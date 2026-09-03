//! Putting a KooKoo caller onto an Asterisk channel.
//!
//! KooKoo will not SIP-INVITE us — `<dial>` reaches PSTN only — so the one way
//! its audio arrives is the `<stream>` verb's WebSocket. That makes the caller a
//! WebSocket session rather than a channel, and a WebSocket session cannot be
//! put in a bridge, handed to a person, or listened to by a supervisor.
//!
//! This makes it a channel. The bridge asks Asterisk (over ARI) to originate an
//! AudioSocket leg back to us; Asterisk connects, and from then on the two
//! sockets are simply piped together:
//!
//! ```text
//!   caller ──KooKoo WS──► bridge ──AudioSocket──► Asterisk channel
//!                          (this module)              │
//!                                                     ├── mixing bridge
//!                                                     └── agent leg → the AI
//! ```
//!
//! **No resampling and no codec.** KooKoo carries PCM16 at 8 kHz and AudioSocket
//! carries PCM16 at 8 kHz, so the whole job is re-framing 10 ms packets into
//! 20 ms frames and back. That is the reason this hop is cheap enough to be
//! worth taking for every call.
//!
//! ## The frame sizes are not the same, and that is the whole difficulty
//!
//! KooKoo sends 80 samples at a time; AudioSocket wants 160. Anything left over
//! has to wait rather than be padded — padding stretches speech, and dropping
//! shortens it. Both directions therefore accumulate.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{Mutex, mpsc};

/// Audio waiting to cross, in one direction.
///
/// Bounded: an unbounded channel between two live sockets is a memory leak
/// wearing the costume of resilience. If one side stalls for two seconds the
/// call is already ruined, and buffering more only makes the recovery worse.
const RELAY_DEPTH: usize = 100;

/// The AudioSocket half of a relay, waiting for Asterisk to connect.
pub struct RelayEnds {
    /// Audio from Asterisk that should go out to the KooKoo caller.
    pub to_kookoo: mpsc::Sender<Vec<u8>>,
    /// Audio from the KooKoo caller that should go to Asterisk.
    pub from_kookoo: mpsc::Receiver<Vec<u8>>,
}

/// The KooKoo half.
pub struct KookooEnds {
    pub to_asterisk: mpsc::Sender<Vec<u8>>,
    pub from_asterisk: mpsc::Receiver<Vec<u8>>,
}

/// Relays waiting for their AudioSocket connection.
///
/// Keyed by the ucid, which is what the channel is originated with and what
/// Asterisk sends back as its first frame — the same correlation `PendingCalls`
/// uses, so there is one idea of "which call is this" rather than two.
#[derive(Clone, Default)]
pub struct Relays {
    inner: Arc<Mutex<HashMap<String, RelayEnds>>>,
}

impl Relays {
    pub fn new() -> Self {
        Self::default()
    }

    /// Set up a relay for `ucid`, returning the KooKoo side of it.
    pub async fn open(&self, ucid: &str) -> KookooEnds {
        let (to_asterisk, from_kookoo) = mpsc::channel(RELAY_DEPTH);
        let (to_kookoo, from_asterisk) = mpsc::channel(RELAY_DEPTH);
        self.inner
            .lock()
            .await
            .insert(ucid.to_string(), RelayEnds { to_kookoo, from_kookoo });
        KookooEnds { to_asterisk, from_asterisk }
    }

    /// Claim the AudioSocket side. Taken, not read: one relay serves one
    /// connection, and a second connection presenting the same ucid is a bug
    /// rather than a second caller.
    pub async fn claim(&self, ucid: &str) -> Option<RelayEnds> {
        self.inner.lock().await.remove(ucid)
    }

    /// Give up on a relay whose Asterisk leg never arrived.
    pub async fn close(&self, ucid: &str) {
        self.inner.lock().await.remove(ucid);
    }

    pub async fn len(&self) -> usize {
        self.inner.lock().await.len()
    }
}

/// Accumulates PCM bytes and hands out fixed-size frames.
///
/// The 10 ms ↔ 20 ms seam. A short frame is never padded and a long one is
/// never truncated — the remainder waits for its other half, which is what
/// keeps speech the length it was spoken.
#[derive(Default)]
pub struct Reframer {
    buffer: Vec<u8>,
    frame_bytes: usize,
}

impl Reframer {
    /// `samples` is per frame; PCM16 is two bytes each.
    pub fn new(samples: usize) -> Self {
        Self { buffer: Vec::new(), frame_bytes: samples * 2 }
    }

    pub fn push(&mut self, pcm: &[u8]) -> Vec<Vec<u8>> {
        self.buffer.extend_from_slice(pcm);
        let mut out = Vec::new();
        while self.buffer.len() >= self.frame_bytes {
            out.push(self.buffer.drain(..self.frame_bytes).collect());
        }
        out
    }

    /// What has not yet made a whole frame. For tests and diagnostics.
    pub fn pending(&self) -> usize {
        self.buffer.len()
    }
}

/// KooKoo's `media` event carries samples as a JSON array of integers.
pub fn samples_to_pcm(samples: &[i64]) -> Vec<u8> {
    samples.iter().flat_map(|s| (*s as i16).to_le_bytes()).collect()
}

pub fn pcm_to_samples(pcm: &[u8]) -> Vec<i16> {
    pcm.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ten_millisecond_packets_become_twenty_millisecond_frames() {
        // KooKoo sends 80 samples; AudioSocket wants 160. One in, nothing out;
        // two in, one frame out.
        let mut r = Reframer::new(160);
        assert!(r.push(&vec![0u8; 160]).is_empty(), "half a frame is not a frame");
        assert_eq!(r.pending(), 160);

        let frames = r.push(&vec![0u8; 160]);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].len(), 320);
        assert_eq!(r.pending(), 0);
    }

    #[test]
    fn a_remainder_waits_rather_than_being_padded() {
        // Padding to fill a frame stretches the utterance by the padding, every
        // time; over a call that is audible drift.
        let mut r = Reframer::new(160);
        let frames = r.push(&vec![7u8; 500]);
        assert_eq!(frames.len(), 1);
        assert_eq!(r.pending(), 180, "the odd 180 bytes stay for the next packet");
    }

    #[test]
    fn samples_round_trip_through_pcm() {
        let original: Vec<i64> = vec![0, 1, -1, 32767, -32768, 1234];
        let pcm = samples_to_pcm(&original);
        assert_eq!(pcm.len(), original.len() * 2);
        let back = pcm_to_samples(&pcm);
        assert_eq!(back, original.iter().map(|s| *s as i16).collect::<Vec<_>>());
    }

    #[tokio::test]
    async fn a_relay_is_claimed_once() {
        // Two connections presenting the same ucid is a bug, not a second
        // caller — and handing the same channels to both would interleave two
        // conversations onto one socket.
        let relays = Relays::new();
        let _kookoo = relays.open("ucid-1").await;
        assert_eq!(relays.len().await, 1);
        assert!(relays.claim("ucid-1").await.is_some());
        assert!(relays.claim("ucid-1").await.is_none());
        assert_eq!(relays.len().await, 0);
    }

    #[tokio::test]
    async fn audio_crosses_in_both_directions() {
        let relays = Relays::new();
        let mut kookoo = relays.open("ucid-2").await;
        let mut asterisk = relays.claim("ucid-2").await.expect("claimed");

        kookoo.to_asterisk.send(vec![1, 2, 3]).await.unwrap();
        assert_eq!(asterisk.from_kookoo.recv().await, Some(vec![1, 2, 3]));

        asterisk.to_kookoo.send(vec![4, 5, 6]).await.unwrap();
        assert_eq!(kookoo.from_asterisk.recv().await, Some(vec![4, 5, 6]));
    }

    #[tokio::test]
    async fn a_relay_nobody_claimed_can_be_closed() {
        // The Asterisk leg failing to arrive must not leave an entry behind for
        // the life of the process.
        let relays = Relays::new();
        let _ = relays.open("ucid-3").await;
        relays.close("ucid-3").await;
        assert_eq!(relays.len().await, 0);
    }
}

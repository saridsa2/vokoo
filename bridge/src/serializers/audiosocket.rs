//! Asterisk's AudioSocket, so a WhatsApp call can reach an agent.
//!
//! WhatsApp Business calls terminate on Asterisk. Asterisk's `chan_audiosocket`
//! then connects **out to us** as a TCP client — `AudioSocket/<host>:<port>/<uuid>`
//! — and carries the call as 8 kHz signed-linear PCM, mono.
//!
//! That rate is the reason this is cheap: it is the same 8 kHz KooKoo already
//! delivers, so the audio path is a re-frame and a resample to the pipeline's
//! 16 kHz — no codec, no transcode. `serializers/kookoo.rs` does exactly that
//! job for the WebSocket side and this mirrors it for the socket side.
//!
//! The wire format is four kinds of frame and nothing else:
//!
//! ```text
//! [type: u8][length: u16 big-endian][payload]
//!
//! 0x00  terminate   the call is over
//! 0x01  uuid        16 raw bytes, sent once, first — the call's identity
//! 0x10  audio       signed linear 16-bit, 8 kHz, mono, little-endian samples
//! 0xff  error       Asterisk reporting a problem with the stream
//! ```
//!
//! Verified against a working implementation rather than recalled: helix's
//! `apps/kookoo-bridge/src/audiosocket.ts` speaks this to the same Asterisk 18
//! box WhatsApp terminates on.

/// What a frame is.
///
/// Kept as a plain `u8` match rather than a derived enum conversion: an unknown
/// kind must be skipped, not refused. Asterisk may add one, and a call is worth
/// more than strictness about a frame nobody needs to read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FrameKind {
    Terminate,
    Uuid,
    Audio,
    Error,
    /// Something this does not know about. Carried so the reader can skip its
    /// payload by length rather than losing sync on the stream.
    Unknown(u8),
}

impl FrameKind {
    fn from_byte(byte: u8) -> Self {
        match byte {
            0x00 => Self::Terminate,
            0x01 => Self::Uuid,
            0x10 => Self::Audio,
            0xff => Self::Error,
            other => Self::Unknown(other),
        }
    }

    fn to_byte(self) -> u8 {
        match self {
            Self::Terminate => 0x00,
            Self::Uuid => 0x01,
            Self::Audio => 0x10,
            Self::Error => 0xff,
            Self::Unknown(byte) => byte,
        }
    }
}

/// One frame off the wire.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AudioSocketFrame {
    pub kind: FrameKind,
    pub payload: Vec<u8>,
}

impl AudioSocketFrame {
    pub fn audio(pcm: Vec<u8>) -> Self {
        Self { kind: FrameKind::Audio, payload: pcm }
    }

    pub fn terminate() -> Self {
        Self { kind: FrameKind::Terminate, payload: Vec::new() }
    }

    /// The frame as bytes, ready to write.
    pub fn encode(&self) -> Vec<u8> {
        let length = self.payload.len().min(u16::MAX as usize);
        let mut out = Vec::with_capacity(3 + length);
        out.push(self.kind.to_byte());
        out.extend_from_slice(&(length as u16).to_be_bytes());
        out.extend_from_slice(&self.payload[..length]);
        out
    }

    /// The uuid a `0x01` frame carries, canonically formatted.
    ///
    /// This is how a socket is tied to a call: the bridge tells Asterisk which
    /// uuid to dial, Asterisk sends it back in the first frame, and that is the
    /// only thing connecting this TCP connection to the call it belongs to.
    pub fn as_uuid(&self) -> Option<String> {
        if self.kind != FrameKind::Uuid || self.payload.len() != 16 {
            return None;
        }
        let b = &self.payload;
        Some(format!(
            "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
            b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
            b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15],
        ))
    }
}

/// Reassembles frames from a TCP stream.
///
/// A socket delivers bytes, not frames: one read can hold half a header, and a
/// 20 ms audio frame can arrive in three pieces. Everything not yet complete
/// stays in `buffer` until it is.
#[derive(Default)]
pub struct FrameReader {
    buffer: Vec<u8>,
}

impl FrameReader {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed what was read; take whatever frames are now complete.
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<AudioSocketFrame> {
        self.buffer.extend_from_slice(bytes);
        let mut frames = Vec::new();
        let mut at = 0usize;

        loop {
            // A header is three bytes. Fewer than that and the length is not
            // yet knowable, so nothing can be decided.
            if self.buffer.len() - at < 3 {
                break;
            }
            let kind = FrameKind::from_byte(self.buffer[at]);
            let length = u16::from_be_bytes([self.buffer[at + 1], self.buffer[at + 2]]) as usize;
            if self.buffer.len() - at < 3 + length {
                break;
            }
            frames.push(AudioSocketFrame {
                kind,
                payload: self.buffer[at + 3..at + 3 + length].to_vec(),
            });
            at += 3 + length;
        }

        // Drain only what was consumed. Draining the whole buffer would discard
        // the partial frame at the end, which is the common case at 20 ms.
        if at > 0 {
            self.buffer.drain(..at);
        }
        frames
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_audio_frame_is_type_length_payload() {
        let frame = AudioSocketFrame::audio(vec![1, 2, 3, 4]);
        let bytes = frame.encode();
        assert_eq!(bytes[0], 0x10);
        assert_eq!(u16::from_be_bytes([bytes[1], bytes[2]]), 4);
        assert_eq!(&bytes[3..], &[1, 2, 3, 4]);
    }

    #[test]
    fn a_uuid_frame_reads_back_as_a_uuid() {
        let raw: Vec<u8> = (0..16).collect();
        let frame = AudioSocketFrame { kind: FrameKind::Uuid, payload: raw };
        assert_eq!(
            frame.as_uuid().as_deref(),
            Some("00010203-0405-0607-0809-0a0b0c0d0e0f"),
        );
    }

    #[test]
    fn only_a_sixteen_byte_uuid_frame_is_a_uuid() {
        // A short one is a malformed frame, not a uuid to be padded or guessed.
        let frame = AudioSocketFrame { kind: FrameKind::Uuid, payload: vec![1, 2, 3] };
        assert_eq!(frame.as_uuid(), None);
        assert_eq!(AudioSocketFrame::audio(vec![0; 16]).as_uuid(), None);
    }

    #[test]
    fn a_frame_split_across_reads_is_reassembled() {
        // The case that actually happens: TCP does not respect frame edges.
        let mut reader = FrameReader::new();
        let whole = AudioSocketFrame::audio(vec![9; 320]).encode();

        assert!(reader.feed(&whole[..2]).is_empty(), "half a header decides nothing");
        assert!(reader.feed(&whole[2..100]).is_empty(), "a partial payload is not a frame");

        let frames = reader.feed(&whole[100..]);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].kind, FrameKind::Audio);
        assert_eq!(frames[0].payload.len(), 320);
    }

    #[test]
    fn several_frames_in_one_read_all_come_out() {
        let mut reader = FrameReader::new();
        let mut bytes = Vec::new();
        bytes.extend(AudioSocketFrame { kind: FrameKind::Uuid, payload: vec![7; 16] }.encode());
        bytes.extend(AudioSocketFrame::audio(vec![1; 320]).encode());
        bytes.extend(AudioSocketFrame::terminate().encode());

        let frames = reader.feed(&bytes);
        assert_eq!(
            frames.iter().map(|f| f.kind).collect::<Vec<_>>(),
            vec![FrameKind::Uuid, FrameKind::Audio, FrameKind::Terminate],
        );
    }

    #[test]
    fn a_trailing_partial_frame_survives_the_drain() {
        // Draining the whole buffer after reading complete frames would throw
        // away the start of the next one — which at 20 ms is most reads.
        let mut reader = FrameReader::new();
        let mut bytes = AudioSocketFrame::audio(vec![1; 8]).encode();
        bytes.extend_from_slice(&[0x10, 0x00]); // half of the next header

        assert_eq!(reader.feed(&bytes).len(), 1);
        // The rest of that header plus a payload completes it.
        let frames = reader.feed(&[0x02, 0xaa, 0xbb]);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].payload, vec![0xaa, 0xbb]);
    }

    #[test]
    fn an_unknown_kind_is_skipped_rather_than_desyncing_the_stream() {
        // Asterisk may add a frame type. Refusing it would cost the call; the
        // length is what lets it be stepped over.
        let mut reader = FrameReader::new();
        let mut bytes = AudioSocketFrame { kind: FrameKind::Unknown(0x42), payload: vec![1, 2, 3] }.encode();
        bytes.extend(AudioSocketFrame::audio(vec![5; 4]).encode());

        let frames = reader.feed(&bytes);
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].kind, FrameKind::Unknown(0x42));
        assert_eq!(frames[1].kind, FrameKind::Audio);
        assert_eq!(frames[1].payload, vec![5; 4]);
    }

    #[test]
    fn a_zero_length_frame_is_a_frame() {
        // Terminate carries nothing, and must not stall the reader.
        let mut reader = FrameReader::new();
        let frames = reader.feed(&AudioSocketFrame::terminate().encode());
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].kind, FrameKind::Terminate);
        assert!(frames[0].payload.is_empty());
    }
}

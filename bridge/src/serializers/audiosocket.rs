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

use async_trait::async_trait;

use crate::audio_process::resamplers::ResamplerQuality;
use crate::frames::{ControlFrame, DataFrame, Frame, FrameInner, SystemFrame};

use super::{FrameSerializer, SerializedInput, SerializedOutput};

/// Telephony audio is narrowband; the same balanced preset the KooKoo and
/// Twilio serializers use.
const RESAMPLER_QUALITY: ResamplerQuality = ResamplerQuality::Medium;

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

// ---------------------------------------------------------------------------
// AudioSocketFrameSerializer
// ---------------------------------------------------------------------------

/// Samples per outbound audio frame — 160 = 20 ms at 8 kHz, which is what
/// Asterisk's own channel driver reads and writes.
///
/// Same lockstep rule as [`KOOKOO_FRAME_SAMPLES`](super::KOOKOO_FRAME_SAMPLES):
/// `serialize()` emits at most one frame per call, so the transport must be
/// built with `audio_out_10ms_chunks = 2`. Hand it more samples than fit and
/// the remainder is buffered until the next chunk — outbound throughput halves
/// and the backlog grows for the whole call.
pub const AUDIOSOCKET_FRAME_SAMPLES: usize = 160;

/// The rate AudioSocket carries. Not configurable: `chan_audiosocket` is
/// specified as 8 kHz signed linear, and a different value here would not
/// change what arrives — it would only mislabel it.
pub const AUDIOSOCKET_SAMPLE_RATE: u32 = 8000;

/// Audio in and out of an AudioSocket connection, at the pipeline's rate.
///
/// The split against [`AudioSocketTransport`](crate::transport::audiosocket) is
/// deliberate and follows the KooKoo pair: **the transport owns the wire, the
/// serializer owns the audio**. So the transport does the framing — it holds
/// the [`FrameReader`], acts on `terminate` itself and hands over only an audio
/// frame's payload — and this resamples, buffers and re-frames.
///
/// One difference from KooKoo is worth stating rather than discovering: there
/// is **no command channel**. KooKoo takes `clearBuffer` and `callDisconnect`
/// as JSON on the same socket; AudioSocket has four frame types and none of
/// them says "stop playing". Barge-in is therefore whatever we can do locally —
/// drop what has not been written yet — and nothing more.
pub struct AudioSocketFrameSerializer {
    /// The pipeline's rate, learned in `setup`.
    sample_rate: u32,
    /// 8 kHz → pipeline. `None` when the pipeline already runs at 8 kHz.
    input_resampler: Option<crate::audio_process::resamplers::StreamResampler>,
    /// pipeline → 8 kHz, rebuilt if a frame arrives at a rate we have not seen.
    output_resampler: Option<(u32, crate::audio_process::resamplers::StreamResampler)>,
    /// Resampled outbound audio waiting to fill a 20 ms frame.
    out_pending: Vec<i16>,
    /// Terminate is sent once. A second one after the socket is closing is at
    /// best ignored and at worst an error in the Asterisk log.
    terminate_sent: bool,
}

impl Default for AudioSocketFrameSerializer {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioSocketFrameSerializer {
    pub fn new() -> Self {
        Self {
            sample_rate: AUDIOSOCKET_SAMPLE_RATE,
            input_resampler: None,
            output_resampler: None,
            out_pending: Vec::new(),
            terminate_sent: false,
        }
    }

    /// Resample an outbound chunk to 8 kHz and append it to `out_pending`.
    fn push_output_audio(&mut self, pcm: &[u8], from_rate: u32) {
        let f32_in = super::kookoo::pcm_bytes_to_f32(pcm);
        if f32_in.is_empty() {
            return;
        }

        if from_rate == AUDIOSOCKET_SAMPLE_RATE {
            self.out_pending.extend(super::kookoo::f32_to_i16(&f32_in));
            return;
        }

        let needs_rebuild = self.output_resampler.as_ref().map(|(r, _)| *r) != Some(from_rate);
        if needs_rebuild {
            self.output_resampler = Some((
                from_rate,
                crate::audio_process::resamplers::StreamResampler::new(
                    from_rate,
                    AUDIOSOCKET_SAMPLE_RATE,
                    RESAMPLER_QUALITY,
                ),
            ));
        }
        if let Some((_, resampler)) = self.output_resampler.as_mut() {
            let resampled = resampler.process(&f32_in);
            self.out_pending.extend(super::kookoo::f32_to_i16(&resampled));
        }
    }

    /// Pop exactly one 20 ms frame if enough audio has accumulated.
    ///
    /// A short frame is never padded with silence: Asterisk plays what it is
    /// given, so padding stretches every utterance by the size of whatever was
    /// left over.
    fn take_frame(&mut self) -> Option<Vec<u8>> {
        if self.out_pending.len() < AUDIOSOCKET_FRAME_SAMPLES {
            return None;
        }
        Some(
            self.out_pending
                .drain(..AUDIOSOCKET_FRAME_SAMPLES)
                .flat_map(|s| s.to_le_bytes())
                .collect(),
        )
    }
}

#[async_trait]
impl FrameSerializer for AudioSocketFrameSerializer {
    async fn setup(&mut self, audio_in_sample_rate: u32, _audio_out_sample_rate: u32) {
        self.sample_rate = audio_in_sample_rate;
        self.input_resampler = if self.sample_rate == AUDIOSOCKET_SAMPLE_RATE {
            None
        } else {
            Some(crate::audio_process::resamplers::StreamResampler::new(
                AUDIOSOCKET_SAMPLE_RATE,
                self.sample_rate,
                RESAMPLER_QUALITY,
            ))
        };
    }

    async fn serialize(&mut self, frame: &Frame) -> Option<SerializedOutput> {
        let is_end_or_cancel = matches!(
            &frame.inner,
            FrameInner::Control(ControlFrame::End { .. })
                | FrameInner::System(SystemFrame::Cancel { .. })
        );
        if is_end_or_cancel && !self.terminate_sent {
            self.terminate_sent = true;
            return Some(SerializedOutput::Binary(AudioSocketFrame::terminate().encode()));
        }

        match &frame.inner {
            // Barge-in. Everything queued was going to be spoken over the
            // caller, so it is dropped. What Asterisk has already been handed
            // is gone — there is no frame type that recalls it — so a long
            // buffer here is heard as the agent talking past the interruption.
            // That is the argument for keeping `out_pending` at one frame.
            FrameInner::System(SystemFrame::Interruption) => {
                self.out_pending.clear();
                None
            }

            FrameInner::Data(DataFrame::OutputAudioRaw(audio)) => {
                self.push_output_audio(&audio.audio, audio.sample_rate);
                Some(SerializedOutput::Binary(
                    AudioSocketFrame::audio(self.take_frame()?).encode(),
                ))
            }

            _ => None,
        }
    }

    /// One audio frame's payload → one input frame.
    ///
    /// The transport hands over the payload of a `0x10` frame and nothing else.
    /// Text never arrives on this socket, so it is refused rather than parsed:
    /// AudioSocket is binary throughout, and a text message here would mean
    /// something is wrong upstream, not that there is audio to salvage.
    async fn deserialize(&mut self, data: &SerializedInput) -> Option<Frame> {
        let pcm = match data {
            SerializedInput::Binary(bytes) => bytes,
            SerializedInput::Text(_) => return None,
        };

        let f32_in = super::kookoo::pcm_bytes_to_f32(pcm);
        if f32_in.is_empty() {
            return None;
        }

        let out = match self.input_resampler.as_mut() {
            Some(r) => r.process(&f32_in),
            None => f32_in,
        };
        if out.is_empty() {
            return None;
        }

        let pcm: Vec<u8> = super::kookoo::f32_to_i16(&out)
            .iter()
            .flat_map(|s| s.to_le_bytes())
            .collect();
        Some(Frame::input_audio(pcm, self.sample_rate, 1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A serializer set up for a 16 kHz pipeline — what a real call uses.
    async fn serializer() -> AudioSocketFrameSerializer {
        let mut s = AudioSocketFrameSerializer::new();
        s.setup(16_000, 16_000).await;
        s
    }

    /// `n` samples of PCM16 — a sawtooth, kept well inside i16 so the test
    /// exercises the resampler rather than an overflow in its own fixture.
    fn pcm(n: usize) -> Vec<u8> {
        (0..n).flat_map(|i| (((i % 64) as i16) * 100).to_le_bytes()).collect()
    }

    #[tokio::test]
    async fn eight_kilohertz_in_becomes_the_pipeline_rate() {
        let mut s = serializer().await;

        // The resampler primes before it produces anything, so the first 20 ms
        // frame yields no audio — worth pinning rather than working around,
        // because it means a call loses its opening frame and not that the
        // path is broken.
        assert!(s.deserialize(&SerializedInput::Binary(pcm(160))).await.is_none());

        let mut got = None;
        for _ in 0..5 {
            if let Some(frame) = s.deserialize(&SerializedInput::Binary(pcm(160))).await {
                got = Some(frame);
                break;
            }
        }

        match got.expect("audio within five frames").inner {
            // Input audio is a *system* frame in rustvani, not a data one — it
            // is carried out of band so a stalled pipeline cannot back it up.
            FrameInner::System(SystemFrame::InputAudioRaw(audio)) => {
                assert_eq!(audio.sample_rate, 16_000);
                assert!(!audio.audio.is_empty());
            }
            other => panic!("expected input audio, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn output_leaves_as_twenty_millisecond_frames() {
        let mut s = serializer().await;
        // 640 samples at 16 kHz = 40 ms = two frames at 8 kHz. The first
        // serialize returns one; the rest stays buffered.
        let out = s
            .serialize(&Frame::output_audio(pcm(640), 16_000, 1))
            .await
            .expect("a frame");
        let SerializedOutput::Binary(bytes) = out else { panic!("audio is binary") };

        let mut reader = FrameReader::new();
        let frames = reader.feed(&bytes);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].kind, FrameKind::Audio);
        assert_eq!(frames[0].payload.len(), AUDIOSOCKET_FRAME_SAMPLES * 2);
    }

    #[tokio::test]
    async fn a_partial_frame_waits_rather_than_being_padded() {
        let mut s = serializer().await;
        // 80 samples at 16 kHz is 40 at 8 kHz — a quarter of a frame. Padding
        // it to 160 would stretch the utterance by 15 ms of silence.
        assert!(s.serialize(&Frame::output_audio(pcm(80), 16_000, 1)).await.is_none());
    }

    #[tokio::test]
    async fn a_barge_in_drops_what_has_not_been_written() {
        let mut s = serializer().await;
        // Buffer most of a frame, interrupt, then send a little more. If the
        // buffer had survived, the leftovers would complete a frame and the
        // caller would hear the tail of an utterance they cut off.
        assert!(s.serialize(&Frame::output_audio(pcm(280), 16_000, 1)).await.is_none());
        assert!(s.serialize(&Frame::interruption()).await.is_none());
        assert!(s.serialize(&Frame::output_audio(pcm(40), 16_000, 1)).await.is_none());
    }

    #[tokio::test]
    async fn ending_the_call_sends_terminate_once() {
        let mut s = serializer().await;
        let end = Frame::end();
        let first = s.serialize(&end).await.expect("terminate");
        assert_eq!(
            first,
            SerializedOutput::Binary(AudioSocketFrame::terminate().encode()),
        );
        // A second End — the pipeline sends one per direction — must not put
        // another terminate on a socket that is already closing.
        assert!(s.serialize(&end).await.is_none());
    }

    #[tokio::test]
    async fn text_on_this_socket_is_not_audio() {
        let mut s = serializer().await;
        assert!(s.deserialize(&SerializedInput::Text("{}".into())).await.is_none());
    }

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

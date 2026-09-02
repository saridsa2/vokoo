//! KooKoo / Ozonetel bidirectional WebSocket protocol serializer.
//!
//! Sibling of [`TwilioFrameSerializer`](super::twilio). KooKoo's protocol is
//! simpler than Twilio's in two ways — audio arrives as a JSON array of PCM16
//! samples rather than base64 µ-law (so no g711 hop), and hang-up is a command
//! on the socket rather than a REST call (so no HTTP client or credentials).
//!
//! It is harder in one way: every outbound packet needs a `seqid` that is both
//! unique and meaningful. The media server keeps a dedupe window of the last
//! 3000 ids and silently drops repeats, so one id per utterance means every
//! chunk after the first vanishes. But a purely random id makes the `mark` you
//! receive on barge-in name a 10 ms fragment and tell you nothing. Prefixing a
//! per-utterance counter satisfies both: `utt-7-00042` resolves to "the caller
//! interrupted utterance 7 after 420 ms".
//!
//! Protocol reference: KooKoo `<stream is_sip="true">` bidirectional audio.
//! PCM Linear, 16-bit, 8000 Hz, mono, 80 samples (10 ms) per packet.

use async_trait::async_trait;
use serde_json::json;

use crate::audio_process::resamplers::{ResamplerQuality, StreamResampler};
use crate::frames::{ControlFrame, DataFrame, Frame, FrameInner, KeypadEntry, SystemFrame};

use super::{FrameSerializer, SerializedInput, SerializedOutput};

/// Telephony audio is narrowband; a balanced preset keeps latency low without
/// audible loss. Matches the Twilio serializer's choice.
const RESAMPLER_QUALITY: ResamplerQuality = ResamplerQuality::Medium;

/// Samples per outbound media packet — 80 = 10 ms at 8 kHz.
///
/// This MUST stay in lockstep with the transport's `audio_out_10ms_chunks`:
/// `serialize()` returns at most one packet per call, so if the transport
/// hands over more samples than fit in a packet, the remainder is buffered and
/// only leaves on the next chunk. That silently halves outbound throughput and
/// the backlog grows for the whole call — it sounds like dropped audio.
///
///   audio_out_10ms_chunks = 1  ->  80 samples   (this value)
///   audio_out_10ms_chunks = 2  ->  160 samples
pub const KOOKOO_FRAME_SAMPLES: usize = 80;

// ---------------------------------------------------------------------------
// InputParams
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct KooKooInputParams {
    /// Sample rate KooKoo uses on the wire. Always 8000 in practice.
    pub kookoo_sample_rate: u32,
    /// Optional override for the pipeline input rate. `None` uses the rate
    /// passed to [`setup`](FrameSerializer::setup).
    pub sample_rate: Option<u32>,
    /// Send `callDisconnect` when an End/Cancel frame is serialized.
    pub auto_hang_up: bool,
    /// Cause code sent with `callDisconnect`.
    pub hangup_cause_code: u16,
}

impl Default for KooKooInputParams {
    fn default() -> Self {
        Self {
            kookoo_sample_rate: 8000,
            sample_rate: None,
            auto_hang_up: true,
            hangup_cause_code: 200,
        }
    }
}

// ---------------------------------------------------------------------------
// KooKooStart — parsed `start` handshake
// ---------------------------------------------------------------------------

/// Identifiers KooKoo sends in its `start` event.
///
/// Two traps live here, both of which have cost people hours:
///
/// * `did` is the number that was **called** (yours). The **caller** is
///   `call_id`. Using `did` as the caller silently attributes every call to
///   your own number.
/// * `x_headers` is a JSON **string**, not an object — KooKoo renames the
///   `x-uui` attribute from the `<stream>` tag and encodes it. It must be
///   parsed, and it is the only channel carrying NewCall params (operator,
///   circle, cid_e164, …) into the WebSocket handler.
#[derive(Debug, Clone)]
pub struct KooKooStart {
    pub ucid: String,
    /// The number that was dialled — *ours*.
    pub did: Option<String>,
    /// The caller's number. From `call_id`, falling back to `x_headers.cid`.
    pub caller: Option<String>,
    /// Everything packed into `x-uui` at NewCall time, already parsed.
    pub headers: serde_json::Value,
}

impl KooKooStart {
    pub fn parse(text: &str) -> Option<Self> {
        let msg: serde_json::Value = serde_json::from_str(text).ok()?;
        if msg.get("event")?.as_str()? != "start" {
            return None;
        }

        // x_headers is a JSON string. Tolerate an object too, in case the
        // platform ever stops double-encoding it.
        let headers = match msg.get("x_headers") {
            Some(serde_json::Value::String(s)) => {
                serde_json::from_str(s).unwrap_or(serde_json::Value::Null)
            }
            Some(v) => v.clone(),
            None => serde_json::Value::Null,
        };

        let caller = msg
            .get("call_id")
            .and_then(|v| v.as_str())
            .or_else(|| headers.get("cid").and_then(|v| v.as_str()))
            .map(String::from);

        Some(Self {
            ucid: msg.get("ucid")?.as_str()?.to_string(),
            did: msg.get("did").and_then(|v| v.as_str()).map(String::from),
            caller,
            headers,
        })
    }
}

// ---------------------------------------------------------------------------
// PCM helpers
// ---------------------------------------------------------------------------

/// Little-endian PCM16 bytes → normalized f32, which is what
/// [`StreamResampler`] operates on.
pub(crate) fn pcm_bytes_to_f32(pcm: &[u8]) -> Vec<f32> {
    pcm.chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0)
        .collect()
}

/// Normalized f32 → i16, clamped rather than wrapped so a hot signal distorts
/// instead of inverting.
pub(crate) fn f32_to_i16(samples: &[f32]) -> Vec<i16> {
    samples
        .iter()
        .map(|s| (s.clamp(-1.0, 1.0) * 32767.0).round() as i16)
        .collect()
}

// ---------------------------------------------------------------------------
// CallCapture — raw wire log
// ---------------------------------------------------------------------------

/// Writes every inbound message to a JSONL file so a real call becomes a
/// replayable fixture.
///
/// Everything we believe about this protocol comes from documentation. A
/// capture from an actual call is the only thing that can contradict it — and
/// it is the difference between "the call worked" and knowing *why*.
///
/// Media packets arrive 100/second, so they are sampled: the first few
/// verbatim (which is where the 16 kHz first-packet claim gets settled), then
/// one in every thousand. Everything that is *not* media — start, stop, mark,
/// dtmf, and anything undocumented — is written in full, because those are
/// rare and are exactly what we do not yet know.
pub struct CallCapture {
    file: std::sync::Mutex<std::io::BufWriter<std::fs::File>>,
    media_seen: std::sync::atomic::AtomicU64,
    other_seen: std::sync::atomic::AtomicU64,
}

impl CallCapture {
    /// Verbatim media packets before sampling kicks in.
    const MEDIA_VERBATIM: u64 = 5;
    /// After that, log one in this many.
    const MEDIA_SAMPLE_EVERY: u64 = 1000;

    pub fn create(path: impl AsRef<std::path::Path>) -> std::io::Result<Self> {
        let file = std::fs::File::create(path)?;
        Ok(Self {
            file: std::sync::Mutex::new(std::io::BufWriter::new(file)),
            media_seen: std::sync::atomic::AtomicU64::new(0),
            other_seen: std::sync::atomic::AtomicU64::new(0),
        })
    }

    fn note(&self, raw: &str, is_media: bool) {
        use std::io::Write;
        use std::sync::atomic::Ordering::Relaxed;

        let n = if is_media {
            let n = self.media_seen.fetch_add(1, Relaxed) + 1;
            let keep = n <= Self::MEDIA_VERBATIM || n % Self::MEDIA_SAMPLE_EVERY == 0;
            if !keep {
                return;
            }
            n
        } else {
            self.other_seen.fetch_add(1, Relaxed) + 1
        };

        if let Ok(mut f) = self.file.lock() {
            let _ = writeln!(f, r#"{{"n":{n},"media":{is_media},"raw":{}}}"#,
                serde_json::Value::String(raw.to_string()));
            let _ = f.flush();
        }
    }

    /// Log a message the serializer never sees — notably `start`, which the
    /// transport layer consumes during the handshake. It carries `x_headers`
    /// and the media metadata, so it is the last thing we want missing.
    pub fn note_raw(&self, raw: &str) {
        self.note(raw, false);
    }

    /// (media packets seen, non-media messages seen)
    pub fn counts(&self) -> (u64, u64) {
        use std::sync::atomic::Ordering::Relaxed;
        (self.media_seen.load(Relaxed), self.other_seen.load(Relaxed))
    }
}

// ---------------------------------------------------------------------------
// KooKooFrameSerializer
// ---------------------------------------------------------------------------

pub struct KooKooFrameSerializer {
    ucid: String,
    params: KooKooInputParams,
    kookoo_sample_rate: u32,
    /// Pipeline input rate; set in [`setup`](FrameSerializer::setup).
    sample_rate: u32,

    /// 8 kHz → pipeline rate for inbound audio. `None` when rates match.
    input_resampler: Option<StreamResampler>,
    /// (source rate, pipeline rate → 8 kHz) for outbound. Built lazily,
    /// rebuilt if a later frame arrives at a different rate.
    output_resampler: Option<(u32, StreamResampler)>,

    /// Samples resampled but not yet emitted. Resampling rarely lands on an
    /// exact multiple of 80, and zero-padding each chunk to fill a frame
    /// injects 10 ms of digital silence several times a second — audible as
    /// clicking. Carrying the remainder instead is the fix.
    out_pending: Vec<i16>,

    /// Bumped on every interruption so `seqid` identifies the utterance.
    utterance: u64,
    chunk: u64,

    /// KooKoo's first packet after connect is 16 kHz / 160 frames and must be
    /// dropped; every packet after it is 8 kHz / 80.
    first_packet_seen: bool,
    hangup_sent: bool,

    /// Optional raw-wire log. `None` in tests and once the protocol is trusted.
    capture: Option<std::sync::Arc<CallCapture>>,
}

impl KooKooFrameSerializer {
    pub fn new(ucid: impl Into<String>, params: KooKooInputParams) -> Self {
        let kookoo_sample_rate = params.kookoo_sample_rate;
        Self {
            ucid: ucid.into(),
            params,
            kookoo_sample_rate,
            sample_rate: 0,
            input_resampler: None,
            output_resampler: None,
            out_pending: Vec::with_capacity(KOOKOO_FRAME_SAMPLES * 4),
            utterance: 1,
            chunk: 0,
            first_packet_seen: false,
            hangup_sent: false,
            capture: None,
        }
    }

    /// Attach a raw-wire log for this call.
    pub fn set_capture(&mut self, capture: std::sync::Arc<CallCapture>) {
        self.capture = Some(capture);
    }

    /// Convenience constructor from a parsed handshake.
    pub fn from_start(start: &KooKooStart, params: KooKooInputParams) -> Self {
        Self::new(start.ucid.clone(), params)
    }

    /// Resample an outbound chunk to 8 kHz and append it to `out_pending`.
    fn push_output_audio(&mut self, pcm: &[u8], from_rate: u32) {
        let f32_in = pcm_bytes_to_f32(pcm);
        if f32_in.is_empty() {
            return;
        }

        if from_rate == self.kookoo_sample_rate {
            self.out_pending.extend(f32_to_i16(&f32_in));
            return;
        }

        let needs_rebuild = self.output_resampler.as_ref().map(|(r, _)| *r) != Some(from_rate);
        if needs_rebuild {
            self.output_resampler = Some((
                from_rate,
                StreamResampler::new(from_rate, self.kookoo_sample_rate, RESAMPLER_QUALITY),
            ));
        }
        if let Some((_, resampler)) = self.output_resampler.as_mut() {
            let resampled = resampler.process(&f32_in);
            self.out_pending.extend(f32_to_i16(&resampled));
        }
    }

    /// Pop exactly one 80-sample packet if enough audio has accumulated.
    fn take_frame(&mut self) -> Option<Vec<i16>> {
        if self.out_pending.len() < KOOKOO_FRAME_SAMPLES {
            return None;
        }
        Some(self.out_pending.drain(..KOOKOO_FRAME_SAMPLES).collect())
    }

    fn media_packet(&mut self, samples: Vec<i16>) -> SerializedOutput {
        self.chunk += 1;
        let n = samples.len();
        SerializedOutput::Text(
            json!({
                "event": "media",
                "type": "media",
                "ucid": self.ucid,
                "seqid": format!("utt-{}-{:05}", self.utterance, self.chunk),
                "data": {
                    "samples": samples,
                    "bitsPerSample": 16,
                    "sampleRate": self.kookoo_sample_rate,
                    "channelCount": 1,
                    "numberOfFrames": n,
                    "type": "data",
                },
            })
            .to_string(),
        )
    }
}

#[async_trait]
impl FrameSerializer for KooKooFrameSerializer {
    async fn setup(&mut self, audio_in_sample_rate: u32, _audio_out_sample_rate: u32) {
        self.sample_rate = self.params.sample_rate.unwrap_or(audio_in_sample_rate);

        self.input_resampler = if self.kookoo_sample_rate == self.sample_rate {
            None
        } else {
            Some(StreamResampler::new(
                self.kookoo_sample_rate,
                self.sample_rate,
                RESAMPLER_QUALITY,
            ))
        };
    }

    async fn serialize(&mut self, frame: &Frame) -> Option<SerializedOutput> {
        // 1. End / Cancel → hang up over the socket. No REST, no credentials.
        let is_end_or_cancel = matches!(
            &frame.inner,
            FrameInner::Control(ControlFrame::End { .. })
                | FrameInner::System(SystemFrame::Cancel { .. })
        );
        if self.params.auto_hang_up && !self.hangup_sent && is_end_or_cancel {
            self.hangup_sent = true;
            return Some(SerializedOutput::Text(
                json!({
                    "command": "callDisconnect",
                    "causeCode": self.params.hangup_cause_code,
                })
                .to_string(),
            ));
        }

        match &frame.inner {
            // 2. Barge-in. Drop anything we had queued — it will never be
            //    heard — and start a new utterance so the `mark` KooKoo sends
            //    back names the utterance the caller actually cut off.
            FrameInner::System(SystemFrame::Interruption) => {
                self.out_pending.clear();
                self.utterance += 1;
                self.chunk = 0;
                Some(SerializedOutput::Text(
                    json!({ "command": "clearBuffer", "sessionId": self.ucid }).to_string(),
                ))
            }

            // 3. Output audio → one 80-sample media packet. Anything left over
            //    stays buffered for the next frame rather than being padded.
            FrameInner::Data(DataFrame::OutputAudioRaw(audio)) => {
                self.push_output_audio(&audio.audio, audio.sample_rate);
                let frame_samples = self.take_frame()?;
                Some(self.media_packet(frame_samples))
            }

            _ => None,
        }
    }

    async fn deserialize(&mut self, data: &SerializedInput) -> Option<Frame> {
        // KooKoo's JSON can arrive in EITHER a text or a binary frame. The Node
        // SDK never noticed the difference because `raw.toString()` flattens
        // both; rejecting binary here drops every media packet silently.
        let owned;
        let text: &str = match data {
            SerializedInput::Text(t) => t,
            SerializedInput::Binary(b) => {
                owned = String::from_utf8_lossy(b).into_owned();
                &owned
            }
        };

        let msg: serde_json::Value = serde_json::from_str(text).ok()?;
        let event = msg.get("event").and_then(|v| v.as_str())?;

        // Log before interpreting, so anything we fail to understand is still
        // on disk. Undocumented events would otherwise vanish silently.
        if let Some(c) = &self.capture {
            let is_media = event == "media"
                && msg.get("type").and_then(|v| v.as_str()) != Some("dtmf");
            c.note(text, is_media);
        }

        // DTMF arrives *inside* a media event, not as its own event type.
        // Matching only on `type == "media"` drops keypresses silently — and
        // this is the right way to collect a PIN or account number, because
        // 8 kHz speech cannot reliably distinguish spoken digits.
        if event == "media" && msg.get("type").and_then(|v| v.as_str()) == Some("dtmf") {
            let signal = msg.get("signal")?.as_str()?;
            return KeypadEntry::from_digit(signal).map(Frame::input_dtmf);
        }

        if event == "media" {
            let data = msg.get("data")?;

            // The first packet after connect is 16 kHz / 160 frames. Feeding
            // it to an 8 kHz pipeline corrupts the start of every call.
            if !self.first_packet_seen {
                self.first_packet_seen = true;
                return None;
            }

            let samples = data.get("samples")?.as_array()?;
            if samples.is_empty() {
                return None;
            }

            let f32_in: Vec<f32> = samples
                .iter()
                .filter_map(|v| v.as_i64())
                .map(|s| s as f32 / 32768.0)
                .collect();

            let out = match self.input_resampler.as_mut() {
                Some(r) => r.process(&f32_in),
                None => f32_in,
            };
            if out.is_empty() {
                return None;
            }

            let pcm: Vec<u8> = f32_to_i16(&out)
                .iter()
                .flat_map(|s| s.to_le_bytes())
                .collect();
            return Some(Frame::input_audio(pcm, self.sample_rate, 1));
        }

        // start / stop / mark are handled by the transport layer, not turned
        // into frames. A `mark` is only ever sent in answer to our own
        // clearBuffer — it is not a per-packet playback receipt, and treating
        // it as one produces an "unacknowledged packets" number that grows for
        // the whole call and means nothing.
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn serializer() -> KooKooFrameSerializer {
        KooKooFrameSerializer::new(
            "21275806501458167",
            KooKooInputParams { auto_hang_up: false, ..Default::default() },
        )
    }

    #[test]
    fn start_parses_x_headers_json_string() {
        let msg = json!({
            "event": "start",
            "ucid": "21275806501458167",
            "did": "918065740671",
            "call_id": "919704665032",
            "x_headers": "{\"cid\":\"919704665032\",\"operator\":\"Airtel\",\"circle\":\"ANDHRA PRADESH\"}"
        })
        .to_string();

        let start = KooKooStart::parse(&msg).unwrap();
        assert_eq!(start.ucid, "21275806501458167");
        // did is OURS, caller is theirs — the distinction that bites people.
        assert_eq!(start.did.as_deref(), Some("918065740671"));
        assert_eq!(start.caller.as_deref(), Some("919704665032"));
        assert_eq!(start.headers["operator"], "Airtel");
        assert_eq!(start.headers["circle"], "ANDHRA PRADESH");
    }

    #[test]
    fn start_rejects_non_start_events() {
        let stop = json!({ "event": "stop", "ucid": "x" }).to_string();
        assert!(KooKooStart::parse(&stop).is_none());
    }

    #[tokio::test]
    async fn first_media_packet_is_discarded() {
        let mut s = serializer();
        s.setup(8000, 8000).await;

        // KooKoo's first packet: 16 kHz, 160 frames. Must not reach the pipeline.
        let first = json!({
            "event": "media", "type": "media",
            "data": { "samples": vec![100i32; 160], "sampleRate": 16000, "numberOfFrames": 160 }
        })
        .to_string();
        assert!(s.deserialize(&SerializedInput::Text(first)).await.is_none());

        let second = json!({
            "event": "media", "type": "media",
            "data": { "samples": vec![100i32; 80], "sampleRate": 8000, "numberOfFrames": 80 }
        })
        .to_string();
        let frame = s.deserialize(&SerializedInput::Text(second)).await.unwrap();
        assert_eq!(frame.name(), "InputAudioRawFrame");
    }

    #[tokio::test]
    async fn dtmf_nested_in_media_event_is_caught() {
        let mut s = serializer();
        s.setup(8000, 8000).await;
        let msg = json!({ "event": "media", "type": "dtmf", "signal": "5" }).to_string();
        let frame = s.deserialize(&SerializedInput::Text(msg)).await.unwrap();
        assert_eq!(frame.name(), "InputDTMFFrame");
    }

    #[tokio::test]
    async fn interruption_clears_buffer_and_starts_new_utterance() {
        let mut s = serializer();
        s.setup(8000, 8000).await;

        let pcm: Vec<u8> = vec![0i16; 80].iter().flat_map(|x| x.to_le_bytes()).collect();
        s.serialize(&Frame::output_audio(pcm, 8000, 1)).await.unwrap();

        let out = s.serialize(&Frame::interruption()).await.unwrap();
        let SerializedOutput::Text(json) = out else { panic!("expected text") };
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["command"], "clearBuffer");
        assert_eq!(v["sessionId"], "21275806501458167");
        assert_eq!(s.utterance, 2);
        assert_eq!(s.chunk, 0);
        assert!(s.out_pending.is_empty());
    }

    #[tokio::test]
    async fn output_audio_emits_exactly_80_samples_with_unique_seqids() {
        let mut s = serializer();
        s.setup(8000, 8000).await;

        let mut seqids = Vec::new();
        for _ in 0..3 {
            let pcm: Vec<u8> = vec![1234i16; 80].iter().flat_map(|x| x.to_le_bytes()).collect();
            let out = s.serialize(&Frame::output_audio(pcm, 8000, 1)).await.unwrap();
            let SerializedOutput::Text(json) = out else { panic!("expected text") };
            let v: serde_json::Value = serde_json::from_str(&json).unwrap();

            assert_eq!(v["event"], "media");
            assert_eq!(v["ucid"], "21275806501458167");
            assert_eq!(v["data"]["numberOfFrames"], 80);
            assert_eq!(v["data"]["samples"].as_array().unwrap().len(), 80);
            seqids.push(v["seqid"].as_str().unwrap().to_string());
        }

        // Unique per packet — the dedupe window silently drops repeats.
        assert_eq!(seqids, vec!["utt-1-00001", "utt-1-00002", "utt-1-00003"]);
    }

    #[tokio::test]
    async fn partial_audio_is_buffered_not_zero_padded() {
        let mut s = serializer();
        s.setup(8000, 8000).await;

        // 40 samples — half a packet. Must produce nothing rather than pad.
        let pcm: Vec<u8> = vec![7i16; 40].iter().flat_map(|x| x.to_le_bytes()).collect();
        assert!(s.serialize(&Frame::output_audio(pcm, 8000, 1)).await.is_none());
        assert_eq!(s.out_pending.len(), 40);

        // Another 40 completes it.
        let pcm: Vec<u8> = vec![7i16; 40].iter().flat_map(|x| x.to_le_bytes()).collect();
        assert!(s.serialize(&Frame::output_audio(pcm, 8000, 1)).await.is_some());
        assert!(s.out_pending.is_empty());
    }

    /// Build a sine tone as PCM16 at `rate`.
    fn tone(rate: u32, secs: f32, hz: f32, amp: f32) -> Vec<i16> {
        let n = (rate as f32 * secs) as usize;
        (0..n)
            .map(|i| {
                let t = i as f32 / rate as f32;
                ((t * hz * std::f32::consts::TAU).sin() * amp * 32767.0) as i16
            })
            .collect()
    }

    fn rms(s: &[i16]) -> f64 {
        if s.is_empty() {
            return 0.0;
        }
        let sum: f64 = s.iter().map(|&x| (x as f64).powi(2)).sum();
        (sum / s.len() as f64).sqrt()
    }

    fn kookoo_media(samples: &[i16]) -> String {
        json!({
            "event": "media", "type": "media",
            "data": {
                "samples": samples, "bitsPerSample": 16, "sampleRate": 8000,
                "channelCount": 1, "numberOfFrames": samples.len(), "type": "data"
            }
        })
        .to_string()
    }

    /// The path none of the other tests exercise: pipeline at 16 kHz, so both
    /// resamplers engage. If the f32 scale convention is wrong, amplitude
    /// collapses or clips here rather than erroring anywhere.
    #[tokio::test]
    async fn audio_survives_8k_to_16k_and_back() {
        let mut s = serializer();
        s.setup(16_000, 16_000).await;
        assert!(s.input_resampler.is_some(), "16k pipeline must resample inbound");

        let input = tone(8000, 1.0, 440.0, 0.5);

        // Burn the mandatory discarded first packet.
        let _ = s
            .deserialize(&SerializedInput::Text(kookoo_media(&vec![0i16; 160])))
            .await;

        let mut echoed = Vec::new();
        for chunk in input.chunks(KOOKOO_FRAME_SAMPLES) {
            let frame = s
                .deserialize(&SerializedInput::Text(kookoo_media(chunk)))
                .await;
            let Some(frame) = frame else { continue };
            // Echo: whatever came in at pipeline rate goes straight back out.
            let FrameInner::System(SystemFrame::InputAudioRaw(a)) = &frame.inner else {
                panic!("expected InputAudioRaw");
            };
            let out = Frame::output_audio(a.audio.clone(), a.sample_rate, 1);
            if let Some(SerializedOutput::Text(t)) = s.serialize(&out).await {
                let v: serde_json::Value = serde_json::from_str(&t).unwrap();
                let arr = v["data"]["samples"].as_array().unwrap();
                assert_eq!(arr.len(), KOOKOO_FRAME_SAMPLES, "every packet is 80 samples");
                echoed.extend(arr.iter().map(|x| x.as_i64().unwrap() as i16));
            }
        }

        assert!(!echoed.is_empty(), "round trip produced no audio");

        let (a, b) = (rms(&input), rms(&echoed));
        let ratio = b / a;
        assert!(
            (0.8..=1.25).contains(&ratio),
            "amplitude not preserved through 8k->16k->8k: in_rms={a:.1} out_rms={b:.1} ratio={ratio:.3}"
        );
    }

    /// The clicking bug: if partial chunks were zero-padded to fill a frame,
    /// the output would contain runs of digital silence several times a second
    /// in the middle of continuous tone.
    #[tokio::test]
    async fn continuous_input_produces_no_silent_runs() {
        let mut s = serializer();
        s.setup(16_000, 16_000).await;

        let input = tone(8000, 1.0, 440.0, 0.5);
        let _ = s
            .deserialize(&SerializedInput::Text(kookoo_media(&vec![0i16; 160])))
            .await;

        let mut echoed = Vec::new();
        for chunk in input.chunks(KOOKOO_FRAME_SAMPLES) {
            if let Some(frame) = s
                .deserialize(&SerializedInput::Text(kookoo_media(chunk)))
                .await
            {
                let FrameInner::System(SystemFrame::InputAudioRaw(a)) = &frame.inner else {
                    continue;
                };
                let out = Frame::output_audio(a.audio.clone(), a.sample_rate, 1);
                if let Some(SerializedOutput::Text(t)) = s.serialize(&out).await {
                    let v: serde_json::Value = serde_json::from_str(&t).unwrap();
                    echoed.extend(
                        v["data"]["samples"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .map(|x| x.as_i64().unwrap() as i16),
                    );
                }
            }
        }

        // A 440 Hz tone crosses zero legitimately, but never sits at exactly 0
        // for a quarter of a frame. 20+ consecutive zeros means padding.
        let mut run = 0usize;
        let mut worst = 0usize;
        for &x in &echoed {
            if x == 0 {
                run += 1;
                worst = worst.max(run);
            } else {
                run = 0;
            }
        }
        assert!(worst < 20, "found {worst} consecutive zero samples — looks like frame padding");
    }

    #[tokio::test]
    async fn end_frame_sends_call_disconnect() {
        let mut s = KooKooFrameSerializer::new("ucid-1", KooKooInputParams::default());
        s.setup(8000, 8000).await;
        let out = s.serialize(&Frame::end()).await.unwrap();
        let SerializedOutput::Text(json) = out else { panic!("expected text") };
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["command"], "callDisconnect");
        assert_eq!(v["causeCode"], 200);
    }
}

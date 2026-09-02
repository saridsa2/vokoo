//! A call carried over Asterisk's AudioSocket, on a plain TCP connection.
//!
//! Sibling of [`WebSocketTransport`](crate::transport::WebSocketTransport), and
//! deliberately the same shape: a `tokio::select!` loop with one arm reading
//! the socket into the pipeline and one arm writing the pipeline out. rustvani
//! already keeps one such loop per transport — websocket, vaniwebrtc — so this
//! follows that pattern rather than trying to make the WebSocket one generic
//! over a wire it was written against `axum::extract::ws::WebSocket` for.
//!
//! Three things differ from the WebSocket transport, and each is a decision
//! rather than an omission:
//!
//! 1. **Asterisk connects to us.** `chan_audiosocket` is the TCP *client*, so
//!    there is no upgrade, no handshake and no headers — the first frame is a
//!    uuid and that is the only thing tying the connection to a call.
//! 2. **The wire is framed, not message-oriented.** TCP delivers bytes, so
//!    [`FrameReader`] reassembles them. One read can carry three frames or a
//!    third of one.
//! 3. **There is no text channel.** Everything is binary. RAVI JSON has nowhere
//!    to go and is dropped rather than written — writing it would put JSON
//!    bytes into an audio frame, which Asterisk plays as noise.

use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::sync::mpsc;

use crate::frames::{Frame, FrameDirection, FrameInner, FrameProcessor, SystemFrame};
use crate::serializers::{
    AudioSocketFrame, FrameKind, FrameReader, FrameSerializer, SerializedInput, SerializedOutput,
};
use crate::transport::output::OutputMessage;
use crate::transport::{BaseTransport, TransportParams};

/// How long to wait for the uuid frame before giving up on a connection.
///
/// Asterisk sends it immediately on connect, so this is not a latency budget —
/// it is what stops a port scanner or a half-open connection from holding a
/// task for the life of the process.
pub const UUID_WAIT: Duration = Duration::from_secs(5);

/// Read size. An AudioSocket frame is 323 bytes, so this holds a handful of
/// them without being large enough to add latency by waiting to fill.
const READ_BUFFER: usize = 4096;

/// How often a frame goes out — 20 ms, one frame, always.
///
/// **AudioSocket is a clocked stream, not an event stream.** `app_audiosocket`
/// waits on the socket and hangs the call up after 2 s with
///
/// > Reached timeout after 2000 ms of no activity on AudioSocket connection
///
/// so a transport that writes only when the pipeline has something to say ends
/// every call two seconds after it starts. That is what the first version of
/// this did, mirroring the WebSocket transport onto a wire that does not work
/// the same way, and it is what the local test caught.
const FRAME_INTERVAL: Duration = Duration::from_millis(20);

/// One frame of silence, for a tick with nothing queued.
///
/// Sized to the wire, not to a constant: 320 bytes at 8 kHz, 640 at 16 kHz.
/// A fixed 320 on a wideband channel is half a frame every 20 ms, which
/// Asterisk plays as audio running at half speed — noise, not silence.
fn silence(wire_rate: u32) -> Vec<u8> {
    let pcm = vec![0u8; crate::serializers::audiosocket::frame_samples(wire_rate) * 2];
    AudioSocketFrame::audio(pcm).encode()
}

/// The most audio allowed to wait — two seconds.
///
/// **A deep queue is never answered by writing faster.** An earlier version
/// wrote a second frame whenever the queue passed a threshold, to "catch up";
/// on a wire clocked at 50 frames a second that plays the call at double speed,
/// which sounds like interference rather than like a fault. The caller hears
/// noise and every diagnostic looks healthy.
///
/// So the clock is fixed at real time and the queue is bounded instead. Past
/// the bound the oldest frames go: audio that is more than two seconds late has
/// been overtaken by the conversation, and dropping it is what lets the rest
/// arrive on time.
const MAX_QUEUE_FRAMES: usize = 100;

const AUDIO_OUT_CHANNEL_CAP: usize = 150;

/// One second of frames, the threshold worth mentioning in the log.
const FRAMES_PER_SECOND_USIZE: usize = 50;

// ---------------------------------------------------------------------------
// AudioSocketParams
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct AudioSocketParams {
    pub transport: TransportParams,
    /// What the wire carries. Must match the serializer's.
    pub wire_rate: u32,
}

impl Default for AudioSocketParams {
    fn default() -> Self {
        Self {
            transport: TransportParams {
                audio_in_enabled: true,
                audio_in_sample_rate: Some(16_000),
                audio_in_channels: 1,
                audio_in_passthrough: true,
                audio_in_stream_on_start: true,
                // 20 ms, matching `AUDIOSOCKET_FRAME_SAMPLES`. The serializer
                // emits at most one frame per call, so a larger chunk here
                // leaves the remainder buffered and halves outbound throughput
                // for the rest of the call.
                audio_out_10ms_chunks: 2,
                ..TransportParams::default()
            },
            wire_rate: crate::serializers::AUDIOSOCKET_SAMPLE_RATE,
        }
    }
}

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

/// What [`await_uuid`] learned, and everything it read getting there.
///
/// `pending` exists because the first read is usually not only the uuid:
/// Asterisk writes it and starts streaming immediately, so one 4 KB read can
/// hold the uuid and a dozen audio frames. Those frames have already been
/// pulled out of the reader — keeping only the reader would silently drop the
/// first quarter-second of every call.
pub struct AudioSocketHandshake {
    /// The call's identity, and the only thing tying this socket to a call.
    pub uuid: String,
    /// Frames that arrived after the uuid in the same read.
    pub pending: Vec<AudioSocketFrame>,
    /// Partial bytes, for the loop to continue from.
    pub reader: FrameReader,
}

/// Read until the uuid arrives.
///
/// Sibling of `await_kookoo_start` on the WebSocket side — same job, one
/// handshake earlier, because AudioSocket carries no call metadata at all.
pub async fn await_uuid(
    stream: &mut TcpStream,
    timeout: Duration,
) -> Option<AudioSocketHandshake> {
    let mut reader = FrameReader::new();
    let mut buffer = vec![0u8; READ_BUFFER];
    let deadline = tokio::time::Instant::now() + timeout;

    loop {
        let read = tokio::time::timeout_at(deadline, stream.read(&mut buffer)).await;
        let n = match read {
            Ok(Ok(0)) => {
                log::warn!("AudioSocket: connection closed before the uuid arrived");
                return None;
            }
            Ok(Ok(n)) => n,
            Ok(Err(e)) => {
                log::warn!("AudioSocket: read failed before the uuid arrived: {e}");
                return None;
            }
            Err(_) => {
                log::warn!("AudioSocket: no uuid within {timeout:?}, dropping the connection");
                return None;
            }
        };

        let mut frames = reader.feed(&buffer[..n]).into_iter();
        while let Some(frame) = frames.next() {
            if let Some(uuid) = frame.as_uuid() {
                return Some(AudioSocketHandshake {
                    uuid,
                    pending: frames.collect(),
                    reader,
                });
            }
            // Anything before the uuid cannot be attributed to a call, so it
            // is dropped rather than buffered for one we have not identified.
            log::debug!("AudioSocket: {:?} frame before the uuid, ignored", frame.kind);
        }
    }
}

// ---------------------------------------------------------------------------
// AudioSocketTransport
// ---------------------------------------------------------------------------

pub struct AudioSocketTransport {
    base: Arc<BaseTransport>,
    audio_out_rx: std::sync::Mutex<Option<mpsc::Receiver<OutputMessage>>>,
    serializer: std::sync::Mutex<Option<Box<dyn FrameSerializer>>>,
    audio_in_sample_rate: u32,
    audio_out_sample_rate: u32,
    wire_rate: u32,
}

impl AudioSocketTransport {
    pub fn new(name: &str, params: AudioSocketParams) -> Self {
        let audio_in_sample_rate = params.transport.audio_in_sample_rate.unwrap_or(16_000);
        let audio_out_sample_rate =
            params.transport.audio_out_sample_rate.unwrap_or(audio_in_sample_rate);

        let base = Arc::new(BaseTransport::new(name, params.transport));

        let (audio_out_tx, audio_out_rx) = mpsc::channel::<OutputMessage>(AUDIO_OUT_CHANNEL_CAP);
        base.set_audio_out_tx(audio_out_tx);

        Self {
            base,
            audio_out_rx: std::sync::Mutex::new(Some(audio_out_rx)),
            serializer: std::sync::Mutex::new(None),
            audio_in_sample_rate,
            audio_out_sample_rate,
            wire_rate: params.wire_rate,
        }
    }

    pub fn input(&self) -> FrameProcessor {
        self.base.input()
    }

    pub fn output(&self) -> FrameProcessor {
        self.base.output()
    }

    /// Install the wire serializer. Call before [`run_socket`](Self::run_socket).
    ///
    /// Unlike the WebSocket transport this has no raw path to fall back to: an
    /// AudioSocket connection with no serializer would be 8 kHz PCM handed to a
    /// 16 kHz pipeline, which is not silence but a call that sounds slowed
    /// down — worse than refusing.
    pub fn set_serializer(&self, serializer: Box<dyn FrameSerializer>) {
        *self.serializer.lock().unwrap() = Some(serializer);
    }

    /// Drive the connection until it closes.
    ///
    /// Takes the whole [`AudioSocketHandshake`] rather than just the socket:
    /// the frames it already read belong to this call and are played into the
    /// pipeline before the loop starts.
    pub async fn run_socket(
        &self,
        stream: TcpStream,
        handshake: AudioSocketHandshake,
        push_tx: mpsc::Sender<(Frame, FrameDirection)>,
    ) {
        let AudioSocketHandshake { pending, mut reader, .. } = handshake;
        let mut audio_out_rx = self
            .audio_out_rx
            .lock()
            .unwrap()
            .take()
            .expect("run_socket called more than once on the same AudioSocketTransport");

        let mut serializer = match self.serializer.lock().unwrap().take() {
            Some(ser) => ser,
            None => {
                log::error!("AudioSocketTransport: no serializer installed, refusing the call");
                return;
            }
        };
        serializer.setup(self.audio_in_sample_rate, self.audio_out_sample_rate).await;

        let base = self.base.clone();
        // Split so the two arms can read and write at once. A single handle
        // would make an outbound write wait for an inbound read, which at 20 ms
        // is audible.
        let (mut rx_half, mut tx_half): (OwnedReadHalf, OwnedWriteHalf) = stream.into_split();
        let mut buffer = vec![0u8; READ_BUFFER];

        // Frames waiting for their tick. The pipeline decides *what* goes out;
        // the clock below decides *when*.
        let mut outbound: std::collections::VecDeque<Vec<u8>> = std::collections::VecDeque::new();
        let quiet = silence(self.wire_rate);
        // `AUDIOSOCKET_TONE=440` replaces everything the pipeline says with a
        // sine wave. It separates the two halves of "the caller hears noise":
        // a clean tone means the framing, the clock and the wire are right and
        // the fault is in what the pipeline produced; a noisy tone means the
        // fault is here and no amount of looking at the audio will show it.
        let tone_hz: Option<f64> = std::env::var("AUDIOSOCKET_TONE")
            .ok()
            .and_then(|v| v.parse().ok())
            .filter(|hz| *hz > 0.0);
        let mut tone_phase = 0f64;
        let tone_frame = |phase: &mut f64, hz: f64, rate: u32, samples: usize| -> Vec<u8> {
            let step = std::f64::consts::TAU * hz / rate as f64;
            let mut out = Vec::with_capacity(samples * 2);
            for _ in 0..samples {
                let v = (phase.sin() * 8000.0) as i16;
                *phase += step;
                if *phase > std::f64::consts::TAU {
                    *phase -= std::f64::consts::TAU;
                }
                out.extend_from_slice(&v.to_le_bytes());
            }
            AudioSocketFrame::audio(out).encode()
        };
        let mut clock = tokio::time::interval(FRAME_INTERVAL);
        // A tick that arrives late must not cause a burst of catch-up ticks —
        // that would write a second of audio in a few milliseconds and Asterisk
        // would play it as a squeak.
        clock.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut deepest = 0usize;
        let mut dropped = 0usize;

        // Instrumentation. A wire clocked at 50 frames a second is either
        // running at that rate or it is not, and every theory about why a call
        // sounds wrong is guesswork until this is on the record.
        let mut frames_in = 0u64;
        let mut frames_out = 0u64;
        let started = std::time::Instant::now();
        let mut last_report = started;
        // `AUDIOSOCKET_DUMP=/tmp` writes the raw PCM of both directions, so the
        // audio itself can be examined rather than reasoned about.
        let dump_dir = std::env::var("AUDIOSOCKET_DUMP").ok();
        let mut dump_in = dump_dir.as_ref().and_then(|d| {
            std::fs::File::create(format!("{d}/as-in.raw")).ok()
        });
        let mut dump_out = dump_dir.as_ref().and_then(|d| {
            std::fs::File::create(format!("{d}/as-out.raw")).ok()
        });

        // Whatever came in with the uuid, through the same handler the loop
        // uses. A second copy of this dispatch is how the two would drift.
        let mut running = true;
        for frame in pending {
            if !Self::handle_incoming(frame, &mut serializer, &base, &push_tx).await {
                running = false;
                break;
            }
        }

        while running {
            tokio::select! {
                // ------------------------------------------------------------
                // Arm 1: Asterisk → pipeline
                // ------------------------------------------------------------
                read = rx_half.read(&mut buffer) => {
                    let n = match read {
                        Ok(0) => {
                            log::debug!("AudioSocketTransport: Asterisk closed the connection");
                            break;
                        }
                        Ok(n) => n,
                        Err(e) => {
                            log::warn!("AudioSocketTransport: read failed: {e}");
                            break;
                        }
                    };

                    let mut ended = false;
                    for frame in reader.feed(&buffer[..n]) {
                        if frame.kind == FrameKind::Audio {
                            frames_in += 1;
                            if let Some(f) = dump_in.as_mut() {
                                use std::io::Write;
                                let _ = f.write_all(&frame.payload);
                            }
                        }
                        if !Self::handle_incoming(frame, &mut serializer, &base, &push_tx).await {
                            ended = true;
                            break;
                        }
                    }
                    if ended {
                        break;
                    }
                }

                // ------------------------------------------------------------
                // Arm 2: pipeline → Asterisk
                // ------------------------------------------------------------
                output_msg = audio_out_rx.recv() => {
                    match output_msg {
                        Some(OutputMessage::Audio(bytes)) => {
                            let frame = Frame::output_audio(bytes, self.audio_out_sample_rate, 1);
                            if let Some(SerializedOutput::Binary(out)) =
                                serializer.serialize(&frame).await
                            {
                                outbound.push_back(out);
                                deepest = deepest.max(outbound.len());
                                while outbound.len() > MAX_QUEUE_FRAMES {
                                    outbound.pop_front();
                                    dropped += 1;
                                }
                            }
                        }

                        // RAVI text. There is no channel for it on this wire,
                        // and writing it would land JSON inside an audio frame.
                        Some(OutputMessage::Text(_)) => {}

                        Some(OutputMessage::Interruption) => {
                            while let Ok(queued) = audio_out_rx.try_recv() {
                                match queued {
                                    OutputMessage::Audio(_) => {}
                                    OutputMessage::Interruption => break,
                                    OutputMessage::Text(_) => {}
                                }
                            }
                            // Everything queued was going to be spoken over the
                            // caller. Dropping it here is the only barge-in
                            // this wire has — what Asterisk already holds is
                            // gone, which is why the queue is kept shallow.
                            outbound.clear();
                            // Clears the serializer's own part-frame; returns
                            // nothing, because AudioSocket has no "stop
                            // playing" to send.
                            let _ = serializer.serialize(&Frame::interruption()).await;
                        }

                        None => break, // pipeline shut down
                    }
                }

                // ------------------------------------------------------------
                // Arm 3: the clock. One frame every 20 ms, without exception.
                // ------------------------------------------------------------
                _ = clock.tick() => {
                    // Silence when there is nothing to say. Not an idle state:
                    // it is what holds the call up between the caller's
                    // question and the agent's answer.
                    let frame = match tone_hz {
                        Some(hz) => tone_frame(
                            &mut tone_phase,
                            hz,
                            self.wire_rate,
                            crate::serializers::audiosocket::frame_samples(self.wire_rate),
                        ),
                        None => outbound.pop_front().unwrap_or_else(|| quiet.clone()),
                    };
                    frames_out += 1;
                    if let Some(f) = dump_out.as_mut() {
                        use std::io::Write;
                        let _ = f.write_all(&frame);
                    }
                    // Written verbatim. Everything in this queue is ALREADY a
                    // complete frame — the serializer encodes, and so do the
                    // silence and tone builders above.
                    //
                    // Wrapping it again here is what made the agent's voice
                    // arrive as noise while silence and a test tone came
                    // through perfectly: only pipeline audio passes the
                    // serializer, so only pipeline audio was double-encoded
                    // into a 326-byte frame whose first three payload bytes
                    // were an inner header, misaligning every sample after it.
                    if tx_half.write_all(&frame).await.is_err() {
                        log::warn!("AudioSocketTransport: failed to send audio");
                        break;
                    }

                    // Every five seconds, the two numbers that decide whether
                    // the wire is being fed correctly. Both should read 50.
                    if last_report.elapsed() >= Duration::from_secs(5) {
                        let secs = started.elapsed().as_secs_f64();
                        log::info!(
                            "AudioSocket rates: out {:.1}/s, in {:.1}/s, queue {} (target 50/s each)",
                            frames_out as f64 / secs,
                            frames_in as f64 / secs,
                            outbound.len(),
                        );
                        last_report = std::time::Instant::now();
                    }

                }
            }
        }

        if deepest > FRAMES_PER_SECOND_USIZE {
            log::info!(
                "AudioSocketTransport: outbound queue reached {deepest} frames ({} ms), {dropped} dropped",
                deepest * 20,
            );
        }

        // Best-effort teardown: tell Asterisk the call is over so it returns to
        // the dialplan rather than waiting on a socket that has stopped
        // talking. The write may already be failing, which is why it is not
        // checked.
        if let Some(out) = serializer.serialize(&Frame::end()).await {
            let _ = Self::write(&mut tx_half, out).await;
        }
        let _ = tx_half.write_all(&AudioSocketFrame::terminate().encode()).await;
        let _ = tx_half.flush().await;

        let _ = push_tx.send((Frame::end(), FrameDirection::Downstream)).await;
    }

    /// One wire frame into the pipeline. Returns false when the call is over.
    ///
    /// The single place a `FrameKind` is interpreted, used by both the leftover
    /// frames from the handshake and the read loop.
    async fn handle_incoming(
        frame: AudioSocketFrame,
        serializer: &mut Box<dyn FrameSerializer>,
        base: &BaseTransport,
        push_tx: &mpsc::Sender<(Frame, FrameDirection)>,
    ) -> bool {
        match frame.kind {
            FrameKind::Audio => {
                let input = SerializedInput::Binary(frame.payload);
                if let Some(f) = serializer.deserialize(&input).await {
                    Self::dispatch_incoming_frame(base, push_tx, f).await;
                }
                true
            }
            FrameKind::Terminate => {
                log::debug!("AudioSocketTransport: Asterisk sent terminate");
                false
            }
            // Asterisk reporting a problem with the stream. Nothing here can
            // act on it — this protocol has no retry — so it is logged and the
            // socket is left to close on its own terms.
            FrameKind::Error => {
                log::warn!("AudioSocketTransport: Asterisk error frame: {:?}", frame.payload);
                true
            }
            // The uuid is sent once, before the loop. A second one means
            // something is confused; the call is identified either way.
            FrameKind::Uuid => true,
            FrameKind::Unknown(kind) => {
                log::debug!("AudioSocketTransport: unknown frame 0x{kind:02x}");
                true
            }
        }
    }

    /// Audio to the input transport, everything else downstream — the same
    /// split the WebSocket transport makes.
    async fn dispatch_incoming_frame(
        base: &BaseTransport,
        push_tx: &mpsc::Sender<(Frame, FrameDirection)>,
        frame: Frame,
    ) {
        match frame.inner {
            FrameInner::System(SystemFrame::InputAudioRaw(data)) => {
                base.push_audio_frame(data).await;
            }
            _ => {
                let _ = push_tx.send((frame, FrameDirection::Downstream)).await;
            }
        }
    }

    async fn write(half: &mut OwnedWriteHalf, out: SerializedOutput) -> std::io::Result<()> {
        match out {
            SerializedOutput::Binary(bytes) => half.write_all(&bytes).await,
            // Unreachable with the AudioSocket serializer, which never produces
            // text. Refused rather than encoded, because the alternative is
            // putting a JSON string on the wire where audio is expected.
            SerializedOutput::Text(t) => {
                log::warn!("AudioSocketTransport: dropping text output: {t}");
                Ok(())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    /// Connect to a throwaway listener and hand back both ends.
    async fn pair() -> (TcpStream, TcpStream) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let client = tokio::spawn(async move { TcpStream::connect(addr).await.unwrap() });
        let (server, _) = listener.accept().await.unwrap();
        (server, client.await.unwrap())
    }

    #[tokio::test]
    async fn the_uuid_frame_identifies_the_call() {
        let (mut server, mut asterisk) = pair().await;
        let uuid = AudioSocketFrame { kind: FrameKind::Uuid, payload: (0..16).collect() };
        asterisk.write_all(&uuid.encode()).await.unwrap();

        let got = await_uuid(&mut server, UUID_WAIT).await.expect("a uuid");
        assert_eq!(got.uuid, "00010203-0405-0607-0809-0a0b0c0d0e0f");
    }

    #[tokio::test]
    async fn audio_arriving_with_the_uuid_is_not_lost() {
        // Asterisk writes the uuid and starts streaming; both land in one read,
        // so `feed` returns them together. Returning at the uuid and keeping
        // only the reader drops the audio on the floor — which is what the
        // first version of this did, and what this test caught.
        let (mut server, mut asterisk) = pair().await;
        let mut bytes = AudioSocketFrame { kind: FrameKind::Uuid, payload: vec![7; 16] }.encode();
        bytes.extend(AudioSocketFrame::audio(vec![1; 320]).encode());
        bytes.extend(AudioSocketFrame::audio(vec![2; 320]).encode());
        asterisk.write_all(&bytes).await.unwrap();

        let got = await_uuid(&mut server, UUID_WAIT).await.expect("a uuid");
        assert_eq!(got.pending.len(), 2, "the audio that came with the uuid");
        assert!(got.pending.iter().all(|f| f.kind == FrameKind::Audio));
    }

    #[tokio::test]
    async fn a_connection_that_says_nothing_is_dropped() {
        // A scanner, or a half-open connection. Without the timeout this holds
        // a task for the life of the process.
        let (mut server, _asterisk) = pair().await;
        let waited = std::time::Instant::now();
        assert!(await_uuid(&mut server, Duration::from_millis(120)).await.is_none());
        assert!(waited.elapsed() < Duration::from_secs(1));
    }

    #[tokio::test]
    async fn silence_goes_out_on_the_clock_while_nobody_is_speaking() {
        // The bug this exists for: `app_audiosocket` hangs the call up after
        // 2 s of no activity, so a transport that writes only when the pipeline
        // speaks ends every call two seconds in. Between the caller's question
        // and the agent's answer there must still be frames.
        let (server, mut asterisk) = pair().await;

        let transport = AudioSocketTransport::new("test", AudioSocketParams::default());
        transport.set_serializer(Box::new(
            crate::serializers::AudioSocketFrameSerializer::new(),
        ));
        let (push_tx, _push_rx) = mpsc::channel(8);
        let handshake = AudioSocketHandshake {
            uuid: "test".into(),
            pending: Vec::new(),
            reader: FrameReader::new(),
        };
        tokio::spawn(async move {
            transport.run_socket(server, handshake, push_tx).await;
        });

        // Six ticks' worth. Nothing is sent to the transport in this window, so
        // every frame that arrives is one the clock produced.
        let mut reader = FrameReader::new();
        let mut frames = Vec::new();
        let mut buf = [0u8; 4096];
        let deadline = tokio::time::Instant::now() + Duration::from_millis(140);
        while tokio::time::Instant::now() < deadline {
            let Ok(Ok(n)) =
                tokio::time::timeout_at(deadline, asterisk.read(&mut buf)).await
            else {
                break;
            };
            if n == 0 {
                break;
            }
            frames.extend(reader.feed(&buf[..n]));
        }

        assert!(
            frames.len() >= 4,
            "expected a frame every 20ms, got {} in 140ms",
            frames.len(),
        );
        assert!(frames.iter().all(|f| f.kind == FrameKind::Audio));
        assert!(
            frames.iter().all(|f| f.payload.len() == 320 && f.payload.iter().all(|&b| b == 0)),
            "an idle tick is 20ms of silence",
        );
    }

    #[tokio::test]
    async fn pipeline_audio_reaches_the_wire_as_one_frame() {
        // The bug this exists for: the serializer returns an already-encoded
        // frame, and the clock used to wrap it again. Silence and a test tone
        // are built raw and so were wrapped once and sounded perfect — only
        // the agent's voice went through the serializer, so only the voice
        // arrived as noise. Anything queued must parse as exactly ONE frame
        // carrying exactly one frame's worth of samples.
        let (server, mut asterisk) = pair().await;

        let transport = AudioSocketTransport::new("test", AudioSocketParams::default());
        transport.set_serializer(Box::new(
            crate::serializers::AudioSocketFrameSerializer::new(),
        ));
        let input = transport.output();
        let (push_tx, _push_rx) = mpsc::channel(8);
        let handshake = AudioSocketHandshake {
            uuid: "test".into(),
            pending: Vec::new(),
            reader: FrameReader::new(),
        };
        tokio::spawn(async move {
            transport.run_socket(server, handshake, push_tx).await;
        });
        drop(input);

        let mut reader = FrameReader::new();
        let mut frames = Vec::new();
        let mut buf = [0u8; 8192];
        let deadline = tokio::time::Instant::now() + Duration::from_millis(120);
        while tokio::time::Instant::now() < deadline {
            let Ok(Ok(n)) = tokio::time::timeout_at(deadline, asterisk.read(&mut buf)).await
            else {
                break;
            };
            if n == 0 {
                break;
            }
            frames.extend(reader.feed(&buf[..n]));
        }

        assert!(!frames.is_empty(), "the clock should be writing");
        let expected = crate::serializers::audiosocket::frame_samples(
            crate::serializers::AUDIOSOCKET_SAMPLE_RATE,
        ) * 2;
        for f in &frames {
            assert_eq!(f.kind, FrameKind::Audio);
            assert_eq!(
                f.payload.len(),
                expected,
                "a frame carrying {} bytes is a frame wrapped twice",
                f.payload.len(),
            );
            // A double-wrapped frame's payload starts with its inner header.
            assert_ne!(
                f.payload[0], 0x10,
                "payload begins with an audio frame header — this is double-encoded",
            );
        }
    }

    #[tokio::test]
    async fn a_closed_connection_does_not_wait_for_the_timeout() {
        let (mut server, asterisk) = pair().await;
        drop(asterisk);
        assert!(await_uuid(&mut server, Duration::from_secs(30)).await.is_none());
    }
}

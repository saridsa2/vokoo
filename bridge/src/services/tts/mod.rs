//! Text-to-speech services.
//!
//! Deepgram and Sarvam stream over WebSocket and are gated by the features that
//! pull in `tokio-tungstenite`; Piper runs locally and is gated by the feature
//! that pulls in `ort`.
//!
//! ElevenLabs has two halves: `elevenlabs` is the streaming synthesiser a call
//! uses, written against the wire protocol because it has to be a
//! `FrameHandler`; `elevenlabs_api` is the vendored REST client for everything
//! else — listing voices and models, which is what discovery reads.

#[cfg(feature = "tts-deepgram")]
pub mod deepgram;
#[cfg(feature = "tts-elevenlabs")]
pub mod elevenlabs;
#[cfg(feature = "tts-elevenlabs")]
pub mod elevenlabs_api;
#[cfg(feature = "tts-piper")]
pub mod piper;
#[cfg(feature = "tts-sarvam")]
pub mod sarvam;

#[cfg(feature = "tts-deepgram")]
pub use deepgram::{DeepgramEncoding, DeepgramTtsConfig, DeepgramTtsHandler};
#[cfg(feature = "tts-elevenlabs")]
pub use elevenlabs::{ElevenLabsTtsConfig, ElevenLabsTtsHandler};
#[cfg(feature = "tts-elevenlabs")]
pub use elevenlabs_api::{ClientConfig as ElevenLabsClientConfig, ElevenLabsClient};
#[cfg(feature = "tts-piper")]
pub use piper::{PiperModel, PiperQuality, PiperTtsConfig, PiperTtsHandler};
#[cfg(feature = "tts-sarvam")]
pub use sarvam::{SarvamTtsConfig, SarvamTtsHandler, TtsModelConfig, get_model_config};

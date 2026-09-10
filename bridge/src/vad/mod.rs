pub mod analyzer;
pub mod params;
pub mod processor;
pub mod silero_native;
#[cfg(feature = "vad-silero-ort")]
pub mod silero_ort;
pub mod state;

pub use analyzer::VadAnalyzer;
pub use params::{VadParams, VAD_CONFIDENCE, VAD_MIN_VOLUME, VAD_START_SECS, VAD_STOP_SECS};
pub use processor::VadProcessor;
pub use silero_native::SileroVadNative;
#[cfg(feature = "vad-silero-ort")]
pub use silero_ort::SileroVadOrt;
pub use state::{calculate_audio_volume, exp_smoothing, StateMachine, VadState};

use std::sync::Arc;

/// Which VAD backend to use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VadBackend {
    /// Pure Rust engine — zero deps, ~5 MB memory, 16kHz only.
    Native,
    /// ONNX Runtime — supports 8kHz + 16kHz, larger footprint.
    Ort,
}

impl Default for VadBackend {
    fn default() -> Self {
        Self::Native
    }
}

/// Create a VAD analyzer from a backend choice.
pub fn create_vad(backend: VadBackend, sample_rate: u32) -> Result<Arc<dyn VadAnalyzer>, String> {
    match backend {
        VadBackend::Native => {
            let vad = SileroVadNative::new(sample_rate)?;
            Ok(Arc::new(vad))
        }
        #[cfg(feature = "vad-silero-ort")]
        VadBackend::Ort => {
            let vad = SileroVadOrt::new(sample_rate)?;
            Ok(Arc::new(vad))
        }
        #[cfg(not(feature = "vad-silero-ort"))]
        VadBackend::Ort => {
            Err("ort VAD backend not compiled; enable feature \"vad-silero-ort\"".to_string())
        }
    }
}

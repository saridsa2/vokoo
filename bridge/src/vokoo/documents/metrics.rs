use std::collections::BTreeMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Mutex;

#[derive(Default)]
pub struct DocumentMetrics {
    leased_jobs: AtomicI64,
    counters: Mutex<BTreeMap<String, u64>>,
}

impl DocumentMetrics {
    pub fn set_leased(&self, leased: bool) {
        self.leased_jobs.store(i64::from(leased), Ordering::Relaxed);
    }

    pub fn increment(&self, metric: &'static str) {
        self.add(metric, 1);
    }

    pub fn add(&self, metric: &'static str, value: usize) {
        *self
            .counters
            .lock()
            .expect("document metrics lock poisoned")
            .entry(metric.to_string())
            .or_default() += value as u64;
    }

    pub fn stage_millis(&self, stage: &'static str, elapsed_millis: u128) {
        let key = format!("document_stage_milliseconds_total{{stage=\"{stage}\"}}");
        *self
            .counters
            .lock()
            .expect("document metrics lock poisoned")
            .entry(key)
            .or_default() += elapsed_millis.min(u64::MAX as u128) as u64;
    }

    pub fn compiler_run(&self, status: &'static str) {
        let key = format!("compiler_runs_total{{status=\"{status}\"}}");
        *self
            .counters
            .lock()
            .expect("document metrics lock poisoned")
            .entry(key)
            .or_default() += 1;
    }

    pub fn compiler_model_step(
        &self,
        phase: &'static str,
        duration_ms: u64,
        input: Option<usize>,
        output: Option<usize>,
    ) {
        let mut counters = self
            .counters
            .lock()
            .expect("document metrics lock poisoned");
        *counters
            .entry(format!("compiler_model_calls_total{{phase=\"{phase}\"}}"))
            .or_default() += 1;
        *counters
            .entry(format!(
                "compiler_phase_milliseconds_total{{phase=\"{phase}\"}}"
            ))
            .or_default() += duration_ms;
        *counters
            .entry("compiler_input_tokens_total".into())
            .or_default() += input.unwrap_or(0) as u64;
        *counters
            .entry("compiler_output_tokens_total".into())
            .or_default() += output.unwrap_or(0) as u64;
    }

    pub fn render(&self) -> String {
        let mut lines = vec![format!(
            "document_jobs_leased {}",
            self.leased_jobs.load(Ordering::Relaxed)
        )];
        lines.extend(
            self.counters
                .lock()
                .expect("document metrics lock poisoned")
                .iter()
                .map(|(metric, value)| format!("{metric} {value}")),
        );
        lines.push(String::new());
        lines.join("\n")
    }
}

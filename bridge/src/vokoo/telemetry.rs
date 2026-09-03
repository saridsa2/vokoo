//! What the bridge knows about itself, in a form something can scrape.
//!
//! Every number here was already being computed and then thrown into a log
//! line: turn latency, outbound frame rate, queue depth, underruns. A whole
//! day of debugging was spent grepping journald for strings added minutes
//! earlier, and the two worst detours — chasing an 8 kHz/16 kHz theory on a
//! packet count, and reading past a `length 326` that was the actual bug —
//! were both cases of having no series to look at.
//!
//! ## Why this is hand-written
//!
//! No dependency. The Prometheus text format is a few lines of `write!`, the
//! whole registry is atomics, and a scrape costs a few microseconds of
//! formatting. Adding a metrics crate to the binary that answers the phone
//! would be more code entering the call path than this module contains.
//!
//! ## The one rule
//!
//! **Never label anything with a call id, a phone number, or a uuid.** A label
//! creates one time series per distinct value, so an unbounded label turns a
//! fixed-size registry into one that grows for the life of the process — which
//! is the thing that gives Prometheus its reputation for being expensive. The
//! labels here are `channel` (two values), `mode` (three), `tool` (a handful)
//! and `cause` (four). All bounded by construction.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

/// Buckets for a latency histogram, in seconds.
///
/// Chosen for what a caller notices rather than for round numbers: under 400 ms
/// feels immediate, a second is a pause, three is somebody wondering if the
/// line dropped. The tail matters more than the middle here.
const LATENCY_BUCKETS: &[f64] = &[0.1, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0, 10.0];

/// Buckets for how long a call lasts, in seconds.
const DURATION_BUCKETS: &[f64] = &[5.0, 15.0, 30.0, 60.0, 120.0, 300.0, 600.0];

#[derive(Default)]
struct Histogram {
    counts: Vec<AtomicU64>,
    sum_millis: AtomicU64,
    total: AtomicU64,
}

impl Histogram {
    fn new(buckets: &[f64]) -> Self {
        Self {
            counts: (0..buckets.len() + 1).map(|_| AtomicU64::new(0)).collect(),
            sum_millis: AtomicU64::new(0),
            total: AtomicU64::new(0),
        }
    }

    fn observe(&self, buckets: &[f64], value: f64) {
        let index = buckets.iter().position(|b| value <= *b).unwrap_or(buckets.len());
        self.counts[index].fetch_add(1, Ordering::Relaxed);
        self.sum_millis.fetch_add((value * 1000.0) as u64, Ordering::Relaxed);
        self.total.fetch_add(1, Ordering::Relaxed);
    }

    /// Prometheus wants cumulative buckets: each `le` counts everything at or
    /// below it, not just what landed in that band.
    fn render(&self, out: &mut String, name: &str, buckets: &[f64]) {
        let mut running = 0u64;
        for (i, edge) in buckets.iter().enumerate() {
            running += self.counts[i].load(Ordering::Relaxed);
            let _ = writeln!(out, "{name}_bucket{{le=\"{edge}\"}} {running}");
        }
        running += self.counts[buckets.len()].load(Ordering::Relaxed);
        let _ = writeln!(out, "{name}_bucket{{le=\"+Inf\"}} {running}");
        let _ = writeln!(
            out,
            "{name}_sum {:.3}",
            self.sum_millis.load(Ordering::Relaxed) as f64 / 1000.0
        );
        let _ = writeln!(out, "{name}_count {}", self.total.load(Ordering::Relaxed));
    }
}

/// One process-wide registry.
///
/// A `Mutex<HashMap>` for the labelled series and plain atomics for the rest.
/// The lock is taken on a counter bump, which happens a few times per call —
/// never per audio frame. Per-frame counting stays in the transport's own
/// local variables and is published once, when the call ends.
#[derive(Default)]
struct Registry {
    counters: Mutex<HashMap<(&'static str, String), u64>>,
    gauges: Mutex<HashMap<(&'static str, String), i64>>,
    turn_latency: OnceLock<Histogram>,
    call_duration: OnceLock<Histogram>,
}

fn registry() -> &'static Registry {
    static R: OnceLock<Registry> = OnceLock::new();
    R.get_or_init(Registry::default)
}

fn labels(pairs: &[(&str, &str)]) -> String {
    if pairs.is_empty() {
        return String::new();
    }
    let inner: Vec<String> = pairs
        .iter()
        // A label value with a quote or newline in it would produce a scrape
        // the collector cannot parse, which loses every series in the response
        // rather than just this one.
        .map(|(k, v)| format!("{k}=\"{}\"", v.replace('\\', "").replace('"', "").replace('\n', " ")))
        .collect();
    format!("{{{}}}", inner.join(","))
}

/// Add one to a counter.
pub fn count(name: &'static str, pairs: &[(&str, &str)]) {
    add(name, pairs, 1);
}

/// Add to a counter.
pub fn add(name: &'static str, pairs: &[(&str, &str)], by: u64) {
    if by == 0 {
        return;
    }
    let mut map = registry().counters.lock().unwrap();
    *map.entry((name, labels(pairs))).or_insert(0) += by;
}

/// Move a gauge up or down. Use for things that go both ways, like calls in
/// progress; a counter that can decrease is a lie to whoever reads the rate.
pub fn gauge_add(name: &'static str, pairs: &[(&str, &str)], by: i64) {
    let mut map = registry().gauges.lock().unwrap();
    *map.entry((name, labels(pairs))).or_insert(0) += by;
}

/// How long the caller waited between finishing their sentence and hearing the
/// agent begin. The number this product is judged on.
pub fn observe_turn_latency(seconds: f64) {
    registry()
        .turn_latency
        .get_or_init(|| Histogram::new(LATENCY_BUCKETS))
        .observe(LATENCY_BUCKETS, seconds);
}

pub fn observe_call_duration(seconds: f64) {
    registry()
        .call_duration
        .get_or_init(|| Histogram::new(DURATION_BUCKETS))
        .observe(DURATION_BUCKETS, seconds);
}

/// The whole registry in Prometheus text format.
pub fn render() -> String {
    let mut out = String::with_capacity(4096);

    let _ = writeln!(out, "# HELP sarvathra_build_info Version of the running bridge.");
    let _ = writeln!(out, "# TYPE sarvathra_build_info gauge");
    let _ = writeln!(
        out,
        "sarvathra_build_info{{version=\"{}\"}} 1",
        env!("CARGO_PKG_VERSION")
    );

    let counters = registry().counters.lock().unwrap();
    let mut names: Vec<&'static str> = counters.keys().map(|(n, _)| *n).collect();
    names.sort_unstable();
    names.dedup();
    for name in names {
        let _ = writeln!(out, "# TYPE {name} counter");
        for ((n, labels), value) in counters.iter() {
            if *n == name {
                let _ = writeln!(out, "{n}{labels} {value}");
            }
        }
    }
    drop(counters);

    let gauges = registry().gauges.lock().unwrap();
    let mut names: Vec<&'static str> = gauges.keys().map(|(n, _)| *n).collect();
    names.sort_unstable();
    names.dedup();
    for name in names {
        let _ = writeln!(out, "# TYPE {name} gauge");
        for ((n, labels), value) in gauges.iter() {
            if *n == name {
                let _ = writeln!(out, "{n}{labels} {value}");
            }
        }
    }
    drop(gauges);

    if let Some(h) = registry().turn_latency.get() {
        let _ = writeln!(
            out,
            "# HELP sarvathra_turn_latency_seconds Caller stopped speaking to first agent audio."
        );
        let _ = writeln!(out, "# TYPE sarvathra_turn_latency_seconds histogram");
        h.render(&mut out, "sarvathra_turn_latency_seconds", LATENCY_BUCKETS);
    }
    if let Some(h) = registry().call_duration.get() {
        let _ = writeln!(out, "# TYPE sarvathra_call_duration_seconds histogram");
        h.render(&mut out, "sarvathra_call_duration_seconds", DURATION_BUCKETS);
    }

    out
}

/// Count panics, and say where, before the task dies.
///
/// A panic in a tokio task kills that task and nothing else — which is the
/// right behaviour for a bridge whose calls are independent, and is why
/// `panic = "abort"` is deliberately not set. The cost is that a panic is
/// almost silent: one line in the journal that nobody is looking at. On
/// 3 September a bad tool declaration panicked a worker and killed a live
/// call, and it was found only by reading the log for something else.
///
/// So it is counted. `sarvathra_panics_total` going up is always a bug, and it
/// is the one alert worth having from day one.
pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let where_ = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "unknown".to_string());
        // The location, not the message: a panic message can carry a caller's
        // words or a provider key, and this ends up in a label if anyone is
        // careless later.
        count("sarvathra_panics_total", &[("location", &where_)]);
        log::error!("[panic] at {where_} — a task died; the call it served is over");
        previous(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_counter_renders_with_its_labels() {
        count("sarvathra_test_total", &[("channel", "whatsapp")]);
        count("sarvathra_test_total", &[("channel", "whatsapp")]);
        let out = render();
        assert!(out.contains("sarvathra_test_total{channel=\"whatsapp\"} 2"), "{out}");
    }

    #[test]
    fn a_gauge_goes_down_again() {
        gauge_add("sarvathra_test_active", &[], 1);
        gauge_add("sarvathra_test_active", &[], 1);
        gauge_add("sarvathra_test_active", &[], -1);
        assert!(render().contains("sarvathra_test_active 1"));
    }

    #[test]
    fn histogram_buckets_are_cumulative() {
        // Prometheus reads `le` as "at or below", so a value in an early bucket
        // must also appear in every later one. Rendering per-band counts is a
        // histogram that looks right and computes nonsense quantiles.
        observe_turn_latency(0.2);
        observe_turn_latency(0.8);
        let out = render();
        let line = |le: &str| {
            out.lines()
                .find(|l| l.starts_with(&format!("sarvathra_turn_latency_seconds_bucket{{le=\"{le}\"")))
                .unwrap_or_default()
                .rsplit(' ')
                .next()
                .unwrap_or("0")
                .parse::<u64>()
                .unwrap_or(0)
        };
        assert_eq!(line("0.1"), 0);
        assert_eq!(line("0.25"), 1);
        assert_eq!(line("1"), 2);
        assert!(out.contains("sarvathra_turn_latency_seconds_count 2"));
    }

    #[test]
    fn a_label_cannot_break_the_scrape() {
        // One malformed line loses the whole response, not just its own series,
        // so a quote or a newline inside a value has to go.
        count("sarvathra_test_quoted_total", &[("note", "he said \"hello\"\nand left")]);
        let out = render();
        let line = out
            .lines()
            .find(|l| l.starts_with("sarvathra_test_quoted_total"))
            .expect("the series is rendered");
        assert_eq!(line.matches('"').count(), 2, "exactly the pair around the value: {line}");
        assert!(!line.contains('\n'));
        assert!(line.contains("he said hello and left"), "{line}");
    }
}

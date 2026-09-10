//! Validation at the boundary where health data leaves VoKoo.

use serde::de::DeserializeOwned;
use serde_json::Value;

fn decode<T: DeserializeOwned>(value: &Value) -> Result<(), String> {
    serde_json::from_value::<T>(value.clone())
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// Validate the owned clinical payload types without duplicating their fields
/// in the bridge. Generic customer schemas are validated separately; this is
/// the stricter contract selected by an integration using a VoKoo kind.
pub fn validate_clinical_payload(kind: &str, value: &Value) -> Result<(), String> {
    match kind {
        "person" => decode::<vokoo_clinical_schemas::health::Person>(value),
        "lab_report" => decode::<vokoo_clinical_schemas::lab_report::LabReport>(value),
        "imaging_report" => decode::<vokoo_clinical_schemas::imaging_report::ImagingReport>(value),
        "medication" => decode::<vokoo_clinical_schemas::medication::MedicationRecord>(value),
        "family_health" => decode::<vokoo_clinical_schemas::family_health::FamilyHealthTree>(value),
        _ => Err(format!("unknown clinical payload kind {kind:?}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn example(path: &str) -> Value {
        let raw = match path {
            "person" => include_str!("../../../vendor/vokoo-clinical-schemas/infrastructure/schemas/health/examples/person.min.json"),
            "lab_report" => include_str!("../../../vendor/vokoo-clinical-schemas/infrastructure/schemas/lab-report/examples/lab-report.cbc.json"),
            "imaging_report" => include_str!("../../../vendor/vokoo-clinical-schemas/infrastructure/schemas/imaging-report/examples/imaging-report.ct-chest.json"),
            "medication" => include_str!("../../../vendor/vokoo-clinical-schemas/infrastructure/schemas/medication/examples/medication.metformin.json"),
            "family_health" => include_str!("../../../vendor/vokoo-clinical-schemas/infrastructure/schemas/family-health/examples/family-tree.min.json"),
            _ => unreachable!(),
        };
        serde_json::from_str(raw).unwrap()
    }

    #[test]
    fn vendored_examples_are_the_runtime_contract() {
        for kind in [
            "person",
            "lab_report",
            "imaging_report",
            "medication",
            "family_health",
        ] {
            validate_clinical_payload(kind, &example(kind))
                .unwrap_or_else(|error| panic!("{kind}: {error}"));
        }
    }

    #[test]
    fn a_payload_missing_required_clinical_identity_is_rejected() {
        assert!(
            validate_clinical_payload("lab_report", &serde_json::json!({ "results": [] })).is_err()
        );
    }

    #[test]
    fn an_unknown_kind_is_not_silently_treated_as_generic_json() {
        assert!(validate_clinical_payload("unknown", &serde_json::json!({})).is_err());
    }
}

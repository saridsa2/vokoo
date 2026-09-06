# VoKoo Rust SDK

Rust data models for the VoKoo health data platform.

**Website:** https://github.com/saridsa2/vokoo

## Installation

Add this to your `Cargo.toml`:

```toml
[dependencies]
vokoo = "0.1.0"
```

## Features

- 🏥 **Lab Reports**: Structured laboratory test results with LOINC codes
- 🔬 **Imaging Reports**: Diagnostic imaging reports with DICOM support
- 💊 **Medications**: Medication records with RxNorm codes
- 👤 **Personal Health**: Individual health records following FHIR standards
- 👨‍👩‍👧‍👦 **Family Health**: Family health trees for genetic tracking
- 🦀 **Full Rust Support**: Type-safe with Serde serialization/deserialization

## Usage

### Lab Report Example

```rust
use vokoo_clinical_schemas::{LabReport, LabResult, CodeableConcept, Coding, Quantity, LabValue};
use chrono::Utc;

// Create a lab result
let result = LabResult {
    code: CodeableConcept {
        coding: vec![Coding {
            system: "http://loinc.org".to_string(),
            code: "2339-0".to_string(),
            display: Some("Glucose".to_string()),
        }],
        text: None,
    },
    value: LabValue::Quantity(Quantity {
        value: 95.0,
        unit: "mg/dL".to_string(),
    }),
    reference_range: None,
    interpretation: Some(vokoo_clinical_schemas::Interpretation::N),
    method: None,
};

// Create a lab report
let report = LabReport {
    id: "lab-001".to_string(),
    patient_id: "patient-123".to_string(),
    issued_at: Utc::now(),
    results: vec![result],
    facility: None,
    panel: None,
    specimen: None,
};

// Serialize to JSON
let json = serde_json::to_string_pretty(&report).unwrap();
println!("{}", json);
```

### Personal Health Record Example

```rust
use vokoo_clinical_schemas::{Person, HumanName};
use chrono::NaiveDate;

let person = Person {
    id: "patient-123".to_string(),
    resource_type: "Person".to_string(),
    name: vec![HumanName {
        family: "Zhang".to_string(),
        given: vec!["San".to_string()],
        r#use: None,
        prefix: None,
        suffix: None,
    }],
    birth_date: NaiveDate::from_ymd_opt(1990, 1, 1).unwrap(),
    gender: Some(vokoo_clinical_schemas::Gender::Male),
    ..Default::default()
};
```

### Medication Record Example

```rust
use vokoo_clinical_schemas::{MedicationRecord, Dosage, Coding, Route};
use chrono::NaiveDate;

let medication = MedicationRecord {
    id: "med-001".to_string(),
    patient_id: "patient-123".to_string(),
    medication: Coding {
        system: "http://www.nlm.nih.gov/research/umls/rxnorm".to_string(),
        code: "617310".to_string(),
        display: Some("Atorvastatin 20mg".to_string()),
    },
    dosage: Dosage {
        value: 20.0,
        unit: "mg".to_string(),
    },
    route: Route {
        system: "http://snomed.info/sct".to_string(),
        code: "PO".to_string(),
        display: Some("Oral".to_string()),
    },
    start_date: NaiveDate::from_ymd_opt(2024, 1, 1).unwrap(),
    form: None,
    frequency: Some("QD".to_string()),
    duration_days: None,
    end_date: None,
    indication: None,
    instructions: None,
};
```

## Data Models

### Common Types
- `Coding`: Coded value from a terminology system
- `CodeableConcept`: Concept with multiple codes
- `Quantity`: Measured value with UCUM unit
- `HumanName`: Structured person name
- `ContactPoint`: Contact information
- `Address`: Postal address

### Domain Models
- `LabReport`: Laboratory test report
- `ImagingReport`: Diagnostic imaging report
- `MedicationRecord`: Medication administration record
- `Person`: Personal health record
- `FamilyHealthTree`: Family health tree

## Standards Compliance

This crate implements data models based on:
- HL7 FHIR (Fast Healthcare Interoperability Resources)
- LOINC (Logical Observation Identifiers Names and Codes)
- SNOMED CT (Systematized Nomenclature of Medicine)
- RxNorm (medication naming)
- UCUM (Unified Code for Units of Measure)
- DICOM (Digital Imaging and Communications in Medicine)

## License

Governed by the VoKoo root LICENSE

## Support

- Documentation: https://github.com/saridsa2/vokoo
- Issues: https://github.com/saridsa2/vokoo/issues
- Support: https://github.com/saridsa2/vokoo/issues

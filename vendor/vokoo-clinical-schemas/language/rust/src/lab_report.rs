//! Lab Report data models.
//!
//! Package: vokoo
//! Website: https://github.com/saridsa2/vokoo
//! Schema: urn:vokoo:clinical:schema:lab-report:v0.1.0

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use crate::common::{CodeableConcept, Quantity, ReferenceRange, Coding};

/// Lab result interpretation
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum Interpretation {
    /// Normal
    N,
    /// Low
    L,
    /// High
    H,
    /// Abnormal
    A,
}

/// Lab facility information.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Facility {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// Specimen information.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Specimen {
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub specimen_type: Option<Coding>,
    #[serde(rename = "collectedAt", skip_serializing_if = "Option::is_none")]
    pub collected_at: Option<DateTime<Utc>>,
}

/// Lab result value (can be Quantity, CodeableConcept, or String)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum LabValue {
    Quantity(Quantity),
    Concept(CodeableConcept),
    String(String),
}

/// Individual lab test result.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LabResult {
    /// LOINC code for the test
    pub code: CodeableConcept,
    /// Result value (Quantity, CodeableConcept, or string)
    pub value: LabValue,
    /// Normal reference range
    #[serde(rename = "referenceRange", skip_serializing_if = "Option::is_none")]
    pub reference_range: Option<ReferenceRange>,
    /// N (normal), L (low), H (high), A (abnormal)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interpretation: Option<Interpretation>,
    /// Test method used
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<CodeableConcept>,
}

/// Laboratory test report.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LabReport {
    /// Unique report identifier
    pub id: String,
    /// Reference to Person.id
    #[serde(rename = "patientId")]
    pub patient_id: String,
    /// Report issue timestamp
    #[serde(rename = "issuedAt")]
    pub issued_at: DateTime<Utc>,
    /// List of lab test results
    pub results: Vec<LabResult>,
    /// Lab facility information
    #[serde(skip_serializing_if = "Option::is_none")]
    pub facility: Option<Facility>,
    /// Test panel code
    #[serde(skip_serializing_if = "Option::is_none")]
    pub panel: Option<CodeableConcept>,
    /// Specimen information
    #[serde(skip_serializing_if = "Option::is_none")]
    pub specimen: Option<Specimen>,
}

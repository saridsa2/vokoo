//! WellAlly Health Data Models for Rust
//!
//! Package: wellally
//! Website: https://www.wellally.tech/
//! Version: 0.1.0
//!
//! This crate provides Rust data models for health-related data structures,
//! including lab reports, imaging reports, medication records, and personal health records.

pub mod common;
pub mod lab_report;
pub mod imaging_report;
pub mod medication;
pub mod health;
pub mod family_health;
use serde::Serialize;
use serde::Deserialize;
use serde_with::skip_serializing_none;

pub use common::*;
pub use lab_report::*;
pub use imaging_report::*;
pub use medication::*;
pub use health::*;
pub use family_health::*;

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReferenceRange {
    pub low: Option<Quantity>,
    pub high: Option<Quantity>,
    pub text: Option<String>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Identifier {
    pub system: String,
    pub value: String,
    #[serde(rename = "type")]
    pub id_type: Option<CodeableConcept>,
    pub period: Option<Period>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HumanName {
    pub family: String,
    pub given: Vec<String>,
    pub use_: Option<String>,
    pub prefix: Option<Vec<String>>,
    pub suffix: Option<Vec<String>>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactPoint {
    pub system: Option<String>,
    pub value: String,
    pub use_: Option<String>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Address {
    pub line: Option<Vec<String>>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub postalCode: Option<String>,
    pub country: Option<String>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Period {
    pub start: Option<String>,
    pub end: Option<String>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Modality {
    pub system: String,
    pub code: String,
    pub display: Option<String>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Route {
    pub system: String,
    pub code: String,
    pub display: Option<String>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecimenType {
    pub system: String,
    pub code: String,
    pub display: Option<String>,
}

// ---------- Health Person ----------
#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClinicalSummary {
    pub conditions: Option<Vec<CodeableConcept>>,
    pub allergies: Option<Vec<CodeableConcept>>,
    pub bloodType: Option<String>,
    pub primaryCareProvider: Option<String>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthPerson {
    pub id: String,
    pub name: Vec<HumanName>,
    pub birthDate: String,
    #[serde(default = "default_resource_type")]
    pub resourceType: String,
    pub identifier: Option<Vec<Identifier>>,
    pub gender: Option<String>,
    pub telecom: Option<Vec<ContactPoint>>,
    pub address: Option<Vec<Address>>,
    pub maritalStatus: Option<CodeableConcept>,
    pub language: Option<Vec<String>>,
    pub clinicalSummary: Option<ClinicalSummary>,
}

fn default_resource_type() -> String {
    "Person".to_string()
}

// ---------- Lab Report ----------
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum LabResultValue {
    Quantity(Quantity),
    CodeableConcept(CodeableConcept),
    Text(String),
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LabResult {
    pub code: CodeableConcept,
    pub value: LabResultValue,
    pub referenceRange: Option<ReferenceRange>,
    pub interpretation: Option<String>,
    pub method: Option<CodeableConcept>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Specimen {
    pub r#type: Option<SpecimenType>,
    pub collectedAt: Option<String>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Facility {
    pub id: Option<String>,
    pub name: Option<String>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LabReport {
    pub id: String,
    pub patientId: String,
    pub issuedAt: String,
    pub results: Vec<LabResult>,
    pub facility: Option<Facility>,
    pub panel: Option<CodeableConcept>,
    pub specimen: Option<Specimen>,
}

// ---------- Imaging Report ----------
#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub url: Option<String>,
    pub r#type: Option<String>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadiationDose {
    pub ctdiVol_mGy: Option<f64>,
    pub dlp_mGy_cm: Option<f64>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Performer {
    pub id: Option<String>,
    pub name: Option<String>,
    pub role: Option<String>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImagingReport {
    pub id: String,
    pub patientId: String,
    pub modality: Modality,
    pub bodySite: Coding,
    pub reportedAt: String,
    pub studyInstanceUid: Option<String>,
    pub performer: Option<Performer>,
    pub findings: Option<Vec<String>>,
    pub impression: Option<String>,
    pub radiationDose: Option<RadiationDose>,
    pub attachments: Option<Vec<Attachment>>,
}

// ---------- Medication ----------
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dosage {
    pub value: f64,
    pub unit: String,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MedicationRecord {
    pub id: String,
    pub patientId: String,
    pub medication: Coding,
    pub dosage: Dosage,
    pub route: Route,
    pub startDate: String,
    pub form: Option<Coding>,
    pub frequency: Option<String>,
    pub durationDays: Option<i64>,
    pub endDate: Option<String>,
    pub indication: Option<CodeableConcept>,
    pub instructions: Option<String>,
}

// ---------- Family Health ----------
#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FamilyMember {
    pub id: String,
    pub relationToProband: String,
    pub sex: Option<String>,
    pub birthYear: Option<i64>,
    pub deceased: Option<bool>,
    pub conditions: Option<Vec<CodeableConcept>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FamilyHealthTree {
    pub probandId: String,
    pub members: Vec<FamilyMember>,
}

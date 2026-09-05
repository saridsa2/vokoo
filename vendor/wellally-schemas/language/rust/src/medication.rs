//! Medication Record data models.
//!
//! Package: wellally
//! Website: https://www.wellally.tech/
//! Schema: https://wellall.health/schemas/medication/v0.1.0

use serde::{Deserialize, Serialize};
use chrono::NaiveDate;
use crate::common::{Coding, CodeableConcept, Route};

/// Medication dosage amount.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Dosage {
    /// Dose amount
    pub value: f64,
    /// UCUM unit (e.g., mg, mL)
    pub unit: String,
}

/// Medication administration record.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MedicationRecord {
    /// Unique record identifier
    pub id: String,
    /// Reference to Person.id
    #[serde(rename = "patientId")]
    pub patient_id: String,
    /// Medication code (RxNorm)
    pub medication: Coding,
    /// Dose amount and unit
    pub dosage: Dosage,
    /// Administration route (PO, IV, etc.)
    pub route: Route,
    /// Start date
    #[serde(rename = "startDate")]
    pub start_date: NaiveDate,
    /// Medication form (tablet, capsule, etc.)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub form: Option<Coding>,
    /// Dosing frequency (QD, BID, TID, etc.)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frequency: Option<String>,
    /// Treatment duration in days
    #[serde(rename = "durationDays", skip_serializing_if = "Option::is_none")]
    pub duration_days: Option<i32>,
    /// End date
    #[serde(rename = "endDate", skip_serializing_if = "Option::is_none")]
    pub end_date: Option<NaiveDate>,
    /// Indication for use
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indication: Option<CodeableConcept>,
    /// Additional instructions
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
}

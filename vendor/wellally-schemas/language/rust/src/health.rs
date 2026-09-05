//! Personal Health Record data models.
//!
//! Package: wellally
//! Website: https://www.wellally.tech/
//! Schema: https://wellall.health/schemas/health/v0.1.0

use serde::{Deserialize, Serialize};
use chrono::NaiveDate;
use crate::common::{Identifier, HumanName, ContactPoint, Address, CodeableConcept};

/// Gender type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Gender {
    Male,
    Female,
    Other,
    Unknown,
}

/// Clinical summary information.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClinicalSummary {
    /// Known conditions/diagnoses (SNOMED CT or ICD-10)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conditions: Option<Vec<CodeableConcept>>,
    /// Allergy list
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allergies: Option<Vec<CodeableConcept>>,
    /// Blood type (e.g., A+, O-)
    #[serde(rename = "bloodType", skip_serializing_if = "Option::is_none")]
    pub blood_type: Option<String>,
    /// Primary care provider ID
    #[serde(rename = "primaryCareProvider", skip_serializing_if = "Option::is_none")]
    pub primary_care_provider: Option<String>,
}

/// Personal health record.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Person {
    /// Unique person identifier (UUID/ULID)
    pub id: String,
    /// Resource type (always "Person")
    #[serde(rename = "resourceType")]
    pub resource_type: String,
    /// Person name(s)
    pub name: Vec<HumanName>,
    /// Date of birth
    #[serde(rename = "birthDate")]
    pub birth_date: NaiveDate,
    /// External identifiers (MRN, national ID, etc.)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identifier: Option<Vec<Identifier>>,
    /// Gender
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gender: Option<Gender>,
    /// Contact points (phone, email)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub telecom: Option<Vec<ContactPoint>>,
    /// Address(es)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<Vec<Address>>,
    /// Marital status
    #[serde(rename = "maritalStatus", skip_serializing_if = "Option::is_none")]
    pub marital_status: Option<CodeableConcept>,
    /// Language preferences (IETF BCP-47 tags)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<Vec<String>>,
    /// Clinical summary
    #[serde(rename = "clinicalSummary", skip_serializing_if = "Option::is_none")]
    pub clinical_summary: Option<ClinicalSummary>,
}

impl Default for Person {
    fn default() -> Self {
        Self {
            id: String::new(),
            resource_type: "Person".to_string(),
            name: Vec::new(),
            birth_date: NaiveDate::from_ymd_opt(2000, 1, 1).unwrap(),
            identifier: None,
            gender: None,
            telecom: None,
            address: None,
            marital_status: None,
            language: None,
            clinical_summary: None,
        }
    }
}

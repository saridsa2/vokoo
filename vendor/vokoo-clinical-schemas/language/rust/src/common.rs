//! Common definitions and types for VoKoo Health data models.
//!
//! Package: vokoo
//! Website: https://github.com/saridsa2/vokoo
//! Schema: urn:vokoo:clinical:schema:common:v0.1.0

use serde::{Deserialize, Serialize};
use chrono::NaiveDate;

/// UCUM unit type
pub type UCUMUnit = String;

/// Name usage context
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NameUse {
    Official,
    Usual,
    Nickname,
    Anonymous,
    Old,
    Maiden,
}

/// Contact system type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ContactSystem {
    Phone,
    Email,
}

/// Contact use context
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ContactUse {
    Home,
    Work,
    Mobile,
}

/// Imaging modality codes
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ModalityCode {
    CT,
    MR,
    US,
    XR,
    PT,
}

/// Represents a coded value from a terminology system.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Coding {
    /// URI identifying the terminology system (e.g., http://loinc.org)
    pub system: String,
    /// The code value from the system
    pub code: String,
    /// Optional human-readable display text
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display: Option<String>,
}

/// A concept that may be defined by one or more codes from formal terminologies.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CodeableConcept {
    /// List of coded values (at least one required)
    pub coding: Vec<Coding>,
    /// Optional plain text representation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

/// A measured or measurable amount with a UCUM unit.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Quantity {
    /// Numerical value
    pub value: f64,
    /// UCUM unit string
    pub unit: UCUMUnit,
}

/// Reference range for lab test results.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReferenceRange {
    /// Lower bound quantity
    #[serde(skip_serializing_if = "Option::is_none")]
    pub low: Option<Quantity>,
    /// Upper bound quantity
    #[serde(skip_serializing_if = "Option::is_none")]
    pub high: Option<Quantity>,
    /// Optional textual description
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

/// An identifier assigned to a resource.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Identifier {
    /// URI identifying the namespace
    pub system: String,
    /// The identifier value
    pub value: String,
    /// Optional coded type
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<CodeableConcept>,
    /// Optional validity period
    #[serde(skip_serializing_if = "Option::is_none")]
    pub period: Option<Period>,
}

/// A human's name with text, parts and usage information.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HumanName {
    /// Family/last name
    pub family: String,
    /// Given/first name(s)
    pub given: Vec<String>,
    /// Name usage context
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#use: Option<NameUse>,
    /// Name prefix(es)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefix: Option<Vec<String>>,
    /// Name suffix(es)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suffix: Option<Vec<String>>,
}

/// Contact details for a person or organization.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContactPoint {
    /// phone | email
    pub system: ContactSystem,
    /// The actual contact point value
    pub value: String,
    /// home | work | mobile
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#use: Option<ContactUse>,
}

/// An address for a person or organization.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Address {
    /// Street address lines
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<Vec<String>>,
    /// City name
    #[serde(skip_serializing_if = "Option::is_none")]
    pub city: Option<String>,
    /// State/province
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    /// Postal/zip code
    #[serde(rename = "postalCode", skip_serializing_if = "Option::is_none")]
    pub postal_code: Option<String>,
    /// Country name
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
}

/// A time period defined by start and end dates.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Period {
    /// Start date
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start: Option<NaiveDate>,
    /// End date
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end: Option<NaiveDate>,
}

/// Imaging modality code (CT, MR, US, XR, PT).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Modality {
    /// Terminology system URI
    pub system: String,
    /// Modality code
    pub code: ModalityCode,
    /// Optional display text
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display: Option<String>,
}

/// Medication administration route.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Route {
    /// Terminology system URI
    pub system: String,
    /// Route code (e.g., PO, IV, IM, SC, INH, SL, PR or SNOMED CT codes)
    pub code: String,
    /// Optional display text
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display: Option<String>,
}

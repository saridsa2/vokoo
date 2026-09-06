//! Family Health Tree data models.
//!
//! Package: vokoo
//! Website: https://github.com/saridsa2/vokoo
//! Schema: urn:vokoo:clinical:schema:family-health:v0.1.0

use serde::{Deserialize, Serialize};
use crate::common::CodeableConcept;

/// Relationship to proband
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RelationToProband {
    #[serde(rename = "self")]
    Self_,
    Mother,
    Father,
    Sibling,
    Child,
    Grandparent,
    Grandchild,
    Aunt,
    Uncle,
    Cousin,
    Other,
}

/// Biological sex
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Sex {
    Male,
    Female,
    Other,
    Unknown,
}

/// Family member in a health tree.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FamilyMember {
    /// Member identifier
    pub id: String,
    /// Relationship to proband
    #[serde(rename = "relationToProband")]
    pub relation_to_proband: RelationToProband,
    /// Biological sex
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sex: Option<Sex>,
    /// Year of birth
    #[serde(rename = "birthYear", skip_serializing_if = "Option::is_none")]
    pub birth_year: Option<i32>,
    /// Whether deceased
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deceased: Option<bool>,
    /// Health conditions (SNOMED CT or ICD-10)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conditions: Option<Vec<CodeableConcept>>,
}

/// Family health tree for genetic and hereditary disease tracking.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FamilyHealthTree {
    /// ID of the proband (main individual)
    #[serde(rename = "probandId")]
    pub proband_id: String,
    /// List of family members
    pub members: Vec<FamilyMember>,
}

//! Imaging Report data models.
//!
//! Package: wellally
//! Website: https://www.wellally.tech/
//! Schema: https://wellall.health/schemas/imaging-report/v0.1.0

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use crate::common::{Modality, Coding};

/// Imaging report performer (radiologist).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Performer {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
}

/// CT radiation dose information.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RadiationDose {
    /// CT Dose Index Volume (mGy)
    #[serde(rename = "ctdiVol_mGy", skip_serializing_if = "Option::is_none")]
    pub ctdi_vol_mgy: Option<f64>,
    /// Dose Length Product (mGy·cm)
    #[serde(rename = "dlp_mGy_cm", skip_serializing_if = "Option::is_none")]
    pub dlp_mgy_cm: Option<f64>,
}

/// Report attachment (image, PDF, etc.).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Attachment {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub attachment_type: Option<String>,
}

/// Diagnostic imaging report.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ImagingReport {
    /// Unique report identifier
    pub id: String,
    /// Reference to Person.id
    #[serde(rename = "patientId")]
    pub patient_id: String,
    /// Imaging modality (CT, MR, US, XR, PT)
    pub modality: Modality,
    /// Body site examined (SNOMED CT code)
    #[serde(rename = "bodySite")]
    pub body_site: Coding,
    /// Report timestamp
    #[serde(rename = "reportedAt")]
    pub reported_at: DateTime<Utc>,
    /// DICOM Study Instance UID
    #[serde(rename = "studyInstanceUid", skip_serializing_if = "Option::is_none")]
    pub study_instance_uid: Option<String>,
    /// Radiologist information
    #[serde(skip_serializing_if = "Option::is_none")]
    pub performer: Option<Performer>,
    /// Imaging findings list
    #[serde(skip_serializing_if = "Option::is_none")]
    pub findings: Option<Vec<String>>,
    /// Diagnostic impression/conclusion
    #[serde(skip_serializing_if = "Option::is_none")]
    pub impression: Option<String>,
    /// Radiation dose (for CT)
    #[serde(rename = "radiationDose", skip_serializing_if = "Option::is_none")]
    pub radiation_dose: Option<RadiationDose>,
    /// Attached files
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<Attachment>>,
}

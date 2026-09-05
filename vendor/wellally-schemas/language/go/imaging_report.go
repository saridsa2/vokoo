// Package wellally provides imaging report data models.
//
// Package: https://github.com/saridsa2/vokoo/tree/main/vendor/wellally-schemas/language/go
// Website: https://www.wellally.tech/
// Schema: https://wellall.health/schemas/imaging-report/v0.1.0
package wellally

import "time"

// Performer represents imaging report performer (radiologist).
type Performer struct {
	ID   *string `json:"id,omitempty"`
	Name *string `json:"name,omitempty"`
	Role *string `json:"role,omitempty"`
}

// RadiationDose represents CT radiation dose information.
type RadiationDose struct {
	// CT Dose Index Volume (mGy)
	CTDIVolMGy *float64 `json:"ctdiVol_mGy,omitempty"`
	// Dose Length Product (mGy·cm)
	DLPMGyCm *float64 `json:"dlp_mGy_cm,omitempty"`
}

// Attachment represents report attachment (image, PDF, etc.).
type Attachment struct {
	URL  *string `json:"url,omitempty"`
	Type *string `json:"type,omitempty"`
}

// ImagingReport represents a diagnostic imaging report.
type ImagingReport struct {
	// Unique report identifier
	ID string `json:"id"`
	// Reference to Person.id
	PatientID string `json:"patientId"`
	// Imaging modality (CT, MR, US, XR, PT)
	Modality Modality `json:"modality"`
	// Body site examined (SNOMED CT code)
	BodySite Coding `json:"bodySite"`
	// Report timestamp
	ReportedAt time.Time `json:"reportedAt"`
	// DICOM Study Instance UID
	StudyInstanceUID *string `json:"studyInstanceUid,omitempty"`
	// Radiologist information
	Performer *Performer `json:"performer,omitempty"`
	// Imaging findings list
	Findings []string `json:"findings,omitempty"`
	// Diagnostic impression/conclusion
	Impression *string `json:"impression,omitempty"`
	// Radiation dose (for CT)
	RadiationDose *RadiationDose `json:"radiationDose,omitempty"`
	// Attached files
	Attachments []Attachment `json:"attachments,omitempty"`
}

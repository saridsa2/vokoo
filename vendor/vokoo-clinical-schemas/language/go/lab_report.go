// Package vokoo provides lab report data models.
//
// Package: https://github.com/saridsa2/vokoo/tree/main/vendor/vokoo-clinical-schemas/language/go
// Website: https://github.com/saridsa2/vokoo
// Schema: urn:vokoo:clinical:schema:lab-report:v0.1.0
package clinicalschemas

import "time"

// Interpretation represents lab result interpretation
type Interpretation string

const (
	// InterpretationNormal indicates normal result
	InterpretationNormal Interpretation = "N"
	// InterpretationLow indicates low result
	InterpretationLow Interpretation = "L"
	// InterpretationHigh indicates high result
	InterpretationHigh Interpretation = "H"
	// InterpretationAbnormal indicates abnormal result
	InterpretationAbnormal Interpretation = "A"
)

// Facility represents lab facility information.
type Facility struct {
	ID   *string `json:"id,omitempty"`
	Name *string `json:"name,omitempty"`
}

// Specimen represents specimen information.
type Specimen struct {
	Type        *Coding    `json:"type,omitempty"`
	CollectedAt *time.Time `json:"collectedAt,omitempty"`
}

// LabValue represents a lab result value that can be Quantity, CodeableConcept, or string
type LabValue interface{}

// LabResult represents an individual lab test result.
type LabResult struct {
	// LOINC code for the test
	Code CodeableConcept `json:"code"`
	// Result value (Quantity, CodeableConcept, or string)
	Value LabValue `json:"value"`
	// Normal reference range
	ReferenceRange *ReferenceRange `json:"referenceRange,omitempty"`
	// N (normal), L (low), H (high), A (abnormal)
	Interpretation *Interpretation `json:"interpretation,omitempty"`
	// Test method used
	Method *CodeableConcept `json:"method,omitempty"`
}

// LabReport represents a laboratory test report.
type LabReport struct {
	// Unique report identifier
	ID string `json:"id"`
	// Reference to Person.id
	PatientID string `json:"patientId"`
	// Report issue timestamp
	IssuedAt time.Time `json:"issuedAt"`
	// List of lab test results
	Results []LabResult `json:"results"`
	// Lab facility information
	Facility *Facility `json:"facility,omitempty"`
	// Test panel code
	Panel *CodeableConcept `json:"panel,omitempty"`
	// Specimen information
	Specimen *Specimen `json:"specimen,omitempty"`
}

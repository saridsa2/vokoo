// Package wellally provides personal health record data models.
//
// Package: https://github.com/saridsa2/vokoo/tree/main/vendor/wellally-schemas/language/go
// Website: https://www.wellally.tech/
// Schema: https://wellall.health/schemas/health/v0.1.0
package wellally

import "time"

// Gender represents gender type
type Gender string

const (
	GenderMale    Gender = "male"
	GenderFemale  Gender = "female"
	GenderOther   Gender = "other"
	GenderUnknown Gender = "unknown"
)

// ClinicalSummary represents clinical summary information.
type ClinicalSummary struct {
	// Known conditions/diagnoses (SNOMED CT or ICD-10)
	Conditions []CodeableConcept `json:"conditions,omitempty"`
	// Allergy list
	Allergies []CodeableConcept `json:"allergies,omitempty"`
	// Blood type (e.g., A+, O-)
	BloodType *string `json:"bloodType,omitempty"`
	// Primary care provider ID
	PrimaryCareProvider *string `json:"primaryCareProvider,omitempty"`
}

// Person represents a personal health record.
type Person struct {
	// Unique person identifier (UUID/ULID)
	ID string `json:"id"`
	// Resource type (always "Person")
	ResourceType string `json:"resourceType"`
	// Person name(s)
	Name []HumanName `json:"name"`
	// Date of birth
	BirthDate time.Time `json:"birthDate"`
	// External identifiers (MRN, national ID, etc.)
	Identifier []Identifier `json:"identifier,omitempty"`
	// Gender
	Gender *Gender `json:"gender,omitempty"`
	// Contact points (phone, email)
	Telecom []ContactPoint `json:"telecom,omitempty"`
	// Address(es)
	Address []Address `json:"address,omitempty"`
	// Marital status
	MaritalStatus *CodeableConcept `json:"maritalStatus,omitempty"`
	// Language preferences (IETF BCP-47 tags)
	Language []string `json:"language,omitempty"`
	// Clinical summary
	ClinicalSummary *ClinicalSummary `json:"clinicalSummary,omitempty"`
}

// Package vokoo provides medication record data models.
//
// Package: https://github.com/saridsa2/vokoo/tree/main/vendor/vokoo-clinical-schemas/language/go
// Website: https://github.com/saridsa2/vokoo
// Schema: urn:vokoo:clinical:schema:medication:v0.1.0
package clinicalschemas

import "time"

// Dosage represents medication dosage amount.
type Dosage struct {
	// Dose amount
	Value float64 `json:"value"`
	// UCUM unit (e.g., mg, mL)
	Unit string `json:"unit"`
}

// MedicationRecord represents a medication administration record.
type MedicationRecord struct {
	// Unique record identifier
	ID string `json:"id"`
	// Reference to Person.id
	PatientID string `json:"patientId"`
	// Medication code (RxNorm)
	Medication Coding `json:"medication"`
	// Dose amount and unit
	Dosage Dosage `json:"dosage"`
	// Administration route (PO, IV, etc.)
	Route Route `json:"route"`
	// Start date
	StartDate time.Time `json:"startDate"`
	// Medication form (tablet, capsule, etc.)
	Form *Coding `json:"form,omitempty"`
	// Dosing frequency (QD, BID, TID, etc.)
	Frequency *string `json:"frequency,omitempty"`
	// Treatment duration in days
	DurationDays *int `json:"durationDays,omitempty"`
	// End date
	EndDate *time.Time `json:"endDate,omitempty"`
	// Indication for use
	Indication *CodeableConcept `json:"indication,omitempty"`
	// Additional instructions
	Instructions *string `json:"instructions,omitempty"`
}

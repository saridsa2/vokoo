// Package vokoo provides common definitions and types for VoKoo Health data models.
//
// Package: https://github.com/saridsa2/vokoo/tree/main/vendor/vokoo-clinical-schemas/language/go
// Website: https://github.com/saridsa2/vokoo
// Schema: urn:vokoo:clinical:schema:common:v0.1.0
package clinicalschemas

import "time"

// UCUMUnit represents a UCUM unit string
type UCUMUnit string

// NameUse represents name usage context
type NameUse string

const (
	NameUseOfficial  NameUse = "official"
	NameUseUsual     NameUse = "usual"
	NameUseNickname  NameUse = "nickname"
	NameUseAnonymous NameUse = "anonymous"
	NameUseOld       NameUse = "old"
	NameUseMaiden    NameUse = "maiden"
)

// ContactSystem represents contact system type
type ContactSystem string

const (
	ContactSystemPhone ContactSystem = "phone"
	ContactSystemEmail ContactSystem = "email"
)

// ContactUse represents contact use context
type ContactUse string

const (
	ContactUseHome   ContactUse = "home"
	ContactUseWork   ContactUse = "work"
	ContactUseMobile ContactUse = "mobile"
)

// ModalityCode represents imaging modality codes
type ModalityCode string

const (
	ModalityCodeCT ModalityCode = "CT"
	ModalityCodeMR ModalityCode = "MR"
	ModalityCodeUS ModalityCode = "US"
	ModalityCodeXR ModalityCode = "XR"
	ModalityCodePT ModalityCode = "PT"
)

// Coding represents a coded value from a terminology system.
type Coding struct {
	// URI identifying the terminology system (e.g., http://loinc.org)
	System string `json:"system"`
	// The code value from the system
	Code string `json:"code"`
	// Optional human-readable display text
	Display *string `json:"display,omitempty"`
}

// CodeableConcept represents a concept that may be defined by one or more codes
// from formal terminologies.
type CodeableConcept struct {
	// List of coded values (at least one required)
	Coding []Coding `json:"coding"`
	// Optional plain text representation
	Text *string `json:"text,omitempty"`
}

// Quantity represents a measured or measurable amount with a UCUM unit.
type Quantity struct {
	// Numerical value
	Value float64 `json:"value"`
	// UCUM unit string
	Unit UCUMUnit `json:"unit"`
}

// ReferenceRange represents a reference range for lab test results.
type ReferenceRange struct {
	// Lower bound quantity
	Low *Quantity `json:"low,omitempty"`
	// Upper bound quantity
	High *Quantity `json:"high,omitempty"`
	// Optional textual description
	Text *string `json:"text,omitempty"`
}

// Identifier represents an identifier assigned to a resource.
type Identifier struct {
	// URI identifying the namespace
	System string `json:"system"`
	// The identifier value
	Value string `json:"value"`
	// Optional coded type
	Type *CodeableConcept `json:"type,omitempty"`
	// Optional validity period
	Period *Period `json:"period,omitempty"`
}

// HumanName represents a human's name with text, parts and usage information.
type HumanName struct {
	// Family/last name
	Family string `json:"family"`
	// Given/first name(s)
	Given []string `json:"given"`
	// Name usage context
	Use *NameUse `json:"use,omitempty"`
	// Name prefix(es)
	Prefix []string `json:"prefix,omitempty"`
	// Name suffix(es)
	Suffix []string `json:"suffix,omitempty"`
}

// ContactPoint represents contact details for a person or organization.
type ContactPoint struct {
	// phone | email
	System ContactSystem `json:"system"`
	// The actual contact point value
	Value string `json:"value"`
	// home | work | mobile
	Use *ContactUse `json:"use,omitempty"`
}

// Address represents an address for a person or organization.
type Address struct {
	// Street address lines
	Line []string `json:"line,omitempty"`
	// City name
	City *string `json:"city,omitempty"`
	// State/province
	State *string `json:"state,omitempty"`
	// Postal/zip code
	PostalCode *string `json:"postalCode,omitempty"`
	// Country name
	Country *string `json:"country,omitempty"`
}

// Period represents a time period defined by start and end dates.
type Period struct {
	// Start date
	Start *time.Time `json:"start,omitempty"`
	// End date
	End *time.Time `json:"end,omitempty"`
}

// Modality represents imaging modality code (CT, MR, US, XR, PT).
type Modality struct {
	// Terminology system URI
	System string `json:"system"`
	// Modality code
	Code ModalityCode `json:"code"`
	// Optional display text
	Display *string `json:"display,omitempty"`
}

// Route represents medication administration route.
type Route struct {
	// Terminology system URI
	System string `json:"system"`
	// Route code (e.g., PO, IV, IM, SC, INH, SL, PR or SNOMED CT codes)
	Code string `json:"code"`
	// Optional display text
	Display *string `json:"display,omitempty"`
}

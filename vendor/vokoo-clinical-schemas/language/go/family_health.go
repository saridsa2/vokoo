// Package vokoo provides family health tree data models.
//
// Package: https://github.com/saridsa2/vokoo/tree/main/vendor/vokoo-clinical-schemas/language/go
// Website: https://github.com/saridsa2/vokoo
// Schema: urn:vokoo:clinical:schema:family-health:v0.1.0
package clinicalschemas

// RelationToProband represents relationship to proband
type RelationToProband string

const (
	RelationSelf        RelationToProband = "self"
	RelationMother      RelationToProband = "mother"
	RelationFather      RelationToProband = "father"
	RelationSibling     RelationToProband = "sibling"
	RelationChild       RelationToProband = "child"
	RelationGrandparent RelationToProband = "grandparent"
	RelationGrandchild  RelationToProband = "grandchild"
	RelationAunt        RelationToProband = "aunt"
	RelationUncle       RelationToProband = "uncle"
	RelationCousin      RelationToProband = "cousin"
	RelationOther       RelationToProband = "other"
)

// Sex represents biological sex
type Sex string

const (
	SexMale    Sex = "male"
	SexFemale  Sex = "female"
	SexOther   Sex = "other"
	SexUnknown Sex = "unknown"
)

// FamilyMember represents a family member in a health tree.
type FamilyMember struct {
	// Member identifier
	ID string `json:"id"`
	// Relationship to proband
	RelationToProband RelationToProband `json:"relationToProband"`
	// Biological sex
	Sex *Sex `json:"sex,omitempty"`
	// Year of birth
	BirthYear *int `json:"birthYear,omitempty"`
	// Whether deceased
	Deceased *bool `json:"deceased,omitempty"`
	// Health conditions (SNOMED CT or ICD-10)
	Conditions []CodeableConcept `json:"conditions,omitempty"`
}

// FamilyHealthTree represents a family health tree for genetic and hereditary disease tracking.
type FamilyHealthTree struct {
	// ID of the proband (main individual)
	ProbandID string `json:"probandId"`
	// List of family members
	Members []FamilyMember `json:"members"`
}

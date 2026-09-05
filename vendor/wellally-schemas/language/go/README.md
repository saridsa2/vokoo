# WellAlly Go SDK

Go data models for the WellAlly health data platform.

**Website:** https://www.wellally.tech/

## Installation

```bash
go get https://github.com/saridsa2/vokoo/tree/main/vendor/wellally-schemas/language/go
```

## Features

- 🏥 **Lab Reports**: Structured laboratory test results with LOINC codes
- 🔬 **Imaging Reports**: Diagnostic imaging reports with DICOM support
- 💊 **Medications**: Medication records with RxNorm codes
- 👤 **Personal Health**: Individual health records following FHIR standards
- 👨‍👩‍👧‍👦 **Family Health**: Family health trees for genetic tracking
- 🔷 **Idiomatic Go**: Following Go best practices with proper JSON tags

## Usage

### Lab Report Example

```go
package main

import (
    "encoding/json"
    "fmt"
    "time"

    "https://github.com/saridsa2/vokoo/tree/main/vendor/wellally-schemas/language/go"
)

func main() {
    // Create a lab result
    display := "Glucose"
    result := wellally.LabResult{
        Code: wellally.CodeableConcept{
            Coding: []wellally.Coding{{
                System:  "http://loinc.org",
                Code:    "2339-0",
                Display: &display,
            }},
        },
        Value: wellally.Quantity{
            Value: 95.0,
            Unit:  "mg/dL",
        },
        Interpretation: func() *wellally.Interpretation {
            i := wellally.InterpretationNormal
            return &i
        }(),
    }

    // Create a lab report
    report := wellally.LabReport{
        ID:        "lab-001",
        PatientID: "patient-123",
        IssuedAt:  time.Now(),
        Results:   []wellally.LabResult{result},
    }

    // Marshal to JSON
    data, _ := json.MarshalIndent(report, "", "  ")
    fmt.Println(string(data))
}
```

### Personal Health Record Example

```go
package main

import (
    "time"

    "https://github.com/saridsa2/vokoo/tree/main/vendor/wellally-schemas/language/go"
)

func main() {
    person := wellally.Person{
        ID:           "patient-123",
        ResourceType: "Person",
        Name: []wellally.HumanName{{
            Family: "Zhang",
            Given:  []string{"San"},
        }},
        BirthDate: time.Date(1990, 1, 1, 0, 0, 0, 0, time.UTC),
        Gender: func() *wellally.Gender {
            g := wellally.GenderMale
            return &g
        }(),
    }
}
```

### Medication Record Example

```go
package main

import (
    "time"

    "https://github.com/saridsa2/vokoo/tree/main/vendor/wellally-schemas/language/go"
)

func main() {
    display := "Atorvastatin 20mg"
    routeDisplay := "Oral"
    frequency := "QD"

    medication := wellally.MedicationRecord{
        ID:        "med-001",
        PatientID: "patient-123",
        Medication: wellally.Coding{
            System:  "http://www.nlm.nih.gov/research/umls/rxnorm",
            Code:    "617310",
            Display: &display,
        },
        Dosage: wellally.Dosage{
            Value: 20.0,
            Unit:  "mg",
        },
        Route: wellally.Route{
            System:  "http://snomed.info/sct",
            Code:    "PO",
            Display: &routeDisplay,
        },
        StartDate: time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC),
        Frequency: &frequency,
    }
}
```

## Data Models

### Common Types
- `Coding`: Coded value from a terminology system
- `CodeableConcept`: Concept with multiple codes
- `Quantity`: Measured value with UCUM unit
- `HumanName`: Structured person name
- `ContactPoint`: Contact information
- `Address`: Postal address

### Domain Models
- `LabReport`: Laboratory test report
- `ImagingReport`: Diagnostic imaging report
- `MedicationRecord`: Medication administration record
- `Person`: Personal health record
- `FamilyHealthTree`: Family health tree

## Standards Compliance

This package implements data models based on:
- HL7 FHIR (Fast Healthcare Interoperability Resources)
- LOINC (Logical Observation Identifiers Names and Codes)
- SNOMED CT (Systematized Nomenclature of Medicine)
- RxNorm (medication naming)
- UCUM (Unified Code for Units of Measure)
- DICOM (Digital Imaging and Communications in Medicine)

## License

Governed by the VoKoo root LICENSE

## Support

- Documentation: https://www.wellally.tech/docs
- Issues: https://github.com/saridsa2/vokoo/issues
- Support: https://github.com/saridsa2/vokoo/issues

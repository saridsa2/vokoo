# WellAlly TypeScript/Node.js SDK

TypeScript data models for the WellAlly health data platform.

**Website:** https://www.wellally.tech/

## Installation

```bash
npm install @wellally/health-models
# or
yarn add @wellally/health-models
# or
pnpm add @wellally/health-models
```

## Features

- 🏥 **Lab Reports**: Structured laboratory test results with LOINC codes
- 🔬 **Imaging Reports**: Diagnostic imaging reports with DICOM support
- 💊 **Medications**: Medication records with RxNorm codes
- 👤 **Personal Health**: Individual health records following FHIR standards
- 👨‍👩‍👧‍👦 **Family Health**: Family health trees for genetic tracking
- 📘 **Full TypeScript Support**: Complete type definitions for all models

## Usage

### Lab Report Example

```typescript
import { LabReport, LabResult, CodeableConcept, Coding, Quantity } from '@wellally/health-models';

// Create a lab result
const result: LabResult = {
  code: {
    coding: [{
      system: "http://loinc.org",
      code: "2339-0",
      display: "Glucose"
    }]
  },
  value: {
    value: 95.0,
    unit: "mg/dL"
  },
  interpretation: "N"
};

// Create a lab report
const report: LabReport = {
  id: "lab-001",
  patientId: "patient-123",
  issuedAt: new Date().toISOString(),
  results: [result]
};
```

### Personal Health Record Example

```typescript
import { Person, HumanName } from '@wellally/health-models';

const person: Person = {
  id: "patient-123",
  resourceType: "Person",
  name: [{
    family: "Zhang",
    given: ["San"]
  }],
  birthDate: "1990-01-01",
  gender: "male"
};
```

### Medication Record Example

```typescript
import { MedicationRecord } from '@wellally/health-models';

const medication: MedicationRecord = {
  id: "med-001",
  patientId: "patient-123",
  medication: {
    system: "http://www.nlm.nih.gov/research/umls/rxnorm",
    code: "617310",
    display: "Atorvastatin 20mg"
  },
  dosage: {
    value: 20,
    unit: "mg"
  },
  route: {
    system: "http://snomed.info/sct",
    code: "PO",
    display: "Oral"
  },
  frequency: "QD",
  startDate: "2024-01-01"
};
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

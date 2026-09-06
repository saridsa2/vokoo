# VoKoo Java SDK

Java data models for the VoKoo health data platform.

**Website:** https://github.com/saridsa2/vokoo

## Installation

### Maven

Add this to your `pom.xml`:

```xml
<dependency>
    <groupId>tech.vokoo</groupId>
    <artifactId>health-models</artifactId>
    <version>0.1.0</version>
</dependency>
```

### Gradle

Add this to your `build.gradle`:

```gradle
implementation 'tech.vokoo:health-models:0.1.0'
```

## Features

- 🏥 **Lab Reports**: Structured laboratory test results with LOINC codes
- 🔬 **Imaging Reports**: Diagnostic imaging reports with DICOM support
- 💊 **Medications**: Medication records with RxNorm codes
- 👤 **Personal Health**: Individual health records following FHIR standards
- 👨‍👩‍👧‍👦 **Family Health**: Family health trees for genetic tracking
- ☕ **Java 11+**: Modern Java with Jackson JSON support

## Usage

### Lab Report Example

```java
import tech.vokoo.health.common.Common.*;
import tech.vokoo.health.labreport.LabReportModels.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

import java.time.Instant;
import java.util.Arrays;

public class Example {
    public static void main(String[] args) throws Exception {
        // Create a lab result
        Coding loincCode = new Coding("http://loinc.org", "2339-0", "Glucose");
        CodeableConcept code = new CodeableConcept(Arrays.asList(loincCode));

        LabResult result = new LabResult();
        result.setCode(code);
        result.setValue(new Quantity(95.0, "mg/dL"));
        result.setInterpretation(Interpretation.N);

        // Create a lab report
        LabReport report = new LabReport();
        report.setId("lab-001");
        report.setPatientId("patient-123");
        report.setIssuedAt(Instant.now());
        report.setResults(Arrays.asList(result));

        // Serialize to JSON
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        String json = mapper.writerWithDefaultPrettyPrinter().writeValueAsString(report);
        System.out.println(json);
    }
}
```

### Personal Health Record Example

```java
import tech.vokoo.health.common.Common.*;
import tech.vokoo.health.person.HealthModels.*;

import java.time.LocalDate;
import java.util.Arrays;

public class Example {
    public static void main(String[] args) {
        HumanName name = new HumanName("Zhang", Arrays.asList("San"));

        Person person = new Person();
        person.setId("patient-123");
        person.setResourceType("Person");
        person.setName(Arrays.asList(name));
        person.setBirthDate(LocalDate.of(1990, 1, 1));
        person.setGender(Gender.MALE);
    }
}
```

### Medication Record Example

```java
import tech.vokoo.health.common.Common.*;
import tech.vokoo.health.medication.MedicationModels.*;

import java.time.LocalDate;

public class Example {
    public static void main(String[] args) {
        Coding medication = new Coding(
            "http://www.nlm.nih.gov/research/umls/rxnorm",
            "617310",
            "Atorvastatin 20mg"
        );

        Route route = new Route(
            "http://snomed.info/sct",
            "PO",
            "Oral"
        );

        MedicationRecord record = new MedicationRecord();
        record.setId("med-001");
        record.setPatientId("patient-123");
        record.setMedication(medication);
        record.setDosage(new Dosage(20.0, "mg"));
        record.setRoute(route);
        record.setStartDate(LocalDate.of(2024, 1, 1));
        record.setFrequency("QD");
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

- Documentation: https://github.com/saridsa2/vokoo
- Issues: https://github.com/saridsa2/vokoo/issues
- Support: https://github.com/saridsa2/vokoo/issues

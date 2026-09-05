"""
Example usage of WellAlly FHIR-lite Mapper.
"""

from wellally_fhir_lite import FHIRLiteMapper
from wellally.common import Person, CodeableConcept, Coding, Quantity
from wellally.lab import LabReport, LabResult
import json


def example_person_to_patient():
    """Convert Person to FHIR Patient."""
    print("=== Person to FHIR Patient ===\n")

    mapper = FHIRLiteMapper()

    person = Person(
        identifier="P12345",
        name="John Doe",
        date_of_birth="1980-05-15",
        gender="M"
    )

    patient = mapper.person_to_patient(person)

    print(json.dumps(patient, indent=2))
    print()


def example_lab_result_to_observation():
    """Convert LabResult to FHIR Observation."""
    print("=== LabResult to FHIR Observation ===\n")

    mapper = FHIRLiteMapper()

    # Create lab result
    lab_result = LabResult(
        code=CodeableConcept(
            coding=[Coding(
                system="http://loinc.org",
                code="2339-0",
                display="Glucose"
            )],
            display="Glucose"
        ),
        value=Quantity(value=95, unit="mg/dL"),
        reference_range="70-100"
    )

    observation = mapper.lab_result_to_observation(
        lab_result,
        patient_reference="Patient/P12345",
        report_date="2025-01-15T09:00:00Z"
    )

    print(json.dumps(observation, indent=2))
    print()


def example_complete_lab_report():
    """Convert complete lab report."""
    print("=== Complete Lab Report to FHIR ===\n")

    mapper = FHIRLiteMapper()

    # Create lab report
    report = LabReport(
        identifier="LAB-2025-001",
        effective_date_time="2025-01-15T09:00:00Z",
        results=[
            LabResult(
                code=CodeableConcept(
                    coding=[Coding(system="http://loinc.org", code="2339-0", display="Glucose")],
                    display="Glucose"
                ),
                value=Quantity(value=105, unit="mg/dL"),
                reference_range="70-100"
            ),
            LabResult(
                code=CodeableConcept(
                    coding=[Coding(system="http://loinc.org", code="2093-3", display="Cholesterol")],
                    display="Total Cholesterol"
                ),
                value=Quantity(value=190, unit="mg/dL"),
                reference_range="< 200"
            )
        ]
    )

    diagnostic_report = mapper.lab_report_to_diagnostic_report(report, "Patient/P12345")

    print("DiagnosticReport:")
    print(f"  Status: {diagnostic_report['status']}")
    print(f"  Results: {len(diagnostic_report['result'])} observations")
    print()


if __name__ == "__main__":
    print("WellAlly FHIR-lite Mapper - Examples\n")
    print("=" * 60)
    print()

    try:
        example_person_to_patient()
        example_lab_result_to_observation()
        example_complete_lab_report()

        print("=" * 60)
        print("\n✨ All examples completed!")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()

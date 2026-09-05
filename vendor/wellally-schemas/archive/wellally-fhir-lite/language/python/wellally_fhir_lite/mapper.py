"""
FHIR-lite mapper - simplified FHIR R4 mapping.
"""

from typing import Dict, Any, Optional, List
from datetime import datetime

from wellally.lab import LabReport, LabResult
from wellally.common import Person, CodeableConcept, Coding, Quantity


class FHIRLiteMapper:
    """
    Map WellAlly schemas to simplified FHIR R4 resources.

    Supports essential FHIR resources:
    - Patient
    - Observation (lab results, vitals)
    - DiagnosticReport

    Example:
        >>> mapper = FHIRLiteMapper()
        >>> fhir_patient = mapper.person_to_patient(person)
        >>> print(fhir_patient["resourceType"])
        Patient
    """

    def __init__(self):
        """Initialize FHIR mapper."""
        pass

    def person_to_patient(self, person: Person) -> Dict[str, Any]:
        """
        Map WellAlly Person to FHIR Patient resource.

        Args:
            person: WellAlly Person object

        Returns:
            FHIR Patient resource
        """
        patient = {
            "resourceType": "Patient",
            "id": person.identifier or "unknown",
        }

        # Name
        if person.name:
            patient["name"] = [{
                "use": "official",
                "text": person.name,
                "family": person.name.split()[-1] if " " in person.name else person.name,
                "given": person.name.split()[:-1] if " " in person.name else []
            }]

        # Birth date
        if person.date_of_birth:
            patient["birthDate"] = person.date_of_birth

        # Gender
        if person.gender:
            patient["gender"] = person.gender.lower()

        # Identifier
        if person.identifier:
            patient["identifier"] = [{
                "system": "urn:wellally:patient",
                "value": person.identifier
            }]

        return patient

    def lab_result_to_observation(
        self,
        result: LabResult,
        patient_reference: str = "Patient/unknown",
        report_date: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Map LabResult to FHIR Observation.

        Args:
            result: WellAlly LabResult
            patient_reference: FHIR patient reference
            report_date: ISO date string

        Returns:
            FHIR Observation resource
        """
        observation = {
            "resourceType": "Observation",
            "status": "final",
            "category": [{
                "coding": [{
                    "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                    "code": "laboratory",
                    "display": "Laboratory"
                }]
            }],
            "subject": {
                "reference": patient_reference
            }
        }

        # Code (LOINC)
        observation["code"] = self._codeable_concept_to_fhir(result.code)

        # Value
        if result.value:
            observation["valueQuantity"] = self._quantity_to_fhir(result.value)

        # Effective date
        if report_date:
            observation["effectiveDateTime"] = report_date

        # Reference range
        if result.reference_range:
            # Parse simple range like "70-100"
            parts = result.reference_range.replace(" ", "").split("-")
            if len(parts) == 2:
                try:
                    observation["referenceRange"] = [{
                        "low": {"value": float(parts[0]), "unit": result.value.unit},
                        "high": {"value": float(parts[1]), "unit": result.value.unit}
                    }]
                except:
                    pass

        # Interpretation (abnormal flags)
        if result.interpretation:
            observation["interpretation"] = [
                self._codeable_concept_to_fhir(interp)
                for interp in result.interpretation
            ]

        return observation

    def lab_report_to_diagnostic_report(
        self,
        report: LabReport,
        patient_reference: str = "Patient/unknown"
    ) -> Dict[str, Any]:
        """
        Map LabReport to FHIR DiagnosticReport.

        Args:
            report: WellAlly LabReport
            patient_reference: FHIR patient reference

        Returns:
            FHIR DiagnosticReport resource
        """
        diagnostic_report = {
            "resourceType": "DiagnosticReport",
            "status": "final",
            "category": [{
                "coding": [{
                    "system": "http://terminology.hl7.org/CodeSystem/v2-0074",
                    "code": "LAB",
                    "display": "Laboratory"
                }]
            }],
            "code": {
                "text": "Laboratory Report"
            },
            "subject": {
                "reference": patient_reference
            }
        }

        # Effective date
        if report.effective_date_time:
            diagnostic_report["effectiveDateTime"] = report.effective_date_time

        # Results - create observations
        observations = []
        for lab_result in report.results:
            obs = self.lab_result_to_observation(
                lab_result,
                patient_reference,
                report.effective_date_time
            )
            observations.append(obs)

        diagnostic_report["result"] = [
            {"reference": f"Observation/{i}"}
            for i in range(len(observations))
        ]

        # Store observations in contained resources
        diagnostic_report["contained"] = observations

        return diagnostic_report

    def _codeable_concept_to_fhir(self, concept: CodeableConcept) -> Dict[str, Any]:
        """Convert WellAlly CodeableConcept to FHIR."""
        fhir_concept = {}

        if concept.coding:
            fhir_concept["coding"] = [
                {
                    "system": coding.system,
                    "code": coding.code,
                    "display": coding.display
                }
                for coding in concept.coding
            ]

        if concept.display:
            fhir_concept["text"] = concept.display

        return fhir_concept

    def _quantity_to_fhir(self, quantity: Quantity) -> Dict[str, Any]:
        """Convert WellAlly Quantity to FHIR."""
        return {
            "value": quantity.value,
            "unit": quantity.unit,
            "system": "http://unitsofmeasure.org",  # UCUM
            "code": quantity.unit
        }

    def bundle_resources(
        self,
        resources: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Create FHIR Bundle from multiple resources.

        Args:
            resources: List of FHIR resources

        Returns:
            FHIR Bundle
        """
        return {
            "resourceType": "Bundle",
            "type": "collection",
            "entry": [
                {"resource": resource}
                for resource in resources
            ]
        }

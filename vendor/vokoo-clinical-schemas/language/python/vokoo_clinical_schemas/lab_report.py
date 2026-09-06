"""
Lab Report data models.
Package: vokoo
Website: https://github.com/saridsa2/vokoo
Schema: urn:vokoo:clinical:schema:lab-report:v0.1.0
"""

from typing import Optional, List, Union, Literal
from dataclasses import dataclass
from datetime import datetime

from .common import CodeableConcept, Quantity, ReferenceRange, Coding


@dataclass
class Facility:
    """Lab facility information."""
    id: Optional[str] = None
    name: Optional[str] = None


@dataclass
class Specimen:
    """Specimen information."""
    type: Optional[Coding] = None
    collectedAt: Optional[datetime] = None


@dataclass
class LabResult:
    """
    Individual lab test result.

    Attributes:
        code: LOINC code for the test
        value: Result value (Quantity, CodeableConcept, or string)
        referenceRange: Normal reference range
        interpretation: N (normal), L (low), H (high), A (abnormal)
        method: Test method used
    """
    code: CodeableConcept
    value: Union[Quantity, CodeableConcept, str]
    referenceRange: Optional[ReferenceRange] = None
    interpretation: Optional[Literal["N", "L", "H", "A"]] = None
    method: Optional[CodeableConcept] = None


@dataclass
class LabReport:
    """
    Laboratory test report.

    Attributes:
        id: Unique report identifier
        patientId: Reference to Person.id
        issuedAt: Report issue timestamp
        results: List of lab test results
        facility: Lab facility information
        panel: Test panel code
        specimen: Specimen information
    """
    id: str
    patientId: str
    issuedAt: datetime
    results: List[LabResult]
    facility: Optional[Facility] = None
    panel: Optional[CodeableConcept] = None
    specimen: Optional[Specimen] = None

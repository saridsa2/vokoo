"""
Medication Record data models.
Package: vokoo
Website: https://github.com/saridsa2/vokoo
Schema: urn:vokoo:clinical:schema:medication:v0.1.0
"""

from typing import Optional
from dataclasses import dataclass
from datetime import date

from .common import Coding, CodeableConcept, Route


@dataclass
class Dosage:
    """
    Medication dosage amount.

    Attributes:
        value: Dose amount
        unit: UCUM unit (e.g., mg, mL)
    """
    value: float
    unit: str


@dataclass
class MedicationRecord:
    """
    Medication administration record.

    Attributes:
        id: Unique record identifier
        patientId: Reference to Person.id
        medication: Medication code (RxNorm)
        dosage: Dose amount and unit
        route: Administration route (PO, IV, etc.)
        startDate: Start date
        form: Medication form (tablet, capsule, etc.)
        frequency: Dosing frequency (QD, BID, TID, etc.)
        durationDays: Treatment duration in days
        endDate: End date
        indication: Indication for use
        instructions: Additional instructions
    """
    id: str
    patientId: str
    medication: Coding
    dosage: Dosage
    route: Route
    startDate: date
    form: Optional[Coding] = None
    frequency: Optional[str] = None
    durationDays: Optional[int] = None
    endDate: Optional[date] = None
    indication: Optional[CodeableConcept] = None
    instructions: Optional[str] = None

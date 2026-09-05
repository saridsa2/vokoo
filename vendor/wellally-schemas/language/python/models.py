from __future__ import annotations
from dataclasses import dataclass, field
from typing import List, Optional, Union

# Package namespace aligned with wellally.tech
# Generated from infrastructure/schemas v0.1.0

# ---------- Common Types ----------
@dataclass
class Coding:
    system: str
    code: str
    display: Optional[str] = None


@dataclass
class CodeableConcept:
    coding: List[Coding]
    text: Optional[str] = None


@dataclass
class Quantity:
    value: float
    unit: str


@dataclass
class ReferenceRange:
    low: Optional[Quantity] = None
    high: Optional[Quantity] = None
    text: Optional[str] = None


@dataclass
class Identifier:
    system: str
    value: str
    type: Optional[CodeableConcept] = None
    period: Optional["Period"] = None  # validity window


@dataclass
class HumanName:
    family: str
    given: List[str]
    use: Optional[str] = None  # official/usual/nickname/anonymous/old/maiden
    prefix: Optional[List[str]] = None
    suffix: Optional[List[str]] = None


@dataclass
class ContactPoint:
    system: str  # phone | email
    value: str
    use: Optional[str] = None  # home | work | mobile


@dataclass
class Address:
    line: Optional[List[str]] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postalCode: Optional[str] = None
    country: Optional[str] = None


@dataclass
class Modality:
    system: str
    code: str  # CT | MR | US | XR | PT
    display: Optional[str] = None


@dataclass
class Route:
    system: str
    code: str  # e.g., PO/IV/SNOMED code
    display: Optional[str] = None


@dataclass
class SpecimenType:
    system: str
    code: str  # BLD | SER | PLAS | UR
    display: Optional[str] = None


@dataclass
class Period:
    start: Optional[str] = None  # ISO date
    end: Optional[str] = None    # ISO date


# ---------- Health (Person) ----------
@dataclass
class ClinicalSummary:
    conditions: Optional[List[CodeableConcept]] = None
    allergies: Optional[List[CodeableConcept]] = None
    bloodType: Optional[str] = None
    primaryCareProvider: Optional[str] = None


@dataclass
class HealthPerson:
    id: str
    name: List[HumanName]
    birthDate: str  # ISO date
    identifier: Optional[List[Identifier]] = None
    resourceType: str = "Person"
    gender: Optional[str] = None  # male/female/other/unknown
    telecom: Optional[List[ContactPoint]] = None
    address: Optional[List[Address]] = None
    maritalStatus: Optional[CodeableConcept] = None
    language: Optional[List[str]] = None
    clinicalSummary: Optional[ClinicalSummary] = None


# ---------- Lab Report ----------
LabResultValue = Union[Quantity, CodeableConcept, str]


@dataclass
class LabResult:
    code: CodeableConcept
    value: LabResultValue
    referenceRange: Optional[ReferenceRange] = None
    interpretation: Optional[str] = None  # N/L/H/A
    method: Optional[CodeableConcept] = None


@dataclass
class Specimen:
    type: Optional[SpecimenType] = None
    collectedAt: Optional[str] = None  # ISO date-time


@dataclass
class Facility:
    id: Optional[str] = None
    name: Optional[str] = None


@dataclass
class LabReport:
    id: str
    patientId: str
    issuedAt: str  # ISO date-time
    results: List[LabResult]
    facility: Optional[Facility] = None
    panel: Optional[CodeableConcept] = None
    specimen: Optional[Specimen] = None


# ---------- Imaging Report ----------
@dataclass
class Attachment:
    url: Optional[str] = None
    type: Optional[str] = None  # thumbnail/report PDF etc.


@dataclass
class RadiationDose:
    ctdiVol_mGy: Optional[float] = None
    dlp_mGy_cm: Optional[float] = None


@dataclass
class Performer:
    id: Optional[str] = None
    name: Optional[str] = None
    role: Optional[str] = None


@dataclass
class ImagingReport:
    id: str
    patientId: str
    modality: Modality
    bodySite: Coding
    reportedAt: str  # ISO date-time
    studyInstanceUid: Optional[str] = None
    performer: Optional[Performer] = None
    findings: Optional[List[str]] = None
    impression: Optional[str] = None
    radiationDose: Optional[RadiationDose] = None
    attachments: Optional[List[Attachment]] = None


# ---------- Medication ----------
@dataclass
class Dosage:
    value: float
    unit: str  # UCUM unit


@dataclass
class MedicationRecord:
    id: str
    patientId: str
    medication: Coding
    dosage: Dosage
    route: Route
    startDate: str  # ISO date
    form: Optional[Coding] = None
    frequency: Optional[str] = None
    durationDays: Optional[int] = None
    endDate: Optional[str] = None
    indication: Optional[CodeableConcept] = None
    instructions: Optional[str] = None


# ---------- Family Health Tree ----------
@dataclass
class FamilyMember:
    id: str
    relationToProband: str  # self/mother/father/...
    sex: Optional[str] = None  # male/female/other/unknown
    birthYear: Optional[int] = None
    deceased: Optional[bool] = None
    conditions: Optional[List[CodeableConcept]] = None


@dataclass
class FamilyHealthTree:
    probandId: str
    members: List[FamilyMember]

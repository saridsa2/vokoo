"""
Personal Health Record data models.
Package: wellally
Website: https://www.wellally.tech/
Schema: https://wellall.health/schemas/health/v0.1.0
"""

from typing import Optional, List, Literal
from dataclasses import dataclass
from datetime import date

from .common import Identifier, HumanName, ContactPoint, Address, CodeableConcept


@dataclass
class ClinicalSummary:
    """
    Clinical summary information.

    Attributes:
        conditions: Known conditions/diagnoses (SNOMED CT or ICD-10)
        allergies: Allergy list
        bloodType: Blood type (e.g., A+, O-)
        primaryCareProvider: Primary care provider ID
    """
    conditions: Optional[List[CodeableConcept]] = None
    allergies: Optional[List[CodeableConcept]] = None
    bloodType: Optional[str] = None
    primaryCareProvider: Optional[str] = None


@dataclass
class Person:
    """
    Personal health record.

    Attributes:
        id: Unique person identifier (UUID/ULID)
        name: Person name(s)
        birthDate: Date of birth
        resourceType: Resource type (always "Person")
        identifier: External identifiers (MRN, national ID, etc.)
        gender: Gender (male, female, other, unknown)
        telecom: Contact points (phone, email)
        address: Address(es)
        maritalStatus: Marital status
        language: Language preferences (IETF BCP-47 tags)
        clinicalSummary: Clinical summary
    """
    id: str
    name: List[HumanName]
    birthDate: date
    resourceType: Literal["Person"] = "Person"
    identifier: Optional[List[Identifier]] = None
    gender: Optional[Literal["male", "female", "other", "unknown"]] = None
    telecom: Optional[List[ContactPoint]] = None
    address: Optional[List[Address]] = None
    maritalStatus: Optional[CodeableConcept] = None
    language: Optional[List[str]] = None
    clinicalSummary: Optional[ClinicalSummary] = None

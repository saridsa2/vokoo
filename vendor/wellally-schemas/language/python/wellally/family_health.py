"""
Family Health Tree data models.
Package: wellally
Website: https://www.wellally.tech/
Schema: https://wellall.health/schemas/family-health/v0.1.0
"""

from typing import Optional, List, Literal
from dataclasses import dataclass

from .common import CodeableConcept


@dataclass
class FamilyMember:
    """
    Family member in a health tree.

    Attributes:
        id: Member identifier
        relationToProband: Relationship to proband
        sex: Biological sex
        birthYear: Year of birth
        deceased: Whether deceased
        conditions: Health conditions (SNOMED CT or ICD-10)
    """
    id: str
    relationToProband: Literal[
        "self", "mother", "father", "sibling", "child",
        "grandparent", "grandchild", "aunt", "uncle", "cousin", "other"
    ]
    sex: Optional[Literal["male", "female", "other", "unknown"]] = None
    birthYear: Optional[int] = None
    deceased: Optional[bool] = None
    conditions: Optional[List[CodeableConcept]] = None


@dataclass
class FamilyHealthTree:
    """
    Family health tree for genetic and hereditary disease tracking.

    Attributes:
        probandId: ID of the proband (main individual)
        members: List of family members
    """
    probandId: str
    members: List[FamilyMember]

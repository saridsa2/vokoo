"""
Common definitions and types for WellAll Health data models.
Package: wellally
Website: https://www.wellally.tech/
Schema: https://wellall.health/schemas/common/v0.1.0
"""

from typing import Optional, List, Literal
from dataclasses import dataclass, field
from datetime import date


# Type aliases for UCUM units
UCUMUnit = str


@dataclass
class Coding:
    """
    Represents a coded value from a terminology system.

    Attributes:
        system: URI identifying the terminology system (e.g., http://loinc.org)
        code: The code value from the system
        display: Optional human-readable display text
    """
    system: str
    code: str
    display: Optional[str] = None


@dataclass
class CodeableConcept:
    """
    A concept that may be defined by one or more codes from formal terminologies.

    Attributes:
        coding: List of coded values (at least one required)
        text: Optional plain text representation
    """
    coding: List[Coding]
    text: Optional[str] = None


@dataclass
class Quantity:
    """
    A measured or measurable amount with a UCUM unit.

    Attributes:
        value: Numerical value
        unit: UCUM unit string
    """
    value: float
    unit: UCUMUnit


@dataclass
class ReferenceRange:
    """
    Reference range for lab test results.

    Attributes:
        low: Lower bound quantity
        high: Upper bound quantity
        text: Optional textual description
    """
    low: Optional[Quantity] = None
    high: Optional[Quantity] = None
    text: Optional[str] = None


@dataclass
class Identifier:
    """
    An identifier assigned to a resource.

    Attributes:
        system: URI identifying the namespace
        value: The identifier value
        type: Optional coded type
        period: Optional validity period
    """
    system: str
    value: str
    type: Optional[CodeableConcept] = None
    period: Optional['Period'] = None


@dataclass
class HumanName:
    """
    A human's name with text, parts and usage information.

    Attributes:
        family: Family/last name
        given: Given/first name(s)
        use: Name usage context (official, usual, nickname, etc.)
        prefix: Name prefix(es)
        suffix: Name suffix(es)
    """
    family: str
    given: List[str]
    use: Optional[Literal["official", "usual", "nickname", "anonymous", "old", "maiden"]] = None
    prefix: Optional[List[str]] = None
    suffix: Optional[List[str]] = None


@dataclass
class ContactPoint:
    """
    Contact details for a person or organization.

    Attributes:
        system: phone | email
        value: The actual contact point value
        use: home | work | mobile
    """
    system: Literal["phone", "email"]
    value: str
    use: Optional[Literal["home", "work", "mobile"]] = None


@dataclass
class Address:
    """
    An address for a person or organization.

    Attributes:
        line: Street address lines
        city: City name
        state: State/province
        postalCode: Postal/zip code
        country: Country name
    """
    line: Optional[List[str]] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postalCode: Optional[str] = None
    country: Optional[str] = None


@dataclass
class Period:
    """
    A time period defined by start and end dates.

    Attributes:
        start: Start date
        end: End date
    """
    start: Optional[date] = None
    end: Optional[date] = None


@dataclass
class Modality:
    """
    Imaging modality code (CT, MR, US, XR, PT).

    Attributes:
        system: Terminology system URI
        code: Modality code
        display: Optional display text
    """
    system: str
    code: Literal["CT", "MR", "US", "XR", "PT"]
    display: Optional[str] = None


@dataclass
class Route:
    """
    Medication administration route.

    Attributes:
        system: Terminology system URI
        code: Route code (e.g., PO, IV, IM)
        display: Optional display text
    """
    system: str
    code: str  # PO, IV, IM, SC, INH, SL, PR or SNOMED CT codes
    display: Optional[str] = None

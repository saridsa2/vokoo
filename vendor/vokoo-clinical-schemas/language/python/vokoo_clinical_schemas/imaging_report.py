"""
Imaging Report data models.
Package: vokoo
Website: https://github.com/saridsa2/vokoo
Schema: urn:vokoo:clinical:schema:imaging-report:v0.1.0
"""

from typing import Optional, List
from dataclasses import dataclass
from datetime import datetime

from .common import Modality, Coding


@dataclass
class Performer:
    """Imaging report performer (radiologist)."""
    id: Optional[str] = None
    name: Optional[str] = None
    role: Optional[str] = None


@dataclass
class RadiationDose:
    """
    CT radiation dose information.

    Attributes:
        ctdiVol_mGy: CT Dose Index Volume (mGy)
        dlp_mGy_cm: Dose Length Product (mGy·cm)
    """
    ctdiVol_mGy: Optional[float] = None
    dlp_mGy_cm: Optional[float] = None


@dataclass
class Attachment:
    """Report attachment (image, PDF, etc.)."""
    url: Optional[str] = None
    type: Optional[str] = None


@dataclass
class ImagingReport:
    """
    Diagnostic imaging report.

    Attributes:
        id: Unique report identifier
        patientId: Reference to Person.id
        modality: Imaging modality (CT, MR, US, XR, PT)
        bodySite: Body site examined (SNOMED CT code)
        reportedAt: Report timestamp
        studyInstanceUid: DICOM Study Instance UID
        performer: Radiologist information
        findings: Imaging findings list
        impression: Diagnostic impression/conclusion
        radiationDose: Radiation dose (for CT)
        attachments: Attached files
    """
    id: str
    patientId: str
    modality: Modality
    bodySite: Coding
    reportedAt: datetime
    studyInstanceUid: Optional[str] = None
    performer: Optional[Performer] = None
    findings: Optional[List[str]] = None
    impression: Optional[str] = None
    radiationDose: Optional[RadiationDose] = None
    attachments: Optional[List[Attachment]] = None

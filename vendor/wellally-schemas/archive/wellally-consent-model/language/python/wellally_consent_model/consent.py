"""
Health consent management system.
"""

from typing import Dict, List, Optional
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum


class ConsentStatus(Enum):
    """Consent status."""
    ACTIVE = "active"
    REVOKED = "revoked"
    EXPIRED = "expired"
    PENDING = "pending"


class ConsentScope(Enum):
    """What the consent covers."""
    DATA_SHARING = "data_sharing"
    RESEARCH = "research"
    THIRD_PARTY = "third_party"
    MARKETING = "marketing"
    ALL = "all"


@dataclass
class Consent:
    """
    Patient consent record.

    Attributes:
        consent_id: Unique identifier
        patient_id: Patient identifier
        scope: What consent covers
        status: Current status
        granted_date: When consent was given
        expiry_date: When consent expires
        revoked_date: When consent was revoked
        data_categories: Specific data types covered
        purposes: Allowed purposes
        authorized_parties: Who can access
        audit_trail: History of changes
    """
    consent_id: str
    patient_id: str
    scope: ConsentScope
    status: ConsentStatus
    granted_date: datetime
    expiry_date: Optional[datetime] = None
    revoked_date: Optional[datetime] = None
    data_categories: List[str] = field(default_factory=list)
    purposes: List[str] = field(default_factory=list)
    authorized_parties: List[str] = field(default_factory=list)
    audit_trail: List[Dict] = field(default_factory=list)

    def to_dict(self) -> Dict:
        """Convert to dictionary."""
        return {
            "consent_id": self.consent_id,
            "patient_id": self.patient_id,
            "scope": self.scope.value,
            "status": self.status.value,
            "granted_date": self.granted_date.isoformat(),
            "expiry_date": self.expiry_date.isoformat() if self.expiry_date else None,
            "revoked_date": self.revoked_date.isoformat() if self.revoked_date else None,
            "data_categories": self.data_categories,
            "purposes": self.purposes,
            "authorized_parties": self.authorized_parties
        }


class ConsentModel:
    """
    Manage patient consents with audit trail.

    Implements GDPR-compliant consent management:
    - Consent capture and verification
    - Revocation support
    - Audit logging
    - Expiry tracking

    Example:
        >>> manager = ConsentModel()
        >>> consent_id = manager.grant_consent(
        ...     patient_id="12345",
        ...     scope=ConsentScope.DATA_SHARING,
        ...     data_categories=["lab_results", "medications"]
        ... )
    """

    def __init__(self):
        """Initialize consent manager."""
        self.consents: Dict[str, Consent] = {}
        self._next_id = 1

    def grant_consent(
        self,
        patient_id: str,
        scope: ConsentScope,
        data_categories: Optional[List[str]] = None,
        purposes: Optional[List[str]] = None,
        authorized_parties: Optional[List[str]] = None,
        expiry_date: Optional[datetime] = None
    ) -> str:
        """
        Grant new consent.

        Args:
            patient_id: Patient identifier
            scope: Consent scope
            data_categories: Data types covered
            purposes: Allowed purposes
            authorized_parties: Who can access
            expiry_date: Expiration date

        Returns:
            Consent ID
        """
        consent_id = f"CONSENT-{self._next_id:06d}"
        self._next_id += 1

        consent = Consent(
            consent_id=consent_id,
            patient_id=patient_id,
            scope=scope,
            status=ConsentStatus.ACTIVE,
            granted_date=datetime.now(),
            expiry_date=expiry_date,
            data_categories=data_categories or [],
            purposes=purposes or [],
            authorized_parties=authorized_parties or []
        )

        # Add audit entry
        consent.audit_trail.append({
            "action": "granted",
            "timestamp": datetime.now().isoformat(),
            "details": "Consent granted"
        })

        self.consents[consent_id] = consent

        return consent_id

    def revoke_consent(self, consent_id: str, reason: Optional[str] = None) -> bool:
        """
        Revoke existing consent.

        Args:
            consent_id: Consent to revoke
            reason: Optional reason for revocation

        Returns:
            True if revoked successfully
        """
        if consent_id not in self.consents:
            return False

        consent = self.consents[consent_id]

        if consent.status != ConsentStatus.ACTIVE:
            return False  # Already revoked/expired

        consent.status = ConsentStatus.REVOKED
        consent.revoked_date = datetime.now()

        # Add audit entry
        consent.audit_trail.append({
            "action": "revoked",
            "timestamp": datetime.now().isoformat(),
            "reason": reason or "Patient request"
        })

        return True

    def verify_consent(
        self,
        patient_id: str,
        scope: ConsentScope,
        data_category: Optional[str] = None,
        purpose: Optional[str] = None,
        requesting_party: Optional[str] = None
    ) -> bool:
        """
        Verify if valid consent exists.

        Args:
            patient_id: Patient ID
            scope: Required scope
            data_category: Specific data type
            purpose: Intended purpose
            requesting_party: Who is requesting access

        Returns:
            True if valid consent exists
        """
        now = datetime.now()

        for consent in self.consents.values():
            # Check patient
            if consent.patient_id != patient_id:
                continue

            # Check status
            if consent.status != ConsentStatus.ACTIVE:
                continue

            # Check expiry
            if consent.expiry_date and consent.expiry_date < now:
                consent.status = ConsentStatus.EXPIRED
                continue

            # Check scope
            if consent.scope != scope and consent.scope != ConsentScope.ALL:
                continue

            # Check data category
            if data_category:
                if consent.data_categories and data_category not in consent.data_categories:
                    continue

            # Check purpose
            if purpose:
                if consent.purposes and purpose not in consent.purposes:
                    continue

            # Check requesting party
            if requesting_party:
                if consent.authorized_parties and requesting_party not in consent.authorized_parties:
                    continue

            # Valid consent found
            return True

        return False

    def get_patient_consents(self, patient_id: str) -> List[Consent]:
        """Get all consents for a patient."""
        return [
            c for c in self.consents.values()
            if c.patient_id == patient_id
        ]

    def get_active_consents(self, patient_id: str) -> List[Consent]:
        """Get active consents for a patient."""
        now = datetime.now()
        active = []

        for consent in self.consents.values():
            if consent.patient_id != patient_id:
                continue

            if consent.status != ConsentStatus.ACTIVE:
                continue

            # Check expiry
            if consent.expiry_date and consent.expiry_date < now:
                consent.status = ConsentStatus.EXPIRED
                continue

            active.append(consent)

        return active

    def get_audit_trail(self, consent_id: str) -> List[Dict]:
        """Get audit trail for a consent."""
        if consent_id in self.consents:
            return self.consents[consent_id].audit_trail
        return []

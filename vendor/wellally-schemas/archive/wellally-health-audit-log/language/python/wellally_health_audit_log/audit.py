"""
Tamper-resistant health audit logging.
"""

from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from datetime import datetime
import hashlib
import json


@dataclass
class AuditLogEntry:
    """
    Single audit log entry.

    Attributes:
        timestamp: When action occurred
        actor: Who performed action
        action: What was done
        resource_type: Type of resource accessed
        resource_id: Resource identifier
        details: Additional information
        previous_hash: Hash of previous entry (for integrity)
        entry_hash: Hash of this entry
    """
    timestamp: datetime
    actor: str
    action: str
    resource_type: str
    resource_id: str
    details: Dict[str, Any]
    previous_hash: str
    entry_hash: str = ""

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "timestamp": self.timestamp.isoformat(),
            "actor": self.actor,
            "action": self.action,
            "resource_type": self.resource_type,
            "resource_id": self.resource_id,
            "details": self.details,
            "previous_hash": self.previous_hash,
            "entry_hash": self.entry_hash
        }


class HealthAuditLog:
    """
    Tamper-resistant audit logging system.

    Uses blockchain-style hash chaining to ensure integrity.
    Each entry contains hash of previous entry, making tampering detectable.

    Example:
        >>> audit = HealthAuditLog()
        >>> audit.log_access("dr_smith", "view", "LabReport", "LAB-12345")
        >>> audit.log_modification("dr_smith", "update", "Medication", "MED-789")
    """

    def __init__(self):
        """Initialize audit log."""
        self.entries: List[AuditLogEntry] = []
        self._last_hash = "0" * 64  # Genesis hash

    def log_access(
        self,
        actor: str,
        action: str,
        resource_type: str,
        resource_id: str,
        details: Optional[Dict[str, Any]] = None
    ) -> AuditLogEntry:
        """
        Log data access.

        Args:
            actor: Who accessed (user ID, system name)
            action: Action performed (view, download, export)
            resource_type: Type of resource
            resource_id: Resource identifier
            details: Additional details

        Returns:
            Created audit entry
        """
        return self._create_entry(
            actor=actor,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            details=details or {}
        )

    def log_modification(
        self,
        actor: str,
        action: str,
        resource_type: str,
        resource_id: str,
        changes: Optional[Dict[str, Any]] = None
    ) -> AuditLogEntry:
        """
        Log data modification.

        Args:
            actor: Who modified
            action: Action (create, update, delete)
            resource_type: Type of resource
            resource_id: Resource identifier
            changes: What changed

        Returns:
            Created audit entry
        """
        details = changes or {}
        details["modification_type"] = action

        return self._create_entry(
            actor=actor,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            details=details
        )

    def log_consent_change(
        self,
        actor: str,
        consent_id: str,
        action: str,
        reason: Optional[str] = None
    ) -> AuditLogEntry:
        """Log consent changes."""
        details = {"reason": reason} if reason else {}

        return self._create_entry(
            actor=actor,
            action=action,
            resource_type="Consent",
            resource_id=consent_id,
            details=details
        )

    def _create_entry(
        self,
        actor: str,
        action: str,
        resource_type: str,
        resource_id: str,
        details: Dict[str, Any]
    ) -> AuditLogEntry:
        """Create and add audit entry."""
        timestamp = datetime.now()

        entry = AuditLogEntry(
            timestamp=timestamp,
            actor=actor,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            details=details,
            previous_hash=self._last_hash
        )

        # Calculate hash for this entry
        entry.entry_hash = self._calculate_hash(entry)

        # Add to log
        self.entries.append(entry)
        self._last_hash = entry.entry_hash

        return entry

    def _calculate_hash(self, entry: AuditLogEntry) -> str:
        """Calculate SHA-256 hash of entry."""
        # Create deterministic string representation
        data = {
            "timestamp": entry.timestamp.isoformat(),
            "actor": entry.actor,
            "action": entry.action,
            "resource_type": entry.resource_type,
            "resource_id": entry.resource_id,
            "details": entry.details,
            "previous_hash": entry.previous_hash
        }

        data_str = json.dumps(data, sort_keys=True)

        return hashlib.sha256(data_str.encode()).hexdigest()

    def verify_integrity(self) -> Dict[str, Any]:
        """
        Verify audit log integrity.

        Checks that hash chain is intact.

        Returns:
            Verification result
        """
        if not self.entries:
            return {"valid": True, "message": "Empty log"}

        expected_hash = "0" * 64  # Genesis

        for i, entry in enumerate(self.entries):
            # Check previous hash matches
            if entry.previous_hash != expected_hash:
                return {
                    "valid": False,
                    "message": f"Hash chain broken at entry {i}",
                    "entry": entry.to_dict()
                }

            # Recalculate hash
            calculated_hash = self._calculate_hash(entry)
            if calculated_hash != entry.entry_hash:
                return {
                    "valid": False,
                    "message": f"Entry {i} has been tampered with",
                    "entry": entry.to_dict()
                }

            expected_hash = entry.entry_hash

        return {
            "valid": True,
            "message": f"All {len(self.entries)} entries verified",
            "entries_count": len(self.entries)
        }

    def query_trail(
        self,
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        actor: Optional[str] = None,
        action: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> List[AuditLogEntry]:
        """
        Query audit trail.

        Args:
            resource_type: Filter by resource type
            resource_id: Filter by resource ID
            actor: Filter by actor
            action: Filter by action
            start_date: Start date
            end_date: End date

        Returns:
            Matching entries
        """
        results = []

        for entry in self.entries:
            # Apply filters
            if resource_type and entry.resource_type != resource_type:
                continue
            if resource_id and entry.resource_id != resource_id:
                continue
            if actor and entry.actor != actor:
                continue
            if action and entry.action != action:
                continue
            if start_date and entry.timestamp < start_date:
                continue
            if end_date and entry.timestamp > end_date:
                continue

            results.append(entry)

        return results

    def get_resource_history(self, resource_type: str, resource_id: str) -> List[AuditLogEntry]:
        """Get complete history for a resource."""
        return self.query_trail(resource_type=resource_type, resource_id=resource_id)

    def get_actor_activity(self, actor: str) -> List[AuditLogEntry]:
        """Get all activity by an actor."""
        return self.query_trail(actor=actor)

    def export_log(self) -> List[Dict[str, Any]]:
        """Export audit log."""
        return [entry.to_dict() for entry in self.entries]

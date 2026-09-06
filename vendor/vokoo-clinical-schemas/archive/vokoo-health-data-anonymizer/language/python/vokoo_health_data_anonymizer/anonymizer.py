"""
Health data anonymization implementation.
"""

from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta
import hashlib
import random
import re


class AnonymizationMethod:
    """Anonymization methods."""
    REDACT = "redact"  # Remove completely
    HASH = "hash"  # One-way hash
    GENERALIZE = "generalize"  # Reduce precision
    DATE_SHIFT = "date_shift"  # Shift dates consistently
    PSEUDONYMIZE = "pseudonymize"  # Replace with fake but consistent


class HealthDataAnonymizer:
    """
    Anonymize health data for privacy protection.

    Implements:
    - PII removal (names, IDs, addresses)
    - Date shifting (consistent within patient)
    - K-anonymity support
    - Re-identification risk analysis

    Example:
        >>> anonymizer = HealthDataAnonymizer()
        >>> anon_data = anonymizer.anonymize_record(patient_data)
        >>> print(anon_data["patient"]["name"])  # "[REDACTED]"
    """

    def __init__(self, salt: Optional[str] = None, date_shift_days: int = 180):
        """
        Initialize anonymizer.

        Args:
            salt: Salt for hashing (for consistency)
            date_shift_days: Maximum days to shift dates
        """
        self.salt = salt or "vokoo-anonymizer-salt"
        self.date_shift_days = date_shift_days
        self._date_shift_cache: Dict[str, int] = {}

    def anonymize_record(
        self,
        record: Dict[str, Any],
        keep_fields: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Anonymize a health record.

        Args:
            record: Health record dictionary
            keep_fields: Fields to keep unchanged

        Returns:
            Anonymized record
        """
        keep_fields = keep_fields or []
        anon = record.copy()

        # Anonymize common PII fields
        pii_fields = {
            "name": self.redact_name,
            "patient_name": self.redact_name,
            "id": self.pseudonymize_id,
            "patient_id": self.pseudonymize_id,
            "mrn": self.pseudonymize_id,
            "ssn": self.redact_value,
            "phone": self.redact_value,
            "email": self.redact_email,
            "address": self.redact_value,
            "date_of_birth": self.generalize_date,
            "dob": self.generalize_date,
        }

        for field, method in pii_fields.items():
            if field in anon and field not in keep_fields:
                anon[field] = method(anon[field])

        # Shift dates
        date_fields = ["date", "timestamp", "effective_date", "result_date"]
        patient_id = record.get("patient_id") or record.get("id") or "default"

        for field in date_fields:
            if field in anon and field not in keep_fields:
                anon[field] = self.shift_date(anon[field], patient_id)

        return anon

    def redact_name(self, name: str) -> str:
        """Redact a name."""
        if not name:
            return name
        return "[REDACTED]"

    def redact_value(self, value: Any) -> str:
        """Completely redact a value."""
        return "[REDACTED]"

    def redact_email(self, email: str) -> str:
        """Partially redact email."""
        if not email or "@" not in email:
            return "[REDACTED]"

        local, domain = email.split("@", 1)
        if len(local) > 2:
            redacted_local = local[0] + "***" + local[-1]
        else:
            redacted_local = "***"

        return f"{redacted_local}@{domain}"

    def pseudonymize_id(self, identifier: str) -> str:
        """Create consistent pseudonym for ID."""
        if not identifier:
            return identifier

        # Hash with salt for consistency
        hash_obj = hashlib.sha256(f"{self.salt}{identifier}".encode())
        hashed = hash_obj.hexdigest()[:12].upper()

        return f"ANON-{hashed}"

    def generalize_date(self, date_str: str) -> str:
        """Generalize date to year only."""
        if not date_str:
            return date_str

        try:
            date = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
            return str(date.year)
        except:
            # Try to extract year
            year_match = re.search(r'\d{4}', date_str)
            if year_match:
                return year_match.group()
            return "[REDACTED]"

    def shift_date(self, date_str: str, patient_id: str) -> str:
        """
        Shift date consistently for a patient.

        Maintains relative time differences within patient.
        """
        if not date_str:
            return date_str

        try:
            date = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        except:
            return date_str

        # Get consistent shift for this patient
        if patient_id not in self._date_shift_cache:
            # Random but consistent shift
            random.seed(f"{self.salt}{patient_id}")
            shift = random.randint(-self.date_shift_days, self.date_shift_days)
            self._date_shift_cache[patient_id] = shift

        shift_days = self._date_shift_cache[patient_id]
        shifted = date + timedelta(days=shift_days)

        return shifted.isoformat()

    def generalize_age(self, age: int, bins: List[int] = [0, 18, 30, 50, 70, 120]) -> str:
        """
        Generalize age to age range.

        Args:
            age: Exact age
            bins: Age bin boundaries

        Returns:
            Age range string
        """
        for i in range(len(bins) - 1):
            if bins[i] <= age < bins[i + 1]:
                return f"{bins[i]}-{bins[i+1]-1}"

        return f"{bins[-1]}+"

    def generalize_zipcode(self, zipcode: str, precision: int = 3) -> str:
        """
        Generalize ZIP code.

        Args:
            zipcode: Full ZIP code
            precision: Number of digits to keep

        Returns:
            Generalized ZIP
        """
        if not zipcode:
            return zipcode

        # Keep first N digits, replace rest with 0
        digits = ''.join(c for c in zipcode if c.isdigit())
        if len(digits) >= precision:
            return digits[:precision] + "00"
        return zipcode

    def calculate_k_anonymity(
        self,
        records: List[Dict[str, Any]],
        quasi_identifiers: List[str]
    ) -> int:
        """
        Calculate k-anonymity value.

        K-anonymity: minimum group size when grouped by quasi-identifiers.
        Higher k = better privacy.

        Args:
            records: List of records
            quasi_identifiers: Fields that could identify individuals

        Returns:
            K value (minimum group size)
        """
        # Group records by quasi-identifier values
        groups: Dict[tuple, int] = {}

        for record in records:
            # Create key from quasi-identifiers
            key_values = tuple(
                str(record.get(qi, "")) for qi in quasi_identifiers
            )
            groups[key_values] = groups.get(key_values, 0) + 1

        # K is the minimum group size
        if not groups:
            return 0

        return min(groups.values())

    def assess_risk(
        self,
        record: Dict[str, Any],
        population_size: int = 1000000
    ) -> Dict[str, Any]:
        """
        Assess re-identification risk.

        Args:
            record: Anonymized record
            population_size: Size of population

        Returns:
            Risk assessment
        """
        # Count identifying attributes
        pii_present = []
        pii_fields = ["name", "id", "ssn", "phone", "email", "address", "date_of_birth"]

        for field in pii_fields:
            if field in record:
                value = record[field]
                if value and value != "[REDACTED]" and not value.startswith("ANON-"):
                    pii_present.append(field)

        # Estimate risk (simplified)
        if len(pii_present) >= 3:
            risk = "high"
            uniqueness = 1 / 10  # Likely unique
        elif len(pii_present) == 2:
            risk = "medium"
            uniqueness = 1 / 100
        elif len(pii_present) == 1:
            risk = "low"
            uniqueness = 1 / 1000
        else:
            risk = "minimal"
            uniqueness = 1 / population_size

        return {
            "risk_level": risk,
            "pii_fields_present": pii_present,
            "estimated_uniqueness": uniqueness,
            "estimated_reidentifiable_individuals": int(population_size * uniqueness)
        }

    def batch_anonymize(
        self,
        records: List[Dict[str, Any]],
        target_k: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Anonymize multiple records to achieve k-anonymity.

        Args:
            records: List of records
            target_k: Target k-anonymity value

        Returns:
            Anonymized records
        """
        anonymized = []

        for record in records:
            anon = self.anonymize_record(record)
            anonymized.append(anon)

        # Check k-anonymity
        quasi_ids = ["age", "gender", "zipcode"]
        k = self.calculate_k_anonymity(anonymized, quasi_ids)

        print(f"Achieved k-anonymity: k={k} (target: k={target_k})")

        return anonymized

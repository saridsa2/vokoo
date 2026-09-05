"""
Health data anomaly detection implementation.
"""

from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime, timedelta
from statistics import mean, stdev
from collections import defaultdict

from wellally.common import Quantity


@dataclass
class Anomaly:
    """
    Detected anomaly in health data.

    Attributes:
        data_type: Type of data (e.g., "glucose", "blood_pressure")
        value: The anomalous value
        expected_range: Expected range
        severity: Low, medium, or high
        reason: Why it's flagged as anomalous
        timestamp: When the value was recorded
        metadata: Additional context
    """
    data_type: str
    value: Any
    expected_range: Optional[Tuple[float, float]]
    severity: str  # low, medium, high
    reason: str
    timestamp: Optional[datetime] = None
    metadata: Dict[str, Any] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "data_type": self.data_type,
            "value": self.value,
            "expected_range": self.expected_range,
            "severity": self.severity,
            "reason": self.reason,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "metadata": self.metadata or {}
        }


class AnomalyFlagger:
    """
    Detect anomalies in health data.

    Implements multiple detection strategies:
    - Statistical outliers (Z-score, IQR)
    - Clinical range violations
    - Sudden changes/spikes
    - Missing data patterns
    - Duplicate detection

    Example:
        >>> flagger = AnomalyFlagger()
        >>> anomalies = flagger.check_value("glucose", 400, reference_range=(70, 100))
        >>> for anomaly in anomalies:
        ...     print(f"{anomaly.severity}: {anomaly.reason}")
    """

    def __init__(
        self,
        z_threshold: float = 3.0,
        iqr_multiplier: float = 1.5
    ):
        """
        Initialize anomaly flagger.

        Args:
            z_threshold: Z-score threshold for outlier detection
            iqr_multiplier: IQR multiplier for outlier detection
        """
        self.z_threshold = z_threshold
        self.iqr_multiplier = iqr_multiplier

        # Clinical reference ranges
        self.reference_ranges = self._get_default_ranges()

    def _get_default_ranges(self) -> Dict[str, Tuple[float, float]]:
        """Get default clinical reference ranges."""
        return {
            # Laboratory values (US units)
            "glucose": (70, 100),  # mg/dL fasting
            "glucose_random": (70, 140),  # mg/dL random
            "hba1c": (4.0, 5.7),  # %
            "total_cholesterol": (0, 200),  # mg/dL
            "ldl": (0, 100),  # mg/dL
            "hdl": (40, 200),  # mg/dL
            "triglycerides": (0, 150),  # mg/dL
            "creatinine": (0.7, 1.3),  # mg/dL
            "sodium": (136, 145),  # mEq/L
            "potassium": (3.5, 5.0),  # mEq/L

            # Vital signs
            "heart_rate": (60, 100),  # bpm
            "systolic_bp": (90, 120),  # mmHg
            "diastolic_bp": (60, 80),  # mmHg
            "temperature": (36.1, 37.2),  # °C
            "respiratory_rate": (12, 20),  # breaths/min
            "oxygen_saturation": (95, 100),  # %

            # Body measurements
            "bmi": (18.5, 24.9),  # kg/m²
        }

    def check_value(
        self,
        data_type: str,
        value: float,
        reference_range: Optional[Tuple[float, float]] = None,
        timestamp: Optional[datetime] = None
    ) -> List[Anomaly]:
        """
        Check a single value for anomalies.

        Args:
            data_type: Type of measurement
            value: Measured value
            reference_range: Optional custom reference range
            timestamp: When value was recorded

        Returns:
            List of detected anomalies
        """
        anomalies = []

        # Use provided range or default
        if reference_range is None:
            reference_range = self.reference_ranges.get(data_type)

        if reference_range is None:
            return anomalies  # Can't check without range

        min_val, max_val = reference_range

        # Check if outside range
        if value < min_val:
            severity = self._calculate_severity(value, min_val, max_val, below=True)
            anomalies.append(Anomaly(
                data_type=data_type,
                value=value,
                expected_range=reference_range,
                severity=severity,
                reason=f"Below normal range (minimum: {min_val})",
                timestamp=timestamp
            ))

        elif value > max_val:
            severity = self._calculate_severity(value, min_val, max_val, below=False)
            anomalies.append(Anomaly(
                data_type=data_type,
                value=value,
                expected_range=reference_range,
                severity=severity,
                reason=f"Above normal range (maximum: {max_val})",
                timestamp=timestamp
            ))

        return anomalies

    def _calculate_severity(
        self,
        value: float,
        min_val: float,
        max_val: float,
        below: bool
    ) -> str:
        """Calculate severity of out-of-range value."""
        if below:
            # How far below minimum
            deviation = (min_val - value) / (max_val - min_val)
        else:
            # How far above maximum
            deviation = (value - max_val) / (max_val - min_val)

        if deviation > 1.0:  # More than 100% outside range
            return "high"
        elif deviation > 0.5:  # More than 50% outside range
            return "medium"
        else:
            return "low"

    def check_series(
        self,
        data_type: str,
        values: List[float],
        timestamps: Optional[List[datetime]] = None
    ) -> List[Anomaly]:
        """
        Check a time series for anomalies.

        Uses statistical methods to detect outliers.

        Args:
            data_type: Type of measurement
            values: List of values
            timestamps: Optional timestamps for each value

        Returns:
            List of anomalies
        """
        anomalies = []

        if len(values) < 3:
            return anomalies  # Need at least 3 values for stats

        # Z-score method
        anomalies.extend(self._check_zscore(data_type, values, timestamps))

        # IQR method
        anomalies.extend(self._check_iqr(data_type, values, timestamps))

        # Sudden change detection
        anomalies.extend(self._check_sudden_changes(data_type, values, timestamps))

        return anomalies

    def _check_zscore(
        self,
        data_type: str,
        values: List[float],
        timestamps: Optional[List[datetime]]
    ) -> List[Anomaly]:
        """Detect outliers using Z-score."""
        if len(values) < 3:
            return []

        anomalies = []
        avg = mean(values)
        sd = stdev(values)

        if sd == 0:
            return []  # No variation

        for i, value in enumerate(values):
            z_score = abs((value - avg) / sd)

            if z_score > self.z_threshold:
                timestamp = timestamps[i] if timestamps else None
                anomalies.append(Anomaly(
                    data_type=data_type,
                    value=value,
                    expected_range=(avg - 2*sd, avg + 2*sd),
                    severity="medium" if z_score < 4 else "high",
                    reason=f"Statistical outlier (Z-score: {z_score:.2f})",
                    timestamp=timestamp,
                    metadata={"z_score": z_score, "mean": avg, "std_dev": sd}
                ))

        return anomalies

    def _check_iqr(
        self,
        data_type: str,
        values: List[float],
        timestamps: Optional[List[datetime]]
    ) -> List[Anomaly]:
        """Detect outliers using IQR method."""
        if len(values) < 4:
            return []

        sorted_values = sorted(values)
        n = len(sorted_values)

        q1_idx = n // 4
        q3_idx = 3 * n // 4

        q1 = sorted_values[q1_idx]
        q3 = sorted_values[q3_idx]
        iqr = q3 - q1

        if iqr == 0:
            return []

        lower_bound = q1 - self.iqr_multiplier * iqr
        upper_bound = q3 + self.iqr_multiplier * iqr

        anomalies = []

        for i, value in enumerate(values):
            if value < lower_bound or value > upper_bound:
                timestamp = timestamps[i] if timestamps else None
                anomalies.append(Anomaly(
                    data_type=data_type,
                    value=value,
                    expected_range=(lower_bound, upper_bound),
                    severity="low",
                    reason=f"IQR outlier (Q1={q1:.1f}, Q3={q3:.1f}, IQR={iqr:.1f})",
                    timestamp=timestamp,
                    metadata={"q1": q1, "q3": q3, "iqr": iqr}
                ))

        return anomalies

    def _check_sudden_changes(
        self,
        data_type: str,
        values: List[float],
        timestamps: Optional[List[datetime]]
    ) -> List[Anomaly]:
        """Detect sudden spikes or drops."""
        if len(values) < 2:
            return []

        anomalies = []

        # Calculate typical change
        changes = [abs(values[i+1] - values[i]) for i in range(len(values)-1)]
        if not changes:
            return []

        avg_change = mean(changes)
        sd_change = stdev(changes) if len(changes) > 1 else 0

        # Detect large changes
        for i in range(len(values) - 1):
            change = abs(values[i+1] - values[i])

            # More than 3x typical change
            if sd_change > 0 and change > avg_change + 3 * sd_change:
                timestamp = timestamps[i+1] if timestamps else None
                anomalies.append(Anomaly(
                    data_type=data_type,
                    value=values[i+1],
                    expected_range=None,
                    severity="medium",
                    reason=f"Sudden change: {values[i]:.1f} → {values[i+1]:.1f}",
                    timestamp=timestamp,
                    metadata={
                        "previous_value": values[i],
                        "change": change,
                        "typical_change": avg_change
                    }
                ))

        return anomalies

    def check_missing_data(
        self,
        expected_frequency: timedelta,
        timestamps: List[datetime],
        data_type: str = "measurement"
    ) -> List[Anomaly]:
        """
        Detect missing data points.

        Args:
            expected_frequency: Expected time between measurements
            timestamps: List of actual timestamps
            data_type: Type of data

        Returns:
            Anomalies for missing data gaps
        """
        if len(timestamps) < 2:
            return []

        anomalies = []
        sorted_times = sorted(timestamps)

        for i in range(len(sorted_times) - 1):
            gap = sorted_times[i+1] - sorted_times[i]

            # Gap is more than 2x expected frequency
            if gap > expected_frequency * 2:
                anomalies.append(Anomaly(
                    data_type=data_type,
                    value=None,
                    expected_range=None,
                    severity="low",
                    reason=f"Missing data gap: {gap.total_seconds() / 3600:.1f} hours",
                    timestamp=sorted_times[i],
                    metadata={
                        "gap_start": sorted_times[i].isoformat(),
                        "gap_end": sorted_times[i+1].isoformat(),
                        "gap_duration": str(gap)
                    }
                ))

        return anomalies

    def check_duplicates(
        self,
        values: List[float],
        timestamps: List[datetime],
        data_type: str = "measurement"
    ) -> List[Anomaly]:
        """
        Detect duplicate measurements at same time.

        Args:
            values: Measured values
            timestamps: Timestamps
            data_type: Type of data

        Returns:
            Anomalies for duplicates
        """
        if len(values) != len(timestamps):
            return []

        # Group by timestamp
        time_groups = defaultdict(list)
        for value, timestamp in zip(values, timestamps):
            time_groups[timestamp].append(value)

        anomalies = []

        for timestamp, vals in time_groups.items():
            if len(vals) > 1:
                anomalies.append(Anomaly(
                    data_type=data_type,
                    value=vals,
                    expected_range=None,
                    severity="low",
                    reason=f"Duplicate measurements at same time: {vals}",
                    timestamp=timestamp,
                    metadata={"duplicate_count": len(vals), "values": vals}
                ))

        return anomalies

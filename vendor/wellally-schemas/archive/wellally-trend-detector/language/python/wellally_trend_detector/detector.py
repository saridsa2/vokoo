"""
Health data trend detection implementation.
"""

from typing import List, Dict, Any, Optional, Tuple, Literal
from dataclasses import dataclass
from datetime import datetime
from statistics import mean
from enum import Enum


class TrendDirection(Enum):
    """Trend direction."""
    INCREASING = "increasing"
    DECREASING = "decreasing"
    STABLE = "stable"
    FLUCTUATING = "fluctuating"


@dataclass
class Trend:
    """
    Detected trend in time series data.

    Attributes:
        data_type: Type of data
        direction: Trend direction
        confidence: Confidence score (0-1)
        slope: Rate of change
        start_date: Trend start
        end_date: Trend end
        details: Additional information
    """
    data_type: str
    direction: TrendDirection
    confidence: float
    slope: float
    start_date: datetime
    end_date: datetime
    details: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "data_type": self.data_type,
            "direction": self.direction.value,
            "confidence": self.confidence,
            "slope": self.slope,
            "start_date": self.start_date.isoformat(),
            "end_date": self.end_date.isoformat(),
            "details": self.details
        }


class TrendDetector:
    """
    Detect trends in health time series data.

    Implements:
    - Linear trend analysis
    - Moving averages
    - Change point detection
    - Seasonality detection
    - Rate of change calculation

    Example:
        >>> detector = TrendDetector()
        >>> trend = detector.detect_trend("glucose", values, timestamps)
        >>> print(f"{trend.direction.value}: slope={trend.slope:.2f}")
    """

    def __init__(
        self,
        min_data_points: int = 3,
        smoothing_window: int = 3
    ):
        """
        Initialize trend detector.

        Args:
            min_data_points: Minimum points needed for trend detection
            smoothing_window: Window size for moving average smoothing
        """
        self.min_data_points = min_data_points
        self.smoothing_window = smoothing_window

    def detect_trend(
        self,
        data_type: str,
        values: List[float],
        timestamps: List[datetime]
    ) -> Optional[Trend]:
        """
        Detect overall trend in time series.

        Args:
            data_type: Type of measurement
            values: Measured values
            timestamps: Timestamps for each value

        Returns:
            Detected trend or None
        """
        if len(values) < self.min_data_points or len(values) != len(timestamps):
            return None

        # Calculate linear regression
        slope, intercept, r_squared = self._linear_regression(values, timestamps)

        # Determine direction
        threshold = 0.01  # Slope threshold for "stable"

        if abs(slope) < threshold:
            direction = TrendDirection.STABLE
        elif slope > 0:
            direction = TrendDirection.INCREASING
        else:
            direction = TrendDirection.DECREASING

        # Check for fluctuation
        if self._is_fluctuating(values):
            direction = TrendDirection.FLUCTUATING

        # Confidence based on R²
        confidence = r_squared

        return Trend(
            data_type=data_type,
            direction=direction,
            confidence=confidence,
            slope=slope,
            start_date=min(timestamps),
            end_date=max(timestamps),
            details=f"R²={r_squared:.3f}, intercept={intercept:.2f}"
        )

    def _linear_regression(
        self,
        values: List[float],
        timestamps: List[datetime]
    ) -> Tuple[float, float, float]:
        """
        Calculate linear regression.

        Returns:
            (slope, intercept, r_squared)
        """
        n = len(values)

        # Convert timestamps to numeric (days since first)
        base_time = timestamps[0]
        x = [(t - base_time).total_seconds() / 86400 for t in timestamps]
        y = values

        # Calculate means
        x_mean = mean(x)
        y_mean = mean(y)

        # Calculate slope and intercept
        numerator = sum((x[i] - x_mean) * (y[i] - y_mean) for i in range(n))
        denominator = sum((x[i] - x_mean) ** 2 for i in range(n))

        if denominator == 0:
            return 0.0, y_mean, 0.0

        slope = numerator / denominator
        intercept = y_mean - slope * x_mean

        # Calculate R²
        y_pred = [slope * x[i] + intercept for i in range(n)]
        ss_res = sum((y[i] - y_pred[i]) ** 2 for i in range(n))
        ss_tot = sum((y[i] - y_mean) ** 2 for i in range(n))

        r_squared = 1 - (ss_res / ss_tot) if ss_tot != 0 else 0.0

        return slope, intercept, r_squared

    def _is_fluctuating(self, values: List[float]) -> bool:
        """Check if data is fluctuating (many direction changes)."""
        if len(values) < 3:
            return False

        # Count direction changes
        changes = 0
        for i in range(1, len(values) - 1):
            # Check if direction changes
            diff1 = values[i] - values[i-1]
            diff2 = values[i+1] - values[i]

            if diff1 * diff2 < 0:  # Opposite signs
                changes += 1

        # Fluctuating if more than 40% of points change direction
        return changes / (len(values) - 2) > 0.4

    def calculate_moving_average(
        self,
        values: List[float],
        window: Optional[int] = None
    ) -> List[float]:
        """
        Calculate moving average.

        Args:
            values: Input values
            window: Window size (default: self.smoothing_window)

        Returns:
            Smoothed values
        """
        if window is None:
            window = self.smoothing_window

        if len(values) < window:
            return values.copy()

        smoothed = []
        for i in range(len(values)):
            start = max(0, i - window // 2)
            end = min(len(values), i + window // 2 + 1)
            smoothed.append(mean(values[start:end]))

        return smoothed

    def calculate_rate_of_change(
        self,
        values: List[float],
        timestamps: List[datetime],
        unit: Literal["day", "week", "month"] = "day"
    ) -> List[float]:
        """
        Calculate rate of change between consecutive points.

        Args:
            values: Measured values
            timestamps: Timestamps
            unit: Time unit for rate calculation

        Returns:
            Rate of change for each interval
        """
        if len(values) != len(timestamps) or len(values) < 2:
            return []

        # Time divisor
        divisors = {"day": 1, "week": 7, "month": 30}
        divisor = divisors[unit]

        rates = []
        for i in range(1, len(values)):
            time_diff = (timestamps[i] - timestamps[i-1]).total_seconds() / 86400 / divisor
            if time_diff > 0:
                value_diff = values[i] - values[i-1]
                rate = value_diff / time_diff
                rates.append(rate)
            else:
                rates.append(0.0)

        return rates

    def detect_change_points(
        self,
        values: List[float],
        timestamps: List[datetime],
        threshold: float = 2.0
    ) -> List[Tuple[int, datetime]]:
        """
        Detect significant change points in the series.

        Args:
            values: Measured values
            timestamps: Timestamps
            threshold: Z-score threshold for change detection

        Returns:
            List of (index, timestamp) for change points
        """
        if len(values) < 4:
            return []

        # Calculate differences
        diffs = [values[i+1] - values[i] for i in range(len(values) - 1)]

        # Calculate statistics
        mean_diff = mean(diffs)

        # Standard deviation
        variance = sum((d - mean_diff) ** 2 for d in diffs) / len(diffs)
        std_diff = variance ** 0.5

        if std_diff == 0:
            return []

        # Find points where change exceeds threshold
        change_points = []
        for i, diff in enumerate(diffs):
            z_score = abs((diff - mean_diff) / std_diff)
            if z_score > threshold:
                change_points.append((i + 1, timestamps[i + 1]))

        return change_points

    def analyze_periodicity(
        self,
        values: List[float],
        timestamps: List[datetime]
    ) -> Dict[str, Any]:
        """
        Analyze periodicity/seasonality in data.

        Args:
            values: Measured values
            timestamps: Timestamps

        Returns:
            Periodicity analysis results
        """
        if len(values) < 7:
            return {"periodic": False, "reason": "Insufficient data"}

        # Simple autocorrelation at lag 7 (weekly pattern)
        n = len(values)
        mean_val = mean(values)

        # Calculate autocorrelation at lag 7
        if n >= 14:
            numerator = sum((values[i] - mean_val) * (values[i+7] - mean_val)
                          for i in range(n - 7))
            denominator = sum((v - mean_val) ** 2 for v in values)

            if denominator > 0:
                correlation = numerator / denominator

                # Strong correlation suggests weekly pattern
                is_periodic = abs(correlation) > 0.5

                return {
                    "periodic": is_periodic,
                    "pattern": "weekly" if is_periodic else None,
                    "correlation": correlation,
                    "confidence": abs(correlation)
                }

        return {"periodic": False, "reason": "No clear pattern detected"}

    def get_trend_summary(
        self,
        data_type: str,
        values: List[float],
        timestamps: List[datetime]
    ) -> Dict[str, Any]:
        """
        Get comprehensive trend summary.

        Args:
            data_type: Type of measurement
            values: Measured values
            timestamps: Timestamps

        Returns:
            Complete trend analysis
        """
        if len(values) < self.min_data_points:
            return {"error": "Insufficient data points"}

        # Main trend
        trend = self.detect_trend(data_type, values, timestamps)

        # Moving average
        smoothed = self.calculate_moving_average(values)

        # Rate of change
        rates = self.calculate_rate_of_change(values, timestamps)

        # Change points
        change_points = self.detect_change_points(values, timestamps)

        # Periodicity
        periodicity = self.analyze_periodicity(values, timestamps)

        return {
            "trend": trend.to_dict() if trend else None,
            "moving_average": smoothed,
            "rate_of_change": {
                "mean": mean(rates) if rates else 0,
                "values": rates
            },
            "change_points": [
                {"index": idx, "timestamp": ts.isoformat()}
                for idx, ts in change_points
            ],
            "periodicity": periodicity,
            "statistics": {
                "mean": mean(values),
                "min": min(values),
                "max": max(values),
                "range": max(values) - min(values)
            }
        }

"""
Health data correlation analysis implementation.
"""

from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime
from statistics import mean
from math import sqrt


@dataclass
class CorrelationResult:
    """
    Result of correlation analysis.

    Attributes:
        variable_x: First variable name
        variable_y: Second variable name
        correlation: Correlation coefficient (-1 to 1)
        method: Correlation method used
        p_value: Statistical significance (if available)
        sample_size: Number of data points
        interpretation: Human-readable interpretation
    """
    variable_x: str
    variable_y: str
    correlation: float
    method: str
    p_value: Optional[float] = None
    sample_size: int = 0
    interpretation: str = ""

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "variable_x": self.variable_x,
            "variable_y": self.variable_y,
            "correlation": self.correlation,
            "method": self.method,
            "p_value": self.p_value,
            "sample_size": self.sample_size,
            "interpretation": self.interpretation
        }


class DataCorrelation:
    """
    Analyze correlations between health data variables.

    Implements:
    - Pearson correlation (linear relationships)
    - Spearman correlation (monotonic relationships)
    - Time-lagged correlations
    - Multivariate analysis

    Example:
        >>> analyzer = DataCorrelation()
        >>> result = analyzer.pearson_correlation(glucose, weight)
        >>> print(f"Correlation: {result.correlation:.3f}")
    """

    def __init__(self):
        """Initialize correlation analyzer."""
        pass

    def pearson_correlation(
        self,
        x: List[float],
        y: List[float],
        x_name: str = "variable_x",
        y_name: str = "variable_y"
    ) -> CorrelationResult:
        """
        Calculate Pearson correlation coefficient.

        Measures linear relationship between two variables.

        Args:
            x: First variable values
            y: Second variable values
            x_name: Name of first variable
            y_name: Name of second variable

        Returns:
            Correlation result
        """
        if len(x) != len(y) or len(x) < 2:
            return CorrelationResult(
                variable_x=x_name,
                variable_y=y_name,
                correlation=0.0,
                method="pearson",
                sample_size=min(len(x), len(y)),
                interpretation="Insufficient data"
            )

        n = len(x)

        # Calculate means
        mean_x = mean(x)
        mean_y = mean(y)

        # Calculate correlation
        numerator = sum((x[i] - mean_x) * (y[i] - mean_y) for i in range(n))

        sum_sq_x = sum((x[i] - mean_x) ** 2 for i in range(n))
        sum_sq_y = sum((y[i] - mean_y) ** 2 for i in range(n))

        denominator = sqrt(sum_sq_x * sum_sq_y)

        if denominator == 0:
            r = 0.0
        else:
            r = numerator / denominator

        # Interpret
        interpretation = self._interpret_correlation(r)

        return CorrelationResult(
            variable_x=x_name,
            variable_y=y_name,
            correlation=r,
            method="pearson",
            sample_size=n,
            interpretation=interpretation
        )

    def spearman_correlation(
        self,
        x: List[float],
        y: List[float],
        x_name: str = "variable_x",
        y_name: str = "variable_y"
    ) -> CorrelationResult:
        """
        Calculate Spearman rank correlation.

        Measures monotonic relationship (not necessarily linear).

        Args:
            x: First variable values
            y: Second variable values
            x_name: Name of first variable
            y_name: Name of second variable

        Returns:
            Correlation result
        """
        if len(x) != len(y) or len(x) < 2:
            return CorrelationResult(
                variable_x=x_name,
                variable_y=y_name,
                correlation=0.0,
                method="spearman",
                sample_size=min(len(x), len(y)),
                interpretation="Insufficient data"
            )

        # Rank the values
        x_ranked = self._rank(x)
        y_ranked = self._rank(y)

        # Calculate Pearson on ranks
        result = self.pearson_correlation(x_ranked, y_ranked, x_name, y_name)
        result.method = "spearman"

        return result

    def _rank(self, values: List[float]) -> List[float]:
        """Convert values to ranks."""
        indexed = [(val, idx) for idx, val in enumerate(values)]
        indexed.sort()

        ranks = [0.0] * len(values)
        for rank, (val, idx) in enumerate(indexed, 1):
            ranks[idx] = float(rank)

        return ranks

    def _interpret_correlation(self, r: float) -> str:
        """Interpret correlation strength."""
        abs_r = abs(r)

        if abs_r >= 0.9:
            strength = "very strong"
        elif abs_r >= 0.7:
            strength = "strong"
        elif abs_r >= 0.5:
            strength = "moderate"
        elif abs_r >= 0.3:
            strength = "weak"
        else:
            strength = "very weak or no"

        if r > 0:
            direction = "positive"
        elif r < 0:
            direction = "negative"
        else:
            return "No correlation"

        return f"{strength.capitalize()} {direction} correlation"

    def lagged_correlation(
        self,
        x: List[float],
        y: List[float],
        x_timestamps: List[datetime],
        y_timestamps: List[datetime],
        x_name: str = "variable_x",
        y_name: str = "variable_y",
        max_lag_days: int = 7
    ) -> List[CorrelationResult]:
        """
        Calculate correlation at different time lags.

        Example: Does change in diet (x) affect glucose (y) 1-3 days later?

        Args:
            x: First variable values
            y: Second variable values
            x_timestamps: Timestamps for x
            y_timestamps: Timestamps for y
            x_name: Name of first variable
            y_name: Name of second variable
            max_lag_days: Maximum lag to test (days)

        Returns:
            List of correlation results at different lags
        """
        results = []

        # Try different lags (0 to max_lag_days)
        for lag_days in range(max_lag_days + 1):
            # Align data with lag
            x_aligned, y_aligned = self._align_with_lag(
                x, y, x_timestamps, y_timestamps, lag_days
            )

            if len(x_aligned) < 3:
                continue

            # Calculate correlation
            result = self.pearson_correlation(x_aligned, y_aligned, x_name, y_name)
            result.interpretation += f" (lag: {lag_days} days)"
            results.append(result)

        return results

    def _align_with_lag(
        self,
        x: List[float],
        y: List[float],
        x_timestamps: List[datetime],
        y_timestamps: List[datetime],
        lag_days: int
    ) -> Tuple[List[float], List[float]]:
        """Align two time series with a time lag."""
        from datetime import timedelta

        x_aligned = []
        y_aligned = []

        lag_delta = timedelta(days=lag_days)

        for i, x_time in enumerate(x_timestamps):
            target_time = x_time + lag_delta

            # Find closest y timestamp within 1 day
            for j, y_time in enumerate(y_timestamps):
                if abs((y_time - target_time).total_seconds()) < 86400:  # Within 1 day
                    x_aligned.append(x[i])
                    y_aligned.append(y[j])
                    break

        return x_aligned, y_aligned

    def correlation_matrix(
        self,
        data: Dict[str, List[float]],
        method: str = "pearson"
    ) -> Dict[str, Dict[str, float]]:
        """
        Calculate correlation matrix for multiple variables.

        Args:
            data: Dict mapping variable names to values
            method: "pearson" or "spearman"

        Returns:
            Correlation matrix as nested dict
        """
        variables = list(data.keys())
        matrix = {}

        for var1 in variables:
            matrix[var1] = {}
            for var2 in variables:
                if var1 == var2:
                    matrix[var1][var2] = 1.0
                else:
                    if method == "pearson":
                        result = self.pearson_correlation(
                            data[var1], data[var2], var1, var2
                        )
                    else:
                        result = self.spearman_correlation(
                            data[var1], data[var2], var1, var2
                        )

                    matrix[var1][var2] = result.correlation

        return matrix

    def find_strongest_correlations(
        self,
        data: Dict[str, List[float]],
        threshold: float = 0.5,
        method: str = "pearson"
    ) -> List[CorrelationResult]:
        """
        Find strongest correlations in a dataset.

        Args:
            data: Dict mapping variable names to values
            threshold: Minimum absolute correlation to report
            method: "pearson" or "spearman"

        Returns:
            List of significant correlations
        """
        variables = list(data.keys())
        results = []

        for i, var1 in enumerate(variables):
            for var2 in variables[i+1:]:  # Avoid duplicates
                if method == "pearson":
                    result = self.pearson_correlation(data[var1], data[var2], var1, var2)
                else:
                    result = self.spearman_correlation(data[var1], data[var2], var1, var2)

                if abs(result.correlation) >= threshold:
                    results.append(result)

        # Sort by absolute correlation (strongest first)
        results.sort(key=lambda r: abs(r.correlation), reverse=True)

        return results

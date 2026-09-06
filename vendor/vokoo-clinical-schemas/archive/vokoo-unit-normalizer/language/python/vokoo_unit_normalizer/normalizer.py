"""
Unit normalizer implementation.
"""

from typing import Optional, Dict, Any
from vokoo_clinical_schemas.common import Quantity
from .units import get_conversion_factor, UCUMUnit


class ConversionError(Exception):
    """Raised when unit conversion fails."""
    pass


class UnitNormalizer:
    """
    Normalize clinical units to standard UCUM format.

    Converts between different unit systems commonly used in clinical settings,
    with special handling for lab-specific conversions.

    Example:
        >>> normalizer = UnitNormalizer()
        >>> result = normalizer.convert(100, "mg/dL", "mmol/L", context="glucose")
        >>> print(result)  # 5.55
    """

    def __init__(self):
        """Initialize the unit normalizer."""
        self.conversion_cache: Dict[tuple, float] = {}

    def convert(
        self,
        value: float,
        from_unit: str,
        to_unit: str,
        context: Optional[str] = None
    ) -> float:
        """
        Convert a value from one unit to another.

        Args:
            value: The numeric value to convert
            from_unit: Source unit (UCUM format)
            to_unit: Target unit (UCUM format)
            context: Optional context (e.g., 'glucose', 'cholesterol')

        Returns:
            Converted value

        Raises:
            ConversionError: If conversion is not supported

        Example:
            >>> normalizer.convert(180, "mg/dL", "mmol/L", "glucose")
            9.99
        """
        # Handle temperature conversions specially
        if from_unit in ["Cel", "[degF]"] and to_unit in ["Cel", "[degF]"]:
            return self._convert_temperature(value, from_unit, to_unit)

        # Check cache
        cache_key = (from_unit, to_unit, context)
        if cache_key not in self.conversion_cache:
            try:
                factor = get_conversion_factor(from_unit, to_unit, context)
                self.conversion_cache[cache_key] = factor
            except KeyError as e:
                raise ConversionError(
                    f"No conversion available from {from_unit} to {to_unit}"
                ) from e

        factor = self.conversion_cache[cache_key]
        return value * factor

    def _convert_temperature(self, value: float, from_unit: str, to_unit: str) -> float:
        """
        Convert temperature values.

        Args:
            value: Temperature value
            from_unit: "Cel" or "[degF]"
            to_unit: "Cel" or "[degF]"

        Returns:
            Converted temperature
        """
        if from_unit == to_unit:
            return value

        if from_unit == "[degF]" and to_unit == "Cel":
            # F to C: (F - 32) * 5/9
            return (value - 32) * 5 / 9
        elif from_unit == "Cel" and to_unit == "[degF]":
            # C to F: C * 9/5 + 32
            return value * 9 / 5 + 32
        else:
            raise ConversionError(f"Invalid temperature conversion: {from_unit} to {to_unit}")

    def convert_quantity(
        self,
        quantity: Quantity,
        to_unit: str,
        context: Optional[str] = None
    ) -> Quantity:
        """
        Convert a Quantity object to a different unit.

        Args:
            quantity: VoKoo Quantity object
            to_unit: Target unit
            context: Optional conversion context

        Returns:
            New Quantity with converted value and unit

        Example:
            >>> from vokoo_clinical_schemas.common import Quantity
            >>> q = Quantity(value=100, unit="mg/dL")
            >>> result = normalizer.convert_quantity(q, "mmol/L", "glucose")
            >>> print(f"{result.value} {result.unit}")
            5.55 mmol/L
        """
        converted_value = self.convert(
            quantity.value,
            quantity.unit,
            to_unit,
            context
        )

        return Quantity(value=converted_value, unit=to_unit)

    def normalize_to_standard(
        self,
        value: float,
        from_unit: str,
        standard_unit: str,
        context: Optional[str] = None
    ) -> float:
        """
        Normalize a value to a standard unit.

        This is a convenience method for common standardization tasks.

        Args:
            value: Value to normalize
            from_unit: Current unit
            standard_unit: Standard unit to convert to
            context: Optional conversion context

        Returns:
            Normalized value
        """
        return self.convert(value, from_unit, standard_unit, context)

    def batch_convert(
        self,
        values: list[float],
        from_unit: str,
        to_unit: str,
        context: Optional[str] = None
    ) -> list[float]:
        """
        Convert multiple values at once.

        Args:
            values: List of values to convert
            from_unit: Source unit
            to_unit: Target unit
            context: Optional conversion context

        Returns:
            List of converted values
        """
        # Get conversion factor once
        factor = get_conversion_factor(from_unit, to_unit, context)

        # Handle temperature separately
        if from_unit in ["Cel", "[degF]"] and to_unit in ["Cel", "[degF]"]:
            return [self._convert_temperature(v, from_unit, to_unit) for v in values]

        return [v * factor for v in values]

    def get_supported_units(self, category: Optional[str] = None) -> Dict[str, list[str]]:
        """
        Get list of supported units by category.

        Args:
            category: Optional category filter

        Returns:
            Dictionary of categories and their units
        """
        units_by_category = {
            "mass": ["kg", "g", "mg", "ug", "lb_av"],
            "volume": ["L", "mL", "dL"],
            "length": ["m", "cm", "[in_i]", "[ft_i]"],
            "temperature": ["Cel", "[degF]"],
            "pressure": ["mm[Hg]", "kPa"],
            "time": ["s", "min", "h", "d"],
            "energy": ["kcal", "kJ"],
            "concentration": ["mg/dL", "mmol/L", "g/L", "g/dL"],
        }

        if category:
            return {category: units_by_category.get(category, [])}

        return units_by_category

    def validate_unit(self, unit: str) -> bool:
        """
        Check if a unit is recognized.

        Args:
            unit: Unit string to validate

        Returns:
            True if unit is valid
        """
        all_units = []
        for units in self.get_supported_units().values():
            all_units.extend(units)

        return unit in all_units

    def suggest_standard_unit(self, unit: str, context: Optional[str] = None) -> Optional[str]:
        """
        Suggest a standard unit for a given unit.

        Args:
            unit: Current unit
            context: Optional context

        Returns:
            Suggested standard unit or None
        """
        # Standard units by type
        standards = {
            # Mass
            "kg": "kg", "g": "kg", "mg": "g", "ug": "mg", "lb_av": "kg",
            # Volume
            "L": "L", "mL": "L", "dL": "L",
            # Length
            "m": "m", "cm": "m", "[in_i]": "m", "[ft_i]": "m",
            # Temperature
            "Cel": "Cel", "[degF]": "Cel",
            # Pressure
            "mm[Hg]": "mm[Hg]", "kPa": "mm[Hg]",
            # Context-specific
        }

        # Context-specific standards
        if context == "glucose":
            if unit in ["mg/dL", "mmol/L"]:
                return "mmol/L"  # International standard
        elif context == "cholesterol":
            if unit in ["mg/dL", "mmol/L"]:
                return "mmol/L"

        return standards.get(unit)

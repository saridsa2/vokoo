"""
Unit definitions and categories.
"""

from enum import Enum
from typing import Dict, List


class UnitCategory(str, Enum):
    """Categories of clinical units."""
    MASS = "mass"
    VOLUME = "volume"
    CONCENTRATION = "concentration"
    LENGTH = "length"
    TEMPERATURE = "temperature"
    PRESSURE = "pressure"
    TIME = "time"
    ENERGY = "energy"


class UCUMUnit:
    """UCUM (Unified Code for Units of Measure) unit definitions."""

    # Mass
    KILOGRAM = "kg"
    GRAM = "g"
    MILLIGRAM = "mg"
    MICROGRAM = "ug"
    POUND = "lb_av"

    # Volume
    LITER = "L"
    MILLILITER = "mL"
    DECILITER = "dL"

    # Concentration (mass/volume)
    MG_PER_DL = "mg/dL"  # Common in US
    MMOL_PER_L = "mmol/L"  # Common internationally
    G_PER_L = "g/L"
    G_PER_DL = "g/dL"

    # Length
    METER = "m"
    CENTIMETER = "cm"
    INCH = "[in_i]"
    FOOT = "[ft_i]"

    # Temperature
    CELSIUS = "Cel"
    FAHRENHEIT = "[degF]"

    # Pressure
    MMHG = "mm[Hg]"
    KPA = "kPa"

    # Time
    SECOND = "s"
    MINUTE = "min"
    HOUR = "h"
    DAY = "d"

    # Energy
    KCAL = "kcal"
    KJ = "kJ"


# Conversion factors: {(from_unit, to_unit): factor}
# Result = value * factor
CONVERSION_FACTORS: Dict[tuple, float] = {
    # Mass conversions
    ("kg", "g"): 1000,
    ("g", "kg"): 0.001,
    ("g", "mg"): 1000,
    ("mg", "g"): 0.001,
    ("mg", "ug"): 1000,
    ("ug", "mg"): 0.001,
    ("lb_av", "kg"): 0.45359237,
    ("kg", "lb_av"): 2.20462262,

    # Volume conversions
    ("L", "mL"): 1000,
    ("mL", "L"): 0.001,
    ("L", "dL"): 10,
    ("dL", "L"): 0.1,
    ("dL", "mL"): 100,
    ("mL", "dL"): 0.01,

    # Length conversions
    ("m", "cm"): 100,
    ("cm", "m"): 0.01,
    ("[in_i]", "cm"): 2.54,
    ("cm", "[in_i]"): 0.393701,
    ("[ft_i]", "m"): 0.3048,
    ("m", "[ft_i]"): 3.28084,
    ("[ft_i]", "cm"): 30.48,
    ("cm", "[ft_i]"): 0.0328084,

    # Temperature (special handling needed)
    # C = (F - 32) * 5/9
    # F = C * 9/5 + 32

    # Pressure conversions
    ("mm[Hg]", "kPa"): 0.133322,
    ("kPa", "mm[Hg]"): 7.50062,

    # Time conversions
    ("min", "s"): 60,
    ("s", "min"): 1/60,
    ("h", "min"): 60,
    ("min", "h"): 1/60,
    ("d", "h"): 24,
    ("h", "d"): 1/24,

    # Energy conversions
    ("kcal", "kJ"): 4.184,
    ("kJ", "kcal"): 0.239006,
}


# Special conversions for glucose (requires molecular weight)
# Glucose molecular weight: 180.16 g/mol
GLUCOSE_CONVERSIONS = {
    ("mg/dL", "mmol/L"): 0.0555,  # mg/dL * 0.0555 = mmol/L
    ("mmol/L", "mg/dL"): 18.0182,  # mmol/L * 18 = mg/dL
}


# Common lab test conversion contexts
LAB_TEST_CONVERSIONS: Dict[str, Dict[tuple, float]] = {
    "glucose": GLUCOSE_CONVERSIONS,
    "cholesterol": {
        ("mg/dL", "mmol/L"): 0.0259,  # Total cholesterol MW ~386
        ("mmol/L", "mg/dL"): 38.67,
    },
    "triglycerides": {
        ("mg/dL", "mmol/L"): 0.0113,  # Average TG MW ~885
        ("mmol/L", "mg/dL"): 88.57,
    },
    "creatinine": {
        ("mg/dL", "μmol/L"): 88.4,  # Creatinine MW 113
        ("μmol/L", "mg/dL"): 0.0113,
    },
    "urea": {
        ("mg/dL", "mmol/L"): 0.357,  # BUN to urea
        ("mmol/L", "mg/dL"): 2.801,
    },
}


def get_conversion_factor(from_unit: str, to_unit: str, context: str = None) -> float:
    """
    Get conversion factor between units.

    Args:
        from_unit: Source UCUM unit
        to_unit: Target UCUM unit
        context: Optional context (e.g., 'glucose', 'cholesterol')

    Returns:
        Conversion factor (multiply source value by this)

    Raises:
        KeyError: If conversion not supported
    """
    # Same unit
    if from_unit == to_unit:
        return 1.0

    # Check context-specific conversions first
    if context and context in LAB_TEST_CONVERSIONS:
        context_conversions = LAB_TEST_CONVERSIONS[context]
        key = (from_unit, to_unit)
        if key in context_conversions:
            return context_conversions[key]

    # Check general conversions
    key = (from_unit, to_unit)
    if key in CONVERSION_FACTORS:
        return CONVERSION_FACTORS[key]

    # Try reverse conversion
    reverse_key = (to_unit, from_unit)
    if reverse_key in CONVERSION_FACTORS:
        return 1.0 / CONVERSION_FACTORS[reverse_key]

    raise KeyError(f"No conversion from {from_unit} to {to_unit}")

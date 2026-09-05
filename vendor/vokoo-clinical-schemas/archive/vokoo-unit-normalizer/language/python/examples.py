"""
Example usage of VoKoo Unit Normalizer.
"""

from vokoo_unit_normalizer import UnitNormalizer, ConversionError
from vokoo_clinical_schemas.common import Quantity


def example_basic_conversion():
    """Basic unit conversion."""
    print("=== Basic Unit Conversion ===\n")

    normalizer = UnitNormalizer()

    # Weight conversion
    weight_kg = normalizer.convert(150, "lb_av", "kg")
    print(f"150 lb = {weight_kg:.2f} kg")

    # Height conversion
    height_m = normalizer.convert(72, "[in_i]", "m")
    print(f"72 inches = {height_m:.2f} m")

    # Volume conversion
    volume_l = normalizer.convert(500, "mL", "L")
    print(f"500 mL = {volume_l:.2f} L")

    # Temperature conversion
    temp_c = normalizer.convert(98.6, "[degF]", "Cel")
    print(f"98.6°F = {temp_c:.2f}°C")

    print()


def example_lab_conversions():
    """Lab-specific conversions with context."""
    print("=== Lab Test Conversions ===\n")

    normalizer = UnitNormalizer()

    # Glucose conversion
    glucose_mgdl = 100
    glucose_mmol = normalizer.convert(glucose_mgdl, "mg/dL", "mmol/L", context="glucose")
    print(f"Glucose: {glucose_mgdl} mg/dL = {glucose_mmol:.2f} mmol/L")

    # Reverse conversion
    glucose_back = normalizer.convert(glucose_mmol, "mmol/L", "mg/dL", context="glucose")
    print(f"Glucose: {glucose_mmol:.2f} mmol/L = {glucose_back:.1f} mg/dL")

    print()

    # Cholesterol
    chol_mgdl = 200
    chol_mmol = normalizer.convert(chol_mgdl, "mg/dL", "mmol/L", context="cholesterol")
    print(f"Cholesterol: {chol_mgdl} mg/dL = {chol_mmol:.2f} mmol/L")

    print()


def example_quantity_conversion():
    """Convert VoKoo Quantity objects."""
    print("=== Quantity Object Conversion ===\n")

    normalizer = UnitNormalizer()

    # Create Quantity
    weight = Quantity(value=70, unit="kg")
    print(f"Original: {weight.value} {weight.unit}")

    # Convert to pounds
    weight_lb = normalizer.convert_quantity(weight, "lb_av")
    print(f"Converted: {weight_lb.value:.2f} {weight_lb.unit}")

    print()

    # Glucose quantity
    glucose = Quantity(value=5.5, unit="mmol/L")
    print(f"Glucose: {glucose.value} {glucose.unit}")

    glucose_mgdl = normalizer.convert_quantity(glucose, "mg/dL", context="glucose")
    print(f"Glucose: {glucose_mgdl.value:.1f} {glucose_mgdl.unit}")

    print()


def example_batch_conversion():
    """Batch convert multiple values."""
    print("=== Batch Conversion ===\n")

    normalizer = UnitNormalizer()

    # Multiple temperature readings
    temps_f = [98.6, 99.1, 98.2, 100.4, 97.8]
    temps_c = normalizer.batch_convert(temps_f, "[degF]", "Cel")

    print("Temperature readings:")
    for f, c in zip(temps_f, temps_c):
        print(f"  {f}°F = {c:.1f}°C")

    print()

    # Multiple glucose readings
    glucose_values = [90, 110, 95, 105, 100]
    glucose_mmol = normalizer.batch_convert(
        glucose_values, "mg/dL", "mmol/L", context="glucose"
    )

    print("Glucose readings:")
    for mg, mmol in zip(glucose_values, glucose_mmol):
        print(f"  {mg} mg/dL = {mmol:.1f} mmol/L")

    print()


def example_validation():
    """Validate and suggest units."""
    print("=== Unit Validation ===\n")

    normalizer = UnitNormalizer()

    # Check valid units
    units_to_check = ["kg", "lb_av", "mg/dL", "mmol/L", "invalid_unit"]

    print("Validating units:")
    for unit in units_to_check:
        is_valid = normalizer.validate_unit(unit)
        status = "✓" if is_valid else "✗"
        print(f"  {status} {unit}")

    print()

    # Get supported units
    print("Supported unit categories:")
    categories = normalizer.get_supported_units()
    for category, units in categories.items():
        print(f"  {category}: {', '.join(units[:3])}...")

    print()

    # Suggest standard units
    print("Standard unit suggestions:")
    test_units = ["lb_av", "mg/dL", "[degF]", "mL"]
    for unit in test_units:
        standard = normalizer.suggest_standard_unit(unit)
        print(f"  {unit} → {standard}")

    print()


def example_error_handling():
    """Handle conversion errors."""
    print("=== Error Handling ===\n")

    normalizer = UnitNormalizer()

    # Try invalid conversion
    try:
        result = normalizer.convert(100, "kg", "Cel")  # Can't convert weight to temperature
        print(f"Result: {result}")
    except ConversionError as e:
        print(f"✗ Error (expected): {e}")

    print()

    # Try with unsupported unit
    try:
        result = normalizer.convert(100, "invalid_unit", "kg")
        print(f"Result: {result}")
    except ConversionError as e:
        print(f"✗ Error (expected): {e}")

    print()


def example_clinical_scenarios():
    """Real-world clinical scenarios."""
    print("=== Clinical Scenarios ===\n")

    normalizer = UnitNormalizer()

    # Scenario 1: US lab to international units
    print("Scenario 1: US lab report → International units")
    us_results = {
        "glucose": (110, "mg/dL"),
        "cholesterol": (220, "mg/dL"),
        "triglycerides": (150, "mg/dL"),
    }

    for test, (value, unit) in us_results.items():
        try:
            if test == "glucose":
                converted = normalizer.convert(value, unit, "mmol/L", context="glucose")
                print(f"  {test}: {value} {unit} = {converted:.2f} mmol/L")
            elif test == "cholesterol":
                converted = normalizer.convert(value, unit, "mmol/L", context="cholesterol")
                print(f"  {test}: {value} {unit} = {converted:.2f} mmol/L")
        except ConversionError:
            print(f"  {test}: conversion not available")

    print()

    # Scenario 2: Body measurements standardization
    print("Scenario 2: Body measurements → Standard units")
    measurements = [
        ("weight", 180, "lb_av", "kg"),
        ("height", 5.9, "[ft_i]", "m"),
    ]

    for name, value, from_u, to_u in measurements:
        converted = normalizer.convert(value, from_u, to_u)
        print(f"  {name}: {value} {from_u} = {converted:.2f} {to_u}")

    print()


if __name__ == "__main__":
    print("VoKoo Unit Normalizer - Examples\n")
    print("=" * 60)
    print()

    try:
        example_basic_conversion()
        example_lab_conversions()
        example_quantity_conversion()
        example_batch_conversion()
        example_validation()
        example_error_handling()
        example_clinical_scenarios()

        print("=" * 60)
        print("\n✨ All examples completed successfully!")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()

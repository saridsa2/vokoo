"""
Example usage of WellAlly Health Data Anonymizer.
"""

from wellally_health_data_anonymizer import HealthDataAnonymizer


def example_basic_anonymization():
    """Basic record anonymization."""
    print("=== Basic Anonymization ===\n")

    anonymizer = HealthDataAnonymizer()

    # Original record
    record = {
        "name": "John Smith",
        "patient_id": "P12345",
        "date_of_birth": "1980-05-15",
        "email": "john.smith@example.com",
        "phone": "555-1234",
        "glucose": 105,
        "date": "2025-01-15"
    }

    print("Original:")
    for key, value in record.items():
        print(f"  {key}: {value}")

    # Anonymize
    anon = anonymizer.anonymize_record(record)

    print("\nAnonymized:")
    for key, value in anon.items():
        print(f"  {key}: {value}")

    print()


def example_consistent_pseudonymization():
    """Demonstrate consistent pseudonymization."""
    print("=== Consistent Pseudonymization ===\n")

    anonymizer = HealthDataAnonymizer()

    # Same ID should produce same pseudonym
    original_id = "P12345"

    pseudo1 = anonymizer.pseudonymize_id(original_id)
    pseudo2 = anonymizer.pseudonymize_id(original_id)

    print(f"Original ID: {original_id}")
    print(f"Pseudonym 1: {pseudo1}")
    print(f"Pseudonym 2: {pseudo2}")
    print(f"Consistent: {pseudo1 == pseudo2}")

    # Different ID produces different pseudonym
    pseudo3 = anonymizer.pseudonymize_id("P67890")
    print(f"\nDifferent ID pseudonym: {pseudo3}")
    print(f"Different from first: {pseudo3 != pseudo1}")

    print()


def example_date_shifting():
    """Demonstrate consistent date shifting."""
    print("=== Date Shifting ===\n")

    anonymizer = HealthDataAnonymizer()

    # Multiple dates for same patient
    patient_id = "P12345"
    dates = [
        "2025-01-01",
        "2025-01-15",
        "2025-02-01"
    ]

    print(f"Original dates for {patient_id}:")
    for date in dates:
        print(f"  {date}")

    # Shift consistently
    shifted = [anonymizer.shift_date(d, patient_id) for d in dates]

    print("\nShifted dates:")
    for date in shifted:
        print(f"  {date[:10]}")

    # Verify relative differences preserved
    from datetime import datetime
    orig_diff = (datetime.fromisoformat(dates[1]) - datetime.fromisoformat(dates[0])).days
    shift_diff = (datetime.fromisoformat(shifted[1]) - datetime.fromisoformat(shifted[0])).days

    print(f"\nOriginal date difference: {orig_diff} days")
    print(f"Shifted date difference: {shift_diff} days")
    print(f"Relative timing preserved: {orig_diff == shift_diff}")

    print()


def example_generalization():
    """Generalize data for k-anonymity."""
    print("=== Data Generalization ===\n")

    anonymizer = HealthDataAnonymizer()

    # Age generalization
    ages = [25, 32, 48, 55, 72]

    print("Age generalization:")
    for age in ages:
        generalized = anonymizer.generalize_age(age)
        print(f"  {age} → {generalized}")

    print()

    # ZIP code generalization
    zipcodes = ["12345", "12389", "67890"]

    print("ZIP code generalization:")
    for zipcode in zipcodes:
        generalized = anonymizer.generalize_zipcode(zipcode)
        print(f"  {zipcode} → {generalized}")

    print()


def example_k_anonymity():
    """Calculate k-anonymity."""
    print("=== K-Anonymity Assessment ===\n")

    anonymizer = HealthDataAnonymizer()

    # Dataset with quasi-identifiers
    records = [
        {"age": "20-29", "gender": "M", "zipcode": "12300"},
        {"age": "20-29", "gender": "M", "zipcode": "12300"},
        {"age": "20-29", "gender": "M", "zipcode": "12300"},
        {"age": "30-39", "gender": "F", "zipcode": "67800"},
        {"age": "30-39", "gender": "F", "zipcode": "67800"},
    ]

    k = anonymizer.calculate_k_anonymity(records, ["age", "gender", "zipcode"])

    print(f"Dataset with {len(records)} records")
    print(f"K-anonymity value: k={k}")
    print(f"Interpretation: Each individual is indistinguishable from at least {k-1} others")

    print()


def example_risk_assessment():
    """Assess re-identification risk."""
    print("=== Re-identification Risk Assessment ===\n")

    anonymizer = HealthDataAnonymizer()

    # Different levels of anonymization
    scenarios = [
        {
            "name": "Fully Identified",
            "record": {
                "name": "John Smith",
                "ssn": "123-45-6789",
                "date_of_birth": "1980-05-15"
            }
        },
        {
            "name": "Partially Anonymized",
            "record": {
                "name": "[REDACTED]",
                "id": "ANON-ABC123",
                "date_of_birth": "1980"
            }
        },
        {
            "name": "Fully Anonymized",
            "record": {
                "id": "ANON-ABC123",
                "age_range": "40-49",
                "zipcode": "12300"
            }
        }
    ]

    for scenario in scenarios:
        print(f"{scenario['name']}:")
        risk = anonymizer.assess_risk(scenario['record'])
        print(f"  Risk level: {risk['risk_level']}")
        print(f"  PII fields: {', '.join(risk['pii_fields_present']) if risk['pii_fields_present'] else 'none'}")
        print(f"  Estimated uniqueness: 1 in {int(1/risk['estimated_uniqueness']):,}")
        print()


def example_batch_anonymization():
    """Anonymize multiple records."""
    print("=== Batch Anonymization ===\n")

    anonymizer = HealthDataAnonymizer()

    # Multiple patient records
    records = [
        {"patient_id": "P001", "name": "Alice Johnson", "glucose": 95},
        {"patient_id": "P002", "name": "Bob Smith", "glucose": 110},
        {"patient_id": "P003", "name": "Carol White", "glucose": 102},
    ]

    print(f"Anonymizing {len(records)} records...\n")

    anonymized = anonymizer.batch_anonymize(records, target_k=2)

    print("Results:")
    for i, anon in enumerate(anonymized, 1):
        print(f"  Record {i}: ID={anon.get('patient_id')}, Name={anon.get('name')}")

    print()


if __name__ == "__main__":
    print("WellAlly Health Data Anonymizer - Examples\n")
    print("=" * 60)
    print()

    try:
        example_basic_anonymization()
        example_consistent_pseudonymization()
        example_date_shifting()
        example_generalization()
        example_k_anonymity()
        example_risk_assessment()
        example_batch_anonymization()

        print("=" * 60)
        print("\n✨ All examples completed!")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()

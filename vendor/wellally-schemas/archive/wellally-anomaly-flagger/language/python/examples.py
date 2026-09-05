"""
Example usage of WellAlly Anomaly Flagger.
"""

from datetime import datetime, timedelta
from wellally_anomaly_flagger import AnomalyFlagger, Anomaly


def example_single_value_check():
    """Check single values for anomalies."""
    print("=== Single Value Checks ===\n")

    flagger = AnomalyFlagger()

    # Normal glucose
    anomalies = flagger.check_value("glucose", 95)
    print(f"Glucose 95 mg/dL: {len(anomalies)} anomalies")

    # High glucose
    anomalies = flagger.check_value("glucose", 250)
    print(f"Glucose 250 mg/dL: {len(anomalies)} anomalies")
    if anomalies:
        print(f"  → {anomalies[0].severity}: {anomalies[0].reason}")

    # Very high glucose
    anomalies = flagger.check_value("glucose", 400)
    print(f"Glucose 400 mg/dL: {len(anomalies)} anomalies")
    if anomalies:
        print(f"  → {anomalies[0].severity}: {anomalies[0].reason}")

    print()

    # Blood pressure checks
    anomalies = flagger.check_value("systolic_bp", 140)
    print(f"BP 140 mmHg: {len(anomalies)} anomalies")
    if anomalies:
        print(f"  → {anomalies[0].severity}: {anomalies[0].reason}")

    anomalies = flagger.check_value("systolic_bp", 180)
    print(f"BP 180 mmHg: {len(anomalies)} anomalies")
    if anomalies:
        print(f"  → {anomalies[0].severity}: {anomalies[0].reason}")

    print()


def example_series_analysis():
    """Analyze time series for anomalies."""
    print("=== Time Series Analysis ===\n")

    flagger = AnomalyFlagger()

    # Normal glucose readings with one outlier
    glucose_values = [95, 98, 92, 310, 96, 94, 99]  # 310 is anomaly

    anomalies = flagger.check_series("glucose", glucose_values)

    print(f"Glucose series: {glucose_values}")
    print(f"Detected {len(anomalies)} anomalies:\n")

    for anomaly in anomalies:
        print(f"  Value: {anomaly.value}")
        print(f"  Severity: {anomaly.severity}")
        print(f"  Reason: {anomaly.reason}")
        if anomaly.metadata:
            print(f"  Details: {anomaly.metadata}")
        print()


def example_sudden_changes():
    """Detect sudden spikes or drops."""
    print("=== Sudden Change Detection ===\n")

    flagger = AnomalyFlagger()

    # Heart rate with sudden spike
    heart_rate = [72, 75, 73, 155, 74, 76]  # Sudden spike to 155

    anomalies = flagger.check_series("heart_rate", heart_rate)

    print(f"Heart rate series: {heart_rate}")
    print(f"Detected {len(anomalies)} anomalies:\n")

    sudden_changes = [a for a in anomalies if "Sudden change" in a.reason]
    for anomaly in sudden_changes:
        print(f"  {anomaly.reason}")
        print(f"  Severity: {anomaly.severity}")
        print()


def example_missing_data():
    """Detect missing data gaps."""
    print("=== Missing Data Detection ===\n")

    flagger = AnomalyFlagger()

    # Expected: daily measurements
    # But missing several days
    timestamps = [
        datetime(2025, 1, 1),
        datetime(2025, 1, 2),
        datetime(2025, 1, 3),
        datetime(2025, 1, 8),  # Gap of 5 days
        datetime(2025, 1, 9),
    ]

    anomalies = flagger.check_missing_data(
        expected_frequency=timedelta(days=1),
        timestamps=timestamps,
        data_type="glucose"
    )

    print(f"Measurement dates: {[t.strftime('%Y-%m-%d') for t in timestamps]}")
    print(f"Detected {len(anomalies)} missing data gaps:\n")

    for anomaly in anomalies:
        print(f"  {anomaly.reason}")
        print(f"  Gap: {anomaly.metadata['gap_start']} to {anomaly.metadata['gap_end']}")
        print()


def example_duplicates():
    """Detect duplicate measurements."""
    print("=== Duplicate Detection ===\n")

    flagger = AnomalyFlagger()

    # Same timestamp, different values
    values = [95, 98, 96]
    timestamps = [
        datetime(2025, 1, 1, 9, 0),
        datetime(2025, 1, 1, 9, 0),  # Duplicate time
        datetime(2025, 1, 2, 9, 0),
    ]

    anomalies = flagger.check_duplicates(values, timestamps, "glucose")

    print(f"Values: {values}")
    print(f"Times: {[t.strftime('%Y-%m-%d %H:%M') for t in timestamps]}")
    print(f"Detected {len(anomalies)} duplicate issues:\n")

    for anomaly in anomalies:
        print(f"  {anomaly.reason}")
        print(f"  Duplicate values: {anomaly.metadata['values']}")
        print()


def example_clinical_ranges():
    """Check against clinical reference ranges."""
    print("=== Clinical Reference Ranges ===\n")

    flagger = AnomalyFlagger()

    # Show available ranges
    print("Built-in reference ranges:")
    for data_type, (min_val, max_val) in sorted(flagger.reference_ranges.items())[:10]:
        print(f"  {data_type}: {min_val} - {max_val}")

    print()

    # Test various values
    test_cases = [
        ("glucose", 85, "Normal"),
        ("glucose", 120, "Slightly high"),
        ("hba1c", 6.5, "Prediabetes"),
        ("total_cholesterol", 220, "Above optimal"),
        ("ldl", 150, "High"),
        ("heart_rate", 95, "Normal"),
        ("heart_rate", 110, "Elevated"),
    ]

    print("Test results:")
    for data_type, value, note in test_cases:
        anomalies = flagger.check_value(data_type, value)
        status = "✓ Normal" if not anomalies else f"⚠️ {anomalies[0].severity.upper()}"
        print(f"  {data_type} = {value}: {status} ({note})")

    print()


def example_custom_ranges():
    """Use custom reference ranges."""
    print("=== Custom Reference Ranges ===\n")

    flagger = AnomalyFlagger()

    # Custom range for post-meal glucose
    custom_range = (0, 140)  # mg/dL for 2-hour post-meal

    values = [110, 135, 150, 145]
    print(f"Post-meal glucose readings: {values}")
    print(f"Custom range: {custom_range[0]} - {custom_range[1]} mg/dL\n")

    for value in values:
        anomalies = flagger.check_value("glucose", value, reference_range=custom_range)
        if anomalies:
            print(f"  {value} mg/dL: ⚠️ {anomalies[0].reason}")
        else:
            print(f"  {value} mg/dL: ✓ Normal")

    print()


def example_comprehensive_check():
    """Comprehensive anomaly detection."""
    print("=== Comprehensive Health Check ===\n")

    flagger = AnomalyFlagger()

    # One week of glucose monitoring
    dates = [datetime(2025, 1, 1) + timedelta(days=i) for i in range(7)]
    glucose_values = [95, 98, 92, 96, 94, 280, 99]  # Day 6 has spike

    print("Glucose monitoring (7 days):")
    for date, value in zip(dates, glucose_values):
        print(f"  {date.strftime('%Y-%m-%d')}: {value} mg/dL")

    print()

    # Run all checks
    all_anomalies = []

    # Range checks
    for value, timestamp in zip(glucose_values, dates):
        anomalies = flagger.check_value("glucose", value, timestamp=timestamp)
        all_anomalies.extend(anomalies)

    # Series analysis
    series_anomalies = flagger.check_series("glucose", glucose_values, dates)
    all_anomalies.extend(series_anomalies)

    # Missing data check
    missing_anomalies = flagger.check_missing_data(
        expected_frequency=timedelta(days=1),
        timestamps=dates,
        data_type="glucose"
    )
    all_anomalies.extend(missing_anomalies)

    # Report
    print(f"Total anomalies detected: {len(all_anomalies)}\n")

    # Group by severity
    by_severity = {"high": [], "medium": [], "low": []}
    for anomaly in all_anomalies:
        by_severity[anomaly.severity].append(anomaly)

    for severity in ["high", "medium", "low"]:
        if by_severity[severity]:
            print(f"{severity.upper()} severity ({len(by_severity[severity])}):")
            for anomaly in by_severity[severity]:
                timestamp_str = anomaly.timestamp.strftime('%Y-%m-%d') if anomaly.timestamp else "N/A"
                print(f"  [{timestamp_str}] {anomaly.reason}")
            print()


if __name__ == "__main__":
    print("WellAlly Anomaly Flagger - Examples\n")
    print("=" * 60)
    print()

    try:
        example_single_value_check()
        example_series_analysis()
        example_sudden_changes()
        example_missing_data()
        example_duplicates()
        example_clinical_ranges()
        example_custom_ranges()
        example_comprehensive_check()

        print("=" * 60)
        print("\n✨ All examples completed!")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()

"""
Example usage of VoKoo Trend Detector.
"""

from datetime import datetime, timedelta
from vokoo_trend_detector import TrendDetector, TrendDirection


def example_basic_trend():
    """Detect basic trends."""
    print("=== Basic Trend Detection ===\n")

    detector = TrendDetector()

    # Increasing trend
    base_date = datetime(2025, 1, 1)
    dates = [base_date + timedelta(days=i) for i in range(10)]
    values = [100 + i * 5 for i in range(10)]  # Steady increase

    trend = detector.detect_trend("glucose", values, dates)

    print(f"Values: {values}")
    print(f"Trend: {trend.direction.value}")
    print(f"Slope: {trend.slope:.3f}")
    print(f"Confidence: {trend.confidence:.3f}")
    print()


def example_decreasing_trend():
    """Detect decreasing trend."""
    print("=== Decreasing Trend ===\n")

    detector = TrendDetector()

    # Weight loss over 3 months
    base_date = datetime(2024, 10, 1)
    dates = [base_date + timedelta(weeks=i) for i in range(12)]
    weights = [200 - i * 2 for i in range(12)]  # Losing 2 lbs/week

    trend = detector.detect_trend("weight", weights, dates)

    print(f"Weight loss journey (lbs): {weights}")
    print(f"Trend: {trend.direction.value}")
    print(f"Slope: {trend.slope:.3f} per day")
    print(f"Total change: {weights[0] - weights[-1]:.1f} lbs")
    print()


def example_stable_trend():
    """Detect stable trend."""
    print("=== Stable Trend ===\n")

    detector = TrendDetector()

    # Well-controlled blood pressure
    base_date = datetime(2025, 1, 1)
    dates = [base_date + timedelta(days=i*7) for i in range(8)]
    bp = [120, 122, 119, 121, 120, 123, 121, 120]  # Stable around 120

    trend = detector.detect_trend("systolic_bp", bp, dates)

    print(f"Blood pressure readings: {bp}")
    print(f"Trend: {trend.direction.value}")
    print(f"Average: {sum(bp)/len(bp):.1f} mmHg")
    print()


def example_fluctuating():
    """Detect fluctuating data."""
    print("=== Fluctuating Trend ===\n")

    detector = TrendDetector()

    # Erratic glucose control
    base_date = datetime(2025, 1, 1)
    dates = [base_date + timedelta(days=i) for i in range(10)]
    glucose = [100, 150, 90, 160, 85, 170, 95, 155, 88, 165]

    trend = detector.detect_trend("glucose", glucose, dates)

    print(f"Glucose readings: {glucose}")
    print(f"Trend: {trend.direction.value}")
    print(f"Range: {min(glucose)} - {max(glucose)} mg/dL")
    print()


def example_moving_average():
    """Smooth data with moving average."""
    print("=== Moving Average Smoothing ===\n")

    detector = TrendDetector()

    # Noisy data
    raw_values = [100, 105, 98, 110, 102, 108, 95, 112, 104, 109]

    # Smooth with different window sizes
    smoothed_3 = detector.calculate_moving_average(raw_values, window=3)
    smoothed_5 = detector.calculate_moving_average(raw_values, window=5)

    print(f"Raw values:      {raw_values}")
    print(f"Smoothed (w=3):  {[round(v, 1) for v in smoothed_3]}")
    print(f"Smoothed (w=5):  {[round(v, 1) for v in smoothed_5]}")
    print()


def example_rate_of_change():
    """Calculate rate of change."""
    print("=== Rate of Change ===\n")

    detector = TrendDetector()

    # Weight change
    dates = [datetime(2025, 1, 1) + timedelta(weeks=i) for i in range(6)]
    weights = [180, 178, 175, 173, 171, 170]

    # Rate per week
    rates = detector.calculate_rate_of_change(weights, dates, unit="week")

    print("Weight change:")
    for i, (date, weight) in enumerate(zip(dates, weights)):
        rate_str = f"({rates[i-1]:+.1f} lbs/week)" if i > 0 else ""
        print(f"  {date.strftime('%Y-%m-%d')}: {weight} lbs {rate_str}")

    print()


def example_change_points():
    """Detect significant change points."""
    print("=== Change Point Detection ===\n")

    detector = TrendDetector()

    # HbA1c with medication change causing drop
    dates = [datetime(2024, 1, 1) + timedelta(days=i*30) for i in range(12)]
    hba1c = [8.5, 8.4, 8.6, 8.5, 8.3, 7.2, 6.9, 6.8, 6.7, 6.9, 6.8, 6.7]
    #                                    ^ Med started here

    change_points = detector.detect_change_points(hba1c, dates)

    print(f"HbA1c over 12 months: {hba1c}")
    print(f"\nDetected {len(change_points)} change point(s):")
    for idx, timestamp in change_points:
        print(f"  Month {idx}: {hba1c[idx-1]:.1f}% → {hba1c[idx]:.1f}% (change: {hba1c[idx] - hba1c[idx-1]:+.1f}%)")

    print()


def example_periodicity():
    """Detect periodic patterns."""
    print("=== Periodicity Detection ===\n")

    detector = TrendDetector()

    # Weekly pattern (higher on weekends)
    dates = [datetime(2025, 1, 1) + timedelta(days=i) for i in range(28)]
    # Pattern: weekdays ~90, weekends ~120
    values = []
    for i in range(28):
        day_of_week = (i % 7)
        if day_of_week < 5:  # Weekday
            values.append(90 + (i % 3) * 2)
        else:  # Weekend
            values.append(120 + (i % 3) * 2)

    periodicity = detector.analyze_periodicity(values, dates)

    print(f"Values over 4 weeks: {values}")
    print(f"\nPeriodicity analysis:")
    print(f"  Periodic: {periodicity.get('periodic')}")
    if periodicity.get('pattern'):
        print(f"  Pattern: {periodicity['pattern']}")
        print(f"  Correlation: {periodicity.get('correlation', 0):.3f}")

    print()


def example_comprehensive_analysis():
    """Complete trend analysis."""
    print("=== Comprehensive Trend Analysis ===\n")

    detector = TrendDetector()

    # 3 months of glucose data
    dates = [datetime(2024, 10, 1) + timedelta(days=i*3) for i in range(30)]
    glucose = [140 - i * 1.5 + (i % 3) * 5 for i in range(30)]  # Improving with noise

    summary = detector.get_trend_summary("glucose", glucose, dates)

    print("Glucose monitoring (3 months, every 3 days)")
    print(f"\nOverall Trend:")
    if summary.get("trend"):
        trend = summary["trend"]
        print(f"  Direction: {trend['direction']}")
        print(f"  Slope: {trend['slope']:.3f}")
        print(f"  Confidence: {trend['confidence']:.3f}")

    print(f"\nStatistics:")
    stats = summary["statistics"]
    print(f"  Mean: {stats['mean']:.1f} mg/dL")
    print(f"  Range: {stats['min']:.1f} - {stats['max']:.1f} mg/dL")

    print(f"\nRate of Change:")
    rate = summary["rate_of_change"]
    print(f"  Average: {rate['mean']:.2f} per day")

    if summary.get("change_points"):
        print(f"\nChange Points: {len(summary['change_points'])}")
        for cp in summary["change_points"][:3]:
            print(f"  - Index {cp['index']} at {cp['timestamp'][:10]}")

    print()


def example_clinical_scenarios():
    """Real clinical scenarios."""
    print("=== Clinical Scenarios ===\n")

    detector = TrendDetector()

    # Scenario 1: Pre-diabetes progression
    print("Scenario 1: HbA1c progression (pre-diabetes)")
    dates = [datetime(2023, 1, 1) + timedelta(days=i*90) for i in range(8)]
    hba1c = [5.5, 5.7, 5.9, 6.1, 6.3, 6.4, 6.5, 6.6]

    trend = detector.detect_trend("hba1c", hba1c, dates)
    print(f"  Values: {hba1c}")
    print(f"  Trend: {trend.direction.value} (slope: {trend.slope:.4f}/day)")
    print(f"  → Action needed: lifestyle modification")
    print()

    # Scenario 2: Blood pressure control success
    print("Scenario 2: Blood pressure after medication")
    dates = [datetime(2024, 6, 1) + timedelta(days=i*14) for i in range(10)]
    bp = [155, 152, 145, 138, 132, 128, 125, 123, 122, 120]

    trend = detector.detect_trend("bp", bp, dates)
    print(f"  Values: {bp}")
    print(f"  Trend: {trend.direction.value}")
    print(f"  Total reduction: {bp[0] - bp[-1]} mmHg")
    print(f"  → Treatment effective")
    print()


if __name__ == "__main__":
    print("VoKoo Trend Detector - Examples\n")
    print("=" * 60)
    print()

    try:
        example_basic_trend()
        example_decreasing_trend()
        example_stable_trend()
        example_fluctuating()
        example_moving_average()
        example_rate_of_change()
        example_change_points()
        example_periodicity()
        example_comprehensive_analysis()
        example_clinical_scenarios()

        print("=" * 60)
        print("\n✨ All examples completed!")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()

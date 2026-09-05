"""
Example usage of WellAlly Data Correlation.
"""

from datetime import datetime, timedelta
from wellally_data_correlation import DataCorrelation


def example_pearson():
    """Pearson correlation example."""
    print("=== Pearson Correlation ===\n")

    analyzer = DataCorrelation()

    # Glucose and weight relationship
    glucose = [110, 105, 100, 95, 90, 88, 85]
    weight = [180, 178, 175, 172, 170, 168, 165]

    result = analyzer.pearson_correlation(glucose, weight, "glucose", "weight")

    print(f"Glucose: {glucose}")
    print(f"Weight: {weight}")
    print(f"\nCorrelation: {result.correlation:.3f}")
    print(f"Interpretation: {result.interpretation}")
    print(f"Sample size: {result.sample_size}")
    print()


def example_correlation_matrix():
    """Multi-variable correlation matrix."""
    print("=== Correlation Matrix ===\n")

    analyzer = DataCorrelation()

    # Multiple health metrics
    data = {
        "glucose": [110, 105, 100, 95, 90],
        "weight": [180, 178, 175, 172, 170],
        "exercise_min": [0, 15, 30, 45, 60],
        "sleep_hours": [6.5, 7.0, 7.5, 7.5, 8.0]
    }

    matrix = analyzer.correlation_matrix(data)

    print("Correlation Matrix:")
    print("\n       ", end="")
    for var in data.keys():
        print(f"{var[:8]:>10}", end="")
    print()

    for var1 in data.keys():
        print(f"{var1[:8]:>8}", end="")
        for var2 in data.keys():
            print(f"{matrix[var1][var2]:>10.3f}", end="")
        print()
    print()


def example_strongest_correlations():
    """Find strongest correlations."""
    print("=== Strongest Correlations ===\n")

    analyzer = DataCorrelation()

    data = {
        "glucose": [110, 105, 100, 95, 90, 88, 85],
        "weight": [180, 178, 175, 172, 170, 168, 165],
        "hba1c": [7.5, 7.2, 6.9, 6.7, 6.4, 6.2, 6.0],
        "bp_sys": [135, 132, 128, 125, 122, 120, 118],
        "exercise": [0, 15, 30, 45, 60, 75, 90]
    }

    results = analyzer.find_strongest_correlations(data, threshold=0.7)

    print(f"Found {len(results)} strong correlations (|r| >= 0.7):\n")
    for result in results:
        print(f"{result.variable_x} ↔ {result.variable_y}")
        print(f"  r = {result.correlation:.3f}")
        print(f"  {result.interpretation}")
        print()


def example_lagged_correlation():
    """Time-lagged correlation."""
    print("=== Lagged Correlation ===\n")

    analyzer = DataCorrelation()

    # Exercise affects glucose with a lag
    base_date = datetime(2025, 1, 1)

    exercise_dates = [base_date + timedelta(days=i) for i in range(10)]
    exercise_mins = [0, 0, 60, 60, 0, 0, 60, 60, 0, 0]

    glucose_dates = [base_date + timedelta(days=i) for i in range(10)]
    glucose_values = [110, 110, 108, 100, 98, 108, 105, 95, 93, 105]

    results = analyzer.lagged_correlation(
        exercise_mins, glucose_values,
        exercise_dates, glucose_dates,
        "exercise", "glucose",
        max_lag_days=3
    )

    print("Exercise → Glucose correlation at different lags:\n")
    for result in results:
        lag = result.interpretation.split("lag: ")[1].split(" days")[0]
        print(f"Lag {lag} days: r = {result.correlation:.3f}")

    print()


def example_clinical_use_cases():
    """Clinical correlation examples."""
    print("=== Clinical Use Cases ===\n")

    analyzer = DataCorrelation()

    # Use case 1: Medication adherence & HbA1c
    print("Use Case 1: Medication adherence vs HbA1c")
    adherence = [40, 50, 60, 70, 80, 90, 95]  # % of days
    hba1c = [8.5, 8.2, 7.8, 7.4, 7.0, 6.7, 6.5]

    result = analyzer.pearson_correlation(adherence, hba1c, "adherence_%", "hba1c")
    print(f"  r = {result.correlation:.3f}")
    print(f"  {result.interpretation}")
    print(f"  → Better adherence → lower HbA1c")
    print()

    # Use case 2: Sleep & blood pressure
    print("Use Case 2: Sleep hours vs blood pressure")
    sleep = [5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5]
    bp_sys = [145, 140, 135, 128, 125, 122, 120]

    result = analyzer.pearson_correlation(sleep, bp_sys, "sleep_hours", "bp_systolic")
    print(f"  r = {result.correlation:.3f}")
    print(f"  {result.interpretation}")
    print(f"  → More sleep → lower BP")
    print()


if __name__ == "__main__":
    print("WellAlly Data Correlation - Examples\n")
    print("=" * 60)
    print()

    try:
        example_pearson()
        example_correlation_matrix()
        example_strongest_correlations()
        example_lagged_correlation()
        example_clinical_use_cases()

        print("=" * 60)
        print("\n✨ All examples completed!")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()

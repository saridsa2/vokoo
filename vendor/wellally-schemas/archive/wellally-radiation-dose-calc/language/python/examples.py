"""
Example usage of WellAlly Radiation Dose Calculator.
"""

from datetime import datetime, timedelta
from wellally_radiation_dose_calc import RadiationDoseCalculator, RadiationExposure, ImagingModality


def example_ct_dose():
    """Calculate CT effective dose."""
    print("=== CT Dose Calculation ===\n")

    calc = RadiationDoseCalculator()

    # Chest CT
    dlp = 500  # mGy·cm
    dose = calc.calculate_ct_dose(dlp, "chest")

    print(f"Chest CT (DLP={dlp} mGy·cm)")
    print(f"Effective dose: {dose:.1f} mSv")

    # Compare to background
    comparison = calc.compare_to_background(dose)
    print(f"Equivalent to {comparison['days_of_background']:.0f} days of natural background radiation")
    print()


def example_cumulative_tracking():
    """Track cumulative radiation dose."""
    print("=== Cumulative Dose Tracking ===\n")

    calc = RadiationDoseCalculator()

    # Series of imaging studies over 2 years
    exposures = [
        RadiationExposure(
            modality=ImagingModality.CT,
            procedure="Chest CT",
            date=datetime(2023, 1, 15),
            dlp=500,
            body_part="chest",
            age_at_exposure=45
        ),
        RadiationExposure(
            modality=ImagingModality.XRAY,
            procedure="Chest X-ray",
            date=datetime(2023, 6, 20),
            effective_dose_msv=0.02,
            age_at_exposure=45
        ),
        RadiationExposure(
            modality=ImagingModality.CT,
            procedure="Abdomen CT",
            date=datetime(2024, 3, 10),
            dlp=600,
            body_part="abdomen",
            age_at_exposure=46
        ),
    ]

    # Calculate effective doses
    for exp in exposures:
        if exp.effective_dose_msv is None and exp.dlp:
            exp.effective_dose_msv = calc.calculate_ct_dose(exp.dlp, exp.body_part)

    # Get cumulative
    cumulative = calc.calculate_cumulative_dose(exposures)

    print(f"Total exposures: {len(exposures)}")
    print(f"Cumulative dose: {cumulative:.1f} mSv")
    print(f"Risk category: {calc.get_risk_category(cumulative)}")
    print()


def example_age_adjusted_risk():
    """Calculate age-adjusted radiation risk."""
    print("=== Age-Adjusted Risk ===\n")

    calc = RadiationDoseCalculator()

    dose = 10.0  # mSv

    ages = [5, 15, 30, 50, 70]

    print(f"Effective dose: {dose} mSv\n")
    print("Age-adjusted risk:")

    for age in ages:
        risk = calc.calculate_age_adjusted_risk(dose, age)
        print(f"  Age {age}: risk score = {risk:.1f}")

    print("\n(Higher score = higher radiation sensitivity)")
    print()


def example_comprehensive_report():
    """Generate comprehensive radiation report."""
    print("=== Comprehensive Radiation Report ===\n")

    calc = RadiationDoseCalculator()

    # Patient's imaging history
    exposures = []

    # Add multiple studies
    for i in range(5):
        exp = RadiationExposure(
            modality=ImagingModality.CT,
            procedure="CT Abdomen",
            date=datetime(2024, 1, 1) + timedelta(days=i*60),
            dlp=600,
            body_part="abdomen",
            age_at_exposure=50
        )
        exp.effective_dose_msv = calc.calculate_ct_dose(exp.dlp, exp.body_part)
        exposures.append(exp)

    # Generate report
    report = calc.generate_report(exposures, patient_age=50)

    print(f"Total exposures: {report['total_exposures']}")
    print(f"Cumulative dose: {report['cumulative_dose_msv']:.1f} mSv")
    print(f"Risk category: {report['risk_category']}")
    print(f"Age-adjusted risk: {report['age_adjusted_risk']:.1f}")
    print(f"\nBackground comparison:")
    bg = report['background_comparison']
    print(f"  Equivalent to {bg['days_of_background']:.0f} days of background")
    print(f"  {bg['percent_of_annual_limit']:.1f}% of annual regulatory limit")
    print()


if __name__ == "__main__":
    print("WellAlly Radiation Dose Calculator - Examples\n")
    print("=" * 60)
    print()

    try:
        example_ct_dose()
        example_cumulative_tracking()
        example_age_adjusted_risk()
        example_comprehensive_report()

        print("=" * 60)
        print("\n✨ All examples completed!")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()

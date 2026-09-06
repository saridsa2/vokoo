"""
Example usage of VoKoo Medical Timeline.
"""

from datetime import datetime, timedelta
from vokoo_medical_timeline import MedicalTimeline, TimelineEvent


def example_basic_usage():
    """Basic timeline creation."""
    print("=== Basic Timeline Usage ===\n")

    timeline = MedicalTimeline()

    # Add some events
    timeline.add_event(
        date="2025-01-01",
        event_type="laboratory",
        category="Lab Tests",
        title="Annual Physical Lab Work",
        details="Complete metabolic panel"
    )

    timeline.add_event(
        date="2025-01-15",
        event_type="vital_sign",
        category="Vital Signs",
        title="Blood Pressure: 120/80 mmHg"
    )

    timeline.add_medication(
        date="2025-01-20",
        medication_name="Metformin",
        dosage="500mg twice daily",
        action="started"
    )

    # Get all events
    events = timeline.get_events()

    print(f"Total events: {len(events)}\n")
    for event in events:
        print(f"{event.date.strftime('%Y-%m-%d')} | {event.category} | {event.title}")

    print()


def example_vitals_tracking():
    """Track vital signs over time."""
    print("=== Vital Signs Tracking ===\n")

    timeline = MedicalTimeline()

    # Add daily vital signs for a week
    base_date = datetime(2025, 1, 1)

    for i in range(7):
        date = base_date + timedelta(days=i)
        timeline.add_vital_signs(
            date=date,
            vitals={
                "Blood Pressure Systolic": (120 + i, "mmHg"),
                "Blood Pressure Diastolic": (80 + i // 2, "mmHg"),
                "Heart Rate": (70 + i * 2, "bpm"),
                "Temperature": (36.5 + i * 0.1, "°C")
            }
        )

    # Get vital sign events
    vital_events = timeline.get_events(event_type="vital_sign")

    print(f"Recorded {len(vital_events)} vital sign measurements")
    print("\nBlood pressure trend:")

    bp_events = [e for e in vital_events if "Blood Pressure Systolic" in e.title]
    for event in bp_events[:5]:  # Show first 5
        print(f"  {event.date.strftime('%Y-%m-%d')}: {event.title}")

    print()


def example_medication_history():
    """Track medication changes."""
    print("=== Medication History ===\n")

    timeline = MedicalTimeline()

    # Medication timeline
    timeline.add_medication(
        date="2024-06-01",
        medication_name="Lisinopril",
        dosage="10mg daily",
        action="started"
    )

    timeline.add_medication(
        date="2024-09-01",
        medication_name="Lisinopril",
        dosage="20mg daily",
        action="changed"
    )

    timeline.add_medication(
        date="2024-10-01",
        medication_name="Metformin",
        dosage="500mg twice daily",
        action="started"
    )

    timeline.add_medication(
        date="2024-12-01",
        medication_name="Metformin",
        dosage="1000mg twice daily",
        action="changed"
    )

    # Get medication events
    med_events = timeline.get_events(category="Medications")

    print(f"Medication history ({len(med_events)} events):\n")
    for event in med_events:
        print(f"{event.date.strftime('%Y-%m-%d')}: {event.title}")
        print(f"  {event.details}")

    print()


def example_filtering():
    """Filter timeline events."""
    print("=== Event Filtering ===\n")

    timeline = MedicalTimeline()

    # Add various events throughout 2024
    events_data = [
        ("2024-01-15", "laboratory", "Lab Tests", "CBC"),
        ("2024-03-20", "laboratory", "Lab Tests", "Lipid Panel"),
        ("2024-06-10", "laboratory", "Lab Tests", "HbA1c"),
        ("2024-09-05", "vital_sign", "Vital Signs", "BP Check"),
        ("2024-12-15", "laboratory", "Lab Tests", "Annual Labs"),
    ]

    for date, etype, category, title in events_data:
        timeline.add_event(date, etype, category, title)

    # Filter by date range
    q2_events = timeline.get_events(
        start_date="2024-04-01",
        end_date="2024-06-30"
    )

    print(f"Q2 2024 events: {len(q2_events)}")
    for e in q2_events:
        print(f"  {e.date.strftime('%Y-%m-%d')}: {e.title}")

    print()

    # Filter by category
    lab_events = timeline.get_events(category="Lab Tests")
    print(f"\nLab events in 2024: {len(lab_events)}")

    print()


def example_grouping():
    """Group events by time period."""
    print("=== Event Grouping ===\n")

    timeline = MedicalTimeline()

    # Add events across several months
    dates = [
        "2024-01-15", "2024-01-20", "2024-02-10",
        "2024-02-25", "2024-03-05", "2024-03-18", "2024-03-30"
    ]

    for date in dates:
        timeline.add_event(
            date=date,
            event_type="laboratory",
            category="Lab Tests",
            title=f"Lab work on {date}"
        )

    # Group by month
    monthly_groups = timeline.group_by_period("month")

    print("Events by month:")
    for month, events in sorted(monthly_groups.items()):
        print(f"  {month}: {len(events)} events")

    print()


def example_export():
    """Export timeline data."""
    print("=== Timeline Export ===\n")

    timeline = MedicalTimeline()

    # Add some events
    timeline.add_event(
        date="2025-01-01",
        event_type="laboratory",
        category="Lab Tests",
        title="Annual Labs"
    )

    timeline.add_vital_signs(
        date="2025-01-15",
        vitals={
            "Blood Pressure": (120/80, "mmHg"),
            "Heart Rate": (72, "bpm")
        }
    )

    # Export to dict
    data = timeline.to_dict()

    print("Timeline summary:")
    print(f"  Total events: {data['event_count']}")
    print(f"  Date range: {data['date_range']['start']} to {data['date_range']['end']}")
    print(f"  Categories: {', '.join(data['categories'])}")
    print(f"  Event types: {', '.join(data['event_types'])}")

    print()

    # Export to JSON file
    # timeline.export_to_json("timeline.json")
    # print("✓ Exported to timeline.json")

    print()


def example_complex_scenario():
    """Complex real-world scenario."""
    print("=== Complex Scenario: Diabetes Management ===\n")

    timeline = MedicalTimeline()

    # Diagnosis
    timeline.add_event(
        date="2024-03-01",
        event_type="diagnosis",
        category="Diagnoses",
        title="Type 2 Diabetes Diagnosed",
        details="HbA1c: 7.5%"
    )

    # Initial medication
    timeline.add_medication(
        date="2024-03-01",
        medication_name="Metformin",
        dosage="500mg daily",
        action="started"
    )

    # Monthly follow-ups with lab work
    for month in range(3, 13):  # Mar to Dec
        date = f"2024-{month:02d}-15"

        # Lab work
        timeline.add_event(
            date=date,
            event_type="laboratory",
            category="Lab Tests",
            title=f"Glucose: {110 - month} mg/dL",
            test_name="Glucose",
            value=110 - month,
            unit="mg/dL"
        )

        # Vital signs
        timeline.add_vital_signs(
            date=date,
            vitals={
                "Weight": (185 - month * 2, "lb"),
                "Blood Pressure": (130 - month, "mmHg")
            }
        )

    # Medication adjustment
    timeline.add_medication(
        date="2024-06-15",
        medication_name="Metformin",
        dosage="1000mg twice daily",
        action="changed"
    )

    # Get summary
    start, end = timeline.get_date_range()
    print(f"Timeline: {start.strftime('%Y-%m-%d')} to {end.strftime('%Y-%m-%d')}")
    print(f"Total events: {len(timeline.events)}")
    print(f"\nCategories: {', '.join(timeline.get_categories())}")

    # Show glucose trend
    glucose_events = [
        e for e in timeline.get_events(event_type="laboratory")
        if "Glucose" in e.title
    ]

    print(f"\nGlucose trend ({len(glucose_events)} measurements):")
    for e in glucose_events[:5]:
        print(f"  {e.date.strftime('%Y-%m-%d')}: {e.title}")

    print()


if __name__ == "__main__":
    print("VoKoo Medical Timeline - Examples\n")
    print("=" * 60)
    print()

    try:
        example_basic_usage()
        example_vitals_tracking()
        example_medication_history()
        example_filtering()
        example_grouping()
        example_export()
        example_complex_scenario()

        print("=" * 60)
        print("\n✨ All examples completed!")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()

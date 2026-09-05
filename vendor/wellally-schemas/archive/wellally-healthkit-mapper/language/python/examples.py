"""
Example usage of WellAlly HealthKit Mapper.
"""

from wellally_healthkit_mapper import HealthKitMapper, HealthKitDataType
from pathlib import Path


def example_basic_mapping():
    """Basic example: Load and map HealthKit data."""
    print("=== Basic HealthKit Mapping ===\n")

    # Initialize mapper
    mapper = HealthKitMapper()

    # Load export
    export_path = "export.xml"
    if not Path(export_path).exists():
        print(f"❌ Export file not found: {export_path}")
        print("Please export your HealthKit data from iPhone Health app")
        return

    print(f"Loading {export_path}...")
    mapper.load_export(export_path)

    # Get summary
    summary = mapper.get_data_summary()
    print(f"\n✅ Loaded {summary['total_records']} records")
    print(f"📅 Date range: {summary['date_range']['start']} to {summary['date_range']['end']}")
    print(f"🏃 Workouts: {summary['total_workouts']}")
    print(f"📱 Data sources: {', '.join(summary['sources'][:3])}")


def example_map_lab_results():
    """Example: Map lab results."""
    print("\n=== Map Lab Results ===\n")

    mapper = HealthKitMapper()
    export_path = "export.xml"

    if not Path(export_path).exists():
        print(f"Export file not found: {export_path}")
        return

    mapper.load_export(export_path)

    # Map to WellAlly LabReport
    lab_reports = mapper.map_lab_results(patient_id="patient-123")

    print(f"Mapped {len(lab_reports)} lab reports\n")

    for report in lab_reports[:3]:
        print(f"Report: {report.id}")
        print(f"Date: {report.issuedAt}")
        print(f"Tests: {len(report.results)}")

        for result in report.results:
            print(f"  - {result.code.text}: {result.value.value} {result.value.unit}")
        print()


def example_map_vital_signs():
    """Example: Map vital signs."""
    print("\n=== Map Vital Signs ===\n")

    mapper = HealthKitMapper()
    export_path = "export.xml"

    if not Path(export_path).exists():
        print(f"Export file not found: {export_path}")
        return

    mapper.load_export(export_path)

    # Map vital signs
    vitals = mapper.map_vital_signs(patient_id="patient-123")

    print(f"Found {len(vitals)} vital sign types\n")

    # Show heart rate
    if HealthKitDataType.HEART_RATE.value in vitals:
        heart_rates = vitals[HealthKitDataType.HEART_RATE.value]
        print(f"❤️  Heart Rate: {len(heart_rates)} measurements")

        # Show latest 5
        for hr in heart_rates[-5:]:
            print(f"  {hr['timestamp']}: {hr['value']['value']} {hr['value']['unit']}")

    # Show blood pressure
    bp_sys = vitals.get(HealthKitDataType.BLOOD_PRESSURE_SYSTOLIC.value, [])
    bp_dia = vitals.get(HealthKitDataType.BLOOD_PRESSURE_DIASTOLIC.value, [])

    if bp_sys and bp_dia:
        print(f"\n🩸 Blood Pressure: {len(bp_sys)} measurements")
        for sys, dia in zip(bp_sys[-3:], bp_dia[-3:]):
            print(f"  {sys['timestamp']}: {sys['value']['value']}/{dia['value']['value']} {sys['value']['unit']}")


def example_map_body_measurements():
    """Example: Map body measurements."""
    print("\n=== Map Body Measurements ===\n")

    mapper = HealthKitMapper()
    export_path = "export.xml"

    if not Path(export_path).exists():
        print(f"Export file not found: {export_path}")
        return

    mapper.load_export(export_path)

    # Map measurements
    measurements = mapper.map_body_measurements(patient_id="patient-123")

    # Group by type
    by_type = {}
    for m in measurements:
        mtype = m["type"]
        if mtype not in by_type:
            by_type[mtype] = []
        by_type[mtype].append(m)

    print(f"Found {len(by_type)} measurement types\n")

    # Show weight history
    if HealthKitDataType.BODY_MASS.value in by_type:
        weights = by_type[HealthKitDataType.BODY_MASS.value]
        print(f"⚖️  Body Mass: {len(weights)} measurements")

        for w in weights[-5:]:
            print(f"  {w['timestamp']}: {w['value']['value']} {w['value']['unit']}")

    # Show height
    if HealthKitDataType.HEIGHT.value in by_type:
        heights = by_type[HealthKitDataType.HEIGHT.value]
        if heights:
            h = heights[-1]
            print(f"\n📏 Height: {h['value']['value']} {h['value']['unit']}")


def example_map_workouts():
    """Example: Map workout data."""
    print("\n=== Map Workouts ===\n")

    mapper = HealthKitMapper()
    export_path = "export.xml"

    if not Path(export_path).exists():
        print(f"Export file not found: {export_path}")
        return

    mapper.load_export(export_path)

    # Map workouts
    workouts = mapper.map_workouts(patient_id="patient-123")

    print(f"Found {len(workouts)} workouts\n")

    # Group by type
    by_type = {}
    for w in workouts:
        wtype = w["type"]
        if wtype not in by_type:
            by_type[wtype] = []
        by_type[wtype].append(w)

    print("Workout types:")
    for wtype, wlist in sorted(by_type.items(), key=lambda x: -len(x[1]))[:5]:
        print(f"  {wtype}: {len(wlist)} sessions")

    # Show recent workouts
    print("\n🏃 Recent workouts:")
    for w in workouts[-5:]:
        duration_min = w['duration']['value'] / 60
        print(f"  {w['type']}: {duration_min:.1f} min", end="")

        if 'distance' in w:
            print(f", {w['distance']['value']} {w['distance']['unit']}", end="")

        if 'calories' in w:
            print(f", {w['calories']['value']:.0f} {w['calories']['unit']}", end="")

        print()


def example_batch_processing():
    """Example: Process multiple exports."""
    print("\n=== Batch Processing ===\n")

    exports_dir = Path("healthkit_exports")

    if not exports_dir.exists():
        print(f"Directory not found: {exports_dir}")
        exports_dir.mkdir(exist_ok=True)
        print(f"Created directory. Place XML exports in: {exports_dir}/")
        return

    xml_files = list(exports_dir.glob("*.xml"))

    if not xml_files:
        print(f"No XML files found in {exports_dir}/")
        return

    print(f"Found {len(xml_files)} export files\n")

    mapper = HealthKitMapper()

    for xml_file in xml_files:
        print(f"Processing {xml_file.name}...", end=" ")

        try:
            mapper.load_export(xml_file)
            summary = mapper.get_data_summary()

            print(f"✓ {summary['total_records']} records, {summary['total_workouts']} workouts")

            # Map data
            patient_id = xml_file.stem
            lab_reports = mapper.map_lab_results(patient_id)
            vitals = mapper.map_vital_signs(patient_id)
            workouts = mapper.map_workouts(patient_id)

            print(f"  Mapped: {len(lab_reports)} lab reports, {len(vitals)} vital types, {len(workouts)} workouts")

        except Exception as e:
            print(f"✗ Error: {e}")


if __name__ == "__main__":
    print("WellAlly HealthKit Mapper - Examples\n")
    print("=" * 50)

    # Check for sample data
    if not Path("export.xml").exists():
        print("\n⚠️  No export.xml found!")
        print("\nTo get HealthKit data:")
        print("1. Open Health app on iPhone")
        print("2. Tap your profile (top right)")
        print("3. Scroll down and tap 'Export All Health Data'")
        print("4. Save the export.xml file")
        print("\nThen run this script again.\n")
    else:
        try:
            example_basic_mapping()
            example_map_lab_results()
            example_map_vital_signs()
            example_map_body_measurements()
            example_map_workouts()
            example_batch_processing()
        except Exception as e:
            print(f"\n❌ Error: {e}")
            import traceback
            traceback.print_exc()

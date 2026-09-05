# VoKoo HealthKit Mapper

Map Apple HealthKit data exports to VoKoo schemas for consumer/BYOD data synchronization.

## Features

- 🏃 Map HealthKit workout data
- 💓 Map heart rate and vital signs
- ⚖️ Map body measurements (weight, height, BMI)
- 🩸 Map lab results from health apps
- 😴 Map sleep analysis data
- 🍎 Map nutrition data
- 📊 Full VoKoo schema compatibility
- 🔄 Batch processing support

## Installation

```bash
cd language/python
pip install -e .
```

## Quick Start

### 1. Export HealthKit Data

On iPhone:
1. Open Health app
2. Tap profile icon (top right)
3. Scroll down and tap "Export All Health Data"
4. Save the exported XML file

### 2. Map to VoKoo Schema

```python
from vokoo_healthkit_mapper import HealthKitMapper

# Initialize mapper
mapper = HealthKitMapper()

# Parse HealthKit export
mapper.load_export("export.xml")

# Map specific data types
lab_reports = mapper.map_lab_results(patient_id="patient-123")
workouts = mapper.map_workouts(patient_id="patient-123")
vital_signs = mapper.map_vital_signs(patient_id="patient-123")

print(f"Mapped {len(lab_reports)} lab reports")
print(f"Mapped {len(workouts)} workouts")
```

### 3. Supported Data Types

```python
from vokoo_healthkit_mapper import HealthKitDataType

# Check supported types
print(HealthKitDataType.HEART_RATE)
print(HealthKitDataType.BODY_MASS)
print(HealthKitDataType.BLOOD_GLUCOSE)
```

## API Reference

### HealthKitMapper

```python
class HealthKitMapper:
    def load_export(self, xml_path: str) -> None:
        """Load HealthKit XML export."""

    def map_lab_results(self, patient_id: str) -> List[LabReport]:
        """Map lab results to VoKoo LabReport."""

    def map_workouts(self, patient_id: str) -> List[Dict]:
        """Map workout sessions."""

    def map_vital_signs(self, patient_id: str) -> Dict[str, List]:
        """Map vital signs (heart rate, blood pressure, etc.)."""

    def map_body_measurements(self, patient_id: str) -> List[Dict]:
        """Map body measurements."""
```

## Mapping Examples

### Heart Rate

```python
# HealthKit: HKQuantityTypeIdentifierHeartRate
# VoKoo: Quantity with UCUM unit
mapper = HealthKitMapper()
mapper.load_export("export.xml")

heart_rates = mapper.map_vital_signs("patient-123")["heart_rate"]
for hr in heart_rates:
    print(f"{hr['timestamp']}: {hr['value']['value']} {hr['value']['unit']}")
```

### Body Weight

```python
# HealthKit: HKQuantityTypeIdentifierBodyMass
# VoKoo: Body measurement
measurements = mapper.map_body_measurements("patient-123")
for m in measurements:
    if m["type"] == "body_mass":
        print(f"Weight: {m['value']['value']} {m['value']['unit']}")
```

### Blood Glucose

```python
# HealthKit: HKQuantityTypeIdentifierBloodGlucose
# VoKoo: LabResult
lab_results = mapper.map_lab_results("patient-123")
for result in lab_results:
    for test in result.results:
        if "glucose" in test.code.text.lower():
            print(f"Glucose: {test.value.value} {test.value.unit}")
```

## Supported HealthKit Types

### Vital Signs
- ✅ Heart Rate (bpm)
- ✅ Blood Pressure (systolic/diastolic)
- ✅ Respiratory Rate (breaths/min)
- ✅ Body Temperature (°C/°F)
- ✅ Oxygen Saturation (%)

### Body Measurements
- ✅ Height (cm/m)
- ✅ Body Mass (kg/lb)
- ✅ BMI
- ✅ Body Fat Percentage (%)
- ✅ Lean Body Mass (kg)

### Lab Results
- ✅ Blood Glucose (mg/dL, mmol/L)
- ✅ HbA1c (%)
- ✅ Cholesterol (mg/dL)
- ✅ Blood Alcohol Content (%)

### Activity
- ✅ Step Count
- ✅ Distance Walking/Running (m, km)
- ✅ Active Energy Burned (kcal)
- ✅ Exercise Minutes

### Sleep
- ✅ Sleep Analysis (in bed, asleep, awake)

## Unit Conversion

The mapper automatically handles unit conversions:

```python
# HealthKit uses various units
# Weight: lb, kg
# Height: ft, in, cm, m
# Glucose: mg/dL, mmol/L

# VoKoo uses UCUM standard units
# Automatic conversion is applied
```

## Batch Processing

```python
from pathlib import Path

mapper = HealthKitMapper()
exports_dir = Path("healthkit_exports")

for xml_file in exports_dir.glob("*.xml"):
    print(f"Processing {xml_file.name}...")
    mapper.load_export(xml_file)

    patient_id = xml_file.stem  # Use filename as patient ID

    # Map all data types
    lab_reports = mapper.map_lab_results(patient_id)
    workouts = mapper.map_workouts(patient_id)
    vitals = mapper.map_vital_signs(patient_id)

    # Save to database or files
    save_data(patient_id, lab_reports, workouts, vitals)
```

## Data Quality

The mapper includes data quality checks:

- Validates date ranges
- Filters out invalid values
- Checks unit consistency
- Handles missing data gracefully

## Privacy & Security

⚠️ **Important**: HealthKit exports contain sensitive personal health information.

- Always encrypt data at rest and in transit
- Follow HIPAA/GDPR guidelines
- Obtain proper user consent
- Implement access controls

## Dependencies

- `vokoo` - VoKoo health data schemas
- `python-dateutil` - Date parsing

## License

MIT License

## Links

- [VoKoo Platform](https://github.com/saridsa2/vokoo)
- [Apple HealthKit Documentation](https://developer.apple.com/documentation/healthkit)
- [UCUM Units](https://ucum.org/)

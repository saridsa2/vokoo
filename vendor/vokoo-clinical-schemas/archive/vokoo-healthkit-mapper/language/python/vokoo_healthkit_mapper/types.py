"""
HealthKit data type definitions.
"""

from enum import Enum


class HealthKitDataType(str, Enum):
    """HealthKit data type identifiers."""

    # Vital Signs
    HEART_RATE = "HKQuantityTypeIdentifierHeartRate"
    BLOOD_PRESSURE_SYSTOLIC = "HKQuantityTypeIdentifierBloodPressureSystolic"
    BLOOD_PRESSURE_DIASTOLIC = "HKQuantityTypeIdentifierBloodPressureDiastolic"
    RESPIRATORY_RATE = "HKQuantityTypeIdentifierRespiratoryRate"
    BODY_TEMPERATURE = "HKQuantityTypeIdentifierBodyTemperature"
    OXYGEN_SATURATION = "HKQuantityTypeIdentifierOxygenSaturation"

    # Body Measurements
    HEIGHT = "HKQuantityTypeIdentifierHeight"
    BODY_MASS = "HKQuantityTypeIdentifierBodyMass"
    BODY_MASS_INDEX = "HKQuantityTypeIdentifierBodyMassIndex"
    BODY_FAT_PERCENTAGE = "HKQuantityTypeIdentifierBodyFatPercentage"
    LEAN_BODY_MASS = "HKQuantityTypeIdentifierLeanBodyMass"

    # Lab Results
    BLOOD_GLUCOSE = "HKQuantityTypeIdentifierBloodGlucose"
    HBA1C = "HKQuantityTypeIdentifierHbA1c"
    BLOOD_ALCOHOL_CONTENT = "HKQuantityTypeIdentifierBloodAlcoholContent"

    # Activity
    STEP_COUNT = "HKQuantityTypeIdentifierStepCount"
    DISTANCE_WALKING_RUNNING = "HKQuantityTypeIdentifierDistanceWalkingRunning"
    ACTIVE_ENERGY_BURNED = "HKQuantityTypeIdentifierActiveEnergyBurned"
    EXERCISE_TIME = "HKQuantityTypeIdentifierAppleExerciseTime"

    # Sleep
    SLEEP_ANALYSIS = "HKCategoryTypeIdentifierSleepAnalysis"

    # Workouts
    WORKOUT = "HKWorkoutTypeIdentifier"


# Unit mapping: HealthKit unit -> UCUM unit
UNIT_MAPPING = {
    # Weight/Mass
    "lb": "lb_av",
    "kg": "kg",
    "g": "g",

    # Length/Height
    "ft": "[ft_i]",
    "in": "[in_i]",
    "mi": "[mi_i]",
    "cm": "cm",
    "m": "m",
    "km": "km",

    # Temperature
    "degF": "[degF]",
    "degC": "Cel",

    # Blood Glucose
    "mg/dL": "mg/dL",
    "mmol/L": "mmol/L",

    # Heart Rate
    "count/min": "/min",
    "bpm": "/min",

    # Energy
    "kcal": "kcal",
    "kJ": "kJ",
    "Cal": "kcal",

    # Percentage
    "%": "%",

    # Blood Pressure
    "mmHg": "mm[Hg]",
}


# LOINC code mapping for common lab tests
LOINC_MAPPING = {
    HealthKitDataType.BLOOD_GLUCOSE: {
        "code": "2339-0",
        "display": "Glucose [Mass/volume] in Blood"
    },
    HealthKitDataType.HBA1C: {
        "code": "4548-4",
        "display": "Hemoglobin A1c/Hemoglobin.total in Blood"
    },
    HealthKitDataType.HEART_RATE: {
        "code": "8867-4",
        "display": "Heart rate"
    },
    HealthKitDataType.BLOOD_PRESSURE_SYSTOLIC: {
        "code": "8480-6",
        "display": "Systolic blood pressure"
    },
    HealthKitDataType.BLOOD_PRESSURE_DIASTOLIC: {
        "code": "8462-4",
        "display": "Diastolic blood pressure"
    },
    HealthKitDataType.OXYGEN_SATURATION: {
        "code": "2708-6",
        "display": "Oxygen saturation in Arterial blood"
    },
    HealthKitDataType.RESPIRATORY_RATE: {
        "code": "9279-1",
        "display": "Respiratory rate"
    },
    HealthKitDataType.BODY_TEMPERATURE: {
        "code": "8310-5",
        "display": "Body temperature"
    },
}

"""
HealthKit to VoKoo mapper.
"""

import xml.etree.ElementTree as ET
from typing import List, Dict, Any, Optional
from datetime import datetime
from pathlib import Path
from dateutil import parser as date_parser

from vokoo_clinical_schemas.lab_report import LabReport, LabResult, Facility
from vokoo_clinical_schemas.common import CodeableConcept, Coding, Quantity, ReferenceRange

from .types import HealthKitDataType, UNIT_MAPPING, LOINC_MAPPING


class HealthKitMapper:
    """
    Map Apple HealthKit data exports to VoKoo schemas.

    This mapper parses HealthKit XML exports and converts them to
    VoKoo-compatible data structures for integration into health
    data platforms.

    Example:
        >>> mapper = HealthKitMapper()
        >>> mapper.load_export("export.xml")
        >>> lab_reports = mapper.map_lab_results("patient-123")
    """

    def __init__(self):
        """Initialize the HealthKit mapper."""
        self.records: List[Dict[str, Any]] = []
        self.workouts: List[Dict[str, Any]] = []
        self.export_date: Optional[datetime] = None

    def load_export(self, xml_path: str) -> None:
        """
        Load HealthKit XML export file.

        Args:
            xml_path: Path to the HealthKit export.xml file

        Raises:
            FileNotFoundError: If XML file doesn't exist
            ET.ParseError: If XML is invalid
        """
        path = Path(xml_path)
        if not path.exists():
            raise FileNotFoundError(f"Export file not found: {xml_path}")

        tree = ET.parse(xml_path)
        root = tree.getroot()

        # Parse export date
        export_date_str = root.attrib.get("exportDate")
        if export_date_str:
            self.export_date = date_parser.parse(export_date_str)

        # Parse records
        self.records = []
        for record in root.findall(".//Record"):
            self.records.append(self._parse_record(record))

        # Parse workouts
        self.workouts = []
        for workout in root.findall(".//Workout"):
            self.workouts.append(self._parse_workout(workout))

    def _parse_record(self, record: ET.Element) -> Dict[str, Any]:
        """Parse a Record element."""
        return {
            "type": record.attrib.get("type"),
            "sourceName": record.attrib.get("sourceName"),
            "sourceVersion": record.attrib.get("sourceVersion"),
            "unit": record.attrib.get("unit"),
            "creationDate": date_parser.parse(record.attrib.get("creationDate"))
            if record.attrib.get("creationDate") else None,
            "startDate": date_parser.parse(record.attrib.get("startDate"))
            if record.attrib.get("startDate") else None,
            "endDate": date_parser.parse(record.attrib.get("endDate"))
            if record.attrib.get("endDate") else None,
            "value": record.attrib.get("value"),
        }

    def _parse_workout(self, workout: ET.Element) -> Dict[str, Any]:
        """Parse a Workout element."""
        return {
            "workoutActivityType": workout.attrib.get("workoutActivityType"),
            "duration": float(workout.attrib.get("duration", 0)),
            "durationUnit": workout.attrib.get("durationUnit"),
            "totalDistance": workout.attrib.get("totalDistance"),
            "totalDistanceUnit": workout.attrib.get("totalDistanceUnit"),
            "totalEnergyBurned": workout.attrib.get("totalEnergyBurned"),
            "totalEnergyBurnedUnit": workout.attrib.get("totalEnergyBurnedUnit"),
            "sourceName": workout.attrib.get("sourceName"),
            "creationDate": date_parser.parse(workout.attrib.get("creationDate"))
            if workout.attrib.get("creationDate") else None,
            "startDate": date_parser.parse(workout.attrib.get("startDate"))
            if workout.attrib.get("startDate") else None,
            "endDate": date_parser.parse(workout.attrib.get("endDate"))
            if workout.attrib.get("endDate") else None,
        }

    def _convert_unit(self, hk_unit: str) -> str:
        """Convert HealthKit unit to UCUM unit."""
        return UNIT_MAPPING.get(hk_unit, hk_unit)

    def map_lab_results(self, patient_id: str) -> List[LabReport]:
        """
        Map HealthKit lab results to VoKoo LabReport.

        Args:
            patient_id: Patient identifier

        Returns:
            List of LabReport objects
        """
        # Group records by date and type
        lab_types = [
            HealthKitDataType.BLOOD_GLUCOSE,
            HealthKitDataType.HBA1C,
            HealthKitDataType.BLOOD_ALCOHOL_CONTENT,
        ]

        lab_records = [
            r for r in self.records
            if r["type"] in [t.value for t in lab_types]
        ]

        if not lab_records:
            return []

        # Group by date (daily)
        grouped: Dict[str, List[Dict]] = {}
        for record in lab_records:
            date_key = record["startDate"].date().isoformat()
            if date_key not in grouped:
                grouped[date_key] = []
            grouped[date_key].append(record)

        # Create LabReport for each day
        reports = []
        for date_key, records in grouped.items():
            results = []
            for record in records:
                # Get LOINC code
                data_type = HealthKitDataType(record["type"])
                loinc_info = LOINC_MAPPING.get(data_type, {})

                # Create CodeableConcept
                codings = []
                if loinc_info:
                    codings.append(Coding(
                        system="http://loinc.org",
                        code=loinc_info.get("code", ""),
                        display=loinc_info.get("display", "")
                    ))

                code = CodeableConcept(
                    coding=codings,
                    text=data_type.value
                )

                # Create Quantity value
                value = Quantity(
                    value=float(record["value"]),
                    unit=self._convert_unit(record["unit"])
                )

                # Create LabResult
                result = LabResult(
                    code=code,
                    value=value,
                    referenceRange=None,  # HealthKit doesn't provide reference ranges
                    interpretation=None
                )
                results.append(result)

            # Create LabReport
            report = LabReport(
                id=f"hk-{date_key}",
                patientId=patient_id,
                issuedAt=records[0]["startDate"],
                results=results,
                facility=Facility(
                    name="Apple HealthKit",
                    id="healthkit"
                )
            )
            reports.append(report)

        return reports

    def map_vital_signs(self, patient_id: str) -> Dict[str, List[Dict]]:
        """
        Map vital signs data.

        Args:
            patient_id: Patient identifier

        Returns:
            Dictionary with vital sign type as key and list of measurements
        """
        vital_types = [
            HealthKitDataType.HEART_RATE,
            HealthKitDataType.BLOOD_PRESSURE_SYSTOLIC,
            HealthKitDataType.BLOOD_PRESSURE_DIASTOLIC,
            HealthKitDataType.RESPIRATORY_RATE,
            HealthKitDataType.BODY_TEMPERATURE,
            HealthKitDataType.OXYGEN_SATURATION,
        ]

        vital_records = [
            r for r in self.records
            if r["type"] in [t.value for t in vital_types]
        ]

        # Group by type
        grouped: Dict[str, List[Dict]] = {}
        for record in vital_records:
            data_type = record["type"]
            if data_type not in grouped:
                grouped[data_type] = []

            grouped[data_type].append({
                "timestamp": record["startDate"],
                "value": {
                    "value": float(record["value"]),
                    "unit": self._convert_unit(record["unit"])
                },
                "source": record["sourceName"]
            })

        return grouped

    def map_body_measurements(self, patient_id: str) -> List[Dict]:
        """
        Map body measurement data.

        Args:
            patient_id: Patient identifier

        Returns:
            List of body measurements
        """
        measurement_types = [
            HealthKitDataType.HEIGHT,
            HealthKitDataType.BODY_MASS,
            HealthKitDataType.BODY_MASS_INDEX,
            HealthKitDataType.BODY_FAT_PERCENTAGE,
            HealthKitDataType.LEAN_BODY_MASS,
        ]

        measurement_records = [
            r for r in self.records
            if r["type"] in [t.value for t in measurement_types]
        ]

        measurements = []
        for record in measurement_records:
            measurements.append({
                "type": record["type"],
                "timestamp": record["startDate"],
                "value": {
                    "value": float(record["value"]),
                    "unit": self._convert_unit(record["unit"])
                },
                "source": record["sourceName"]
            })

        return measurements

    def map_workouts(self, patient_id: str) -> List[Dict]:
        """
        Map workout/activity data.

        Args:
            patient_id: Patient identifier

        Returns:
            List of workout sessions
        """
        workouts = []
        for workout in self.workouts:
            workout_data = {
                "type": workout["workoutActivityType"],
                "start_time": workout["startDate"],
                "end_time": workout["endDate"],
                "duration": {
                    "value": workout["duration"],
                    "unit": workout["durationUnit"]
                },
                "source": workout["sourceName"]
            }

            if workout.get("totalDistance"):
                workout_data["distance"] = {
                    "value": float(workout["totalDistance"]),
                    "unit": self._convert_unit(workout["totalDistanceUnit"])
                }

            if workout.get("totalEnergyBurned"):
                workout_data["calories"] = {
                    "value": float(workout["totalEnergyBurned"]),
                    "unit": self._convert_unit(workout["totalEnergyBurnedUnit"])
                }

            workouts.append(workout_data)

        return workouts

    def get_data_summary(self) -> Dict[str, Any]:
        """
        Get summary statistics of loaded data.

        Returns:
            Dictionary with counts and date ranges
        """
        if not self.records:
            return {"error": "No data loaded"}

        # Count by type
        type_counts: Dict[str, int] = {}
        for record in self.records:
            data_type = record["type"]
            type_counts[data_type] = type_counts.get(data_type, 0) + 1

        # Date range
        dates = [r["startDate"] for r in self.records if r["startDate"]]
        min_date = min(dates) if dates else None
        max_date = max(dates) if dates else None

        return {
            "total_records": len(self.records),
            "total_workouts": len(self.workouts),
            "export_date": self.export_date,
            "date_range": {
                "start": min_date,
                "end": max_date
            },
            "data_types": type_counts,
            "sources": list(set(r["sourceName"] for r in self.records if r["sourceName"]))
        }

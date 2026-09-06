"""
Medical timeline builder implementation.
"""

from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Literal
from collections import defaultdict
from dataclasses import dataclass, field

from vokoo_clinical_schemas.lab import LabReport
from vokoo_clinical_schemas.common import CodeableConcept


@dataclass
class TimelineEvent:
    """
    A single event in the medical timeline.

    Attributes:
        date: Event date
        event_type: Type of event (lab, vital, medication, procedure, etc.)
        category: Category for grouping
        title: Short description
        details: Detailed information
        source: Data source
        metadata: Additional key-value data
    """
    date: datetime
    event_type: str
    category: str
    title: str
    details: Optional[str] = None
    source: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "date": self.date.isoformat(),
            "event_type": self.event_type,
            "category": self.category,
            "title": self.title,
            "details": self.details,
            "source": self.source,
            "metadata": self.metadata
        }


class MedicalTimeline:
    """
    Build and manage medical event timelines.

    Aggregates health data from multiple sources into a chronological
    timeline with categorization and filtering capabilities.

    Example:
        >>> timeline = MedicalTimeline()
        >>> timeline.add_lab_report(lab_report)
        >>> events = timeline.get_events(start_date="2024-01-01")
    """

    def __init__(self):
        """Initialize empty timeline."""
        self.events: List[TimelineEvent] = []
        self._category_index: Dict[str, List[TimelineEvent]] = defaultdict(list)
        self._type_index: Dict[str, List[TimelineEvent]] = defaultdict(list)

    def add_event(
        self,
        date: datetime | str,
        event_type: str,
        category: str,
        title: str,
        details: Optional[str] = None,
        source: Optional[str] = None,
        **metadata
    ) -> TimelineEvent:
        """
        Add a custom event to the timeline.

        Args:
            date: Event date (datetime or ISO string)
            event_type: Event type
            category: Category for grouping
            title: Event title
            details: Detailed description
            source: Data source
            **metadata: Additional key-value data

        Returns:
            Created TimelineEvent
        """
        # Parse date if string
        if isinstance(date, str):
            date = datetime.fromisoformat(date.replace('Z', '+00:00'))

        event = TimelineEvent(
            date=date,
            event_type=event_type,
            category=category,
            title=title,
            details=details,
            source=source,
            metadata=metadata
        )

        self.events.append(event)
        self._category_index[category].append(event)
        self._type_index[event_type].append(event)

        return event

    def add_lab_report(self, report: LabReport) -> List[TimelineEvent]:
        """
        Add lab report to timeline.

        Args:
            report: VoKoo LabReport

        Returns:
            List of created events (one per test)
        """
        created_events = []

        report_date = datetime.fromisoformat(
            report.effective_date_time.replace('Z', '+00:00')
        )

        for result in report.results:
            # Get test name
            test_name = result.code.display or result.code.coding[0].display

            # Get value
            value_str = f"{result.value.value} {result.value.unit}"

            # Check if abnormal
            is_abnormal = False
            if result.interpretation:
                is_abnormal = any(
                    interp.coding[0].code in ["H", "L", "A"]
                    for interp in result.interpretation
                )

            title = f"{test_name}: {value_str}"
            if is_abnormal:
                title += " ⚠️"

            event = self.add_event(
                date=report_date,
                event_type="laboratory",
                category="Lab Tests",
                title=title,
                details=f"Reference range: {result.reference_range or 'N/A'}",
                source="Lab Report",
                test_name=test_name,
                value=result.value.value,
                unit=result.value.unit,
                abnormal=is_abnormal
            )

            created_events.append(event)

        return created_events

    def add_vital_signs(
        self,
        date: datetime | str,
        vitals: Dict[str, tuple[float, str]]
    ) -> List[TimelineEvent]:
        """
        Add vital signs measurement.

        Args:
            date: Measurement date
            vitals: Dict of {vital_name: (value, unit)}

        Returns:
            Created events
        """
        if isinstance(date, str):
            date = datetime.fromisoformat(date.replace('Z', '+00:00'))

        created_events = []

        for vital_name, (value, unit) in vitals.items():
            event = self.add_event(
                date=date,
                event_type="vital_sign",
                category="Vital Signs",
                title=f"{vital_name}: {value} {unit}",
                source="Vital Signs Monitor",
                vital_name=vital_name,
                value=value,
                unit=unit
            )
            created_events.append(event)

        return created_events

    def add_medication(
        self,
        date: datetime | str,
        medication_name: str,
        dosage: str,
        action: Literal["started", "stopped", "changed"]
    ) -> TimelineEvent:
        """
        Add medication event.

        Args:
            date: Event date
            medication_name: Name of medication
            dosage: Dosage information
            action: Action taken

        Returns:
            Created event
        """
        return self.add_event(
            date=date,
            event_type="medication",
            category="Medications",
            title=f"{action.title()} {medication_name}",
            details=f"Dosage: {dosage}",
            source="Medication Record",
            medication_name=medication_name,
            dosage=dosage,
            action=action
        )

    def get_events(
        self,
        start_date: Optional[datetime | str] = None,
        end_date: Optional[datetime | str] = None,
        category: Optional[str] = None,
        event_type: Optional[str] = None,
        sort_reverse: bool = True
    ) -> List[TimelineEvent]:
        """
        Get filtered and sorted events.

        Args:
            start_date: Start date filter (inclusive)
            end_date: End date filter (inclusive)
            category: Filter by category
            event_type: Filter by event type
            sort_reverse: Sort newest first (True) or oldest first (False)

        Returns:
            Filtered and sorted events
        """
        # Parse date strings
        if isinstance(start_date, str):
            start_date = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
        if isinstance(end_date, str):
            end_date = datetime.fromisoformat(end_date.replace('Z', '+00:00'))

        # Start with all events or filtered by category/type
        if category:
            filtered = self._category_index.get(category, [])
        elif event_type:
            filtered = self._type_index.get(event_type, [])
        else:
            filtered = self.events.copy()

        # Apply date filters
        if start_date:
            filtered = [e for e in filtered if e.date >= start_date]
        if end_date:
            filtered = [e for e in filtered if e.date <= end_date]

        # Sort by date
        filtered.sort(key=lambda e: e.date, reverse=sort_reverse)

        return filtered

    def get_categories(self) -> List[str]:
        """Get all categories in timeline."""
        return sorted(self._category_index.keys())

    def get_event_types(self) -> List[str]:
        """Get all event types in timeline."""
        return sorted(self._type_index.keys())

    def get_date_range(self) -> tuple[Optional[datetime], Optional[datetime]]:
        """
        Get date range of timeline.

        Returns:
            (earliest_date, latest_date) or (None, None) if empty
        """
        if not self.events:
            return None, None

        dates = [e.date for e in self.events]
        return min(dates), max(dates)

    def group_by_period(
        self,
        period: Literal["day", "week", "month", "year"]
    ) -> Dict[str, List[TimelineEvent]]:
        """
        Group events by time period.

        Args:
            period: Time period to group by

        Returns:
            Dict mapping period key to events
        """
        groups = defaultdict(list)

        for event in self.events:
            if period == "day":
                key = event.date.strftime("%Y-%m-%d")
            elif period == "week":
                # ISO week
                key = event.date.strftime("%Y-W%U")
            elif period == "month":
                key = event.date.strftime("%Y-%m")
            elif period == "year":
                key = event.date.strftime("%Y")
            else:
                raise ValueError(f"Invalid period: {period}")

            groups[key].append(event)

        return dict(groups)

    def to_dict(self) -> Dict[str, Any]:
        """
        Export timeline to dictionary.

        Returns:
            Timeline data as dict
        """
        earliest, latest = self.get_date_range()

        return {
            "event_count": len(self.events),
            "date_range": {
                "start": earliest.isoformat() if earliest else None,
                "end": latest.isoformat() if latest else None
            },
            "categories": self.get_categories(),
            "event_types": self.get_event_types(),
            "events": [e.to_dict() for e in sorted(self.events, key=lambda x: x.date)]
        }

    def export_to_json(self, filepath: str):
        """Export timeline to JSON file."""
        import json
        with open(filepath, 'w') as f:
            json.dump(self.to_dict(), f, indent=2)

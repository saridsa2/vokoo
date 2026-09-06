"""
Example usage of VoKoo Health Audit Log.
"""

from datetime import datetime, timedelta
from vokoo_health_audit_log import HealthAuditLog


def example_basic_logging():
    """Basic audit logging."""
    print("=== Basic Audit Logging ===\n")

    audit = HealthAuditLog()

    # Log some access events
    audit.log_access("dr_smith", "view", "LabReport", "LAB-12345")
    audit.log_access("nurse_jones", "view", "LabReport", "LAB-12345")
    audit.log_access("dr_smith", "download", "ImagingStudy", "IMG-789")

    print(f"Logged {len(audit.entries)} events")
    print("\nRecent activity:")
    for entry in audit.entries[-3:]:
        print(f"  {entry.actor} {entry.action} {entry.resource_type}/{entry.resource_id}")

    print()


def example_modifications():
    """Log data modifications."""
    print("=== Modification Logging ===\n")

    audit = HealthAuditLog()

    # Log modifications
    audit.log_modification(
        "dr_smith",
        "update",
        "Medication",
        "MED-456",
        changes={"dosage": {"old": "10mg", "new": "20mg"}}
    )

    audit.log_modification(
        "admin_user",
        "delete",
        "Appointment",
        "APPT-789",
        changes={"reason": "Patient cancelled"}
    )

    print(f"Logged {len(audit.entries)} modification events")
    print()


def example_integrity_verification():
    """Verify audit log integrity."""
    print("=== Integrity Verification ===\n")

    audit = HealthAuditLog()

    # Add some entries
    audit.log_access("dr_smith", "view", "LabReport", "LAB-001")
    audit.log_access("dr_smith", "view", "LabReport", "LAB-002")
    audit.log_access("dr_smith", "view", "LabReport", "LAB-003")

    # Verify integrity
    result = audit.verify_integrity()

    print(f"Integrity check: {'✓ VALID' if result['valid'] else '✗ INVALID'}")
    print(f"Message: {result['message']}")
    print()

    # Demonstrate tampering detection
    print("Simulating tampering...")
    if audit.entries:
        audit.entries[1].details["tampered"] = True

    result = audit.verify_integrity()
    print(f"After tampering: {'✓ VALID' if result['valid'] else '✗ INVALID'}")
    print(f"Message: {result['message']}")
    print()


def example_query_trail():
    """Query audit trail."""
    print("=== Query Audit Trail ===\n")

    audit = HealthAuditLog()

    # Add diverse entries
    audit.log_access("dr_smith", "view", "LabReport", "LAB-001")
    audit.log_access("dr_jones", "view", "LabReport", "LAB-002")
    audit.log_access("dr_smith", "download", "ImagingStudy", "IMG-001")
    audit.log_modification("dr_smith", "update", "Medication", "MED-001")

    # Query by actor
    smith_activity = audit.query_trail(actor="dr_smith")
    print(f"Dr. Smith's activity: {len(smith_activity)} events")
    for entry in smith_activity:
        print(f"  {entry.action} {entry.resource_type}/{entry.resource_id}")

    print()

    # Query by resource
    lab_access = audit.query_trail(resource_type="LabReport")
    print(f"LabReport accesses: {len(lab_access)} events")

    print()


def example_resource_history():
    """Get complete history for a resource."""
    print("=== Resource History ===\n")

    audit = HealthAuditLog()

    # Multiple actions on same resource
    audit.log_access("dr_smith", "view", "Patient", "P12345")
    audit.log_modification("dr_smith", "update", "Patient", "P12345",
                          changes={"address": "updated"})
    audit.log_access("nurse_jones", "view", "Patient", "P12345")
    audit.log_modification("dr_jones", "update", "Patient", "P12345",
                          changes={"phone": "updated"})

    # Get history
    history = audit.get_resource_history("Patient", "P12345")

    print(f"Patient/P12345 history ({len(history)} events):\n")
    for entry in history:
        timestamp = entry.timestamp.strftime("%Y-%m-%d %H:%M:%S")
        print(f"  [{timestamp}] {entry.actor} {entry.action}")
        if entry.details:
            print(f"      {entry.details}")

    print()


def example_consent_tracking():
    """Track consent changes."""
    print("=== Consent Change Tracking ===\n")

    audit = HealthAuditLog()

    # Log consent lifecycle
    audit.log_consent_change("patient_p12345", "CONSENT-001", "granted")
    audit.log_consent_change("patient_p12345", "CONSENT-001", "modified",
                            reason="Updated authorized parties")
    audit.log_consent_change("patient_p12345", "CONSENT-001", "revoked",
                            reason="Patient request")

    # Query consent history
    consent_history = audit.query_trail(resource_type="Consent", resource_id="CONSENT-001")

    print(f"Consent lifecycle ({len(consent_history)} events):\n")
    for entry in consent_history:
        print(f"  {entry.timestamp.strftime('%Y-%m-%d')}: {entry.action}")
        if "reason" in entry.details:
            print(f"    Reason: {entry.details['reason']}")

    print()


def example_actor_activity():
    """Get all activity by an actor."""
    print("=== Actor Activity Report ===\n")

    audit = HealthAuditLog()

    # Simulate a day's activity
    activities = [
        ("view", "Patient", "P001"),
        ("view", "LabReport", "LAB-001"),
        ("view", "Medication", "MED-001"),
        ("update", "Medication", "MED-001"),
        ("view", "Patient", "P002"),
        ("download", "ImagingStudy", "IMG-001"),
    ]

    for action, resource_type, resource_id in activities:
        if action == "update":
            audit.log_modification("dr_smith", action, resource_type, resource_id)
        else:
            audit.log_access("dr_smith", action, resource_type, resource_id)

    # Get activity report
    activity = audit.get_actor_activity("dr_smith")

    print(f"Dr. Smith's activity today: {len(activity)} actions\n")

    # Summarize
    by_action = {}
    for entry in activity:
        by_action[entry.action] = by_action.get(entry.action, 0) + 1

    print("Summary:")
    for action, count in sorted(by_action.items()):
        print(f"  {action}: {count}")

    print()


if __name__ == "__main__":
    print("VoKoo Health Audit Log - Examples\n")
    print("=" * 60)
    print()

    try:
        example_basic_logging()
        example_modifications()
        example_integrity_verification()
        example_query_trail()
        example_resource_history()
        example_consent_tracking()
        example_actor_activity()

        print("=" * 60)
        print("\n✨ All examples completed!")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()

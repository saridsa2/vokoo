"""
Example usage of WellAlly Consent Model.
"""

from datetime import datetime, timedelta
from wellally_consent_model import ConsentModel, ConsentScope, ConsentStatus


def example_grant_consent():
    """Grant patient consent."""
    print("=== Grant Consent ===\n")

    manager = ConsentModel()

    consent_id = manager.grant_consent(
        patient_id="P12345",
        scope=ConsentScope.DATA_SHARING,
        data_categories=["lab_results", "medications", "vitals"],
        purposes=["treatment", "research"],
        authorized_parties=["dr_smith", "research_team_a"],
        expiry_date=datetime.now() + timedelta(days=365)
    )

    print(f"✓ Consent granted: {consent_id}")
    print()


def example_verify_consent():
    """Verify if consent exists."""
    print("=== Verify Consent ===\n")

    manager = ConsentModel()

    # Grant consent first
    manager.grant_consent(
        patient_id="P12345",
        scope=ConsentScope.DATA_SHARING,
        data_categories=["lab_results"],
        purposes=["treatment"]
    )

    # Verify
    has_consent = manager.verify_consent(
        patient_id="P12345",
        scope=ConsentScope.DATA_SHARING,
        data_category="lab_results",
        purpose="treatment"
    )

    print(f"Has valid consent: {has_consent}")

    # Try without consent
    has_consent = manager.verify_consent(
        patient_id="P12345",
        scope=ConsentScope.RESEARCH
    )

    print(f"Has research consent: {has_consent}")
    print()


def example_revoke_consent():
    """Revoke patient consent."""
    print("=== Revoke Consent ===\n")

    manager = ConsentModel()

    # Grant
    consent_id = manager.grant_consent(
        patient_id="P12345",
        scope=ConsentScope.DATA_SHARING
    )

    print(f"Granted: {consent_id}")

    # Revoke
    success = manager.revoke_consent(consent_id, reason="Patient request")

    print(f"Revoked: {success}")

    # Verify it's revoked
    consent = manager.consents[consent_id]
    print(f"Status: {consent.status.value}")
    print()


def example_audit_trail():
    """View consent audit trail."""
    print("=== Consent Audit Trail ===\n")

    manager = ConsentModel()

    # Grant and revoke
    consent_id = manager.grant_consent(
        patient_id="P12345",
        scope=ConsentScope.RESEARCH
    )

    manager.revoke_consent(consent_id, reason="Study completed")

    # Get audit trail
    trail = manager.get_audit_trail(consent_id)

    print(f"Audit trail for {consent_id}:\n")
    for entry in trail:
        print(f"  {entry['timestamp'][:19]}: {entry['action']}")
        if 'reason' in entry:
            print(f"    Reason: {entry['reason']}")

    print()


def example_patient_consents():
    """Get all consents for a patient."""
    print("=== Patient Consents ===\n")

    manager = ConsentModel()

    # Grant multiple consents
    manager.grant_consent("P12345", ConsentScope.DATA_SHARING)
    manager.grant_consent("P12345", ConsentScope.RESEARCH)
    manager.grant_consent("P12345", ConsentScope.MARKETING)

    # Get all consents
    consents = manager.get_patient_consents("P12345")

    print(f"Patient P12345 has {len(consents)} consent(s):\n")
    for consent in consents:
        print(f"  {consent.consent_id}: {consent.scope.value} ({consent.status.value})")

    print()


def example_expiry():
    """Test consent expiry."""
    print("=== Consent Expiry ===\n")

    manager = ConsentModel()

    # Grant with near expiry
    consent_id = manager.grant_consent(
        patient_id="P12345",
        scope=ConsentScope.DATA_SHARING,
        expiry_date=datetime.now() - timedelta(days=1)  # Expired yesterday
    )

    # Try to verify - should fail due to expiry
    has_consent = manager.verify_consent("P12345", ConsentScope.DATA_SHARING)

    print(f"Has valid consent: {has_consent}")

    # Check status
    consent = manager.consents[consent_id]
    print(f"Consent status: {consent.status.value}")
    print()


if __name__ == "__main__":
    print("WellAlly Consent Model - Examples\n")
    print("=" * 60)
    print()

    try:
        example_grant_consent()
        example_verify_consent()
        example_revoke_consent()
        example_audit_trail()
        example_patient_consents()
        example_expiry()

        print("=" * 60)
        print("\n✨ All examples completed!")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()

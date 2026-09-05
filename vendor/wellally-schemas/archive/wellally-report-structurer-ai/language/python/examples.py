"""
Example usage of WellAlly Report Structurer AI.
"""

import os
from wellally_report_structurer_ai import ReportStructurerAI


def example_basic_structuring():
    """Extract structured data from report."""
    print("=== Basic Report Structuring ===\n")

    structurer = ReportStructurerAI(api_key=os.getenv("ZHIPUAI_API_KEY"))

    report_text = """
    Patient presents with type 2 diabetes. Currently taking Metformin 1000mg twice daily
    and Lisinopril 10mg once daily for hypertension. Recent HbA1c was 7.2%, fasting glucose 120 mg/dL.
    Patient reports improved energy and no hypoglycemic episodes. Continue current medications
    and recheck HbA1c in 3 months.
    """

    if not os.getenv("ZHIPUAI_API_KEY"):
        print("⚠️  ZHIPUAI_API_KEY not set - showing demo structure\n")
        structured = {
            "medications": [
                {"name": "Metformin", "dosage": "1000mg", "frequency": "twice daily"},
                {"name": "Lisinopril", "dosage": "10mg", "frequency": "once daily"}
            ],
            "conditions": [
                {"name": "Type 2 Diabetes", "status": "active"},
                {"name": "Hypertension", "status": "active"}
            ],
            "lab_results": [
                {"test": "HbA1c", "value": "7.2", "unit": "%"},
                {"test": "Fasting Glucose", "value": "120", "unit": "mg/dL"}
            ],
            "recommendations": [
                "Continue current medications",
                "Recheck HbA1c in 3 months"
            ]
        }
    else:
        structured = structurer.structure_report(report_text)

    print("Extracted Information:\n")
    print(f"Medications: {len(structured.get('medications', []))}")
    for med in structured.get('medications', []):
        print(f"  - {med.get('name')} {med.get('dosage')} {med.get('frequency')}")

    print(f"\nConditions: {len(structured.get('conditions', []))}")
    for cond in structured.get('conditions', []):
        print(f"  - {cond.get('name')} ({cond.get('status')})")

    print(f"\nLab Results: {len(structured.get('lab_results', []))}")
    for lab in structured.get('lab_results', []):
        print(f"  - {lab.get('test')}: {lab.get('value')} {lab.get('unit')}")

    print()


def example_extract_medications():
    """Extract only medications."""
    print("=== Medication Extraction ===\n")

    structurer = ReportStructurerAI(api_key=os.getenv("ZHIPUAI_API_KEY"))

    text = """
    Current medications:
    1. Metformin 500mg twice daily
    2. Atorvastatin 20mg at bedtime
    3. Aspirin 81mg once daily
    """

    if not os.getenv("ZHIPUAI_API_KEY"):
        print("⚠️  Demo mode\n")
        medications = [
            {"name": "Metformin", "dosage": "500mg", "frequency": "twice daily"},
            {"name": "Atorvastatin", "dosage": "20mg", "frequency": "at bedtime"},
            {"name": "Aspirin", "dosage": "81mg", "frequency": "once daily"}
        ]
    else:
        medications = structurer.extract_medications(text)

    print(f"Found {len(medications)} medications:\n")
    for med in medications:
        print(f"  {med['name']}: {med['dosage']} {med['frequency']}")

    print()


def example_extract_timeline():
    """Extract temporal events."""
    print("=== Timeline Extraction ===\n")

    structurer = ReportStructurerAI(api_key=os.getenv("ZHIPUAI_API_KEY"))

    text = """
    2024-01-15: Initial diagnosis of hypertension, started Lisinopril
    2024-03-20: Follow-up visit, BP improved to 125/80
    2024-06-10: Added Metformin for newly diagnosed diabetes
    2024-09-05: HbA1c decreased to 6.8%
    """

    if not os.getenv("ZHIPUAI_API_KEY"):
        print("⚠️  Demo mode\n")
        events = [
            {"date": "2024-01-15", "event": "Initial diagnosis of hypertension, started Lisinopril"},
            {"date": "2024-03-20", "event": "Follow-up visit, BP improved to 125/80"},
            {"date": "2024-06-10", "event": "Added Metformin for newly diagnosed diabetes"},
            {"date": "2024-09-05", "event": "HbA1c decreased to 6.8%"}
        ]
    else:
        events = structurer.extract_timeline(text)

    print(f"Found {len(events)} timeline events:\n")
    for event in events:
        print(f"  {event.get('date')}: {event.get('event')}")

    print()


def example_identify_relationships():
    """Identify entity relationships."""
    print("=== Relationship Identification ===\n")

    structurer = ReportStructurerAI(api_key=os.getenv("ZHIPUAI_API_KEY"))

    text = """
    Metformin is prescribed to treat type 2 diabetes. HbA1c test is used to
    monitor diabetes control. The patient's fatigue is caused by poorly
    controlled diabetes.
    """

    if not os.getenv("ZHIPUAI_API_KEY"):
        print("⚠️  Demo mode\n")
        relationships = [
            {"entity1": "Metformin", "relationship": "treats", "entity2": "Type 2 Diabetes"},
            {"entity1": "HbA1c test", "relationship": "monitors", "entity2": "Diabetes"},
            {"entity1": "Poorly controlled diabetes", "relationship": "causes", "entity2": "Fatigue"}
        ]
    else:
        relationships = structurer.identify_relationships(text)

    print(f"Found {len(relationships)} relationships:\n")
    for rel in relationships:
        print(f"  {rel.get('entity1')} → {rel.get('relationship')} → {rel.get('entity2')}")

    print()


def example_summarize():
    """Generate report summary."""
    print("=== Report Summarization ===\n")

    structurer = ReportStructurerAI(api_key=os.getenv("ZHIPUAI_API_KEY"))

    long_report = """
    65-year-old male with history of hypertension and type 2 diabetes presents for
    routine follow-up. Patient reports good medication compliance and no adverse effects.
    Home blood glucose monitoring shows fasting values 100-115 mg/dL. Blood pressure
    today is 128/78 mmHg. Recent labs show HbA1c 6.9%, LDL cholesterol 95 mg/dL,
    creatinine 1.1 mg/dL. Physical exam unremarkable. Current medications include
    Metformin 1000mg BID, Lisinopril 20mg daily, and Atorvastatin 40mg daily.
    Plan: Continue current regimen, repeat labs in 6 months, encourage continued
    lifestyle modifications including diet and exercise.
    """

    if not os.getenv("ZHIPUAI_API_KEY"):
        print("⚠️  Demo mode\n")
        summary = "65-year-old male with hypertension and diabetes shows good control on current medications (Metformin, Lisinopril, Atorvastatin) with HbA1c 6.9% and BP 128/78. Plan to continue current treatment and recheck in 6 months."
    else:
        summary = structurer.summarize_report(long_report, max_sentences=2)

    print("Original report length:", len(long_report), "characters")
    print("\nSummary:")
    print(f"  {summary}")

    print()


if __name__ == "__main__":
    print("WellAlly Report Structurer AI - Examples\n")
    print("=" * 60)
    print()

    if not os.getenv("ZHIPUAI_API_KEY"):
        print("ℹ️  Note: ZHIPUAI_API_KEY not set - using demo data")
        print("   Set API key for live AI extraction: export ZHIPUAI_API_KEY='your-key'")
        print()

    try:
        example_basic_structuring()
        example_extract_medications()
        example_extract_timeline()
        example_identify_relationships()
        example_summarize()

        print("=" * 60)
        print("\n✨ All examples completed!")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()

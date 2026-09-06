"""
Example usage of VoKoo PDF Medical Parser.
"""

import os
from pathlib import Path
from vokoo_pdf_medical_parser import MedicalPDFParser


def example_basic_parsing():
    """Basic PDF parsing example."""
    print("=== Basic PDF Parsing ===\n")

    # Initialize parser
    parser = MedicalPDFParser(api_key=os.getenv("ZHIPUAI_API_KEY"))

    # Example: parse a lab report PDF
    pdf_path = "sample_lab_report.pdf"  # Replace with actual path

    if not Path(pdf_path).exists():
        print(f"⚠️  Demo file not found: {pdf_path}")
        print("   Create a sample PDF to run this example")
        return

    # Parse PDF
    result = parser.parse_pdf(pdf_path)

    print(f"Report Type: {result.get('report_type')}")
    print(f"Report Date: {result.get('report_date')}")

    if result.get('patient'):
        patient = result['patient']
        print(f"Patient: {patient.get('name')} (ID: {patient.get('id')})")

    print()


def example_text_extraction():
    """Extract text from PDF."""
    print("=== Text Extraction ===\n")

    parser = MedicalPDFParser(api_key=os.getenv("ZHIPUAI_API_KEY"))

    pdf_path = "sample_report.pdf"

    if not Path(pdf_path).exists():
        print(f"⚠️  Demo file not found: {pdf_path}")
        return

    # Extract raw text
    text = parser.extract_text(pdf_path)

    print(f"Extracted {len(text)} characters")
    print("\nFirst 500 characters:")
    print(text[:500])
    print()


def example_metadata_extraction():
    """Extract PDF metadata."""
    print("=== Metadata Extraction ===\n")

    parser = MedicalPDFParser(api_key=os.getenv("ZHIPUAI_API_KEY"))

    pdf_path = "sample_report.pdf"

    if not Path(pdf_path).exists():
        print(f"⚠️  Demo file not found: {pdf_path}")
        return

    # Get metadata
    metadata = parser.extract_metadata(pdf_path)

    print("PDF Metadata:")
    for key, value in metadata.items():
        print(f"  {key}: {value}")

    print()


def example_lab_report_parsing():
    """Parse a laboratory report."""
    print("=== Laboratory Report Parsing ===\n")

    parser = MedicalPDFParser(api_key=os.getenv("ZHIPUAI_API_KEY"))

    # Demo data structure (what would be returned)
    demo_result = {
        "report_type": "laboratory",
        "patient": {
            "name": "John Doe",
            "id": "12345678",
            "date_of_birth": "1980-05-15",
            "gender": "M"
        },
        "report_date": "2025-01-15",
        "provider": {
            "name": "Dr. Smith",
            "facility": "City Hospital"
        },
        "test_results": [
            {
                "test_name": "Glucose",
                "value": 105,
                "unit": "mg/dL",
                "reference_range": "70-100",
                "abnormal": True
            },
            {
                "test_name": "Hemoglobin A1C",
                "value": 5.8,
                "unit": "%",
                "reference_range": "< 5.7",
                "abnormal": True
            },
            {
                "test_name": "Total Cholesterol",
                "value": 190,
                "unit": "mg/dL",
                "reference_range": "< 200",
                "abnormal": False
            }
        ]
    }

    print("Sample Lab Report Result:")
    print(f"Type: {demo_result['report_type']}")
    print(f"Patient: {demo_result['patient']['name']}")
    print(f"Date: {demo_result['report_date']}")
    print("\nTest Results:")

    for test in demo_result['test_results']:
        flag = "⚠️" if test['abnormal'] else "✓"
        print(f"  {flag} {test['test_name']}: {test['value']} {test['unit']}")
        print(f"     Reference: {test['reference_range']}")

    print()


def example_imaging_report():
    """Parse an imaging/radiology report."""
    print("=== Imaging Report Parsing ===\n")

    # Demo imaging report structure
    demo_result = {
        "report_type": "radiology",
        "patient": {
            "name": "Jane Smith",
            "id": "87654321"
        },
        "report_date": "2025-01-10",
        "provider": {
            "name": "Dr. Johnson",
            "facility": "Regional Medical Center"
        },
        "modality": "CT",
        "body_part": "Chest",
        "findings": (
            "Lungs are clear. No pleural effusion. Heart size normal. "
            "No mediastinal lymphadenopathy."
        ),
        "impression": (
            "Normal chest CT. No acute findings."
        ),
        "recommendations": "None"
    }

    print("Sample Imaging Report:")
    print(f"Modality: {demo_result.get('modality')}")
    print(f"Body Part: {demo_result.get('body_part')}")
    print(f"\nFindings:")
    print(f"  {demo_result.get('findings')}")
    print(f"\nImpression:")
    print(f"  {demo_result.get('impression')}")
    print()


def example_parsing_methods():
    """Compare different parsing methods."""
    print("=== Parsing Methods Comparison ===\n")

    parser = MedicalPDFParser(api_key=os.getenv("ZHIPUAI_API_KEY"))

    pdf_path = "sample_report.pdf"

    if not Path(pdf_path).exists():
        print(f"⚠️  Demo file not found: {pdf_path}")
        return

    print("Method 1: Auto (tries text first, falls back to vision)")
    # result_auto = parser.parse_pdf(pdf_path, method="auto")
    print("  → Automatically selects best method")
    print()

    print("Method 2: Text-based parsing")
    # result_text = parser.parse_pdf(pdf_path, method="text")
    print("  → Fast, good for text-heavy PDFs")
    print()

    print("Method 3: Vision-based parsing")
    # result_vision = parser.parse_pdf(pdf_path, method="vision")
    print("  → Better for scanned/image-based PDFs")
    print()


def example_error_handling():
    """Handle parsing errors."""
    print("=== Error Handling ===\n")

    parser = MedicalPDFParser(api_key=os.getenv("ZHIPUAI_API_KEY"))

    # Try non-existent file
    try:
        result = parser.parse_pdf("nonexistent.pdf")
    except FileNotFoundError as e:
        print(f"✗ Expected error: {e}")

    print()


if __name__ == "__main__":
    print("VoKoo PDF Medical Parser - Examples\n")
    print("=" * 60)
    print()

    # Check if API key is set
    if not os.getenv("ZHIPUAI_API_KEY"):
        print("⚠️  Warning: ZHIPUAI_API_KEY not set")
        print("   Export it: export ZHIPUAI_API_KEY='your-api-key'")
        print()

    try:
        example_basic_parsing()
        example_text_extraction()
        example_metadata_extraction()
        example_lab_report_parsing()
        example_imaging_report()
        example_parsing_methods()
        example_error_handling()

        print("=" * 60)
        print("\n✨ Examples completed!")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()

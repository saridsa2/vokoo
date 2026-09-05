"""
Example usage of WellAlly Lab Parser.
"""

import os
from pathlib import Path
from wellally_lab_parser import LabReportParser


def example_basic_parsing():
    """Basic example: Parse a lab report image."""
    print("=== Basic Parsing Example ===\n")

    # Initialize parser (reads API key from environment)
    parser = LabReportParser()

    # Parse an image
    image_path = "sample_lab_report.jpg"

    if not Path(image_path).exists():
        print(f"Sample image not found: {image_path}")
        print("Please provide a lab report image.")
        return

    result = parser.parse_image(image_path)

    # Print results
    print(f"Report ID: {result.get('reportId')}")
    print(f"Issued At: {result.get('issuedAt')}")
    print(f"Facility: {result.get('facility', {}).get('name')}")
    print(f"\nNumber of results: {len(result.get('results', []))}")

    # Print first few results
    for i, test_result in enumerate(result.get('results', [])[:3], 1):
        print(f"\n{i}. {test_result['code']['text']}")
        if isinstance(test_result['value'], dict):
            print(f"   Value: {test_result['value']['value']} {test_result['value']['unit']}")
        else:
            print(f"   Value: {test_result['value']}")
        print(f"   Interpretation: {test_result.get('interpretation', 'N/A')}")


def example_wellally_schema():
    """Example: Parse and convert to WellAlly schema."""
    print("\n=== WellAlly Schema Example ===\n")

    parser = LabReportParser()
    image_path = "sample_lab_report.jpg"

    if not Path(image_path).exists():
        print(f"Sample image not found: {image_path}")
        return

    # Parse to WellAlly LabReport schema
    lab_report = parser.parse_to_wellally_schema(
        image_path=image_path,
        patient_id="patient-12345"
    )

    print(f"Patient ID: {lab_report.patientId}")
    print(f"Report ID: {lab_report.id}")
    print(f"Issued At: {lab_report.issuedAt}")

    if lab_report.facility:
        print(f"Facility: {lab_report.facility.name}")

    if lab_report.panel:
        print(f"Panel: {lab_report.panel.text}")

    print(f"\nResults ({len(lab_report.results)} tests):")
    for i, result in enumerate(lab_report.results[:5], 1):
        print(f"\n{i}. {result.code.text}")
        if isinstance(result.value, object) and hasattr(result.value, 'value'):
            print(f"   {result.value.value} {result.value.unit}")
        else:
            print(f"   {result.value}")

        if result.referenceRange:
            if result.referenceRange.text:
                print(f"   Reference: {result.referenceRange.text}")
            else:
                low = f"{result.referenceRange.low.value}" if result.referenceRange.low else "N/A"
                high = f"{result.referenceRange.high.value}" if result.referenceRange.high else "N/A"
                print(f"   Reference: {low} - {high}")

        if result.interpretation:
            status = {
                "N": "Normal",
                "L": "Low",
                "H": "High",
                "A": "Abnormal"
            }.get(result.interpretation, result.interpretation)
            print(f"   Status: {status}")


def example_batch_processing():
    """Example: Batch process multiple lab reports."""
    print("\n=== Batch Processing Example ===\n")

    parser = LabReportParser()
    reports_dir = Path("lab_reports")

    if not reports_dir.exists():
        print(f"Directory not found: {reports_dir}")
        print("Creating example directory structure...")
        reports_dir.mkdir(exist_ok=True)
        print(f"Please place lab report images in: {reports_dir}/")
        return

    # Process all images
    image_files = list(reports_dir.glob("*.jpg")) + list(reports_dir.glob("*.png"))

    if not image_files:
        print(f"No images found in {reports_dir}/")
        return

    print(f"Found {len(image_files)} images to process\n")

    results = []
    for image_path in image_files:
        print(f"Processing: {image_path.name}...", end=" ")
        try:
            result = parser.parse_image(image_path)
            results.append({
                "file": image_path.name,
                "success": True,
                "data": result
            })
            print("✓")
        except Exception as e:
            results.append({
                "file": image_path.name,
                "success": False,
                "error": str(e)
            })
            print(f"✗ Error: {e}")

    # Summary
    successful = sum(1 for r in results if r["success"])
    print(f"\n=== Summary ===")
    print(f"Total: {len(results)}")
    print(f"Successful: {successful}")
    print(f"Failed: {len(results) - successful}")


def example_custom_config():
    """Example: Custom parser configuration."""
    print("\n=== Custom Configuration Example ===\n")

    # Initialize with custom settings
    parser = LabReportParser(
        model="glm-4v-flash",  # Using free model
        temperature=0.05,  # Very deterministic
        validate=True  # Enable validation
    )

    print(f"Model: {parser.model}")
    print(f"Temperature: {parser.temperature}")
    print(f"Validation: {'Enabled' if parser.validate else 'Disabled'}")

    # You can also disable validation for faster processing
    fast_parser = LabReportParser(validate=False)
    print(f"\nFast parser validation: {'Enabled' if fast_parser.validate else 'Disabled'}")


if __name__ == "__main__":
    # Check API key
    if not os.getenv("ZHIPUAI_API_KEY"):
        print("⚠️  ZHIPUAI_API_KEY environment variable not set!")
        print("Please set it with: export ZHIPUAI_API_KEY='your-api-key'")
        print("\nGet your free API key at: https://open.bigmodel.cn/\n")
        exit(1)

    # Run examples
    try:
        example_custom_config()
        example_basic_parsing()
        example_wellally_schema()
        example_batch_processing()
    except Exception as e:
        print(f"\n❌ Error running examples: {e}")
        import traceback
        traceback.print_exc()

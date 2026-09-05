"""
Prompts for medical PDF parsing.
"""

SYSTEM_PROMPT = """You are an expert medical document analyst with deep knowledge of:
- Laboratory reports and test results
- Radiology and imaging reports
- Clinical notes and discharge summaries
- Pathology reports
- Prescription records

Extract information accurately and structure it according to medical standards."""


MEDICAL_PDF_EXTRACTION_PROMPT = """Analyze this medical report and extract all relevant information.

PDF Content:
{pdf_text}

Extract and structure the following information:

1. **Report Type**: laboratory, radiology, pathology, clinical_note, prescription, other
2. **Patient Information**: name, ID, DOB, gender (if present)
3. **Report Date**: date of report
4. **Provider**: ordering physician, facility
5. **Test/Procedure Results**: all measurements, findings, observations
6. **Diagnoses**: any diagnostic codes or conditions mentioned
7. **Recommendations**: follow-up actions, medication changes

For laboratory reports, extract:
- Test name
- Result value
- Unit
- Reference range
- Abnormal flags

For imaging reports, extract:
- Modality (X-ray, CT, MRI, etc.)
- Body part examined
- Findings
- Impression

Return the data as JSON with this structure:
```json
{{
  "report_type": "laboratory|radiology|pathology|clinical_note|prescription|other",
  "patient": {{
    "name": "string or null",
    "id": "string or null",
    "date_of_birth": "YYYY-MM-DD or null",
    "gender": "string or null"
  }},
  "report_date": "YYYY-MM-DD or null",
  "provider": {{
    "name": "string or null",
    "facility": "string or null"
  }},
  "test_results": [
    {{
      "test_name": "string",
      "value": "string or number",
      "unit": "string or null",
      "reference_range": "string or null",
      "abnormal": true/false
    }}
  ],
  "findings": "string or null",
  "impression": "string or null",
  "recommendations": "string or null"
}}
```

IMPORTANT:
- Use null for missing information
- Parse dates to YYYY-MM-DD format
- Include all test results found
- Flag abnormal results based on reference ranges
- Preserve exact values and units as written
"""

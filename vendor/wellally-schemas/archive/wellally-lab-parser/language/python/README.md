# WellAlly Lab Parser

OCR lab slips to structured JSON using LangChain and GLM-4V-Flash.

## Features

- 🔬 Parse laboratory test reports from images
- 🤖 Powered by Zhipu AI's free GLM-4V-Flash vision model
- 📊 Structured output compatible with WellAlly schemas
- ✅ Built-in validation and error correction
- 🌐 Support for Chinese and English lab reports

## Installation

```bash
cd language/python
pip install -e .
```

## Quick Start

### 1. Set up API Key

Get your free API key from [Zhipu AI](https://open.bigmodel.cn/):

```bash
export ZHIPUAI_API_KEY="your-api-key-here"
```

Or create a `.env` file:

```
ZHIPUAI_API_KEY=your-api-key-here
```

### 2. Parse a Lab Report

```python
from wellally_lab_parser import LabReportParser

# Initialize parser
parser = LabReportParser()

# Parse image to structured JSON
result = parser.parse_image("path/to/lab_report.jpg")
print(result)

# Or convert directly to WellAlly schema
from wellally_lab_parser import LabReportParser

parser = LabReportParser()
lab_report = parser.parse_to_wellally_schema(
    image_path="path/to/lab_report.jpg",
    patient_id="patient-123"
)
print(lab_report.results[0].code.text)
```

## Supported Lab Report Types

- ✅ Blood routine (血常规)
- ✅ Liver function (肝功能)
- ✅ Kidney function (肾功能)
- ✅ Blood lipids (血脂)
- ✅ Blood glucose (血糖)
- ✅ Thyroid function (甲状腺功能)
- ✅ Tumor markers (肿瘤标志物)
- ✅ Coagulation (凝血功能)
- ✅ Urine routine (尿常规)
- And more...

## API Reference

### LabReportParser

```python
class LabReportParser:
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "https://open.bigmodel.cn/api/paas/v4",
        model: str = "glm-4v-flash",
        temperature: float = 0.1,
        validate: bool = True
    ):
        """
        Initialize the Lab Report Parser.

        Args:
            api_key: Zhipu AI API key
            base_url: API base URL
            model: Model name (glm-4v-flash is free)
            temperature: Lower values = more deterministic
            validate: Enable validation pass
        """
```

#### Methods

**parse_image(image_path, patient_id=None)**

Parse lab report image to structured JSON.

```python
result = parser.parse_image("report.jpg")
# Returns dict with keys: reportId, issuedAt, facility, patient, specimen, panel, results
```

**parse_to_wellally_schema(image_path, patient_id)**

Parse and convert to WellAlly LabReport schema.

```python
from wellally.lab_report import LabReport

lab_report: LabReport = parser.parse_to_wellally_schema(
    "report.jpg",
    "patient-123"
)
```

## Output Schema

```json
{
  "reportId": "R2024120001",
  "issuedAt": "2024-12-18T14:30:00",
  "facility": {
    "name": "某某医院检验科",
    "id": "HOSP001"
  },
  "patient": {
    "id": "P123456",
    "name": "张三"
  },
  "specimen": {
    "type": {
      "system": "http://snomed.info/sct",
      "code": "119364003",
      "display": "Serum specimen"
    },
    "collectedAt": "2024-12-18T10:00:00"
  },
  "panel": {
    "coding": [{
      "system": "http://loinc.org",
      "code": "24326-1",
      "display": "Comprehensive metabolic panel"
    }],
    "text": "肝功能全套"
  },
  "results": [
    {
      "code": {
        "coding": [{
          "system": "http://loinc.org",
          "code": "1742-6",
          "display": "Alanine aminotransferase"
        }],
        "text": "丙氨酸氨基转移酶(ALT)"
      },
      "value": {
        "value": 35.5,
        "unit": "U/L"
      },
      "referenceRange": {
        "low": {"value": 9, "unit": "U/L"},
        "high": {"value": 50, "unit": "U/L"},
        "text": "9-50"
      },
      "interpretation": "N"
    }
  ]
}
```

## Advanced Usage

### Custom Validation

```python
parser = LabReportParser(validate=False)
raw_result = parser.parse_image("report.jpg")

# Apply your own validation
if is_valid(raw_result):
    process(raw_result)
```

### Batch Processing

```python
from pathlib import Path

parser = LabReportParser()
reports_dir = Path("lab_reports")

for image_path in reports_dir.glob("*.jpg"):
    try:
        result = parser.parse_image(image_path)
        save_to_database(result)
    except Exception as e:
        print(f"Failed to parse {image_path}: {e}")
```

### Error Handling

```python
from wellally_lab_parser import LabReportParser

parser = LabReportParser()

try:
    result = parser.parse_image("report.jpg")
except ValueError as e:
    print(f"Parsing error: {e}")
except FileNotFoundError:
    print("Image file not found")
```

## Model Information

This package uses **GLM-4V-Flash** from Zhipu AI:

- ✅ **Completely free** for all users
- 🚀 Fast inference speed
- 🎯 High accuracy for Chinese medical documents
- 📷 Supports multiple image formats (JPG, PNG, etc.)
- 🔄 Streaming support available

Learn more: [GLM-4V-Flash Documentation](https://open.bigmodel.cn/dev/howuse/glm-4v)

## Dependencies

- `langchain` - LLM orchestration
- `langchain-community` - Community integrations
- `openai` - OpenAI-compatible API client
- `wellally` - WellAlly health data schemas
- `Pillow` - Image processing
- `python-dotenv` - Environment variable management

## License

Governed by the VoKoo root LICENSE

## Links

- [WellAlly Platform](https://www.wellally.tech/)
- [Zhipu AI Platform](https://open.bigmodel.cn/)
- [LOINC Database](https://loinc.org/)
- [SNOMED CT](https://www.snomed.org/)

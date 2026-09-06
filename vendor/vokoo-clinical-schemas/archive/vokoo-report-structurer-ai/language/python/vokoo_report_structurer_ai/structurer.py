"""
AI-powered medical report structuring.
"""

from typing import Dict, List, Optional, Any
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.output_parsers import JsonOutputParser


SYSTEM_PROMPT = """You are a medical information extraction expert.
Extract structured data from unstructured medical text with high accuracy."""


class ReportStructurerAI:
    """
    Extract structured data from unstructured medical reports using AI.

    Uses LLM (GLM-4) for:
    - Entity extraction (medications, conditions, tests)
    - Relationship identification
    - Timeline construction
    - Semantic structuring

    Example:
        >>> structurer = ReportStructurerAI(api_key="your-key")
        >>> structured = structurer.structure_report(report_text)
        >>> print(structured["medications"])
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = "glm-4",
        base_url: str = "https://open.bigmodel.cn/api/paas/v4/"
    ):
        """
        Initialize report structurer.

        Args:
            api_key: Zhipu AI API key
            model: Model to use
            base_url: API base URL
        """
        self.llm = ChatOpenAI(
            model=model,
            api_key=api_key,
            base_url=base_url
        )
        self.json_parser = JsonOutputParser()

    def structure_report(self, text: str) -> Dict[str, Any]:
        """
        Extract structured data from medical report.

        Args:
            text: Unstructured report text

        Returns:
            Structured data dictionary
        """
        prompt = f"""Extract structured information from this medical report:

{text}

Extract:
1. **Medications**: List all medications mentioned with dosages
2. **Conditions/Diagnoses**: Medical conditions or diagnoses
3. **Procedures**: Medical procedures performed or planned
4. **Lab Results**: Test names and values
5. **Symptoms**: Reported symptoms
6. **Recommendations**: Follow-up actions or recommendations

Return as JSON:
{{
  "medications": [{{"name": "string", "dosage": "string", "frequency": "string"}}],
  "conditions": ["{{"name": "string", "status": "active|resolved"}}],
  "procedures": ["{{"name": "string", "date": "string or null"}}],
  "lab_results": [{{"test": "string", "value": "string", "unit": "string"}}],
  "symptoms": ["string"],
  "recommendations": ["string"]
}}
"""

        response = self.llm.invoke([
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(content=prompt)
        ])

        try:
            structured = self.json_parser.parse(response.content)
            return structured
        except:
            return {"error": "Failed to parse response", "raw": response.content}

    def extract_medications(self, text: str) -> List[Dict[str, str]]:
        """Extract medications only."""
        structured = self.structure_report(text)
        return structured.get("medications", [])

    def extract_timeline(self, text: str) -> List[Dict[str, Any]]:
        """Extract temporal events."""
        prompt = f"""Extract all time-referenced events from this text:

{text}

Return chronological events as JSON:
{{
  "events": [{{"date": "YYYY-MM-DD or relative", "event": "description"}}]
}}
"""

        response = self.llm.invoke([
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(content=prompt)
        ])

        try:
            result = self.json_parser.parse(response.content)
            return result.get("events", [])
        except:
            return []

    def identify_relationships(self, text: str) -> List[Dict[str, Any]]:
        """Identify relationships between entities."""
        prompt = f"""Identify relationships between medical entities:

{text}

Find relationships like:
- Medication treats condition
- Symptom caused by condition
- Test monitors condition

Return as JSON:
{{
  "relationships": [{{
    "entity1": "string",
    "relationship": "treats|causes|monitors|indicates",
    "entity2": "string"
  }}]
}}
"""

        response = self.llm.invoke([
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(content=prompt)
        ])

        try:
            result = self.json_parser.parse(response.content)
            return result.get("relationships", [])
        except:
            return []

    def summarize_report(self, text: str, max_sentences: int = 3) -> str:
        """Generate concise summary."""
        prompt = f"""Summarize this medical report in {max_sentences} sentences:

{text}

Focus on: diagnosis, treatment plan, and key findings.
"""

        response = self.llm.invoke([
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(content=prompt)
        ])

        return response.content.strip()

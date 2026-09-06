"""
Lab Report Parser using LangChain and GLM-4V-Flash.
"""

import os
import json
import base64
from typing import Optional, Dict, Any, Union
from pathlib import Path
from datetime import datetime

from langchain.chat_models import ChatOpenAI
from langchain.schema import HumanMessage, SystemMessage
from PIL import Image
import io

from .prompts import LAB_REPORT_OCR_PROMPT, LAB_REPORT_VALIDATION_PROMPT, SYSTEM_PROMPT


class LabReportParser:
    """
    Parse lab report images to structured JSON using GLM-4V-Flash.

    This parser uses LangChain with Zhipu AI's GLM-4V-Flash model for
    optical character recognition and structured data extraction from
    laboratory test report images.

    Example:
        >>> parser = LabReportParser(api_key="your-api-key")
        >>> result = parser.parse_image("path/to/lab_report.jpg")
        >>> print(result["reportId"])
    """

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
            api_key: Zhipu AI API key. If None, reads from ZHIPUAI_API_KEY env var
            base_url: API base URL
            model: Model name (default: glm-4v-flash, free tier)
            temperature: Model temperature (0.0-1.0), lower = more deterministic
            validate: Whether to validate extracted data
        """
        self.api_key = api_key or os.getenv("ZHIPUAI_API_KEY")
        if not self.api_key:
            raise ValueError(
                "API key is required. Set ZHIPUAI_API_KEY environment variable "
                "or pass api_key parameter."
            )

        self.model = model
        self.temperature = temperature
        self.validate = validate

        # Initialize LangChain chat model with OpenAI-compatible API
        self.llm = ChatOpenAI(
            model=model,
            openai_api_key=self.api_key,
            openai_api_base=base_url,
            temperature=temperature,
        )

    def _encode_image(self, image_path: Union[str, Path]) -> str:
        """
        Encode image to base64 string.

        Args:
            image_path: Path to the image file

        Returns:
            Base64 encoded image string
        """
        with open(image_path, "rb") as image_file:
            return base64.b64encode(image_file.read()).decode("utf-8")

    def _prepare_image_url(self, image_path: Union[str, Path]) -> str:
        """
        Prepare image URL for API call.

        Args:
            image_path: Path to the image file

        Returns:
            Data URL with base64 encoded image
        """
        # Detect image format
        img = Image.open(image_path)
        img_format = img.format.lower()

        # Encode image
        base64_image = self._encode_image(image_path)

        # Return data URL
        return f"data:image/{img_format};base64,{base64_image}"

    def parse_image(
        self,
        image_path: Union[str, Path],
        patient_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Parse lab report image to structured JSON.

        Args:
            image_path: Path to the lab report image
            patient_id: Optional patient ID to include in result

        Returns:
            Structured lab report data as dictionary

        Raises:
            ValueError: If image cannot be processed
            json.JSONDecodeError: If model output is not valid JSON
        """
        # Prepare image
        image_url = self._prepare_image_url(image_path)

        # Create messages
        messages = [
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(
                content=[
                    {"type": "text", "text": LAB_REPORT_OCR_PROMPT},
                    {"type": "image_url", "image_url": {"url": image_url}}
                ]
            )
        ]

        # Call model
        response = self.llm.invoke(messages)

        # Extract JSON from response
        content = response.content

        # Try to parse JSON from code blocks or raw text
        try:
            # Remove markdown code blocks if present
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].split("```")[0].strip()

            result = json.loads(content)
        except json.JSONDecodeError as e:
            raise ValueError(f"Failed to parse model output as JSON: {e}\nOutput: {content}")

        # Add patient ID if provided
        if patient_id:
            if "patient" not in result:
                result["patient"] = {}
            result["patient"]["id"] = patient_id

        # Validate if enabled
        if self.validate:
            result = self._validate_result(result)

        return result

    def _validate_result(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validate and optionally correct the extracted data.

        Args:
            data: Extracted lab report data

        Returns:
            Validated/corrected data
        """
        # Create validation prompt
        validation_prompt = LAB_REPORT_VALIDATION_PROMPT.format(
            extracted_data=json.dumps(data, indent=2, ensure_ascii=False)
        )

        messages = [
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(content=validation_prompt)
        ]

        # Call model for validation
        response = self.llm.invoke(messages)
        content = response.content

        try:
            # Parse validated result
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].split("```")[0].strip()

            validated_data = json.loads(content)
            return validated_data
        except json.JSONDecodeError:
            # If validation fails, return original data
            return data

    def parse_to_vokoo_schema(
        self,
        image_path: Union[str, Path],
        patient_id: str
    ):
        """
        Parse lab report and convert to VoKoo LabReport schema.

        Args:
            image_path: Path to the lab report image
            patient_id: Patient identifier

        Returns:
            LabReport instance from vokoo_clinical_schemas.lab_report module
        """
        from vokoo_clinical_schemas.lab_report import (
            LabReport, LabResult, Facility, Specimen,
        )
        from vokoo_clinical_schemas.common import (
            CodeableConcept, Coding, Quantity, ReferenceRange
        )

        # Parse image
        data = self.parse_image(image_path, patient_id)

        # Convert to VoKoo schema
        # Facility
        facility = None
        if data.get("facility"):
            facility = Facility(
                id=data["facility"].get("id"),
                name=data["facility"].get("name")
            )

        # Specimen
        specimen = None
        if data.get("specimen"):
            spec_data = data["specimen"]
            specimen_type = None
            if spec_data.get("type"):
                specimen_type = Coding(**spec_data["type"])

            specimen = Specimen(
                type=specimen_type,
                collectedAt=datetime.fromisoformat(spec_data["collectedAt"])
                if spec_data.get("collectedAt") else None
            )

        # Panel
        panel = None
        if data.get("panel"):
            panel_data = data["panel"]
            panel = CodeableConcept(
                coding=[Coding(**c) for c in panel_data.get("coding", [])],
                text=panel_data.get("text")
            )

        # Results
        results = []
        for result_data in data.get("results", []):
            # Code
            code = CodeableConcept(
                coding=[Coding(**c) for c in result_data["code"].get("coding", [])],
                text=result_data["code"].get("text")
            )

            # Value
            value_data = result_data.get("value")
            if isinstance(value_data, dict) and "value" in value_data:
                value = Quantity(**value_data)
            else:
                value = value_data

            # Reference Range
            ref_range = None
            if result_data.get("referenceRange"):
                rr_data = result_data["referenceRange"]
                ref_range = ReferenceRange(
                    low=Quantity(**rr_data["low"]) if rr_data.get("low") else None,
                    high=Quantity(**rr_data["high"]) if rr_data.get("high") else None,
                    text=rr_data.get("text")
                )

            # Create LabResult
            lab_result = LabResult(
                code=code,
                value=value,
                referenceRange=ref_range,
                interpretation=result_data.get("interpretation"),
                method=None
            )
            results.append(lab_result)

        # Create LabReport
        lab_report = LabReport(
            id=data.get("reportId", ""),
            patientId=patient_id,
            issuedAt=datetime.fromisoformat(data["issuedAt"])
            if data.get("issuedAt") else datetime.now(),
            results=results,
            facility=facility,
            panel=panel,
            specimen=specimen
        )

        return lab_report

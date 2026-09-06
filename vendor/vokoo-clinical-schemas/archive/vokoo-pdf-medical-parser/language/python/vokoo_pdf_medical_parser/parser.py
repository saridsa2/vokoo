"""
PDF medical report parser implementation.
"""

import io
from typing import Optional, Dict, Any, BinaryIO
from pathlib import Path

try:
    import PyPDF2
    from PIL import Image
    import pdf2image
except ImportError:
    PyPDF2 = None
    Image = None
    pdf2image = None

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.prompts import ChatPromptTemplate

from .prompts import MEDICAL_PDF_EXTRACTION_PROMPT, SYSTEM_PROMPT


class PDFParserError(Exception):
    """Raised when PDF parsing fails."""
    pass


class MedicalPDFParser:
    """
    Parse medical PDF reports and extract structured data.

    Uses combination of text extraction and vision-based parsing
    for comprehensive medical report understanding.

    Example:
        >>> parser = MedicalPDFParser(api_key="your-glm-api-key")
        >>> result = parser.parse_pdf("lab_report.pdf")
        >>> print(result["report_type"])
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = "glm-4",
        vision_model: str = "glm-4v-flash",
        base_url: str = "https://open.bigmodel.cn/api/paas/v4/"
    ):
        """
        Initialize the PDF parser.

        Args:
            api_key: Zhipu AI API key (or set ZHIPUAI_API_KEY env var)
            model: Text model for structured extraction
            vision_model: Vision model for image-based parsing
            base_url: API base URL
        """
        if PyPDF2 is None:
            raise ImportError("PyPDF2 is required. Install: pip install PyPDF2")

        self.text_llm = ChatOpenAI(
            model=model,
            api_key=api_key,
            base_url=base_url
        )

        self.vision_llm = ChatOpenAI(
            model=vision_model,
            api_key=api_key,
            base_url=base_url
        )

        self.json_parser = JsonOutputParser()

    def extract_text(self, pdf_path: str | Path) -> str:
        """
        Extract all text from PDF.

        Args:
            pdf_path: Path to PDF file

        Returns:
            Extracted text content
        """
        pdf_path = Path(pdf_path)

        if not pdf_path.exists():
            raise FileNotFoundError(f"PDF not found: {pdf_path}")

        text_parts = []

        with open(pdf_path, 'rb') as f:
            reader = PyPDF2.PdfReader(f)

            for page_num, page in enumerate(reader.pages, 1):
                text = page.extract_text()
                if text.strip():
                    text_parts.append(f"--- Page {page_num} ---\n{text}")

        return "\n\n".join(text_parts)

    def parse_with_text(self, pdf_path: str | Path) -> Dict[str, Any]:
        """
        Parse PDF using text extraction + LLM.

        Args:
            pdf_path: Path to PDF file

        Returns:
            Parsed medical data as dictionary
        """
        # Extract text
        text_content = self.extract_text(pdf_path)

        if not text_content.strip():
            raise PDFParserError("No text content found in PDF")

        # Build prompt
        prompt = ChatPromptTemplate.from_messages([
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(content=MEDICAL_PDF_EXTRACTION_PROMPT.format(
                pdf_text=text_content
            ))
        ])

        # Parse with LLM
        chain = prompt | self.text_llm | self.json_parser
        result = chain.invoke({})

        return result

    def parse_with_vision(self, pdf_path: str | Path, max_pages: int = 5) -> Dict[str, Any]:
        """
        Parse PDF using vision model (converts PDF to images).

        Args:
            pdf_path: Path to PDF file
            max_pages: Maximum pages to process

        Returns:
            Parsed medical data
        """
        if pdf2image is None:
            raise ImportError("pdf2image required. Install: pip install pdf2image")

        pdf_path = Path(pdf_path)

        # Convert PDF pages to images
        images = pdf2image.convert_from_path(str(pdf_path), dpi=200)

        # Limit pages
        images = images[:max_pages]

        # Process each page
        results = []
        for page_num, img in enumerate(images, 1):
            # Convert to base64
            buffered = io.BytesIO()
            img.save(buffered, format="PNG")
            img_bytes = buffered.getvalue()

            import base64
            img_base64 = base64.b64encode(img_bytes).decode()

            # Parse with vision model
            message = HumanMessage(
                content=[
                    {"type": "text", "text": MEDICAL_PDF_EXTRACTION_PROMPT.replace("{pdf_text}", f"Page {page_num}")},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{img_base64}"}
                    }
                ]
            )

            response = self.vision_llm.invoke([
                SystemMessage(content=SYSTEM_PROMPT),
                message
            ])

            try:
                page_data = self.json_parser.parse(response.content)
                results.append(page_data)
            except:
                results.append({"page": page_num, "error": "Failed to parse"})

        # Merge results
        return self._merge_results(results)

    def parse_pdf(
        self,
        pdf_path: str | Path,
        method: str = "auto"
    ) -> Dict[str, Any]:
        """
        Parse PDF medical report.

        Args:
            pdf_path: Path to PDF file
            method: Parsing method - "text", "vision", or "auto"

        Returns:
            Extracted medical data

        Example:
            >>> parser = MedicalPDFParser()
            >>> data = parser.parse_pdf("lab_report.pdf")
            >>> print(data["report_type"])
            "laboratory"
        """
        pdf_path = Path(pdf_path)

        if method == "auto":
            # Try text extraction first
            try:
                text = self.extract_text(pdf_path)
                if len(text.strip()) > 100:  # Has substantial text
                    return self.parse_with_text(pdf_path)
            except:
                pass

            # Fall back to vision
            return self.parse_with_vision(pdf_path)

        elif method == "text":
            return self.parse_with_text(pdf_path)

        elif method == "vision":
            return self.parse_with_vision(pdf_path)

        else:
            raise ValueError(f"Invalid method: {method}")

    def _merge_results(self, results: list[Dict[str, Any]]) -> Dict[str, Any]:
        """Merge results from multiple pages."""
        if not results:
            return {}

        # Take first result as base
        merged = results[0].copy()

        # Merge test results if present
        if "test_results" in merged:
            for result in results[1:]:
                if "test_results" in result:
                    merged["test_results"].extend(result["test_results"])

        return merged

    def extract_metadata(self, pdf_path: str | Path) -> Dict[str, Any]:
        """
        Extract PDF metadata.

        Args:
            pdf_path: Path to PDF file

        Returns:
            Metadata dictionary
        """
        pdf_path = Path(pdf_path)

        with open(pdf_path, 'rb') as f:
            reader = PyPDF2.PdfReader(f)

            info = reader.metadata or {}

            return {
                "title": info.get("/Title"),
                "author": info.get("/Author"),
                "subject": info.get("/Subject"),
                "creator": info.get("/Creator"),
                "producer": info.get("/Producer"),
                "creation_date": info.get("/CreationDate"),
                "num_pages": len(reader.pages)
            }

"""
WellAlly Lab Parser

OCR lab slips to structured JSON for intake pipelines.
Uses LangChain with GLM-4V-Flash for image understanding.
"""

__version__ = "0.1.0"

from .parser import LabReportParser
from .prompts import LAB_REPORT_OCR_PROMPT

__all__ = ["LabReportParser", "LAB_REPORT_OCR_PROMPT"]

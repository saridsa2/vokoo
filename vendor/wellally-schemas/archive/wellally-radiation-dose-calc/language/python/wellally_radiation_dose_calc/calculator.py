"""
Radiation dose calculator implementation.
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum


class ImagingModality(Enum):
    """Medical imaging modalities."""
    CT = "CT"
    XRAY = "X-Ray"
    FLUOROSCOPY = "Fluoroscopy"
    NUCLEAR = "Nuclear Medicine"
    PET = "PET/CT"


@dataclass
class RadiationExposure:
    """
    Single radiation exposure record.

    Attributes:
        modality: Imaging type
        procedure: Specific procedure name
        dlp: Dose-length product (mGy·cm) for CT
        dose_mgy: Dose in mGy
        date: Exposure date
        age_at_exposure: Patient age
        effective_dose_msv: Calculated effective dose
        body_part: Anatomical region
    """
    modality: ImagingModality
    procedure: str
    date: datetime
    dlp: Optional[float] = None  # mGy·cm for CT
    dose_mgy: Optional[float] = None
    age_at_exposure: Optional[int] = None
    effective_dose_msv: Optional[float] = None
    body_part: Optional[str] = None
    metadata: Dict = field(default_factory=dict)

    def to_dict(self) -> Dict:
        """Convert to dictionary."""
        return {
            "modality": self.modality.value,
            "procedure": self.procedure,
            "date": self.date.isoformat(),
            "dlp": self.dlp,
            "dose_mgy": self.dose_mgy,
            "effective_dose_msv": self.effective_dose_msv,
            "body_part": self.body_part,
            "age_at_exposure": self.age_at_exposure
        }


class RadiationDoseCalculator:
    """
    Calculate and track radiation dose from medical imaging.

    Implements:
    - DLP to effective dose conversion
    - Age-adjusted risk calculation
    - Cumulative dose tracking
    - Organ dose estimation

    Example:
        >>> calc = RadiationDoseCalculator()
        >>> dose = calc.calculate_ct_dose(dlp=500, body_part="chest")
        >>> print(f"Effective dose: {dose:.1f} mSv")
    """

    def __init__(self):
        """Initialize calculator with standard conversion factors."""
        # DLP to effective dose conversion factors (mSv per mGy·cm)
        # Source: ICRP Publication 102
        self.dlp_conversion = {
            "head": 0.0021,
            "neck": 0.0059,
            "chest": 0.014,
            "abdomen": 0.015,
            "pelvis": 0.015,
            "spine": 0.017,
        }

        # Typical effective doses (mSv) by procedure
        self.typical_doses = {
            # X-rays
            "chest_xray": 0.02,
            "abdomen_xray": 0.7,
            "spine_xray": 1.5,
            "pelvis_xray": 0.6,

            # CT scans
            "ct_head": 2.0,
            "ct_chest": 7.0,
            "ct_abdomen": 8.0,
            "ct_pelvis": 6.0,
            "ct_spine": 6.0,

            # Nuclear medicine
            "bone_scan": 6.3,
            "pet_ct": 14.0,
        }

        # Age-based risk multipliers
        self.age_risk_factors = {
            (0, 10): 3.0,    # Children: highest risk
            (10, 20): 2.0,
            (20, 40): 1.5,
            (40, 60): 1.0,   # Baseline
            (60, 100): 0.7,  # Elderly: lower risk
        }

    def calculate_ct_dose(
        self,
        dlp: float,
        body_part: str
    ) -> float:
        """
        Calculate effective dose from CT DLP.

        Args:
            dlp: Dose-length product in mGy·cm
            body_part: Anatomical region (head, chest, abdomen, pelvis, spine, neck)

        Returns:
            Effective dose in mSv
        """
        body_part_lower = body_part.lower()

        conversion_factor = self.dlp_conversion.get(body_part_lower, 0.015)

        effective_dose = dlp * conversion_factor

        return effective_dose

    def get_typical_dose(self, procedure: str) -> float:
        """
        Get typical effective dose for a procedure.

        Args:
            procedure: Procedure name

        Returns:
            Typical effective dose in mSv
        """
        procedure_lower = procedure.lower().replace(" ", "_").replace("-", "_")

        return self.typical_doses.get(procedure_lower, 0.0)

    def calculate_cumulative_dose(
        self,
        exposures: List[RadiationExposure]
    ) -> float:
        """
        Calculate total cumulative dose.

        Args:
            exposures: List of radiation exposures

        Returns:
            Total effective dose in mSv
        """
        total = 0.0

        for exp in exposures:
            if exp.effective_dose_msv is not None:
                total += exp.effective_dose_msv
            elif exp.dlp is not None and exp.body_part:
                dose = self.calculate_ct_dose(exp.dlp, exp.body_part)
                total += dose
            else:
                # Use typical dose
                typical = self.get_typical_dose(exp.procedure)
                total += typical

        return total

    def calculate_age_adjusted_risk(
        self,
        effective_dose_msv: float,
        age: int
    ) -> float:
        """
        Calculate age-adjusted radiation risk.

        Younger patients have higher radiation sensitivity.

        Args:
            effective_dose_msv: Effective dose in mSv
            age: Patient age in years

        Returns:
            Age-adjusted risk score (higher = more risk)
        """
        # Find age bracket
        risk_factor = 1.0
        for (age_min, age_max), factor in self.age_risk_factors.items():
            if age_min <= age < age_max:
                risk_factor = factor
                break

        return effective_dose_msv * risk_factor

    def estimate_organ_dose(
        self,
        effective_dose_msv: float,
        organ: str
    ) -> float:
        """
        Estimate organ-specific dose.

        Args:
            effective_dose_msv: Effective dose
            organ: Organ name

        Returns:
            Estimated organ dose in mSv
        """
        # Simplified organ dose factors
        # In practice, this would use Monte Carlo simulations
        organ_factors = {
            "thyroid": 1.2,
            "breast": 1.1,
            "lung": 1.0,
            "stomach": 0.9,
            "liver": 0.8,
            "bone_marrow": 0.12,
        }

        factor = organ_factors.get(organ.lower(), 1.0)

        return effective_dose_msv * factor

    def compare_to_background(self, dose_msv: float) -> Dict[str, float]:
        """
        Compare dose to natural background radiation.

        Args:
            dose_msv: Dose in mSv

        Returns:
            Comparison metrics
        """
        # Average natural background: ~3 mSv/year
        annual_background = 3.0  # mSv
        daily_background = annual_background / 365

        return {
            "dose_msv": dose_msv,
            "days_of_background": dose_msv / daily_background,
            "years_of_background": dose_msv / annual_background,
            "percent_of_annual_limit": (dose_msv / 100) * 100  # 100 mSv is regulatory limit
        }

    def get_risk_category(self, cumulative_dose_msv: float) -> str:
        """
        Categorize cumulative radiation risk.

        Args:
            cumulative_dose_msv: Total cumulative dose

        Returns:
            Risk category string
        """
        if cumulative_dose_msv < 10:
            return "Low (< 10 mSv)"
        elif cumulative_dose_msv < 50:
            return "Moderate (10-50 mSv)"
        elif cumulative_dose_msv < 100:
            return "Elevated (50-100 mSv)"
        else:
            return "High (>= 100 mSv)"

    def generate_report(
        self,
        exposures: List[RadiationExposure],
        patient_age: Optional[int] = None
    ) -> Dict:
        """
        Generate comprehensive radiation exposure report.

        Args:
            exposures: List of exposures
            patient_age: Current patient age

        Returns:
            Report dictionary
        """
        # Sort by date
        sorted_exposures = sorted(exposures, key=lambda e: e.date)

        # Calculate cumulative dose
        cumulative = self.calculate_cumulative_dose(sorted_exposures)

        # Age-adjusted risk if age provided
        age_adjusted_risk = None
        if patient_age is not None:
            age_adjusted_risk = self.calculate_age_adjusted_risk(cumulative, patient_age)

        # Background comparison
        background_comp = self.compare_to_background(cumulative)

        # Risk category
        risk_category = self.get_risk_category(cumulative)

        # Group by modality
        by_modality = {}
        for exp in sorted_exposures:
            modality = exp.modality.value
            if modality not in by_modality:
                by_modality[modality] = []
            by_modality[modality].append(exp)

        return {
            "total_exposures": len(sorted_exposures),
            "cumulative_dose_msv": cumulative,
            "age_adjusted_risk": age_adjusted_risk,
            "risk_category": risk_category,
            "background_comparison": background_comp,
            "by_modality": {
                mod: len(exps) for mod, exps in by_modality.items()
            },
            "date_range": {
                "first": sorted_exposures[0].date.isoformat() if sorted_exposures else None,
                "last": sorted_exposures[-1].date.isoformat() if sorted_exposures else None
            }
        }

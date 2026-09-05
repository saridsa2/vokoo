/**
 * Imaging Report data models.
 * Package: @wellally/health-models
 * Website: https://www.wellally.tech/
 * Schema: https://wellall.health/schemas/imaging-report/v0.1.0
 */

import { Modality, Coding } from './common';

/**
 * Imaging report performer (radiologist).
 */
export interface Performer {
  id?: string;
  name?: string;
  role?: string;
}

/**
 * CT radiation dose information.
 */
export interface RadiationDose {
  /**
   * CT Dose Index Volume (mGy)
   */
  ctdiVol_mGy?: number;

  /**
   * Dose Length Product (mGy·cm)
   */
  dlp_mGy_cm?: number;
}

/**
 * Report attachment (image, PDF, etc.).
 */
export interface Attachment {
  url?: string;
  type?: string;
}

/**
 * Diagnostic imaging report.
 */
export interface ImagingReport {
  /**
   * Unique report identifier
   */
  id: string;

  /**
   * Reference to Person.id
   */
  patientId: string;

  /**
   * Imaging modality (CT, MR, US, XR, PT)
   */
  modality: Modality;

  /**
   * Body site examined (SNOMED CT code)
   */
  bodySite: Coding;

  /**
   * Report timestamp (ISO 8601)
   */
  reportedAt: string;

  /**
   * DICOM Study Instance UID
   */
  studyInstanceUid?: string;

  /**
   * Radiologist information
   */
  performer?: Performer;

  /**
   * Imaging findings list
   */
  findings?: string[];

  /**
   * Diagnostic impression/conclusion
   */
  impression?: string;

  /**
   * Radiation dose (for CT)
   */
  radiationDose?: RadiationDose;

  /**
   * Attached files
   */
  attachments?: Attachment[];
}

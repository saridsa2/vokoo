/**
 * Lab Report data models.
 * Package: @vokoo/clinical-schemas
 * Website: https://github.com/saridsa2/vokoo
 * Schema: urn:vokoo:clinical:schema:lab-report:v0.1.0
 */

import { CodeableConcept, Quantity, ReferenceRange, Coding } from './common';

/**
 * Lab result interpretation
 */
export type Interpretation = 'N' | 'L' | 'H' | 'A';

/**
 * Lab facility information.
 */
export interface Facility {
  id?: string;
  name?: string;
}

/**
 * Specimen information.
 */
export interface Specimen {
  type?: Coding;
  collectedAt?: string;
}

/**
 * Individual lab test result.
 */
export interface LabResult {
  /**
   * LOINC code for the test
   */
  code: CodeableConcept;

  /**
   * Result value (Quantity, CodeableConcept, or string)
   */
  value: Quantity | CodeableConcept | string;

  /**
   * Normal reference range
   */
  referenceRange?: ReferenceRange;

  /**
   * N (normal), L (low), H (high), A (abnormal)
   */
  interpretation?: Interpretation;

  /**
   * Test method used
   */
  method?: CodeableConcept;
}

/**
 * Laboratory test report.
 */
export interface LabReport {
  /**
   * Unique report identifier
   */
  id: string;

  /**
   * Reference to Person.id
   */
  patientId: string;

  /**
   * Report issue timestamp (ISO 8601)
   */
  issuedAt: string;

  /**
   * List of lab test results
   */
  results: LabResult[];

  /**
   * Lab facility information
   */
  facility?: Facility;

  /**
   * Test panel code
   */
  panel?: CodeableConcept;

  /**
   * Specimen information
   */
  specimen?: Specimen;
}

/**
 * Medication Record data models.
 * Package: @vokoo/clinical-schemas
 * Website: https://github.com/saridsa2/vokoo
 * Schema: urn:vokoo:clinical:schema:medication:v0.1.0
 */

import { Coding, CodeableConcept, Route } from './common';

/**
 * Medication dosage amount.
 */
export interface Dosage {
  /**
   * Dose amount
   */
  value: number;

  /**
   * UCUM unit (e.g., mg, mL)
   */
  unit: string;
}

/**
 * Medication administration record.
 */
export interface MedicationRecord {
  /**
   * Unique record identifier
   */
  id: string;

  /**
   * Reference to Person.id
   */
  patientId: string;

  /**
   * Medication code (RxNorm)
   */
  medication: Coding;

  /**
   * Dose amount and unit
   */
  dosage: Dosage;

  /**
   * Administration route (PO, IV, etc.)
   */
  route: Route;

  /**
   * Start date (ISO 8601)
   */
  startDate: string;

  /**
   * Medication form (tablet, capsule, etc.)
   */
  form?: Coding;

  /**
   * Dosing frequency (QD, BID, TID, etc.)
   */
  frequency?: string;

  /**
   * Treatment duration in days
   */
  durationDays?: number;

  /**
   * End date (ISO 8601)
   */
  endDate?: string;

  /**
   * Indication for use
   */
  indication?: CodeableConcept;

  /**
   * Additional instructions
   */
  instructions?: string;
}

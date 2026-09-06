/**
 * Personal Health Record data models.
 * Package: @vokoo/clinical-schemas
 * Website: https://github.com/saridsa2/vokoo
 * Schema: urn:vokoo:clinical:schema:health:v0.1.0
 */

import { Identifier, HumanName, ContactPoint, Address, CodeableConcept } from './common';

/**
 * Gender type
 */
export type Gender = 'male' | 'female' | 'other' | 'unknown';

/**
 * Clinical summary information.
 */
export interface ClinicalSummary {
  /**
   * Known conditions/diagnoses (SNOMED CT or ICD-10)
   */
  conditions?: CodeableConcept[];

  /**
   * Allergy list
   */
  allergies?: CodeableConcept[];

  /**
   * Blood type (e.g., A+, O-)
   */
  bloodType?: string;

  /**
   * Primary care provider ID
   */
  primaryCareProvider?: string;
}

/**
 * Personal health record.
 */
export interface Person {
  /**
   * Unique person identifier (UUID/ULID)
   */
  id: string;

  /**
   * Resource type (always "Person")
   */
  resourceType: 'Person';

  /**
   * Person name(s)
   */
  name: HumanName[];

  /**
   * Date of birth (ISO 8601)
   */
  birthDate: string;

  /**
   * External identifiers (MRN, national ID, etc.)
   */
  identifier?: Identifier[];

  /**
   * Gender
   */
  gender?: Gender;

  /**
   * Contact points (phone, email)
   */
  telecom?: ContactPoint[];

  /**
   * Address(es)
   */
  address?: Address[];

  /**
   * Marital status
   */
  maritalStatus?: CodeableConcept;

  /**
   * Language preferences (IETF BCP-47 tags)
   */
  language?: string[];

  /**
   * Clinical summary
   */
  clinicalSummary?: ClinicalSummary;
}

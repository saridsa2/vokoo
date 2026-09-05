/**
 * Family Health Tree data models.
 * Package: @vokoo/clinical-schemas
 * Website: https://github.com/saridsa2/vokoo
 * Schema: urn:vokoo:clinical:schema:family-health:v0.1.0
 */

import { CodeableConcept } from './common';

/**
 * Relationship to proband
 */
export type RelationToProband =
  | 'self'
  | 'mother'
  | 'father'
  | 'sibling'
  | 'child'
  | 'grandparent'
  | 'grandchild'
  | 'aunt'
  | 'uncle'
  | 'cousin'
  | 'other';

/**
 * Biological sex
 */
export type Sex = 'male' | 'female' | 'other' | 'unknown';

/**
 * Family member in a health tree.
 */
export interface FamilyMember {
  /**
   * Member identifier
   */
  id: string;

  /**
   * Relationship to proband
   */
  relationToProband: RelationToProband;

  /**
   * Biological sex
   */
  sex?: Sex;

  /**
   * Year of birth
   */
  birthYear?: number;

  /**
   * Whether deceased
   */
  deceased?: boolean;

  /**
   * Health conditions (SNOMED CT or ICD-10)
   */
  conditions?: CodeableConcept[];
}

/**
 * Family health tree for genetic and hereditary disease tracking.
 */
export interface FamilyHealthTree {
  /**
   * ID of the proband (main individual)
   */
  probandId: string;

  /**
   * List of family members
   */
  members: FamilyMember[];
}

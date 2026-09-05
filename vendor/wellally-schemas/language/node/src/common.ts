/**
 * Common definitions and types for WellAll Health data models.
 * Package: @wellally/health-models
 * Website: https://www.wellally.tech/
 * Schema: https://wellall.health/schemas/common/v0.1.0
 */

/**
 * UCUM unit type
 */
export type UCUMUnit = string;

/**
 * Name usage context
 */
export type NameUse = 'official' | 'usual' | 'nickname' | 'anonymous' | 'old' | 'maiden';

/**
 * Contact system type
 */
export type ContactSystem = 'phone' | 'email';

/**
 * Contact use context
 */
export type ContactUse = 'home' | 'work' | 'mobile';

/**
 * Imaging modality codes
 */
export type ModalityCode = 'CT' | 'MR' | 'US' | 'XR' | 'PT';

/**
 * Represents a coded value from a terminology system.
 */
export interface Coding {
  /**
   * URI identifying the terminology system (e.g., http://loinc.org)
   */
  system: string;

  /**
   * The code value from the system
   */
  code: string;

  /**
   * Optional human-readable display text
   */
  display?: string;
}

/**
 * A concept that may be defined by one or more codes from formal terminologies.
 */
export interface CodeableConcept {
  /**
   * List of coded values (at least one required)
   */
  coding: Coding[];

  /**
   * Optional plain text representation
   */
  text?: string;
}

/**
 * A measured or measurable amount with a UCUM unit.
 */
export interface Quantity {
  /**
   * Numerical value
   */
  value: number;

  /**
   * UCUM unit string
   */
  unit: UCUMUnit;
}

/**
 * Reference range for lab test results.
 */
export interface ReferenceRange {
  /**
   * Lower bound quantity
   */
  low?: Quantity;

  /**
   * Upper bound quantity
   */
  high?: Quantity;

  /**
   * Optional textual description
   */
  text?: string;
}

/**
 * An identifier assigned to a resource.
 */
export interface Identifier {
  /**
   * URI identifying the namespace
   */
  system: string;

  /**
   * The identifier value
   */
  value: string;

  /**
   * Optional coded type
   */
  type?: CodeableConcept;

  /**
   * Optional validity period
   */
  period?: Period;
}

/**
 * A human's name with text, parts and usage information.
 */
export interface HumanName {
  /**
   * Family/last name
   */
  family: string;

  /**
   * Given/first name(s)
   */
  given: string[];

  /**
   * Name usage context
   */
  use?: NameUse;

  /**
   * Name prefix(es)
   */
  prefix?: string[];

  /**
   * Name suffix(es)
   */
  suffix?: string[];
}

/**
 * Contact details for a person or organization.
 */
export interface ContactPoint {
  /**
   * phone | email
   */
  system: ContactSystem;

  /**
   * The actual contact point value
   */
  value: string;

  /**
   * home | work | mobile
   */
  use?: ContactUse;
}

/**
 * An address for a person or organization.
 */
export interface Address {
  /**
   * Street address lines
   */
  line?: string[];

  /**
   * City name
   */
  city?: string;

  /**
   * State/province
   */
  state?: string;

  /**
   * Postal/zip code
   */
  postalCode?: string;

  /**
   * Country name
   */
  country?: string;
}

/**
 * A time period defined by start and end dates.
 */
export interface Period {
  /**
   * Start date (ISO 8601)
   */
  start?: string;

  /**
   * End date (ISO 8601)
   */
  end?: string;
}

/**
 * Imaging modality code (CT, MR, US, XR, PT).
 */
export interface Modality {
  /**
   * Terminology system URI
   */
  system: string;

  /**
   * Modality code
   */
  code: ModalityCode;

  /**
   * Optional display text
   */
  display?: string;
}

/**
 * Medication administration route.
 */
export interface Route {
  /**
   * Terminology system URI
   */
  system: string;

  /**
   * Route code (e.g., PO, IV, IM, SC, INH, SL, PR or SNOMED CT codes)
   */
  code: string;

  /**
   * Optional display text
   */
  display?: string;
}

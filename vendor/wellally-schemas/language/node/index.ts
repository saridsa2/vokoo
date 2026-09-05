// WellAll schemas v0.1.0 - TypeScript definitions
// Namespace aligned with wellally.tech

export interface Coding {
  system: string; // URI
  code: string;
  display?: string;
}

export interface CodeableConcept {
  coding: Coding[]; // minItems 1
  text?: string;
}

export interface Quantity {
  value: number;
  unit: string; // UCUM
}

export interface ReferenceRange {
  low?: Quantity;
  high?: Quantity;
  text?: string;
}

export interface Identifier {
  system: string; // URI
  value: string;
  type?: CodeableConcept;
  period?: Period; // validity window
}

export interface Period {
  start?: string; // ISO date
  end?: string;   // ISO date
}

export interface HumanName {
  family: string;
  given: string[]; // min 1
  use?: 'official' | 'usual' | 'nickname' | 'anonymous' | 'old' | 'maiden';
  prefix?: string[];
  suffix?: string[];
}

export interface ContactPoint {
  system: 'phone' | 'email';
  value: string;
  use?: 'home' | 'work' | 'mobile';
}

export interface Address {
  line?: string[];
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface Modality {
  system: string; // URI
  code: 'CT' | 'MR' | 'US' | 'XR' | 'PT';
  display?: string;
}

export interface Route {
  system: string; // URI
  code: string;   // PO/IV/etc or SNOMED code
  display?: string;
}

export interface SpecimenType {
  system: string;
  code: 'BLD' | 'SER' | 'PLAS' | 'UR';
  display?: string;
}

// ----- Health Person -----
export interface ClinicalSummary {
  conditions?: CodeableConcept[];
  allergies?: CodeableConcept[];
  bloodType?: string;
  primaryCareProvider?: string;
}

export interface HealthPerson {
  id: string;
  name: HumanName[];
  birthDate: string; // ISO date
  identifier?: Identifier[];
  resourceType?: 'Person';
  gender?: 'male' | 'female' | 'other' | 'unknown';
  telecom?: ContactPoint[];
  address?: Address[];
  maritalStatus?: CodeableConcept;
  language?: string[];
  clinicalSummary?: ClinicalSummary;
}

// ----- Lab Report -----
export type LabResultValue = Quantity | CodeableConcept | string;

export interface LabResult {
  code: CodeableConcept;
  value: LabResultValue;
  referenceRange?: ReferenceRange;
  interpretation?: 'N' | 'L' | 'H' | 'A';
  method?: CodeableConcept;
}

export interface Specimen {
  type?: SpecimenType;
  collectedAt?: string; // ISO date-time
}

export interface Facility {
  id?: string;
  name?: string;
}

export interface LabReport {
  id: string;
  patientId: string;
  issuedAt: string; // ISO date-time
  results: LabResult[];
  facility?: Facility;
  panel?: CodeableConcept;
  specimen?: Specimen;
}

// ----- Imaging Report -----
export interface Attachment {
  url?: string;
  type?: string; // thumbnail/report PDF etc.
}

export interface RadiationDose {
  ctdiVol_mGy?: number;
  dlp_mGy_cm?: number;
}

export interface Performer {
  id?: string;
  name?: string;
  role?: string;
}

export interface ImagingReport {
  id: string;
  patientId: string;
  modality: Modality;
  bodySite: Coding;
  reportedAt: string; // ISO date-time
  studyInstanceUid?: string;
  performer?: Performer;
  findings?: string[];
  impression?: string;
  radiationDose?: RadiationDose;
  attachments?: Attachment[];
}

// ----- Medication -----
export interface Dosage {
  value: number;
  unit: string; // UCUM unit
}

export interface MedicationRecord {
  id: string;
  patientId: string;
  medication: Coding;
  dosage: Dosage;
  route: Route;
  startDate: string; // ISO date
  form?: Coding;
  frequency?: string;
  durationDays?: number;
  endDate?: string;
  indication?: CodeableConcept;
  instructions?: string;
}

// ----- Family Health Tree -----
export interface FamilyMember {
  id: string;
  relationToProband: 'self' | 'mother' | 'father' | 'sibling' | 'child' | 'grandparent' | 'grandchild' | 'aunt' | 'uncle' | 'cousin' | 'other';
  sex?: 'male' | 'female' | 'other' | 'unknown';
  birthYear?: number;
  deceased?: boolean;
  conditions?: CodeableConcept[];
}

export interface FamilyHealthTree {
  probandId: string;
  members: FamilyMember[];
}

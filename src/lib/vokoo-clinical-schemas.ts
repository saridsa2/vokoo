import familyHealth from "../../vendor/vokoo-clinical-schemas/infrastructure/schemas/family-health/schema/family-health.schema.json";
import health from "../../vendor/vokoo-clinical-schemas/infrastructure/schemas/health/schema/health.schema.json";
import imagingReport from "../../vendor/vokoo-clinical-schemas/infrastructure/schemas/imaging-report/schema/imaging-report.schema.json";
import labReport from "../../vendor/vokoo-clinical-schemas/infrastructure/schemas/lab-report/schema/lab-report.schema.json";
import medication from "../../vendor/vokoo-clinical-schemas/infrastructure/schemas/medication/schema/medication.schema.json";

export const CLINICAL_SCHEMA_KINDS = ["person", "lab_report", "imaging_report", "medication", "family_health"] as const;

export type ClinicalSchemaKind = (typeof CLINICAL_SCHEMA_KINDS)[number];

type JsonSchema = {
    $id?: string;
    title?: string;
    required?: string[];
    properties?: Record<string, { type?: string; $ref?: string }>;
    [key: string]: unknown;
};

const SCHEMAS: Record<ClinicalSchemaKind, { label: string; schema: JsonSchema }> = {
    person: { label: "Person", schema: health },
    lab_report: { label: "Lab report", schema: labReport },
    imaging_report: { label: "Imaging report", schema: imagingReport },
    medication: { label: "Medication", schema: medication },
    family_health: { label: "Family health", schema: familyHealth },
};

export function clinicalSchema(kind: ClinicalSchemaKind) {
    const selected = SCHEMAS[kind];
    if (!selected) throw new Error(`unknown clinical schema kind ${JSON.stringify(kind)}`);
    return selected;
}

export function clinicalSchemaFields(kind: ClinicalSchemaKind) {
    const schema = clinicalSchema(kind).schema;
    const required = new Set(schema.required ?? []);
    return Object.entries(schema.properties ?? {}).map(([name, property]) => ({
        name,
        required: required.has(name),
        type: property.type ?? (property.$ref ? "object" : "unknown"),
    }));
}

export const CLINICAL_SCHEMA_OPTIONS = CLINICAL_SCHEMA_KINDS.map((id) => ({
    id,
    label: SCHEMAS[id].label,
}));

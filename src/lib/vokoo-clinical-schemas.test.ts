import assert from "node:assert/strict";
import test from "node:test";
import compiledSchemas from "./clinical-schemas.json";
import { CLINICAL_SCHEMA_KINDS, clinicalSchema, clinicalSchemaFields } from "./vokoo-clinical-schemas.ts";

test("the five built-in clinical choices use VoKoo schema identities", () => {
    assert.deepEqual(CLINICAL_SCHEMA_KINDS, ["person", "lab_report", "imaging_report", "medication", "family_health"]);

    assert.equal(clinicalSchema("person").schema.$id, "urn:vokoo:clinical:schema:health:v0.1.0");
    assert.equal(clinicalSchema("lab_report").schema.$id, "urn:vokoo:clinical:schema:lab-report:v0.1.0");
});

test("field metadata comes from the schema properties", () => {
    assert.deepEqual(clinicalSchemaFields("medication").slice(0, 4), [
        { name: "id", required: true, type: "string" },
        { name: "patientId", required: true, type: "string" },
        { name: "medication", required: true, type: "object" },
        { name: "form", required: false, type: "object" },
    ]);
});

test("inlining a reference preserves the field description beside it", () => {
    const medication = compiledSchemas.medication.schema.properties as Record<string, Record<string, unknown>>;
    const imaging = compiledSchemas["imaging-report"].schema.properties as Record<string, Record<string, unknown>>;

    assert.equal(medication.medication?.description, "Medication code, preferably from RxNorm.");
    assert.equal(imaging.bodySite?.description, "Examined body site, preferably coded with a SNOMED CT anatomical structure code.");
});

test("an unknown clinical kind is rejected instead of falling back to generic JSON", () => {
    assert.throws(() => clinicalSchema("encounter" as never), /unknown clinical schema kind/);
});

test("clinical schema descriptions are written in English for the compiler", () => {
    const descriptions: string[] = [];
    const visit = (value: unknown) => {
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        if (!value || typeof value !== "object") return;
        const record = value as Record<string, unknown>;
        if (typeof record.description === "string") descriptions.push(record.description);
        Object.values(record).forEach(visit);
    };

    for (const kind of CLINICAL_SCHEMA_KINDS) visit(clinicalSchema(kind).schema);

    assert.ok(descriptions.length > 0);
    assert.deepEqual(
        descriptions.filter((description) => /[\u4e00-\u9fff]/u.test(description)),
        [],
    );
});

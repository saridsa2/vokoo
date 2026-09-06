import assert from "node:assert/strict";
import test from "node:test";
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

test("an unknown clinical kind is rejected instead of falling back to generic JSON", () => {
    assert.throws(() => clinicalSchema("encounter" as never), /unknown clinical schema kind/);
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { defineSchema, assertSchemasPushable, schemaManifestEntry } from "./define-schema.ts";

const ID = "c9f84c8d-0bdc-4d8a-a393-6f0d1c75bdcf";
const OTHER = "d4e81f37-6a92-4c05-b8e1-3f7a9d206c58";

const lead = () =>
    defineSchema({
        id: ID,
        name: "Clinic lead",
        description: "What a clinic wants in its CRM after a call.",
        fields: {
            patient_name: { type: "string", description: "As the caller said it" },
            intent: { type: "string", required: true, enum: ["book", "cancel", "enquiry"] },
        },
    });

test("compiles fields the same way a tool's input is compiled", () => {
    const compiled = lead();
    assert.equal(compiled.schema.type, "object");
    assert.equal(compiled.schema.properties.patient_name.type, "string");
    assert.deepEqual(compiled.schema.required, ["intent"]);
    // An optional field must not appear in `required`, or a model is forced to
    // invent a value for something the call never mentioned.
    assert.ok(!compiled.schema.required?.includes("patient_name"));
});

test("refuses a schema with no fields", () => {
    // It would compile to `{}`, which a model satisfies by returning nothing —
    // and nobody notices until a webhook arrives empty.
    assert.throws(
        () => defineSchema({ id: ID, name: "Empty", description: "x", fields: {} }),
        /no fields/,
    );
});

test("refuses a missing description", () => {
    assert.throws(
        () => defineSchema({ id: ID, name: "Lead", description: "  ", fields: { a: { type: "string" } } }),
        /needs a description/,
    );
});

test("refuses an id that is not a UUID", () => {
    assert.throws(
        () => defineSchema({ id: "lead-1", name: "Lead", description: "x", fields: { a: { type: "string" } } }),
        /needs an id/,
    );
});

test("reports a bad field against the schema that has it", () => {
    assert.throws(
        () =>
            defineSchema({
                id: ID,
                name: "Lead",
                description: "x",
                // An array with no item type tells a model to send a list and
                // nothing about what goes in it.
                fields: { tags: { type: "array" } },
            }),
        /has a bad field/,
    );
});

test("refuses two schemas sharing an id, and two sharing a name", () => {
    const a = lead();
    const b = defineSchema({ ...a, name: "Another" });
    assert.throws(() => assertSchemasPushable([a, b]), /share the id/);

    const c = defineSchema({ ...a, id: OTHER });
    assert.throws(() => assertSchemasPushable([a, c]), /both named/);
});

test("the manifest entry says it is not a tool", () => {
    // The push endpoint takes both in one call, and this is what tells them
    // apart on the far side.
    assert.equal(schemaManifestEntry(lead()).isTool, false);
});

test("locked defaults to true, and false survives being said", () => {
    // The default is the load-bearing half: a file's authority is its
    // repository, so anything pushed is locked unless the author says
    // otherwise. Getting this backwards would let the console accept an edit
    // that the next push silently discards.
    assert.equal(schemaManifestEntry(lead()).locked, true);

    const editable = defineSchema({
        id: OTHER,
        name: "Team edited",
        description: "Descriptions refined by whoever reads the calls.",
        locked: false,
        fields: { note: { type: "string" } },
    });
    assert.equal(schemaManifestEntry(editable).locked, false);
});

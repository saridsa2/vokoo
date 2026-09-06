import assert from "node:assert/strict";
import { test } from "node:test";

import { addableFor, boardTakesExpressions } from "./architecture-model.ts";
import { CARE_PATH_WORKSPACE, carePathOptions } from "./care-path-workspace.ts";

const CARE_PATH_COMPONENTS = [
    "trigger.due",
    "trigger.recurring",
    "trigger.reported",
    "trigger.document",
    "outreach.call",
    "outreach.message",
    "outreach.request",
    "care_path.record",
    "care_path.complete",
    "escalate.notify",
] as const;

test("offers every first-class care-path component on a care-path board", () => {
    const offered = new Set(addableFor("care_path"));

    for (const component of CARE_PATH_COMPONENTS) {
        assert.equal(offered.has(component), true, `${component} should be offered`);
    }
});

test("care-path fields may use values produced earlier in the patient-scoped run", () => {
    assert.equal(boardTakesExpressions("care_path"), true);
});

test("cohort care-path choices exclude call and integration flows", () => {
    assert.deepEqual(
        carePathOptions([
            { id: "call", name: "Reception", family: "call", status: "published" },
            { id: "path", name: "Antenatal care", family: "care_path", status: "published" },
            { id: "integration", name: "CRM push", family: "integration", status: "published" },
        ]),
        [{ id: "path", label: "Antenatal care" }],
    );
});

test("a new care path starts at an explicit configurable due trigger", () => {
    assert.equal(CARE_PATH_WORKSPACE.family, "care_path");
    assert.equal(CARE_PATH_WORKSPACE.trigger_event, "care_path.due");
    assert.equal(CARE_PATH_WORKSPACE.trigger, "trigger.due");
    assert.deepEqual(CARE_PATH_WORKSPACE.triggerConfig, {
        key: "",
        anchor: "enrolment",
        offset_days: 0,
        window_days: 0,
    });
});

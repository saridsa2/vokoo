import assert from "node:assert/strict";
import test from "node:test";

import { callFlowChoices, selectedCallFlow } from "./number-flow-binding";

test("only call-family flows can be selected for a phone number", () => {
    const choices = callFlowChoices([
        { id: "call", family: "call" },
        { id: "crm", family: "integration" },
        { id: "care", family: "care_path" },
    ]);

    assert.deepEqual(choices.map((flow) => flow.id), ["call"]);
});

test("the answered binding is the one call flow even when legacy rows remain", () => {
    assert.equal(
        selectedCallFlow([
            { trigger_event: "call.ended", flow_id: "old-crm" },
            { trigger_event: "call.answered", flow_id: "call-flow" },
            { trigger_event: "call.failed", flow_id: "old-escalation" },
        ]),
        "call-flow",
    );
});

test("ended-only legacy configuration is not presented as a call flow", () => {
    assert.equal(selectedCallFlow([{ trigger_event: "call.ended", flow_id: "old-crm" }]), null);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("the shared dialog gives React Aria a title slot", () => {
    const dialog = readFileSync(new URL("components/application/modals/standard-dialog.tsx", root), "utf8");
    const auth = readFileSync(new URL("components/blocks/auth-2.tsx", root), "utf8");

    assert.match(dialog, /<Heading slot="title"/);
    assert.match(auth, /title="Sign in"/);
});

test("nested schemas keep their complete stored preview and are not flattened for editing", async () => {
    const { schemaEditorPresentation } = await import("./schema-editor.ts");
    const stored = {
        type: "object",
        properties: {
            facility: { type: "object", properties: { name: { type: "string" } } },
            results: { type: "array", items: { type: "object", properties: { value: { type: "number" } } } },
        },
    };

    const presentation = schemaEditorPresentation(stored);
    assert.equal(presentation.editableAsFields, false);
    assert.deepEqual(presentation.preview, stored);
    assert.equal(presentation.rows[0]?.type, "object");
    assert.equal(presentation.rows[0]?.children[0]?.name, "name");
    assert.equal(presentation.rows[1]?.type, "array");
    assert.equal(presentation.rows[1]?.children[0]?.name, "items");
});

test("agent subtitles omit empty stack components", async () => {
    const { agentStackSubtitle } = await import("./agent-display.ts");

    assert.equal(agentStackSubtitle(null, ""), "no transcriber · kookoo");
    assert.equal(agentStackSubtitle("deepgram", "gemini"), "deepgram · gemini · kookoo");
});

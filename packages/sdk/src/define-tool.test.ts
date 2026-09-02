import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertPushable, defineTool, manifestEntry, type AnyTool } from "./define-tool.ts";
import { compileSchema, decompileSchema } from "./schema.ts";

const ID = "c9f84c8d-0bdc-4d8a-a393-6f0d1c75bdcf";
const OTHER_ID = "0b4a3f6e-8d21-4b7c-9f10-2ac5d8e3b901";

/** The tool the spec uses as its worked example. */
const checkSlots = () =>
    defineTool({
        id: ID,
        name: "check_slots",
        description: "Find open appointment slots for a doctor on a date.",
        input: {
            doctor: { type: "string", required: true, description: "Surname, as the caller said it." },
            date: { type: "string", required: true },
            limit: { type: "integer" },
        },
        timeoutSeconds: 10,
        handler: async () => ({ slots: [] }),
    });

describe("compileSchema", () => {
    it("emits what the dispatcher and Gemini both read", () => {
        const schema = compileSchema({
            doctor: { type: "string", required: true, description: "Surname." },
            urgent: { type: "boolean" },
        });
        assert.deepEqual(schema, {
            type: "object",
            properties: {
                doctor: { type: "string", description: "Surname." },
                urgent: { type: "boolean" },
            },
            required: ["doctor"],
        });
    });

    it("leaves required out rather than emitting it empty", () => {
        // `required: []` is rejected by draft-04 validators and says nothing.
        const schema = compileSchema({ note: { type: "string" } });
        assert.equal("required" in schema, false);
    });

    it("accepts a tool that takes no arguments", () => {
        assert.deepEqual(compileSchema(undefined), { type: "object", properties: {} });
    });

    it("refuses an array with no item type", () => {
        // Otherwise the model is told to send a list and nothing about what
        // goes in it.
        assert.throws(() => compileSchema({ tags: { type: "array" } }), /needs items/);
    });

    it("refuses an enum whose values contradict the declared type", () => {
        assert.throws(
            () => compileSchema({ mode: { type: "string", enum: [1, 2] } }),
            /is a string but its enum contains 1/,
        );
    });

    it("treats an integer enum as numeric", () => {
        const schema = compileSchema({ priority: { type: "integer", enum: [1, 2, 3] } });
        assert.deepEqual(schema.properties.priority, { type: "integer", enum: [1, 2, 3] });
    });

    it("refuses an unknown type", () => {
        assert.throws(
            // @ts-expect-error the point of the test is a type the compiler rejects
            () => compileSchema({ when: { type: "datetime" } }),
            /not one of string, number, integer, boolean, array, object/,
        );
    });

    it("refuses an argument name the model cannot address", () => {
        assert.throws(() => compileSchema({ "doctor name": { type: "string" } }), /not a usable argument name/);
    });

    it("does not alias the caller's enum array", () => {
        const values = ["a", "b"];
        const schema = compileSchema({ mode: { type: "string", enum: values } });
        values.push("c");
        assert.deepEqual(schema.properties.mode?.enum, ["a", "b"]);
    });
});

describe("defineTool", () => {
    it("compiles the schema once and keeps the definition", () => {
        const tool = checkSlots();
        assert.equal(tool.name, "check_slots");
        assert.deepEqual(tool.schema.required, ["doctor", "date"]);
        assert.equal(typeof tool.handler, "function");
    });

    it("refuses an id that is not a UUID", () => {
        assert.throws(
            () => defineTool({ id: "check-slots", name: "check_slots", description: "x", handler: () => 1 }),
            /needs an id: a UUID written in the source/,
        );
    });

    it("names the tool in the error when the id is missing", () => {
        // A build failure that does not say which of forty files it came from
        // is a search, not a message.
        assert.throws(
            // @ts-expect-error id is required
            () => defineTool({ name: "check_slots", description: "x", handler: () => 1 }),
            /in "check_slots"/,
        );
    });

    it("refuses a name Gemini would not accept", () => {
        for (const name of ["2fast", "check slots", "check-slots", ""]) {
            assert.throws(
                () => defineTool({ id: ID, name, description: "x", handler: () => 1 }),
                /not a usable tool name/,
                `expected "${name}" to be refused`,
            );
        }
    });

    it("refuses an empty description", () => {
        // With none, the model chooses between tools by name alone.
        assert.throws(
            () => defineTool({ id: ID, name: "check_slots", description: "   ", handler: () => 1 }),
            /needs a description/,
        );
    });

    it("refuses a missing handler", () => {
        assert.throws(
            // @ts-expect-error handler is required
            () => defineTool({ id: ID, name: "check_slots", description: "x" }),
            /needs a handler function/,
        );
    });

    it("refuses a timeout nobody would still be on the line for", () => {
        assert.throws(
            () => defineTool({ id: ID, name: "check_slots", description: "x", timeoutSeconds: 900, handler: () => 1 }),
            /above the 300s ceiling/,
        );
        assert.throws(
            () => defineTool({ id: ID, name: "check_slots", description: "x", timeoutSeconds: 0, handler: () => 1 }),
            /not a positive number of seconds/,
        );
    });

    it("reports a bad input against the tool that has it", () => {
        assert.throws(
            () =>
                defineTool({
                    id: ID,
                    name: "check_slots",
                    description: "x",
                    input: { tags: { type: "array" } },
                    handler: () => 1,
                }),
            /the tool "check_slots" has a bad input: .*needs items/,
        );
    });

    it("passes arguments and context through to the handler", async () => {
        let seen: unknown;
        const tool = defineTool<{ doctor: string }>({
            id: ID,
            name: "check_slots",
            description: "x",
            input: { doctor: { type: "string", required: true } },
            handler: (args, ctx) => {
                seen = { args, orgId: ctx.orgId };
                return { ok: true };
            },
        });
        const result = await tool.handler({ doctor: "Rao" }, {
            callId: null,
            orgId: "org-1",
            variables: {},
            secrets: {},
            fetch: globalThis.fetch,
        });
        assert.deepEqual(seen, { args: { doctor: "Rao" }, orgId: "org-1" });
        assert.deepEqual(result, { ok: true });
    });
});

describe("manifestEntry", () => {
    it("carries what the receiver needs and nothing else", () => {
        const entry = manifestEntry(checkSlots());
        assert.deepEqual(entry, {
            id: ID,
            name: "check_slots",
            description: "Find open appointment slots for a doctor on a date.",
            schema: {
                type: "object",
                properties: {
                    doctor: { type: "string", description: "Surname, as the caller said it." },
                    date: { type: "string" },
                    limit: { type: "integer" },
                },
                required: ["doctor", "date"],
            },
            timeoutSeconds: 10,
            // No registry schema named: this tool declared its input inline,
            // which is the right answer for a shape nothing else wants.
            schemaId: null,
            // Absent in the source means locked. A file's authority is its
            // repository, and a console edit would be lost on the next push.
            locked: true,
            isTool: true,
        });
        // The handler is code, not manifest. It ships as a bundle.
        assert.equal("handler" in entry, false);
    });

    it("reports an absent timeout as null rather than omitting it", () => {
        const tool = defineTool({ id: ID, name: "a_tool", description: "x", handler: () => 1 });
        assert.equal(manifestEntry(tool).timeoutSeconds, null);
    });
});

describe("assertPushable", () => {
    const tool = (id: string, name: string): AnyTool =>
        defineTool({ id, name, description: "x", handler: () => 1 });

    it("accepts distinct tools", () => {
        assert.doesNotThrow(() => assertPushable([tool(ID, "one"), tool(OTHER_ID, "two")]));
    });

    it("refuses two tools sharing an authored id", () => {
        // The cost of client-authored identity: copy-paste produces this, and
        // sync would treat one as a rename of the other.
        assert.throws(() => assertPushable([tool(ID, "one"), tool(ID, "two")]), /share the id/);
    });

    it("refuses two tools sharing a name", () => {
        // The model calls a tool by name, and the dispatcher looks it up by
        // name, so a duplicate makes which one runs a matter of row order.
        assert.throws(() => assertPushable([tool(ID, "same"), tool(OTHER_ID, "same")]), /both named "same"/);
    });
});

describe("decompileSchema", () => {
    it("round-trips what compileSchema emits", () => {
        // The property that matters: adopting a tool must not change the
        // contract the model is already being shown.
        const input = {
            doctor: { type: "string", required: true, description: "Surname." },
            limit: { type: "integer" },
            tags: { type: "array", items: { type: "string" } },
            mode: { type: "string", enum: ["fast", "slow"] },
        } as const;
        assert.deepEqual(compileSchema(decompileSchema(compileSchema(input))), compileSchema(input));
    });

    it("marks required fields from the required list", () => {
        const input = decompileSchema({ type: "object", properties: { a: { type: "string" }, b: { type: "string" } }, required: ["b"] });
        assert.equal(input.a?.required, undefined);
        assert.equal(input.b?.required, true);
    });

    it("drops what this vocabulary cannot express, rather than guessing", () => {
        const input = decompileSchema({ type: "object", properties: { when: { type: "datetime" }, ok: { type: "boolean" } } });
        assert.deepEqual(Object.keys(input), ["ok"]);
    });

    it("gives an array from an older schema an item type it can compile", () => {
        const input = decompileSchema({ type: "object", properties: { tags: { type: "array" } } });
        assert.deepEqual(input.tags?.items, { type: "string" });
        assert.doesNotThrow(() => compileSchema(input));
    });

    it("survives a tool with no schema at all", () => {
        assert.deepEqual(decompileSchema(undefined), {});
        assert.deepEqual(decompileSchema({}), {});
    });
});

/**
 * Declaring a named shape.
 *
 * The same idea as `defineTool` and deliberately the same shape: an id you
 * write, a name the rest of the system calls it by, a description written for
 * whoever reads it, and fields compiled by the same `compileSchema` a tool's
 * input goes through. One vocabulary, one compiler, one set of mistakes it
 * refuses.
 *
 * A schema exists because more than one thing wants the same shape. A tool
 * declares what it takes; an intelligence node fills one in from a call; a
 * webhook sends one to a CRM. When those are written separately they drift, and
 * the drift is invisible until a payload is rejected by something that was
 * never told the shape had changed.
 */

import { compileSchema, type InputMap, type JsonSchema } from "./schema.ts";

export type SchemaDefinition = {
    /**
     * A UUID written here and never assigned by the server, for the same reason
     * a tool's is: sync matches on it, so renaming the schema is an update
     * rather than a delete and an insert — which would detach it from every
     * node that points at it.
     */
    id: string;
    /** Unique within the organisation. This is what a node names. */
    name: string;
    /**
     * What this shape is for. Read by a person choosing between schemas, and by
     * the model filling one in — it is given as the tool description when an
     * intelligence node forces a call.
     */
    description: string;
    fields: InputMap;
    /**
     * Whether the console may edit this.
     *
     * **Absent means locked**, because a schema in a file has its authority in
     * a repository: a console edit would be accepted and then silently
     * discarded by the next push, which is the worst shape a failure can take.
     *
     * `false` is a real choice, not an escape hatch — a developer scaffolds a
     * shape and wants the team to refine the field descriptions where they can
     * see the calls it came from.
     */
    locked?: boolean;
};

export type CompiledSchema = SchemaDefinition & { schema: JsonSchema };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Letters, digits and underscores. The same rule a tool name follows, because
 * both end up in a prompt and a name that looks like a number reads as one.
 */
const SCHEMA_NAME = /^[a-zA-Z][a-zA-Z0-9_ -]{0,63}$/;

export function defineSchema(definition: SchemaDefinition): CompiledSchema {
    const { id, name, description, fields } = definition ?? ({} as SchemaDefinition);
    const where = typeof name === "string" && name ? ` in "${name}"` : "";

    if (typeof id !== "string" || !UUID.test(id)) {
        throw new Error(
            `a schema${where} needs an id: a UUID written in the source. Run "vokoo new --schema" to scaffold one.`,
        );
    }
    if (typeof name !== "string" || !SCHEMA_NAME.test(name)) {
        throw new Error(
            `"${String(name)}" is not a usable schema name — start with a letter, up to 64 characters`,
        );
    }
    if (typeof description !== "string" || description.trim().length === 0) {
        // Not decoration: a model asked to fill this in is told what it is for
        // by this sentence and nothing else.
        throw new Error(`the schema "${name}" needs a description — it is what a reader and a model use to tell it apart`);
    }
    if (!fields || typeof fields !== "object" || Object.keys(fields).length === 0) {
        // A schema with no fields compiles to `{}`, which a model satisfies by
        // returning nothing and which nobody notices until a webhook is empty.
        throw new Error(`the schema "${name}" has no fields, so there is nothing for anything to fill in`);
    }

    let schema: JsonSchema;
    try {
        schema = compileSchema(fields);
    } catch (error) {
        throw new Error(`the schema "${name}" has a bad field: ${(error as Error).message}`);
    }

    return { ...definition, schema };
}

/** One entry of what `vokoo push` sends for a schema. */
export type SchemaManifestEntry = {
    id: string;
    name: string;
    description: string;
    schema: JsonSchema;
    locked: boolean;
    isTool: false;
};

export function schemaManifestEntry(compiled: CompiledSchema): SchemaManifestEntry {
    return {
        id: compiled.id,
        name: compiled.name,
        description: compiled.description,
        schema: compiled.schema,
        // Sent explicitly rather than left to the server's default, so what a
        // file says is what arrives — including when it says `false`.
        locked: compiled.locked ?? true,
        isTool: false,
    };
}

/**
 * Refuse a set of schemas that cannot be pushed as one.
 *
 * The same two copy-paste mistakes `assertPushable` catches for tools, and they
 * exist for the same reason: the id is authored.
 */
export function assertSchemasPushable(schemas: CompiledSchema[]): void {
    const byId = new Map<string, string>();
    const byName = new Map<string, string>();

    for (const schema of schemas) {
        const seenId = byId.get(schema.id);
        if (seenId) {
            throw new Error(
                `"${schema.name}" and "${seenId}" share the id ${schema.id} — an id identifies one schema, so give the copy its own`,
            );
        }
        byId.set(schema.id, schema.name);

        const seenName = byName.get(schema.name);
        if (seenName) {
            throw new Error(`two schemas are both named "${schema.name}" — a node points at one by name, so it has to be unique`);
        }
        byName.set(schema.name, schema.name);
    }
}

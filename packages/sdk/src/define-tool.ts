/**
 * Declaring a function an agent can call.
 *
 * The declaration and the handler live in one place on purpose. A description
 * that has drifted from what its code does is a model being told something
 * untrue, and the model has no way to find out — it reads the description,
 * decides to call the tool, and tells a caller what it believed.
 *
 * Everything here is checked when the module is loaded, so a mistake is a build
 * failure rather than a live call that ends in `finish_call(note: "Internal
 * error checking slots.")`.
 */

import { compileSchema, type InputMap, type JsonSchema } from "./schema.ts";

/** What a handler is given about the call it is running for. */
export type ToolContext = {
    /** The call this is running for, or null for `vokoo run`. */
    callId: string | null;
    orgId: string;
    /** Values the flow's `var` nodes have accumulated. */
    variables: Record<string, unknown>;
    /** Resolved per invocation, never built into the bundle. */
    secrets: Record<string, string>;
    /**
     * Outbound HTTP. A wrapper rather than the global so a call is attributable
     * in the logs and can later be given an allowlist without editing handlers.
     */
    fetch: typeof globalThis.fetch;
};

export type ToolHandler<Args> = (args: Args, ctx: ToolContext) => unknown | Promise<unknown>;

export type ToolDefinition<Args = Record<string, unknown>> = {
    /**
     * A UUID written here and never assigned by the server.
     *
     * Sync matches on it, so renaming the tool is an update rather than a
     * delete and an insert — which would orphan every `call_events` row that
     * named it and detach it from the skills it was granted to. `vokoo new`
     * generates it so nobody types one.
     */
    id: string;
    /** Unique within the organisation. This is what the model calls. */
    name: string;
    /** What the model reads when deciding whether to call this. Prompt text. */
    description: string;
    input?: InputMap;
    /** Wall clock, enforced by the executor. */
    timeoutSeconds?: number;
    /**
     * The registry schema this tool takes as its input, by name or id.
     *
     * An alternative to declaring `input` inline, for a shape more than one
     * thing wants. **A plain reference, not an import** — a tool drawn on a
     * canvas has no file to import from, and anything the push must parse to
     * understand a relationship is a thing a canvas cannot produce.
     *
     * What ships is the reference *and* the compiled snapshot, so the model is
     * shown what was pushed rather than whatever the registry says today.
     */
    inputSchema?: string;
    /**
     * Whether the console may edit this. Absent means locked — see
     * `SchemaDefinition.locked`, which says why at length.
     */
    locked?: boolean;
    handler: ToolHandler<Args>;
};

/** A definition with the schema every other reader wants, compiled once. */
export type CompiledTool<Args = Record<string, unknown>> = ToolDefinition<Args> & {
    schema: JsonSchema;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Gemini accepts letters, digits and underscores, and the name also has to read
 * well in a prompt. Leading digits are excluded because a name that looks like a
 * number reads as one.
 */
const TOOL_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

/** An upper bound on `timeoutSeconds`, past which a caller has hung up anyway. */
const MAX_TIMEOUT_SECONDS = 300;

export function defineTool<Args = Record<string, unknown>>(
    definition: ToolDefinition<Args>,
): CompiledTool<Args> {
    const { id, name, description, input, timeoutSeconds, handler } = definition ?? ({} as ToolDefinition<Args>);

    // Reported with the name where there is one, because a build failure that
    // does not say which of forty files it came from is a search, not a message.
    const where = typeof name === "string" && name ? ` in "${name}"` : "";

    if (typeof id !== "string" || !UUID.test(id)) {
        throw new Error(
            `a tool${where} needs an id: a UUID written in the source. Run "vokoo new" to scaffold one.`,
        );
    }
    if (typeof name !== "string" || !TOOL_NAME.test(name)) {
        throw new Error(
            `"${String(name)}" is not a usable tool name — start with a letter and use letters, digits and underscores, up to 64 characters`,
        );
    }
    if (typeof description !== "string" || description.trim().length === 0) {
        // Not decoration: with no description the model is choosing between
        // tools by name alone.
        throw new Error(`the tool "${name}" needs a description — it is what the model reads to decide whether to call it`);
    }
    if (typeof handler !== "function") {
        throw new Error(`the tool "${name}" needs a handler function`);
    }
    if (timeoutSeconds !== undefined) {
        if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
            throw new Error(`the tool "${name}" has timeoutSeconds ${timeoutSeconds}, which is not a positive number of seconds`);
        }
        if (timeoutSeconds > MAX_TIMEOUT_SECONDS) {
            throw new Error(
                `the tool "${name}" asks for ${timeoutSeconds}s, above the ${MAX_TIMEOUT_SECONDS}s ceiling — nobody is still on the line`,
            );
        }
    }

    let schema: JsonSchema;
    try {
        schema = compileSchema(input);
    } catch (error) {
        throw new Error(`the tool "${name}" has a bad input: ${(error as Error).message}`);
    }

    return { ...definition, schema };
}

/** One entry of what `vokoo push` sends. The CLI adds the bundle and checksum. */
export type ManifestEntry = {
    id: string;
    name: string;
    description: string;
    schema: JsonSchema;
    timeoutSeconds: number | null;
    /** The registry schema named, if any. Sent as `schemaId`. */
    schemaId: string | null;
    locked: boolean;
    isTool: true;
};

/**
 * Any tool, whatever its arguments.
 *
 * `any` rather than a union or `unknown`: a project's tools have different
 * argument shapes, a handler is contravariant in its argument, and the
 * functions below read only a tool's metadata. Narrowing it here would make
 * every caller cast instead.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = CompiledTool<any>;

export function manifestEntry(tool: AnyTool): ManifestEntry {
    return {
        id: tool.id,
        name: tool.name,
        description: tool.description,
        schema: tool.schema,
        timeoutSeconds: tool.timeoutSeconds ?? null,
        schemaId: tool.inputSchema ?? null,
        locked: tool.locked ?? true,
        isTool: true,
    };
}

/**
 * Refuse a set of tools that cannot be pushed as one.
 *
 * Two failures exist because ids are authored rather than assigned, and both are
 * copy-paste: the same id on two tools, and the same name on two tools. The
 * second matters because `tools.name` is what the model calls and what the
 * dispatcher looks up, so a duplicate makes which one runs a matter of row
 * order.
 */
export function assertPushable(tools: AnyTool[]): void {
    const byId = new Map<string, string>();
    const byName = new Map<string, string>();

    for (const tool of tools) {
        const seenId = byId.get(tool.id);
        if (seenId) {
            throw new Error(
                `"${tool.name}" and "${seenId}" share the id ${tool.id} — an id identifies one tool, so give the copy its own`,
            );
        }
        byId.set(tool.id, tool.name);

        const seenName = byName.get(tool.name);
        if (seenName) {
            throw new Error(`two tools are both named "${tool.name}" — the model calls a tool by name, so it has to be unique`);
        }
        byName.set(tool.name, tool.name);
    }
}

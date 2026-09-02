/**
 * A functions project: finding the tools in it, and what gets sent.
 *
 * There is no bundler here on purpose. A tool is shipped as one file, twice:
 * `source` as you wrote it, and `code` with the types stripped by Node itself.
 * That keeps the package dependency-free.
 *
 * The cost is that a tool is one file. A handler importing a sibling would push
 * a file whose import cannot be resolved on the other side, and the failure
 * would land on a caller rather than here — so `checkSource` refuses it, and
 * says what to do instead.
 */

import { createHash } from "node:crypto";
import { stripTypeScriptTypes } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

import {
    assertPushable,
    assertSchemasPushable,
    decompileSchema,
    manifestEntry,
    schemaManifestEntry,
    type AnyTool,
    type CompiledSchema,
    type InputMap,
    type ManifestEntry,
    type SchemaManifestEntry,
} from "../../sdk/src/index.ts";

export type ProjectConfig = { toolsDir: string; schemasDir: string };

export const DEFAULT_PROJECT: ProjectConfig = { toolsDir: "tools", schemasDir: "schemas" };

export type PushEntry = ManifestEntry & {
    /** What you wrote. Kept for reading and diffing, never executed. */
    source: string;
    /** The same thing with the types removed. This is what runs. */
    code: string;
    /** Of `source`. What lets the receiver skip an unchanged tool. */
    checksum: string;
};

/**
 * Take the types off, so the executor can import it.
 *
 * Measured on the deployment: a Deno isolate imports JavaScript from a `data:`
 * URL and refuses TypeScript from one — it reads the type annotation as
 * JavaScript and fails — and it will not import a `.ts` file written to `/tmp`
 * either, because a worker's module loader is scoped to its own function. So
 * the types come off here.
 *
 * `stripTypeScriptTypes` is in Node itself and blanks types in place rather than
 * re-printing the file, which keeps line and column numbers true: a stack trace
 * from a running tool still points at the line you wrote.
 */
export function stripTypes(source: string, file: string): string {
    try {
        return stripTypeScriptTypes(source, { mode: "strip" });
    } catch (error) {
        throw new Error(`${basename(file)} could not be compiled: ${(error as Error).message}`);
    }
}

export async function readProject(root: string): Promise<ProjectConfig> {
    try {
        const parsed = JSON.parse(await readFile(join(root, "vokoo.json"), "utf8")) as Partial<ProjectConfig>;
        return {
            toolsDir: parsed.toolsDir ?? DEFAULT_PROJECT.toolsDir,
            schemasDir: parsed.schemasDir ?? DEFAULT_PROJECT.schemasDir,
        };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            throw new Error(`no vokoo.json in ${root} — run \`vokoo init\` to start a functions project`);
        }
        throw error;
    }
}

/** Every tool file in the project, in a stable order so a push is reproducible. */
export async function toolFiles(root: string, config: ProjectConfig): Promise<string[]> {
    return sourceFiles(resolve(root, config.toolsDir), "`vokoo new <name>` to add a tool", true);
}

/**
 * Every schema file, in the same stable order.
 *
 * Missing is not an error, unlike the tools directory. A project may declare
 * tools and no schemas, and `vokoo init` should not have to guess which kind
 * somebody is about to write.
 */
export async function schemaFiles(root: string, config: ProjectConfig): Promise<string[]> {
    return sourceFiles(resolve(root, config.schemasDir), "", false);
}

async function sourceFiles(dir: string, hint: string, required: boolean): Promise<string[]> {
    let names: string[];
    try {
        names = await readdir(dir);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            if (!required) return [];
            throw new Error(`${dir} does not exist — run ${hint}`);
        }
        throw error;
    }
    return names
        .filter((name) => extname(name) === ".ts" && !name.endsWith(".test.ts"))
        .sort()
        .map((name) => join(dir, name));
}

/**
 * Reasons this source cannot be shipped as one file.
 *
 * Returns a message rather than throwing so a push can report every bad file at
 * once. Fixing one, pushing, and being told about the next is a slow way to
 * learn there were four.
 */
export function checkSource(source: string, file: string): string | null {
    // Matches `from "./x"` and `from '../x'` in imports and re-exports. A
    // dynamic import is not caught here; it fails at run time on the executor,
    // which is the same place any other dynamic failure lands.
    const relative = /\bfrom\s+["'](\.\.?\/[^"']+)["']/.exec(source);
    if (relative) {
        return `${basename(file)} imports "${relative[1]}" from a sibling file. A tool ships as one file — inline the helper, or import it with an npm: or https: specifier.`;
    }
    if (!/export\s+default\b/.test(source)) {
        return `${basename(file)} has no default export. A file should \`export default defineTool({ … })\` or \`defineSchema({ … })\`.`;
    }
    return null;
}

export function checksum(source: string): string {
    return `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`;
}

/** Load every tool, refuse the set if it cannot be pushed, and build the manifest. */
export async function buildManifest(files: string[]): Promise<PushEntry[]> {
    const tools: AnyTool[] = [];
    const sources = new Map<string, string>();
    const problems: string[] = [];

    for (const file of files) {
        const source = await readFile(file, "utf8");
        const problem = checkSource(source, file);
        if (problem) {
            problems.push(problem);
            continue;
        }

        let loaded: { default?: AnyTool };
        try {
            // Node 22 strips the types, so the file runs as written. Anything
            // `defineTool` refuses throws here, which is the point: the mistake
            // is reported against the file rather than reaching a caller.
            loaded = (await import(`${resolve(file)}?t=${Date.now()}`)) as { default?: AnyTool };
        } catch (error) {
            problems.push(`${basename(file)}: ${(error as Error).message}`);
            continue;
        }

        const tool = loaded.default;
        if (!tool || typeof tool !== "object" || typeof tool.name !== "string") {
            problems.push(`${basename(file)}: the default export is not a tool from defineTool()`);
            continue;
        }
        tools.push(tool);
        sources.set(tool.id, source);
    }

    if (problems.length > 0) {
        throw new Error(problems.join("\n"));
    }

    // Duplicate ids and duplicate names, the two mistakes that exist because an
    // id is authored rather than assigned.
    assertPushable(tools);

    return tools.map((tool) => {
        const source = sources.get(tool.id) ?? "";
        return {
            ...manifestEntry(tool),
            source,
            code: stripTypes(source, tool.name),
            // Over the source rather than the stripped code: what changed is a
            // question about what somebody wrote.
            checksum: checksum(source),
        };
    });
}

/**
 * The manifest for the schemas in a project.
 *
 * Simpler than `buildManifest`, and the difference is the point: a tool ships
 * code that has to be stripped of types, checksummed and executed, while a
 * schema ships a declaration. There is nothing to run, so there is nothing to
 * strip and nothing whose body could drift from its description.
 */
export async function buildSchemaManifest(files: string[]): Promise<SchemaManifestEntry[]> {
    const schemas: CompiledSchema[] = [];
    const problems: string[] = [];

    for (const file of files) {
        const source = await readFile(file, "utf8");
        const problem = checkSource(source, file);
        if (problem) {
            problems.push(problem);
            continue;
        }

        let loaded: { default?: CompiledSchema };
        try {
            loaded = (await import(`${resolve(file)}?t=${Date.now()}`)) as { default?: CompiledSchema };
        } catch (error) {
            // Anything `defineSchema` refuses throws here, which is the point:
            // reported against the file rather than reaching a node that points
            // at it.
            problems.push(`${basename(file)}: ${(error as Error).message}`);
            continue;
        }

        const schema = loaded.default;
        if (!schema || typeof schema !== "object" || typeof schema.name !== "string" || !schema.schema) {
            problems.push(`${basename(file)}: the default export is not a schema from defineSchema()`);
            continue;
        }
        schemas.push(schema);
    }

    if (problems.length > 0) {
        throw new Error(problems.join("\n"));
    }

    assertSchemasPushable(schemas);
    return schemas.map(schemaManifestEntry);
}

/** The file `vokoo new --schema` writes. */
export function schemaTemplate(name: string, id: string): string {
    return `import { defineSchema } from "@vokoo/sdk"

export default defineSchema({
    id: "${id}",
    name: "${name}",
    description: "What this shape is for. A model reads this when filling it in.",
    fields: {
        example: { type: "string", required: true, description: "Written for the reader deciding what to put here." },
    },
})
`;
}

/** The file `vokoo new` writes. */
export function toolTemplate(name: string, id: string): string {
    return `import { defineTool } from "@vokoo/sdk"

export default defineTool({
    // Written here rather than assigned by the server, so renaming this tool is
    // an update instead of a delete and an insert. Leave it alone.
    id: "${id}",
    name: "${name}",
    // What the model reads when deciding whether to call this. Write it for
    // that reader.
    description: "TODO: say what this does and when to use it.",
    input: {
        // example: { type: "string", required: true, description: "..." },
    },
    timeoutSeconds: 10,
    async handler(args, ctx) {
        // ctx.fetch for outbound HTTP, ctx.secrets for credentials,
        // ctx.variables for what the flow has collected so far.
        return { ok: true }
    },
})
`;
}

/**
 * A stub for a tool that already exists on the server.
 *
 * Carries the server's id, which is the whole point: `skill_tools` references a
 * tool by id and the foreign key cascades, so a tool that is deleted and
 * recreated takes its skill links with it — and a skill's tools are what reach
 * the model at all. Adopting in place keeps them.
 */
export function adoptedTemplate(tool: {
    id: string;
    name: string;
    description: string;
    schema?: unknown;
    endpoint_url?: string | null;
}): string {
    const input = decompileSchema(tool.schema);
    const lines = Object.entries(input).map(([name, field]) => {
        const parts: string[] = [`type: ${JSON.stringify(field.type)}`];
        if (field.required) parts.push("required: true");
        if (field.items) parts.push(`items: { type: ${JSON.stringify(field.items.type)} }`);
        if (field.enum) parts.push(`enum: ${JSON.stringify(field.enum)}`);
        if (field.description) parts.push(`description: ${JSON.stringify(field.description)}`);
        return `        ${name}: { ${parts.join(", ")} },`;
    });

    const wasHttp = tool.endpoint_url
        ? `    // This tool used to be an HTTP call to:\n    //   ${tool.endpoint_url}\n    // Pushing this file replaces that with the handler below.\n`
        : "";

    return `import { defineTool } from "@vokoo/sdk"

export default defineTool({
    // Taken from the workspace, not generated. This tool already exists, and
    // skills reference it by this id — changing it would detach them.
    id: ${JSON.stringify(tool.id)},
    name: ${JSON.stringify(tool.name)},
    description: ${JSON.stringify(tool.description || "TODO: say what this does and when to use it.")},
    input: {
${lines.join("\n") || "        // No arguments were declared."}
    },
    timeoutSeconds: 10,
${wasHttp}    async handler(args, ctx) {
        // TODO: implement. Until this returns something real, the model is
        // being told the tool works.
        throw new Error(${JSON.stringify(`${tool.name} is not implemented yet`)})
    },
})
`;
}

/** A tool name that is usable as both a filename and a function name. */
export function assertToolName(name: string): void {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(name)) {
        throw new Error(
            `"${name}" will not work as a tool name — use lowercase letters, digits and underscores, starting with a letter`,
        );
    }
}

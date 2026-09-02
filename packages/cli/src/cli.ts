#!/usr/bin/env node
/**
 * The `vokoo` command.
 *
 * Argument parsing is `node:util`'s `parseArgs`, and there are no dependencies
 * anywhere in this package. A CLI that takes ten minutes to install is one
 * people avoid running.
 */

import { mkdir, symlink, writeFile } from "node:fs/promises";
import { existsSync, watch } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";

import { ApiError, invocations, LOG_SCAN, push as pushToApi, run as runOnApi, tools as remoteTools, verify } from "./api.ts";
import { describeProfile, readConfig, selectProfile, upsertProfile, writeConfig, type Profile } from "./config.ts";
import {
    adoptedTemplate,
    assertToolName,
    buildManifest,
    buildSchemaManifest,
    DEFAULT_PROJECT,
    readProject,
    schemaFiles,
    schemaTemplate,
    toolFiles,
    toolTemplate,
} from "./project.ts";

const USAGE = `vokoo — write functions your agents can call

  vokoo login [--api-url <url>] [--org <uuid>] [--profile <name>]
  vokoo logout [--profile <name>]
  vokoo whoami [--profile <name>]

  vokoo init [dir]
  vokoo new  <name>                 a tool
  vokoo new  --schema <name>        a named shape a tool or a flow can use
  vokoo pull [--profile <name>]     adopt tools that already exist in the workspace

  vokoo push [--profile <name>]
  vokoo dev  [--profile <name>] [--debounce <ms>]

  vokoo run  <name> [-p '<json>'] [--version <n>]
  vokoo logs <name> [--limit <n>]

The key is never passed as an argument: \`login\` reads it from the prompt, so it
does not end up in your shell history.
`;

function out(line = ""): void {
    process.stdout.write(`${line}\n`);
}

async function main(argv: string[]): Promise<number> {
    const [command, ...rest] = argv;

    if (!command || command === "help" || command === "--help" || command === "-h") {
        out(USAGE);
        return 0;
    }

    const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
            "api-url": { type: "string" },
            schema: { type: "boolean" },
            org: { type: "string" },
            profile: { type: "string" },
            debounce: { type: "string" },
            p: { type: "string" },
            payload: { type: "string" },
            version: { type: "string" },
            limit: { type: "string" },
        },
    });

    switch (command) {
        case "login":
            return login(values);
        case "logout":
            return logout(values.profile);
        case "whoami":
            return whoami(values.profile);
        case "init":
            return init(positionals[0] ?? ".");
        case "new":
            return newTool(positionals[0], Boolean(values.schema));
        case "pull":
            return pull(values.profile);
        case "push":
            return runPush(values.profile);
        case "dev":
            return dev(values.profile, Number(values.debounce ?? 800));
        case "run":
            return runTool(positionals[0], values);
        case "logs":
            return showLogs(positionals[0], values.profile, Number(values.limit ?? 20));
        default:
            out(`unknown command "${command}"`);
            out(USAGE);
            return 1;
    }
}

async function login(values: { "api-url"?: string; org?: string; profile?: string }): Promise<number> {
    // Two ways in, because a key arrives two ways. A person pastes it at a
    // prompt; CI pipes it. Prompting into a pipe reads the wrong lines and then
    // waits forever for a terminal that is not there.
    const interactive = process.stdin.isTTY === true;

    let apiUrl = values["api-url"] ?? "";
    let orgId = values.org ?? "";
    let key = "";

    if (interactive) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        try {
            apiUrl ||= (await rl.question("Control plane URL [http://localhost:8081]: ")).trim();
            orgId ||= (await rl.question("Organisation id: ")).trim();
            // Asked for rather than accepted as a flag: a key on the command
            // line is in the shell history and in the process list.
            key = (await rl.question("API key (vk_live_…): ")).trim();
        } finally {
            rl.close();
        }
    } else {
        // `vokoo login --api-url … --org … < key.txt`
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
        key = Buffer.concat(chunks).toString("utf8").trim();
        if (!apiUrl || !orgId) {
            out("Reading the key from stdin needs --api-url and --org as well.");
            out("  vokoo login --api-url https://… --org <uuid> < key.txt");
            return 1;
        }
    }

    apiUrl = apiUrl || "http://localhost:8081";
    if (!orgId || !key) {
        out("An organisation id and a key are both needed.");
        return 1;
    }

    const profile: Profile = { apiUrl, orgId, key };
    // Checked before it is stored. Writing an unusable key and finding out at
    // the next push wastes the one moment somebody has the key to hand.
    await verify(profile);

    const name = values.profile ?? "default";
    const path = await writeConfig(upsertProfile(await readConfig(), name, profile), undefined);
    out(`Signed in to ${profile.apiUrl} as workspace "${name}".`);
    out(`Saved to ${path}`);
    return 0;
}

async function logout(name?: string): Promise<number> {
    const config = await readConfig();
    const { name: resolved } = selectProfile(config, name);
    const { [resolved]: _removed, ...rest } = config.profiles;
    await writeConfig({ defaultProfile: config.defaultProfile, profiles: rest });
    out(`Removed workspace "${resolved}". The key itself is still valid — revoke it in the console.`);
    return 0;
}

async function whoami(name?: string): Promise<number> {
    const { name: resolved, profile } = selectProfile(await readConfig(), name);
    out(`${resolved}: ${describeProfile(profile)}`);
    return 0;
}

/** The `@vokoo/sdk` that ships beside this CLI. */
function sdkPath(): string {
    return resolve(import.meta.dirname, "..", "..", "sdk");
}

/**
 * Make `import { defineTool } from "@vokoo/sdk"` resolve.
 *
 * Linked rather than installed: the SDK is not on a registry yet, and a
 * scaffold whose very first line cannot be resolved is a scaffold that does not
 * work. When the package is published this becomes a normal dependency and the
 * link is replaced by an install.
 */
async function linkSdk(root: string): Promise<void> {
    const scope = join(root, "node_modules", "@vokoo");
    const target = join(scope, "sdk");
    if (existsSync(target)) return;
    await mkdir(scope, { recursive: true });
    await symlink(sdkPath(), target, "dir");
}

async function init(dir: string): Promise<number> {
    const root = resolve(dir);
    const manifest = join(root, "vokoo.json");
    if (existsSync(manifest)) {
        out(`${manifest} already exists — nothing to do.`);
        return 0;
    }
    await mkdir(join(root, DEFAULT_PROJECT.toolsDir), { recursive: true });
    await writeFile(manifest, `${JSON.stringify(DEFAULT_PROJECT, null, 2)}\n`);

    // `type: module` so the tool files are ES modules, which is what the
    // executor loads them as.
    const pkg = join(root, "package.json");
    if (!existsSync(pkg)) {
        await writeFile(
            pkg,
            `${JSON.stringify(
                {
                    name: basename(root),
                    private: true,
                    type: "module",
                    dependencies: { "@vokoo/sdk": "*" },
                },
                null,
                2,
            )}\n`,
        );
    }
    await linkSdk(root);

    out(`Created ${manifest}, package.json and ${DEFAULT_PROJECT.toolsDir}/`);
    out("Next: vokoo new check_slots");
    return 0;
}

async function newTool(name?: string, isSchema = false): Promise<number> {
    const noun = isSchema ? "schema" : "tool";
    if (!name) {
        out(`Give the ${noun} a name: vokoo new ${isSchema ? "--schema clinic_lead" : "check_slots"}`);
        return 1;
    }
    // The same rule for both: it ends up in a prompt, and a name that looks
    // like a number reads as one.
    assertToolName(name);

    const root = process.cwd();
    const config = await readProject(root);
    const dir = isSchema ? config.schemasDir : config.toolsDir;
    const file = join(root, dir, `${name}.ts`);
    if (existsSync(file)) {
        out(`${file} already exists.`);
        return 1;
    }

    await mkdir(join(root, dir), { recursive: true });
    // Generated here so nobody types a UUID, and so two never share one by
    // being copied from an example.
    const id = crypto.randomUUID();
    await writeFile(file, isSchema ? schemaTemplate(name, id) : toolTemplate(name, id));
    out(`Created ${file}`);
    return 0;
}

/**
 * Write a local file for every tool in the workspace that has none.
 *
 * The reason this exists rather than "make a new tool with the same name": the
 * unique index on (org_id, name) refuses a second tool by that name, and
 * deleting the first would cascade through `skill_tools` and silently detach it
 * from the skills that let an agent call it. Adopting keeps the id, so the push
 * is an update and the links survive.
 *
 * A tool already present locally is left alone. Overwriting it would discard a
 * handler somebody wrote, in a command whose name promises a download.
 */
async function pull(profileName?: string): Promise<number> {
    const { profile } = selectProfile(await readConfig(), profileName);
    const root = process.cwd();
    const project = await readProject(root);

    const existing = new Set(
        (await toolFiles(root, project).catch(() => [])).map((file) => basename(file, ".ts")),
    );

    const remote = await remoteTools(profile);
    if (remote.length === 0) {
        out("This workspace has no tools yet.");
        return 0;
    }

    const written: string[] = [];
    const skipped: string[] = [];

    for (const tool of remote) {
        if (existing.has(tool.name)) {
            skipped.push(tool.name);
            continue;
        }
        await mkdir(join(root, project.toolsDir), { recursive: true });
        await writeFile(join(root, project.toolsDir, `${tool.name}.ts`), adoptedTemplate(tool));
        written.push(tool.name);
    }

    if (written.length > 0) {
        out(`Adopted ${written.join(", ")} into ${project.toolsDir}/`);
        // Said plainly, because a pushed stub would tell the model a tool works
        // when calling it throws.
        out("Each one throws until you implement its handler. Nothing is pushed yet.");
    }
    if (skipped.length > 0) out(`Already here: ${skipped.join(", ")}`);
    return 0;
}

async function loadEntries(root: string) {
    const project = await readProject(root);
    // Repairs a project scaffolded before the link existed, and one whose
    // node_modules was cleaned.
    await linkSdk(root);
    const files = await toolFiles(root, project);
    if (files.length === 0) {
        throw new Error(`no tools in ${project.toolsDir}/ — run \`vokoo new <name>\``);
    }
    return buildManifest(files);
}

async function runPush(name?: string): Promise<number> {
    const { profile } = selectProfile(await readConfig(), name);
    const root = process.cwd();
    const config = await readProject(root);
    const entries = await loadEntries(root);
    const schemas = await buildSchemaManifest(await schemaFiles(root, config));

    const result = await pushToApi(profile, entries, schemas);
    const changed = [...(result.created ?? []), ...(result.updated ?? [])];
    const changedSchemas = [...(result.schemas?.created ?? []), ...(result.schemas?.updated ?? [])];
    const total = entries.length + schemas.length;

    // Unchanged is reported as a count rather than a list. On the tenth push of
    // the day the interesting line is the one thing that moved.
    if (changed.length === 0 && changedSchemas.length === 0) {
        out(`Nothing to push — ${total} item(s) unchanged.`);
        return 0;
    }
    if (changed.length > 0) {
        out(`Pushed ${changed.join(", ")}${result.unchanged?.length ? ` (${result.unchanged.length} unchanged)` : ""}`);
    }
    if (changedSchemas.length > 0) {
        out(
            `Schemas ${changedSchemas.join(", ")}${result.schemas?.unchanged?.length ? ` (${result.schemas.unchanged.length} unchanged)` : ""}`,
        );
    }
    return 0;
}

async function dev(name?: string, debounceMs = 800): Promise<number> {
    const { profile } = selectProfile(await readConfig(), name);
    const root = process.cwd();
    const project = await readProject(root);
    const dir = resolve(root, project.toolsDir);

    const once = async () => {
        try {
            const entries = await loadEntries(root);
            const result = await pushToApi(profile, entries);
            const changed = [...(result.created ?? []), ...(result.updated ?? [])];
            out(changed.length === 0 ? `· no change (${entries.length} tool(s))` : `✓ ${changed.join(", ")}`);
        } catch (error) {
            // A syntax error while typing is the normal case here. Reporting it
            // and carrying on is the whole point of watch mode; exiting would
            // mean restarting after every typo.
            out(`✗ ${(error as Error).message}`);
        }
    };

    await once();
    out(`Watching ${dir} — Ctrl+C to stop.`);

    let timer: NodeJS.Timeout | undefined;
    watch(dir, { recursive: false }, () => {
        // An editor writes a file more than once per save. Without this, one
        // save is three pushes.
        clearTimeout(timer);
        timer = setTimeout(() => void once(), debounceMs);
    });

    return await new Promise<number>(() => {});
}

async function runTool(
    name: string | undefined,
    values: { p?: string; payload?: string; version?: string; profile?: string },
): Promise<number> {
    if (!name) {
        out("Which tool? vokoo run check_slots -p '{\"doctor\":\"Rao\"}'");
        return 1;
    }
    const raw = values.p ?? values.payload ?? "{}";
    let args: unknown;
    try {
        args = JSON.parse(raw);
    } catch {
        out(`The payload is not JSON: ${raw}`);
        return 1;
    }

    const { profile } = selectProfile(await readConfig(), values.profile);
    const result = await runOnApi(profile, name, args, values.version ? Number(values.version) : undefined);

    // Logs first. What a tool printed on its way to failing is usually the
    // reason, and putting it after the error means scrolling back for it.
    for (const line of result.logs ?? []) out(`  ${line}`);

    if (result.ok) {
        out(`${name} v${result.version} ok in ${result.duration_ms}ms`);
        out(JSON.stringify(result.result, null, 2));
        return 0;
    }
    out(`${name} v${result.version} ${result.error} after ${result.duration_ms}ms`);
    if (result.message) out(result.message);
    if (result.stack) out(result.stack);
    // A tool that failed is a failed command, so a script can tell.
    return 1;
}

async function showLogs(name: string | undefined, profileName?: string, limit = 20): Promise<number> {
    if (!name) {
        out("Which tool? vokoo logs check_slots");
        return 1;
    }
    const { profile } = selectProfile(await readConfig(), profileName);
    const rows = await invocations(profile, name, limit);
    if (rows.length === 0) {
        out(`No calls to ${name} in the last ${LOG_SCAN} events.`);
        // Worth saying, because the obvious reading of an empty list is that
        // the tool has never worked.
        out("`vokoo run` is not recorded — it is a test, not a call.");
        return 0;
    }
    for (const row of rows.reverse()) {
        out(`${row.created_at ?? "?"}  ${row.outcome ?? "?"}  ${row.duration_ms ?? "?"}ms`);
        // The lines the tool printed, which is what somebody opening a log came
        // for. Indented under their invocation so a run reads as one block.
        for (const line of row.detail?.result?.logs ?? []) out(`    ${line}`);
    }
    return 0;
}

try {
    process.exitCode = await main(process.argv.slice(2));
} catch (error) {
    if (error instanceof ApiError) {
        process.stderr.write(`${error.message}\n`);
    } else {
        process.stderr.write(`${(error as Error).message}\n`);
    }
    process.exitCode = 1;
}

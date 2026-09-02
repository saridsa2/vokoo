import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, before, describe, it } from "node:test";

import { readConfig, selectProfile, upsertProfile, writeConfig, maskKey, EMPTY_CONFIG } from "./config.ts";
import {
    assertToolName,
    buildManifest,
    buildSchemaManifest,
    checkSource,
    checksum,
    readProject,
    schemaFiles,
    toolFiles,
    toolTemplate,
} from "./project.ts";

let root: string;

const SDK = join(import.meta.dirname, "..", "..", "sdk", "src", "index.ts");

/** A tool file that imports the SDK by path, since the workspace is not linked. */
function toolFile(name: string, id: string, extra = ""): string {
    return `import { defineTool } from ${JSON.stringify(SDK)}
export default defineTool({
    id: "${id}",
    name: "${name}",
    description: "Does a thing.",
    input: { doctor: { type: "string", required: true } },
    ${extra}
    async handler() { return { ok: true } },
})
`;
}

before(async () => {
    root = await mkdtemp(join(tmpdir(), "vokoo-cli-"));
    await mkdir(join(root, "tools"), { recursive: true });
    await writeFile(join(root, "vokoo.json"), JSON.stringify({ toolsDir: "tools" }));
});

after(async () => {
    await rm(root, { recursive: true, force: true });
});

describe("project layout", () => {
    it("reads vokoo.json", async () => {
        // `schemasDir` defaults rather than being required, so a project
        // written before schemas existed keeps working untouched.
        assert.deepEqual(await readProject(root), { toolsDir: "tools", schemasDir: "schemas" });
    });

    it("says what to do when there is no project", async () => {
        const empty = await mkdtemp(join(tmpdir(), "vokoo-empty-"));
        await assert.rejects(() => readProject(empty), /run `vokoo init`/);
        await rm(empty, { recursive: true, force: true });
    });

    it("finds tool files in a stable order and skips tests", async () => {
        await writeFile(join(root, "tools", "b_tool.ts"), toolFile("b_tool", crypto.randomUUID()));
        await writeFile(join(root, "tools", "a_tool.ts"), toolFile("a_tool", crypto.randomUUID()));
        await writeFile(join(root, "tools", "a_tool.test.ts"), "// not a tool");
        await writeFile(join(root, "tools", "notes.md"), "# not a tool");

        const files = await toolFiles(root, { toolsDir: "tools" });
        assert.deepEqual(
            files.map((f) => f.split("/").pop()),
            ["a_tool.ts", "b_tool.ts"],
        );
    });
});

describe("checkSource", () => {
    it("refuses a sibling import, because a tool ships as one file", () => {
        const problem = checkSource(`import { x } from "./helper.ts"\nexport default 1`, "/x/a.ts");
        assert.match(problem ?? "", /imports "\.\/helper\.ts" from a sibling file/);
        assert.match(problem ?? "", /npm: or https: specifier/);
    });

    it("allows an npm specifier, which the executor resolves", () => {
        assert.equal(checkSource(`import z from "npm:zod"\nexport default 1`, "/x/a.ts"), null);
    });

    it("allows an https specifier", () => {
        assert.equal(checkSource(`import x from "https://esm.sh/x"\nexport default 1`, "/x/a.ts"), null);
    });

    it("refuses a file with no default export", () => {
        assert.match(checkSource("const x = 1", "/x/a.ts") ?? "", /no default export/);
    });
});

describe("checksum", () => {
    it("is stable and content-addressed", () => {
        assert.equal(checksum("abc"), checksum("abc"));
        assert.notEqual(checksum("abc"), checksum("abd"));
        assert.match(checksum("abc"), /^sha256:[0-9a-f]{64}$/);
    });
});

describe("buildManifest", () => {
    it("loads tools and carries source and checksum", async () => {
        const dir = await mkdtemp(join(tmpdir(), "vokoo-build-"));
        const id = crypto.randomUUID();
        const file = join(dir, "check_slots.ts");
        await writeFile(file, toolFile("check_slots", id));

        const [entry] = await buildManifest([file]);
        assert.equal(entry?.id, id);
        assert.equal(entry?.name, "check_slots");
        assert.equal(entry?.isTool, true);
        assert.deepEqual(entry?.schema.required, ["doctor"]);
        assert.match(entry?.checksum ?? "", /^sha256:/);
        assert.match(entry?.source ?? "", /defineTool/);
        // The handler is code and ships as source, not as a manifest field.
        assert.equal("handler" in (entry ?? {}), false);
        await rm(dir, { recursive: true, force: true });
    });

    it("reports every bad file at once", async () => {
        // Fixing one, pushing, and being told about the next is a slow way to
        // learn there were two.
        const dir = await mkdtemp(join(tmpdir(), "vokoo-bad-"));
        await writeFile(join(dir, "one.ts"), `import x from "./y.ts"\nexport default 1`);
        await writeFile(join(dir, "two.ts"), `const nothing = 1`);

        await assert.rejects(
            () => buildManifest([join(dir, "one.ts"), join(dir, "two.ts")]),
            (error: Error) =>
                /sibling file/.test(error.message) && /no default export/.test(error.message),
        );
        await rm(dir, { recursive: true, force: true });
    });

    it("refuses two tools sharing an authored id", async () => {
        const dir = await mkdtemp(join(tmpdir(), "vokoo-dup-"));
        const id = crypto.randomUUID();
        await writeFile(join(dir, "one.ts"), toolFile("one", id));
        await writeFile(join(dir, "two.ts"), toolFile("two", id));

        await assert.rejects(
            () => buildManifest([join(dir, "one.ts"), join(dir, "two.ts")]),
            /share the id/,
        );
        await rm(dir, { recursive: true, force: true });
    });

    it("surfaces a defineTool refusal against the file that caused it", async () => {
        const dir = await mkdtemp(join(tmpdir(), "vokoo-invalid-"));
        await writeFile(
            join(dir, "bad.ts"),
            `import { defineTool } from ${JSON.stringify(SDK)}
export default defineTool({ id: "not-a-uuid", name: "bad", description: "x", handler: () => 1 })`,
        );
        await assert.rejects(() => buildManifest([join(dir, "bad.ts")]), /bad\.ts: .*needs an id/);
        await rm(dir, { recursive: true, force: true });
    });
});

describe("scaffolding", () => {
    it("writes a template that is a valid tool once described", () => {
        const source = toolTemplate("check_slots", "c9f84c8d-0bdc-4d8a-a393-6f0d1c75bdcf");
        assert.match(source, /name: "check_slots"/);
        assert.match(source, /id: "c9f84c8d-0bdc-4d8a-a393-6f0d1c75bdcf"/);
        assert.equal(checkSource(source, "check_slots.ts"), null);
    });

    it("refuses a name that would not work as a tool or a filename", () => {
        for (const name of ["Check Slots", "2fast", "check-slots", ""]) {
            assert.throws(() => assertToolName(name), /will not work as a tool name/);
        }
        assert.doesNotThrow(() => assertToolName("check_slots"));
    });
});

describe("config", () => {
    it("round-trips profiles and writes the file 600", async () => {
        const home = await mkdtemp(join(tmpdir(), "vokoo-home-"));
        const profile = { apiUrl: "http://localhost:8081", orgId: "org-1", key: "vk_live_abcdefghij" };

        await writeConfig(upsertProfile(EMPTY_CONFIG, "default", profile), home);
        const config = await readConfig(home);
        assert.deepEqual(selectProfile(config).profile, profile);

        const { mode } = await import("node:fs/promises").then((fs) => fs.stat(join(home, ".vokoo", "config.json")));
        assert.equal(mode & 0o777, 0o600);
        await rm(home, { recursive: true, force: true });
    });

    it("treats a missing config as not-logged-in rather than an error", async () => {
        const home = await mkdtemp(join(tmpdir(), "vokoo-nohome-"));
        assert.deepEqual(await readConfig(home), EMPTY_CONFIG);
        await rm(home, { recursive: true, force: true });
    });

    it("makes the first workspace the default", () => {
        const one = upsertProfile(EMPTY_CONFIG, "staging", { apiUrl: "a", orgId: "b", key: "c" });
        assert.equal(one.defaultProfile, "staging");
        const two = upsertProfile(one, "prod", { apiUrl: "a", orgId: "b", key: "c" });
        assert.equal(two.defaultProfile, "staging", "adding a second workspace must not move the default");
    });

    it("says to log in when nothing is configured", () => {
        assert.throws(() => selectProfile(EMPTY_CONFIG), /run `vokoo login` first/);
    });

    it("names the workspaces it does know", () => {
        const config = upsertProfile(EMPTY_CONFIG, "prod", { apiUrl: "a", orgId: "b", key: "c" });
        assert.throws(() => selectProfile(config, "staging"), /Configured: prod/);
    });

    it("shows exactly the prefix stored in api_keys, and no more", () => {
        // 11 characters, matching KEY_PREFIX_LEN in the control plane — so what
        // the CLI prints is what the console shows beside the same key.
        assert.equal(maskKey("vk_live_abcdefghijklmnop"), "vk_live_abc…");
        assert.equal(maskKey("short"), "…");
    });
});

describe("schemas", () => {
    const schemaFile = (name: string, id: string) => `import { defineSchema } from ${JSON.stringify(SDK)}

export default defineSchema({
    id: "${id}",
    name: "${name}",
    description: "A shape.",
    fields: { who: { type: "string", required: true } },
})
`;

    it("finds schema files, and treats a missing directory as none", async () => {
        const config = await readProject(root);
        // A project may declare tools and no schemas. Demanding the directory
        // exist would make `vokoo init` guess which kind somebody will write.
        assert.deepEqual(await schemaFiles(root, config), []);

        await mkdir(join(root, "schemas"), { recursive: true });
        await writeFile(join(root, "schemas", "b_lead.ts"), schemaFile("b_lead", crypto.randomUUID()));
        await writeFile(join(root, "schemas", "a_lead.ts"), schemaFile("a_lead", crypto.randomUUID()));
        await writeFile(join(root, "schemas", "a_lead.test.ts"), "// not a schema");

        const found = await schemaFiles(root, config);
        assert.deepEqual(found.map((file) => basename(file)), ["a_lead.ts", "b_lead.ts"]);
    });

    it("builds a manifest that says these are not tools", async () => {
        await mkdir(join(root, "schemas"), { recursive: true });
        const id = crypto.randomUUID();
        await writeFile(join(root, "schemas", "lead.ts"), schemaFile("lead", id));

        const manifest = await buildSchemaManifest([join(root, "schemas", "lead.ts")]);
        assert.equal(manifest.length, 1);
        assert.equal(manifest[0].id, id);
        assert.equal(manifest[0].isTool, false);
        assert.equal(manifest[0].schema.properties.who.type, "string");
        // No code and no checksum: a schema ships a declaration, not a body.
        assert.ok(!("code" in manifest[0]));
    });

    it("reports a bad schema against its own file", async () => {
        await mkdir(join(root, "schemas"), { recursive: true });
        await writeFile(
            join(root, "schemas", "broken.ts"),
            schemaFile("broken", "not-a-uuid").replace('"not-a-uuid"', '"nope"'),
        );
        await assert.rejects(
            () => buildSchemaManifest([join(root, "schemas", "broken.ts")]),
            /broken\.ts/,
        );
    });
});

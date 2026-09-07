#!/usr/bin/env node
/**
 * Flatten the vendored VoKoo clinical schemas into self-contained JSON Schema.
 *
 * The five clinical schemas under `vendor/vokoo-clinical-schemas` reference each
 * other and a shared `_common/defs.json` by URI:
 *
 *     "$ref": "https://wellall.health/schemas/common/v0.1.0#/$defs/CodeableConcept"
 *
 * Nothing downstream can follow that. A model is handed a tool's `input_schema`
 * and resolves no references; the console's schema editor reads `properties`
 * and knows nothing about `$defs`; and `compileSchema` in the SDK has no `$ref`
 * at all. So the reference has to be gone before the schema leaves this repo.
 *
 * **It is a build step and not a one-off** for the reason this project already
 * wrote down about `docs/flow-node-catalogue.json`: a snapshot that somebody
 * regenerates by hand is a second copy that drifts. `npm run schemas:inline`
 * rebuilds the artifact from the vendored source, and `--check` fails when the
 * two disagree.
 *
 * ## The one thing that is easy to get wrong
 *
 * A definition pulled in from `_common` may itself reference `#/$defs/Coding` —
 * and that is `_common`'s `$defs`, not the host schema's. Resolving it against
 * the host throws `KeyError: Coding`, or worse, silently finds an unrelated
 * definition of the same name. So the scope travels with the node: entering a
 * common definition switches the scope to `_common` and stays there.
 *
 * Measured after inlining: 400–1,600 tokens per schema, deepest is
 * `lab-report` at 13 levels. Small enough that no trimming is needed.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = join(ROOT, "src/lib/clinical-schemas.json");

/**
 * Where the vendored schemas are. The copied source uses VoKoo names and URNs;
 * accepting the upstream namespace here would let it leak back into generated
 * artifacts without a build failure.
 *
 * The `$id` needs no such handling: it is read out of `_common/defs.json`
 * rather than matched against a literal, so the namespace can change without
 * touching this file.
 */
const SCHEMAS = join(ROOT, "vendor/vokoo-clinical-schemas/infrastructure/schemas");

if (!existsSync(join(SCHEMAS, "_common/defs.json"))) {
    throw new Error("no vendored clinical schemas found under vendor/vokoo-clinical-schemas");
}

/** The five the spec calls canonical. `_common` is definitions, not a schema. */
const KINDS = ["health", "lab-report", "imaging-report", "medication", "family-health"];

/** Guards a schema that references itself. 80 is far past the deepest (13). */
const MAX_DEPTH = 80;

const common = JSON.parse(readFileSync(join(SCHEMAS, "_common/defs.json"), "utf8"));
const COMMON_ID = common.$id;
const COMMON_DEFS = common.$defs;

/**
 * Replace every `$ref` with what it points at.
 *
 * `scope` is the `$defs` a bare `#/$defs/x` resolves against, and it changes
 * when we step into a common definition — see the note above.
 */
function inline(node, scope, depth = 0) {
    if (depth > MAX_DEPTH) return { type: "object" };

    if (Array.isArray(node)) return node.map((v) => inline(v, scope, depth + 1));
    if (node === null || typeof node !== "object") return node;

    const ref = node.$ref;
    if (typeof ref === "string") {
        if (ref.startsWith("#/$defs/")) {
            const name = ref.slice("#/$defs/".length);
            if (!(name in scope)) throw new Error(`unresolved local $ref: ${ref}`);
            return inline(structuredClone(scope[name]), scope, depth + 1);
        }
        if (ref.startsWith(COMMON_ID)) {
            const name = ref.split("$defs/").pop();
            if (!(name in COMMON_DEFS)) throw new Error(`unresolved common $ref: ${ref}`);
            // Scope switches: this definition's own refs are _common's.
            return inline(structuredClone(COMMON_DEFS[name]), COMMON_DEFS, depth + 1);
        }
        throw new Error(`$ref points outside the vendored schemas: ${ref}`);
    }

    // `$defs` is dropped: every reference to it has just been substituted, so
    // keeping it would ship the definitions twice.
    return Object.fromEntries(
        Object.entries(node)
            .filter(([k]) => k !== "$defs")
            .map(([k, v]) => [k, inline(v, scope, depth + 1)]),
    );
}

function depthOf(node, k = 0) {
    if (Array.isArray(node)) return node.length ? Math.max(...node.map((v) => depthOf(v, k + 1))) : k;
    if (node && typeof node === "object") {
        const vs = Object.values(node);
        return vs.length ? Math.max(...vs.map((v) => depthOf(v, k + 1))) : k;
    }
    return k;
}

function build() {
    const out = {};
    for (const kind of KINDS) {
        const dir = join(SCHEMAS, kind, "schema");
        if (!existsSync(dir)) throw new Error(`no schema directory for ${kind}`);
        const file = readdirSync(dir).find((f) => f.endsWith(".json"));
        if (!file) throw new Error(`no schema file in ${dir}`);

        const raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
        const flat = inline(raw, raw.$defs ?? {});
        const text = JSON.stringify(flat);
        if (text.includes("$ref")) throw new Error(`${kind} still contains a $ref after inlining`);

        out[kind] = {
            // The vendored `$id` is kept as provenance: it says which version of
            // the upstream contract this was flattened from.
            source: raw.$id ?? null,
            title: raw.title ?? kind,
            schema: flat,
        };
        process.stderr.write(
            `  ${kind.padEnd(16)} ${String(text.length).padStart(6)}B  depth ${depthOf(flat)}\n`,
        );
    }
    return out;
}

const built = build();
const serialised = JSON.stringify(built, null, 2) + "\n";

if (process.argv.includes("--check")) {
    const current = existsSync(ARTIFACT) ? readFileSync(ARTIFACT, "utf8") : "";
    if (current !== serialised) {
        process.stderr.write(
            `\n${ARTIFACT} is out of date with vendor/vokoo-clinical-schemas.\nRun: npm run schemas:inline\n`,
        );
        process.exit(1);
    }
    process.stderr.write("\nclinical schemas are up to date\n");
} else {
    writeFileSync(ARTIFACT, serialised);
    process.stderr.write(`\nwrote ${ARTIFACT}\n`);
}

#!/usr/bin/env node
//
// Regenerate `docs/flow-node-catalogue.json` from `catalogue_node_types`.
//
// The composer builds against that file rather than fetching the table,
// because `NodeType` is a TypeScript union and a union cannot come from a
// fetch. That is a good reason to have a snapshot and no reason at all to
// write one by hand — which is what had been happening: on 2 September the
// database said the `intelligence` node takes two fields and the console drew
// four, two of which the bridge had stopped reading when that node started
// taking its model from the workspace. Nothing reported the disagreement,
// because nothing knew there were two copies.
//
//   npm run catalogue:sync      rewrite the file from the database
//   npm run catalogue:check     exit 1 if the file and the database disagree
//
// It goes over ssh and psql rather than the control plane because it runs
// without a browser session, and that is the channel every other operational
// command in this project already uses.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const SNAPSHOT = resolve(dirname(fileURLToPath(import.meta.url)), "../docs/flow-node-catalogue.json");
const HOST = process.env.VOKOO_SSH_HOST ?? "vokoo";

// Every row, including inactive ones. `NodeType` is a union built from these
// keys and a flow already drawn may reference a type that has since been
// withdrawn — dropping it from the file would not hide the node, it would stop
// the board rendering. `is_active` travels with the row and the palette is
// what respects it.
//
// `sort_order` then `id`, so the file's order is the palette's order and two
// runs against the same table never produce two different files.
const QUERY = `
  select coalesce(jsonb_agg(row_to_json(n)::jsonb order by n.sort_order, n.id), '[]'::jsonb)
    from (select * from catalogue_node_types) n;
`;

function fromDatabase() {
    // Over stdin, not `-c`: a quoted multi-line argument arrives with its
    // newlines escaped, and psql reads a leading backslash as one of its own
    // commands ("invalid command \n").
    const raw = execFileSync("ssh", [HOST, "docker exec -i supabase-db psql -U postgres -At"], {
        input: QUERY,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
    });
    return JSON.parse(raw.trim());
}

// Key order out of `row_to_json` follows the table's columns, which a later
// `alter table` would change — so the comparison and the file are both keyed
// in sorted order. A column reordering must not read as a catalogue change.
const stable = (value) =>
    JSON.stringify(
        value,
        (_key, held) =>
            held && typeof held === "object" && !Array.isArray(held)
                ? Object.fromEntries(Object.keys(held).sort().map((key) => [key, held[key]]))
                : held,
        2,
    ) + "\n";

const checking = process.argv.includes("--check");
const wanted = stable(fromDatabase());

let current = "";
try {
    current = readFileSync(SNAPSHOT, "utf8");
} catch {
    /* a first run has nothing to compare */
}

if (current === wanted) {
    console.log("node catalogue: the snapshot matches the database");
    process.exit(0);
}

if (checking) {
    const count = (text) => {
        try {
            return JSON.parse(text).length;
        } catch {
            return "?";
        }
    };
    console.error(
        `node catalogue: the snapshot disagrees with the database ` +
            `(${count(current)} node types on disk, ${count(wanted)} in the database).\n` +
            `Run 'npm run catalogue:sync' and commit the result.`,
    );
    process.exit(1);
}

writeFileSync(SNAPSHOT, wanted);
console.log(`node catalogue: rewrote docs/flow-node-catalogue.json from the database`);

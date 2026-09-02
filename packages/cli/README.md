# @vokoo/cli

Write, test and ship the functions your agents call.

```bash
vokoo login --api-url https://vokoo.vayuveda.ai --org <uuid> < key.txt
vokoo init
vokoo new check_slots
vokoo push
vokoo dev
```

## Signing in

```
vokoo login [--api-url <url>] [--org <uuid>] [--profile <name>]
```

At a terminal it prompts. Piped, it reads the key from stdin and needs
`--api-url` and `--org` as flags — so a key never appears as an argument, where
it would be in your shell history and in the process list.

The key is checked against the control plane **before** it is written. Storing
an unusable key and finding out at the next push wastes the one moment you had
it to hand.

Credentials live in `~/.vokoo/config.json`, mode 600, outside the repository —
a key inside a project directory ends up committed. Profiles are keyed by name,
so a workspace and a staging workspace do not need two checkouts. The first one
you configure becomes the default.

`vokoo logout` forgets a workspace locally. It does not revoke the key; revoke
it in the console.

## Writing a tool

`vokoo new <name>` scaffolds a file with a fresh UUID already in it. Do not
change that id — sync matches on it, so renaming the tool stays an update rather
than a delete and an insert.

`vokoo init` also links `@vokoo/sdk` into the project, so the scaffolded file
resolves and runs with no install step.

## Pushing

`vokoo push` loads every tool, refuses the set if it cannot be pushed, and sends
a manifest. `vokoo dev` does the same on every save, debounced, and reports a
failure without exiting — a syntax error while typing is the normal case, and
restarting after every typo is not watch mode.

Everything is checked locally first, and **every bad file is reported at once**.
Fixing one, pushing, and being told about the next is a slow way to learn there
were four.

## One file per tool

There is no bundler. The executor is a Deno isolate that compiles TypeScript and
resolves `npm:` and `https:` specifiers itself, so a tool ships as the source you
wrote — no build step, no build output to read, and nothing to install.

The cost is that a handler cannot import a sibling file: that would push a file
whose import fails on the other side, and the failure would land on a caller
rather than here. `push` refuses it and names the alternative. Inline the helper,
or import it with an `npm:` or `https:` specifier.

## Tests

```bash
node --test src/*.test.ts
```

Design: `docs/specs/2026-09-01-functions-sdk.md`.

// The executor.
//
// Runs one version of one tool and reports what it returned, what it printed and
// how long it took. It is a sandbox and nothing else: the code and the context
// arrive in the request, so this function holds no database client, makes no
// query, and cannot reach anything on its own behalf.
//
// That is deliberate, and it is only half of it. A function isolate is handed
// the whole container environment — service role key, database URL, JWT secret —
// and cannot drop it, because `Deno.env.delete` throws NotSupported. So this
// function is created with an empty environment by the main service instead.
// Measured before that was done: a pushed tool read all fifteen variables.
//
// The control plane reads the version through row-level security and sends the
// code here.
//
// Contract: docs/specs/2026-09-01-functions-sdk.md

/** What a handler is given. Matches ToolContext in @vokoo/sdk. */
type Ctx = {
  callId: string | null;
  orgId: string;
  variables: Record<string, unknown>;
  secrets: Record<string, string>;
};

type RunRequest = {
  name?: string;
  version?: number;
  /** The version's `code`: the tool with its types stripped. */
  code?: string;
  args?: Record<string, unknown>;
  ctx?: Partial<Ctx>;
  timeoutSeconds?: number;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * `defineTool` for a tool that has already been validated.
 *
 * The CLI ran the real one at push time and refused anything malformed, so the
 * copy here only has to hand the definition back. Re-validating would mean two
 * implementations of the same rules, and the one further from the author is the
 * one that goes stale.
 */
const SDK_SHIM = "export const defineTool = (t) => t;";

function moduleUrl(code: string): string {
  const shim = `data:application/javascript;charset=utf-8,${encodeURIComponent(SDK_SHIM)}`;
  // Measured on this runtime: a data: URL of JavaScript imports; the same URL
  // declared as TypeScript does not, and a .ts file written to /tmp is refused
  // by the worker's module loader. Hence stripped code and this rewrite.
  const rewritten = code.replace(/from\s+["']@vokoo\/sdk["']/, `from ${JSON.stringify(shim)}`);
  return `data:application/javascript;charset=utf-8,${encodeURIComponent(rewritten)}`;
}

/** Everything the tool printed, in order, so `vokoo run` can show it. */
function captureConsole(lines: string[]) {
  const real = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  const record = (level: string) => (...parts: unknown[]) => {
    const text = parts
      .map((part) => (typeof part === "string" ? part : safeStringify(part)))
      .join(" ");
    // Bounded: a tool that prints in a loop must not turn one invocation into a
    // response nobody can read.
    if (lines.length < 500) lines.push(level === "log" ? text : `${level}: ${text}`);
  };
  console.log = record("log");
  console.info = record("info");
  console.warn = record("warn");
  console.error = record("error");
  return () => {
    console.log = real.log;
    console.info = real.info;
    console.warn = real.warn;
    console.error = real.error;
  };
}

/**
 * A stack somebody can read.
 *
 * The tool is imported from a `data:` URL, so every frame in it carries the
 * whole encoded module — a three-line trace arrives as several kilobytes of
 * percent-encoding with the useful part buried. The URL is replaced by the
 * tool's name, and the executor's own frames are dropped: they are the same on
 * every failure and say nothing about this one.
 */
function readableStack(error: Error, name: string): string {
  return (error.stack ?? "")
    .split("\n")
    .filter((line) => !line.includes("/functions/run/index.ts") && !line.includes("ext:runtime/"))
    // Up to the line:column the frame ends with. The encoded module contains
    // brackets and newlines of its own, so stopping at the first `)` leaves a
    // tail of percent-encoding behind.
    .map((line) => line.replace(/data:application\/javascript;charset=utf-8,[\s\S]*?(?=:\d+:\d+\))/g, name))
    .slice(0, 6)
    .join("\n");
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // A circular object printed by a handler is not a reason to fail the call.
    return String(value);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  // The caller was authenticated by the main service against VOKOO_RUN_SECRET,
  // before this worker was created. It is not checked again here because there
  // is nothing left to check it against: this worker's environment is empty by
  // design, so that a handler evaluated below has nothing to steal. Nothing can
  // reach this except through main.
  //
  // See docs/vendor-overrides.md — the check lives in a file Supabase ships.

  let body: RunRequest;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "bad_request", message: "body is not JSON" });
  }

  const { code, args = {}, timeoutSeconds = 10 } = body;
  if (!code) return json(400, { ok: false, error: "bad_request", message: "code is required" });

  const ctx: Ctx = {
    callId: body.ctx?.callId ?? null,
    orgId: body.ctx?.orgId ?? "",
    variables: body.ctx?.variables ?? {},
    secrets: body.ctx?.secrets ?? {},
  };

  const logs: string[] = [];
  const started = Date.now();
  const restore = captureConsole(logs);

  try {
    // Loading and running are both inside the budget: a tool can spend its
    // whole timeout at module scope, and an import that never resolves would
    // otherwise hang with no deadline at all.
    const work = (async () => {
      const mod = await import(moduleUrl(code));
      const tool = mod.default as { handler?: (a: unknown, c: Ctx) => unknown } | undefined;
      if (typeof tool?.handler !== "function") {
        throw new Error("the module's default export has no handler");
      }
      return await tool.handler(args, {
        ...ctx,
        // Named rather than the global so an outbound call is attributable, and
        // so an allowlist can be added later without editing any handler.
        fetch: (input: string | URL | Request, init?: RequestInit) => fetch(input, init),
      } as Ctx);
    })();

    const OVERDUE = Symbol("overdue");
    const budget = Math.min(Math.max(timeoutSeconds, 1), 300) * 1000;
    const raced = await Promise.race([
      work,
      new Promise<typeof OVERDUE>((resolve) => setTimeout(() => resolve(OVERDUE), budget)),
    ]);

    if (raced === OVERDUE) {
      // The work is abandoned, not cancelled: there is no isolate to terminate
      // from in here. It stops when this worker is retired.
      return json(200, {
        ok: false,
        error: "timed_out",
        message: `the tool did not finish within ${timeoutSeconds}s`,
        logs,
        duration_ms: Date.now() - started,
      });
    }

    return json(200, { ok: true, result: raced, logs, duration_ms: Date.now() - started });
  } catch (error) {
    // A throw is the tool's answer, not this function's failure — reported with
    // the logs, because what it printed before throwing is usually the reason.
    return json(200, {
      ok: false,
      error: "threw",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? readableStack(error, body.name ?? "tool") : undefined,
      logs,
      duration_ms: Date.now() - started,
    });
  } finally {
    restore();
  }
});

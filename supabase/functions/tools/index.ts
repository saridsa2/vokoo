// The tool dispatcher.
//
// One endpoint for every tool an agent or a flow can call, rather than one
// function per tool. Organisation scoping, argument validation, the timeout and
// the call_events row are needed by every tool; four copies of them would drift,
// and a tool invocation missing from the call trace is invisible exactly when
// someone is working out why a call went wrong.
//
// Contract: docs/specs/2026-08-31-tool-dispatcher.md

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** A caller is mid-sentence on a live call; a flow step is not. */
const BUDGET_MS: Record<string, number> = { live: 2_000, flow: 30_000 };

type Body = {
  tool?: string;
  args?: Record<string, unknown>;
  org_id?: string;
  call_id?: string | null;
  /** The carrier's ucid, for callers that never see the calls row id. */
  ucid?: string | null;
  invocation?: "live" | "flow";
  sequence?: number | null;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const fail = (error: string, message: string, status = 200) =>
  json(status, { ok: false, error, message });

async function rest(path: string, query: string): Promise<unknown[]> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}?${query}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return await response.json();
}

/**
 * Enough of JSON Schema to catch the mistakes that actually happen: a missing
 * required argument, and a value of the wrong primitive type. `tools.schema` is
 * the same declaration the model is given, so a rejection here means the model
 * was shown one contract and called another — worth reporting rather than
 * coercing quietly.
 */
function validate(schema: Record<string, unknown>, args: Record<string, unknown>): string | null {
  const required = (schema.required as string[] | undefined) ?? [];
  for (const key of required) {
    if (args[key] === undefined || args[key] === null || args[key] === "") {
      return `missing required argument: ${key}`;
    }
  }
  const properties = (schema.properties as Record<string, { type?: string }> | undefined) ?? {};
  for (const [key, value] of Object.entries(args)) {
    const expected = properties[key]?.type;
    if (!expected) continue;
    const actual = Array.isArray(value) ? "array" : typeof value;
    const ok = expected === "number" ? actual === "number"
      : expected === "integer" ? Number.isInteger(value)
      : expected === actual;
    if (!ok) return `argument ${key} should be ${expected}, got ${actual}`;
  }
  return null;
}

/**
 * The invocation, in the same timeline as the flow's own steps. Spawned rather
 * than awaited: the caller is waiting on the tool, not on our bookkeeping, and
 * a trace that fails to write must not fail the call.
 */
function trace(row: Record<string, unknown>) {
  // Held open with waitUntil. Spawning the write and returning is not enough:
  // the isolate is retired once the response is sent, and the runtime logged
  // "early termination has been triggered" while a real call's trace went
  // missing. The caller still does not wait for this — waitUntil defers the
  // retirement, it does not delay the response.
  EdgeRuntime.waitUntil(
    fetch(`${SUPABASE_URL}/rest/v1/rpc/call_event`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(row),
    }).catch((error) => console.error("[tools] trace failed", error)),
  );
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return fail("method_not_allowed", "POST only", 405);

  // Checked here rather than left to the gateway. FUNCTIONS_VERIFY_JWT is false
  // on this deployment and api-gw is published on 0.0.0.0:8000, so without this
  // the endpoint is reachable by anyone — while holding the service key and
  // able to POST to whatever endpoint_url a tool row names. The bridge and the
  // control plane hold this key; a browser never calls this.
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (presented !== SERVICE_KEY) {
    return fail("unauthorized", "service role key required", 401);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return fail("bad_request", "body is not JSON", 400);
  }

  const { tool, args = {}, org_id, ucid = null, invocation = "flow", sequence = null } = body;
  let { call_id = null } = body;
  if (!tool) return fail("bad_request", "tool is required", 400);
  if (!org_id) return fail("bad_request", "org_id is required", 400);

  const started = Date.now();
  let callVariables: Record<string, unknown> = {};

  // The bridge knows the carrier's ucid and not the calls row id — migration
  // 0020 calls the ucid "the one identifier that outlives the socket", and the
  // flow runner never handles anything else. Resolving it here keeps that
  // asymmetry out of the caller. A miss is not an error: the invocation still
  // runs, it is only untraceable.
  if (!call_id && ucid) {
    try {
      const found = await rest(
        "calls",
        `provider_call_id=eq.${encodeURIComponent(ucid)}&org_id=eq.${encodeURIComponent(org_id)}&select=id,variables&limit=1`,
      );
      const call = found[0] as { id?: string; variables?: Record<string, unknown> } | undefined;
      call_id = call?.id ?? null;
      // Shared state lives on the call, so the call is where arguments come
      // from. The flow's `var` nodes fill `variables`; this spends them.
      // Anything the node stated explicitly wins, so a node can override one
      // argument without restating the rest.
      callVariables = call?.variables ?? {};
    } catch (error) {
      console.error("[tools] could not resolve ucid", error);
    }
  }

  // The organisation is checked against the row rather than taken on the
  // caller's word: this endpoint holds the service key, so it is the only thing
  // standing between one organisation's call and another's tool.
  let rows: unknown[];
  try {
    rows = await rest(
      "tools",
      `name=eq.${encodeURIComponent(tool)}&org_id=eq.${encodeURIComponent(org_id)}&select=id,name,kind,endpoint_url,schema,config&limit=1`,
    );
  } catch (error) {
    return fail("lookup_failed", String(error));
  }

  const row = rows[0] as
    | { id: string; name: string; kind: string; endpoint_url: string | null; schema: Record<string, unknown>; config: Record<string, unknown> }
    | undefined;
  if (!row) return fail("unknown_tool", `no tool named ${tool} in this organisation`);

  const effectiveArgs = { ...callVariables, ...args };
  const invalid = validate(row.schema ?? {}, effectiveArgs);
  if (invalid) return fail("invalid_arguments", invalid);

  if (row.kind !== "http" || !row.endpoint_url) {
    return fail("unsupported_kind", `tool ${tool} is kind ${row.kind}, which this dispatcher does not run yet`);
  }

  const budget = BUDGET_MS[invocation] ?? BUDGET_MS.flow;

  // The upstream call is started once and then raced against the budget, rather
  // than aborted at it. EdgeRuntime.waitUntil is available on this runtime
  // (verified on edge-runtime 1.74.0), so exceeding the budget does not have to
  // mean abandoning the work: the caller gets an answer inside their budget and
  // the request carries on in the background, writing its result when it lands.
  const inflight = fetch(row.endpoint_url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args: effectiveArgs, call_id, org_id }),
  })
    .then(async (upstream) => ({
      ok: upstream.ok,
      status: upstream.status,
      payload: await upstream.json().catch(() => ({})),
    }))
    .catch((e) => ({ ok: false, status: 0, payload: { message: String(e) } }));

  const OVERDUE = Symbol("overdue");
  const raced = await Promise.race([
    inflight,
    new Promise<typeof OVERDUE>((resolve) => setTimeout(() => resolve(OVERDUE), budget)),
  ]);

  if (raced === OVERDUE) {
    const duration = Date.now() - started;
    // The work is not cancelled. It finishes on its own and records itself, so
    // a later step or the call.ended handler can see what happened.
    EdgeRuntime.waitUntil(
      inflight.then((late) => {
        if (!call_id) return;
        trace({
          p_call_id: call_id,
          p_sequence: sequence,
          p_node_id: null,
          p_node_name: row.name,
          p_implementation: `tool.${row.name}`,
          p_outcome: late.ok ? "ok_late" : "failed_late",
          p_duration_ms: Date.now() - started,
          p_trigger: invocation === "live" ? "call.answered" : "call.ended",
          p_detail: { args: effectiveArgs, result: late.payload, invocation, overdue_after_ms: budget },
        });
      }),
    );
    return json(200, {
      ok: true,
      result: { status: "working" },
      outcome: null,
      // The agent needs something true to say. It has not failed, and it is not
      // done — saying either would be a lie to the caller.
      speak: "I'm getting that sorted for you.",
      duration_ms: duration,
    });
  }

  const { ok, status, payload } = raced;
  const error = ok ? null : status ? `upstream_${status}` : "upstream_unreachable";
  const duration = Date.now() - started;

  if (call_id) {
    trace({
      p_call_id: call_id,
      p_sequence: sequence,
      p_node_id: null,
      p_node_name: row.name,
      p_implementation: `tool.${row.name}`,
      p_outcome: ok ? "ok" : (error ?? "failed"),
      p_duration_ms: duration,
      p_trigger: invocation === "live" ? "call.answered" : "call.ended",
      p_detail: { args: effectiveArgs, result: payload, invocation },
    });
  }

  if (!ok) {
    return json(200, {
      ok: false,
      error,
      message: (payload as { message?: string })?.message ?? "the tool did not answer",
      duration_ms: duration,
    });
  }

  const result = payload as { result?: unknown; outcome?: string; speak?: string };
  return json(200, {
    ok: true,
    result: result.result ?? payload,
    outcome: result.outcome ?? null,
    speak: result.speak ?? null,
    duration_ms: duration,
  });
});

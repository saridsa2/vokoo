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
  fetch(`${SUPABASE_URL}/rest/v1/rpc/call_event`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(row),
  }).catch((error) => console.error("[tools] trace failed", error));
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

  const { tool, args = {}, org_id, call_id = null, invocation = "flow", sequence = null } = body;
  if (!tool) return fail("bad_request", "tool is required", 400);
  if (!org_id) return fail("bad_request", "org_id is required", 400);

  const started = Date.now();

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

  const invalid = validate(row.schema ?? {}, args);
  if (invalid) return fail("invalid_arguments", invalid);

  if (row.kind !== "http" || !row.endpoint_url) {
    return fail("unsupported_kind", `tool ${tool} is kind ${row.kind}, which this dispatcher does not run yet`);
  }

  const budget = BUDGET_MS[invocation] ?? BUDGET_MS.flow;
  const abort = AbortSignal.timeout(budget);

  let payload: unknown;
  let ok = false;
  let error: string | null = null;

  try {
    const upstream = await fetch(row.endpoint_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ args, call_id, org_id }),
      signal: abort,
    });
    payload = await upstream.json().catch(() => ({}));
    ok = upstream.ok;
    if (!ok) error = `upstream_${upstream.status}`;
  } catch (e) {
    // A live caller is mid-sentence, so a timeout is answered rather than
    // retried: the agent says something, and slow work belongs in the
    // call.ended handler instead.
    error = abort.aborted ? "timed_out" : "upstream_unreachable";
    payload = { message: String(e) };
  }

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
      p_detail: { args, result: payload, invocation },
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

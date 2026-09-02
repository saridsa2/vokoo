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

/**
 * A caller is mid-sentence on a live call; a flow step is not.
 *
 * Exceeding a budget is not a failure of the work — the request carries on
 * under `waitUntil` and records what it did. It is a statement about what can
 * be said yet, and the answer at that moment is "not finished".
 */
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

/**
 * Run a tool that was pushed with the SDK.
 *
 * Two hops: read the live version's code, then hand it to `run`. The code is
 * read here because this function has the service key and `run` deliberately has
 * nothing — an isolate that evaluates somebody's handler must not also be able
 * to reach the database.
 *
 * `run` answers 200 with `ok: false` for a tool that threw or timed out, because
 * that is the tool's answer rather than a transport failure. Its shape is mapped
 * onto this dispatcher's, so a flow node and the model see one contract however
 * a tool happens to be implemented.
 */
async function runStoredFunction(
  row: { id: string; name: string },
  args: Record<string, unknown>,
  call_id: string | null,
  org_id: string,
  variables: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; payload: Record<string, unknown> }> {
  try {
    const tools = await rest("tools", `id=eq.${row.id}&select=current_version&limit=1`);
    const version = (tools[0] as { current_version?: number } | undefined)?.current_version ?? 0;
    if (version === 0) {
      return { ok: false, status: 0, payload: { message: `${row.name} has no pushed version` } };
    }

    const versions = await rest(
      "tool_versions",
      `tool_id=eq.${row.id}&version=eq.${version}&select=code,snapshot&limit=1`,
    );
    const stored = versions[0] as { code?: string; snapshot?: { timeoutSeconds?: number } } | undefined;
    if (!stored?.code) {
      return { ok: false, status: 0, payload: { message: `${row.name} v${version} has no code` } };
    }

    const response = await fetch(`${SUPABASE_URL}/functions/v1/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("VOKOO_RUN_SECRET") ?? ""}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: row.name,
        version,
        code: stored.code,
        args,
        timeoutSeconds: stored.snapshot?.timeoutSeconds ?? 10,
        // A real call, so the handler gets the call's state. Secrets stay empty
        // until there is a vault path that does not put them in a bundle.
        ctx: { callId: call_id, orgId: org_id, variables, secrets: {} },
      }),
    });

    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ok: body.ok === true,
      status: response.status,
      // `result` is what the tool returned; the rest is why it did not.
      payload: body.ok === true
        ? { result: body.result, logs: body.logs }
        // `error` is carried so the trace records what the tool did — `threw`,
        // `timed_out` — rather than the HTTP status of the isolate that ran it.
        : { message: body.message ?? body.error, error: body.error, logs: body.logs },
    };
  } catch (error) {
    return { ok: false, status: 0, payload: { message: String(error) } };
  }
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

  const budget = BUDGET_MS[invocation] ?? BUDGET_MS.flow;

  // Started once and then raced against the budget, rather than aborted at it.
  // EdgeRuntime.waitUntil is available on this runtime (verified on
  // edge-runtime 1.74.0), so exceeding the budget does not mean abandoning the
  // work: it carries on and records its result when it lands.
  let inflight: Promise<{ ok: boolean; status: number; payload: Record<string, unknown> }>;

  if (row.kind === "function") {
    // Pushed with the SDK. The code lives in `tool_versions` and runs in the
    // `run` isolate, which has an empty environment — this function has the
    // service key and that one must not.
    inflight = runStoredFunction(row, effectiveArgs, call_id, org_id, callVariables);
  } else if (row.kind === "http" && row.endpoint_url) {
    inflight = fetch(row.endpoint_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ args: effectiveArgs, call_id, org_id }),
    })
      .then(async (upstream) => ({
        ok: upstream.ok,
        status: upstream.status,
        payload: (await upstream.json().catch(() => ({}))) as Record<string, unknown>,
      }))
      .catch((e) => ({ ok: false, status: 0, payload: { message: String(e) } }));
  } else {
    return fail("unsupported_kind", `tool ${tool} is kind ${row.kind}, which this dispatcher does not run yet`);
  }

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
    // `ok: false`. The earlier version of this answered `ok: true` with
    // `result: {status:"working"}`, and `call_live` hands the whole envelope to
    // the model as its function response — so the model was told the tool had
    // succeeded. A model that believes a booking succeeded tells the caller so.
    //
    // The work is not abandoned: it finishes under `waitUntil` above and writes
    // its own `ok_late` row. What changes is only what the model is told now,
    // which is the truth — it has not finished.
    //
    // The flow path reads `error` and routes `timed_out` to its `working`
    // outcome, which is where "still running" belongs: a graph can branch on
    // it, and a sentence to a caller cannot.
    return json(200, {
      ok: false,
      error: "timed_out",
      message: "still running; there is no result yet",
      result: { status: "working" },
      duration_ms: duration,
    });
  }

  const { ok, status, payload } = raced;
  // A tool that reported its own failure names it. Only a transport problem
  // gets a status-derived label — a handler that threw was recorded as
  // `upstream_200`, which describes the isolate answering successfully and says
  // nothing about the tool.
  const reported = (payload as { error?: unknown }).error;
  const error = ok
    ? null
    : typeof reported === "string" && reported
      ? reported
      : status
        ? `upstream_${status}`
        : "upstream_unreachable";
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

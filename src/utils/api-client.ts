/**
 * Client for the VoKoo control-plane API (Rust/Axum, see `server/`).
 *
 * Every data route is generic: `/api/v1/{resource}` maps to a table through a
 * server-side allowlist. That uniformity is why one `useResource` hook can back
 * fifteen list screens instead of fifteen bespoke clients.
 *
 * Two headers are mandatory on data routes:
 *   Authorization: Bearer <supabase access token>
 *   x-org-id:      <organization uuid>
 *
 * The org header is not optional and not inferred server-side: RLS scopes rows
 * by organization, so a request without it reads as "no rows" rather than as an
 * error — which is indistinguishable from an empty table unless you know to
 * look for it.
 */

const API_URL = process.env.NEXT_PUBLIC_CONTROLPLANE_API_URL ?? "http://localhost:8081";

export type ApiEnvelope<T> = {
    data: T;
    meta?: { count?: number; limit?: number; offset?: number; resource?: string };
};

export type AccessContext = {
    accessToken: string;
    organizationId: string;
};

export type SupabaseSession = {
    access_token: string;
    refresh_token: string;
    expires_in: number;
};

/**
 * Supabase nests the session, so sign-in returns `{ data: { session, user } }`
 * rather than a flat session. Typing it flat compiles cleanly and then reads
 * `undefined` at runtime, which is a genuinely confusing failure.
 */
export type SignInResult = {
    session: SupabaseSession;
    user: { id: string; email: string };
};

export class ApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code?: string,
    ) {
        super(message);
        this.name = "ApiError";
    }

    /** A stale or missing token, i.e. the caller should sign in again. */
    get isAuthError() {
        return this.status === 401 || this.code === "unauthorized";
    }
}

async function request<T>(path: string, init: RequestInit = {}, context?: AccessContext): Promise<ApiEnvelope<T>> {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");

    if (context) {
        headers.set("authorization", `Bearer ${context.accessToken}`);
        headers.set("x-org-id", context.organizationId);
    }

    let response: Response;
    try {
        response = await fetch(`${API_URL}${path}`, { ...init, headers });
    } catch (cause) {
        // fetch only rejects on network-level failures, so this is "API is
        // unreachable" (tailnet down, service stopped) rather than a 4xx/5xx.
        throw new ApiError(`Cannot reach the control plane at ${API_URL}`, 0, "network_error");
    }

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
        throw new ApiError(
            payload?.error?.message ?? `Request failed with status ${response.status}`,
            response.status,
            payload?.error?.code,
        );
    }

    return payload as ApiEnvelope<T>;
}

export const api = {
    signIn: (email: string, password: string) =>
        request<SignInResult>("/api/v1/auth/sign-in", {
            method: "POST",
            body: JSON.stringify({ email, password }),
        }),

    /** Exchange a refresh token for a new access token. */
    refresh: (refreshToken: string) =>
        request<{ session: SupabaseSession }>("/api/v1/auth/refresh", {
            method: "POST",
            body: JSON.stringify({ refresh_token: refreshToken }),
        }),

    me: (context: AccessContext) => request<{ id: string; email: string }>("/api/v1/me", {}, context),

    list: <T>(resource: string, context: AccessContext) => request<T[]>(`/api/v1/${resource}`, {}, context),

    get: <T>(resource: string, id: string, context: AccessContext) => request<T>(`/api/v1/${resource}/${id}`, {}, context),

    /**
     * What happened the last times this tool ran on a real call.
     *
     * Empty until a caller reaches it: a test run belongs to no call, so it is
     * not written into the call trace.
     */
    toolRuns: <T>(name: string | undefined, context: AccessContext) =>
        request<T[]>(`/api/v1/tool-runs${name ? `?tool=${encodeURIComponent(name)}` : ""}`, {}, context),

    /**
     * The tools one skill grants.
     *
     * This link is what `compose_agent_tools` walks, so a tool missing from it
     * is one the model is never declared — however well the prompt describes it.
     */
    skillTools: <T>(skillId: string, context: AccessContext) =>
        request<T[]>(`/api/v1/skills/${skillId}/tools`, {}, context),

    /** Replace the set, because a list of checkboxes has a final state. */
    setSkillTools: (skillId: string, toolIds: string[], context: AccessContext) =>
        request<unknown>(
            `/api/v1/skills/${skillId}/tools`,
            { method: "PUT", body: JSON.stringify({ tool_ids: toolIds }) },
            context,
        ),

    /**
     * The skills an agent has.
     *
     * Where the chain starts: both prompt composers walk agent → skills → tools,
     * so an agent with none is told nothing and declared nothing.
     */
    agentSkills: <T>(agentId: string, context: AccessContext) =>
        request<T[]>(`/api/v1/agents/${agentId}/skills`, {}, context),

    setAgentSkills: (agentId: string, skillIds: string[], context: AccessContext) =>
        request<unknown>(
            `/api/v1/agents/${agentId}/skills`,
            { method: "PUT", body: JSON.stringify({ skill_ids: skillIds }) },
            context,
        ),

    /** Which flow answers which event on a number. */
    numberFlows: <T>(numberId: string, context: AccessContext) =>
        request<T[]>(`/api/v1/phone-numbers/${numberId}/flows`, {}, context),

    /** Bind one event to a flow, or pass null to unbind it. */
    setNumberFlow: (numberId: string, triggerEvent: string, flowId: string | null, context: AccessContext) =>
        request<unknown>(
            `/api/v1/phone-numbers/${numberId}/flows`,
            { method: "PUT", body: JSON.stringify({ trigger_event: triggerEvent, flow_id: flowId }) },
            context,
        ),

    /** Every version of one tool, newest first. */
    toolVersions: <T>(name: string, context: AccessContext) =>
        request<T[]>(`/api/v1/functions/${encodeURIComponent(name)}/versions`, {}, context),

    /**
     * Run one tool and report what it did.
     *
     * The same path a caller reaches: the control plane reads the version and
     * hands the code to the executor. A test that ran somewhere else would
     * prove something about somewhere else.
     */
    runFunction: <T>(name: string, args: unknown, version: number | undefined, context: AccessContext) =>
        request<T>(
            `/api/v1/functions/${encodeURIComponent(name)}/run`,
            { method: "POST", body: JSON.stringify({ args, ...(version ? { version } : {}) }) },
            context,
        ),

    create: <T>(resource: string, body: unknown, context: AccessContext) =>
        request<T>(`/api/v1/${resource}`, { method: "POST", body: JSON.stringify(body) }, context),

    update: <T>(resource: string, id: string, body: unknown, context: AccessContext) =>
        request<T>(`/api/v1/${resource}/${id}`, { method: "PATCH", body: JSON.stringify(body) }, context),

    remove: (resource: string, id: string, context: AccessContext) =>
        request<void>(`/api/v1/${resource}/${id}`, { method: "DELETE" }, context),

    metrics: <T>(context: AccessContext) => request<T>("/api/v1/metrics", {}, context),

    /**
     * Put a supervisor on a live call.
     *
     * `listen`, `whisper` or `barge`. The control plane decides whether — role,
     * and the supervisor's own extension, never one named here — and the bridge
     * decides how. `note` is only read when whispering to an AI agent, where
     * the equivalent of speaking into somebody's ear is text into the model's
     * session.
     */
    monitorCall: <T>(
        callId: string,
        mode: "listen" | "whisper" | "barge",
        note: string | undefined,
        context: AccessContext,
    ) =>
        request<T>(
            `/api/v1/calls/${encodeURIComponent(callId)}/monitor`,
            { method: "POST", body: JSON.stringify({ mode, note }) },
            context,
        ),

    /**
     * What the line has been doing, bucketed for a chart.
     *
     * The dashboard's other half. Its live band is a stream; this is a plain
     * GET, because history does not change until a call ends — and when one
     * does, the stream says so, which is what triggers the refetch. Still no
     * polling: the same event drives both.
     */
    dashboardHistory: <T>(days: number, timezone: string, context: AccessContext) =>
        request<T>(
            `/api/v1/dashboard/history?days=${days}&tz=${encodeURIComponent(timezone)}`,
            {},
            context,
        ),

    /**
     * Providers, models, voices and transcribers in one response.
     *
     * One request rather than four: the console needs the whole registry to
     * render a single screen, and four responses can arrive out of order and
     * paint a provider whose models have not loaded yet.
     */
    catalogue: <T>(context: AccessContext) => request<T>("/api/v1/catalogue", {}, context),

    /**
     * Publish an agent.
     *
     * Not a PATCH with `status: "published"`. The row update, the version number
     * and the snapshot have to be written together, so the server delegates to a
     * database function and this is its own route. A PATCH would update the row
     * and write no history, which is only discovered by someone trying to roll
     * back and finding nothing to roll back to.
     */
    publishAgent: <T>(id: string, body: unknown, context: AccessContext) =>
        request<T>(`/api/v1/agents/${id}/publish`, { method: "POST", body: JSON.stringify(body) }, context),

    agentVersions: <T>(id: string, context: AccessContext) =>
        request<T[]>(`/api/v1/agents/${id}/versions`, {}, context),

    publishFlow: <T>(id: string, graph: unknown, context: AccessContext) =>
        request<T>(`/api/v1/flows/${id}/publish`, { method: "POST", body: JSON.stringify(graph) }, context),

    flowVersions: <T>(id: string, context: AccessContext) =>
        request<T[]>(`/api/v1/flows/${id}/versions`, {}, context),

    restoreFlowVersion: <T>(id: string, version: number, context: AccessContext) =>
        request<T>(`/api/v1/flows/${id}/versions/${version}/restore`, { method: "POST" }, context),

    restoreAgentVersion: <T>(id: string, version: number, context: AccessContext) =>
        request<T>(`/api/v1/agents/${id}/versions/${version}/restore`, { method: "POST" }, context),

    organization: <T>(context: AccessContext) => request<T>("/api/v1/settings/organization", {}, context),

    /**
     * The organizations this user belongs to.
     *
     * **The one route that does not need `x-org-id`**, and it has to be: after
     * signing in the console knows a token and nothing else, so any route that
     * demanded an organisation first could never be the one that found it.
     */
    myOrganizations: <T>(accessToken: string) =>
        request<T[]>("/api/v1/me/organizations", {}, { accessToken, organizationId: "" }),

    /* ---------------------------------------------------------- operator */

    /**
     * Whoever runs the platform, as distinct from whoever uses it.
     *
     * **None of these send `x-org-id`.** An operator is a member of no tenant,
     * so an organisation header would be pretending they act from inside one.
     * The guard is `is_platform_admin()`, on the first line of every function
     * these reach — in the database rather than here, because a check in the
     * console protects the console and the functions are reachable by anything
     * holding a token.
     */
    operatorMe: <T>(context: AccessContext) => request<T>("/api/v1/operator/me", {}, context),

    operatorTenants: <T>(context: AccessContext) =>
        request<T[]>("/api/v1/operator/tenants", {}, context),

    operatorSetTenant: (
        id: string,
        change: { plan?: string; status?: string },
        context: AccessContext,
    ) =>
        request<unknown>(
            `/api/v1/operator/tenants/${id}`,
            { method: "POST", body: JSON.stringify(change) },
            context,
        ),

    operatorEntitlements: <T>(id: string, context: AccessContext) =>
        request<T[]>(`/api/v1/operator/tenants/${id}/entitlements`, {}, context),

    /** `allowed: null` clears the override and returns the tenant to its plan. */
    operatorSetEntitlement: (
        id: string,
        change: { kind: string; item_id: string; allowed: boolean | null },
        context: AccessContext,
    ) =>
        request<unknown>(
            `/api/v1/operator/tenants/${id}/entitlements`,
            { method: "POST", body: JSON.stringify(change) },
            context,
        ),

    /** Set your own name in this workspace. Empty clears it. */
    setMyName: (name: string, context: AccessContext) =>
        request<string>(
            "/api/v1/me/profile",
            { method: "POST", body: JSON.stringify({ name }) },
            context,
        ),

    members: <T>(context: AccessContext) => request<T[]>("/api/v1/settings/members", {}, context),

    /**
     * Add a member, and optionally give them an extension.
     *
     * One request, because they are one person. The SIP password comes back
     * once and is never returned again — digest authentication needs the
     * plaintext, so it cannot be hashed and is treated as a credential.
     */
    addMember: <T>(
        person: { name: string; email?: string; role: string; extension?: string },
        context: AccessContext,
    ) =>
        request<T>(
            "/api/v1/settings/members",
            { method: "POST", body: JSON.stringify(person) },
            context,
        ),


    /**
     * Vendor keys — what is connected, never what it is.
     *
     * There is deliberately no read route for a secret. The only function that
     * can decrypt one is granted to the service role, which the telephony
     * bridge holds and no browser ever sees.
     */
    vendorKeys: <T>(context: AccessContext) => request<T[]>("/api/v1/settings/vendors", {}, context),

    setVendorKey: <T>(body: { vendor: string; secret: string; label?: string }, context: AccessContext) =>
        request<T>("/api/v1/settings/vendors", { method: "POST", body: JSON.stringify(body) }, context),

    /**
     * Does this key work?
     *
     * Sends the key as typed, because nothing may read a stored one — the
     * resolver is service_role only and the control plane holds no service key.
     * `supported: false` means no probe is known for that vendor.
     */
    testVendorKey: (vendor: string, secret: string, context: AccessContext) =>
        request<{ supported: boolean; ok?: boolean; reason?: string | null }>(
            `/api/v1/settings/vendors/${vendor}/test`,
            { method: "POST", body: JSON.stringify({ secret }) },
            context,
        ),

    /**
     * Would this engine work?
     *
     * The bridge opens the connections a call opens and reports what each
     * provider said. Slow by nature — it is talking to three services — so
     * callers should show it working.
     */
    preflightEngine: <T>(engineId: string, context: AccessContext) =>
        request<T>(`/api/v1/engines/${engineId}/preflight`, { method: "POST" }, context),

    /**
     * Walk a flow against a finished call without changing anything.
     *
     * The same walk a real hangup takes, with the write to the call and the
     * outgoing request withheld — so testing a flow cannot POST a lead into
     * somebody's CRM. What the node view shows in Input and Output.
     */
    dryRunFlow: <T>(flowId: string, ucid: string, context: AccessContext) =>
        request<T>(`/api/v1/flows/${flowId}/dry-run`, { method: "POST", body: JSON.stringify({ ucid }) }, context),

    /** Ask every connected provider what it currently offers. */
    refreshCatalogue: <T>(context: AccessContext) =>
        request<T>("/api/v1/catalogue/refresh", { method: "POST" }, context),

    deleteVendorKey: (vendor: string, context: AccessContext) =>
        request<void>(`/api/v1/settings/vendors/${vendor}`, { method: "DELETE" }, context),
};

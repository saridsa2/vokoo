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

    create: <T>(resource: string, body: unknown, context: AccessContext) =>
        request<T>(`/api/v1/${resource}`, { method: "POST", body: JSON.stringify(body) }, context),

    update: <T>(resource: string, id: string, body: unknown, context: AccessContext) =>
        request<T>(`/api/v1/${resource}/${id}`, { method: "PATCH", body: JSON.stringify(body) }, context),

    remove: (resource: string, id: string, context: AccessContext) =>
        request<void>(`/api/v1/${resource}/${id}`, { method: "DELETE" }, context),

    metrics: <T>(context: AccessContext) => request<T>("/api/v1/metrics", {}, context),

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

    members: <T>(context: AccessContext) => request<T[]>("/api/v1/settings/members", {}, context),


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

    deleteVendorKey: (vendor: string, context: AccessContext) =>
        request<void>(`/api/v1/settings/vendors/${vendor}`, { method: "DELETE" }, context),
};

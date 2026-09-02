/**
 * Talking to the control plane with an API key.
 *
 * The key goes in `Authorization` and the organisation in `x-org-id`, which is
 * what every other caller of this API already does. The control plane exchanges
 * the key for a short-lived token and reaches the database as the key's machine
 * user, so the organisation boundary is decided by row-level security rather
 * than by anything here.
 */

import type { Profile } from "./config.ts";
import type { SchemaManifestEntry } from "../../sdk/src/index.ts";
import type { PushEntry } from "./project.ts";

export class ApiError extends Error {
    // A plain field assigned in the body, not a constructor parameter property.
    // Node runs this file by stripping types rather than compiling it, and a
    // parameter property is syntax that has to be *generated*, not removed.
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = "ApiError";
        this.status = status;
    }
}

async function request(profile: Profile, path: string, init: RequestInit = {}): Promise<unknown> {
    const url = `${profile.apiUrl.replace(/\/$/, "")}${path}`;

    let response: Response;
    try {
        response = await fetch(url, {
            ...init,
            headers: {
                authorization: `Bearer ${profile.key}`,
                "x-org-id": profile.orgId,
                ...(init.body ? { "content-type": "application/json" } : {}),
                ...init.headers,
            },
        });
    } catch (error) {
        // A refused connection is the common case during setup and deserves to
        // name the address rather than surface as "fetch failed".
        throw new ApiError(`could not reach ${url}: ${(error as Error).message}`, 0);
    }

    const text = await response.text();
    let body: unknown;
    try {
        body = text ? JSON.parse(text) : {};
    } catch {
        body = { error: { message: text.slice(0, 200) } };
    }

    if (!response.ok) {
        const message =
            (body as { error?: { message?: string } })?.error?.message ?? `${response.status} ${response.statusText}`;
        throw new ApiError(message, response.status);
    }
    return body;
}

/**
 * Confirm a key works, before it is written to the config file.
 *
 * Reads a resource the key is entitled to rather than calling a dedicated
 * endpoint: what matters is that the key authenticates *and* resolves to this
 * organisation, and a purpose-built "is this valid" endpoint would answer the
 * first question only.
 */
export async function verify(profile: Profile): Promise<void> {
    try {
        await request(profile, "/api/v1/tools?limit=1");
    } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
            throw new ApiError("that key was not accepted — check it was copied whole", 401);
        }
        if (error instanceof ApiError && error.status === 403) {
            throw new ApiError("that key is not for this organisation — check the org id", 403);
        }
        throw error;
    }
}

export type RemoteTool = {
    id: string;
    name: string;
    description: string;
    kind: string;
    schema?: unknown;
    endpoint_url?: string | null;
    current_version?: number;
};

/** Every tool in the workspace, whether it was pushed or made in the console. */
export async function tools(profile: Profile): Promise<RemoteTool[]> {
    const body = (await request(profile, "/api/v1/tools?limit=200")) as { data?: RemoteTool[] };
    return body.data ?? [];
}

export type PushResult = {
    created?: string[];
    updated?: string[];
    unchanged?: string[];
};

export type RunResult = {
    ok: boolean;
    result?: unknown;
    error?: string;
    message?: string;
    stack?: string;
    logs?: string[];
    duration_ms?: number;
    version?: number;
};

export async function run(
    profile: Profile,
    name: string,
    args: unknown,
    version?: number,
): Promise<RunResult> {
    const body = (await request(profile, `/api/v1/functions/${encodeURIComponent(name)}/run`, {
        method: "POST",
        body: JSON.stringify({ args, ...(version ? { version } : {}) }),
    })) as { data?: RunResult };
    return body.data ?? { ok: false, error: "no_answer" };
}

export type Invocation = {
    node_name?: string;
    outcome?: string;
    duration_ms?: number;
    created_at?: string;
    implementation?: string;
    detail?: { args?: unknown; result?: { logs?: string[] } };
};

/** How many recent events to scan when looking for one tool's invocations. */
const LOG_SCAN = 500;

/**
 * Past invocations of a tool, from the call trace the dispatcher writes.
 *
 * Read from `call_events` rather than a log store of its own: a tool call is
 * already recorded there, in order, beside the flow steps around it. A second
 * place to look would answer the same question differently.
 */
export async function invocations(profile: Profile, name: string, limit: number): Promise<Invocation[]> {
    // Filtered here rather than in the query. `/api/v1/call-events` is the
    // generic list endpoint, which takes a limit and nothing else — a filter
    // passed to it is dropped in silence, which is how this first shipped
    // returning every event for every tool. Scanning a window and filtering is
    // honest about what it can see; a tool whose last call is older than
    // LOG_SCAN events ago will not appear, and `vokoo logs` says so.
    const body = (await request(profile, `/api/v1/call-events?limit=${LOG_SCAN}`)) as { data?: Invocation[] };
    const wanted = `tool.${name}`;
    return (body.data ?? []).filter((row) => row.implementation === wanted).slice(0, limit);
}

export { LOG_SCAN };

export async function push(
    profile: Profile,
    entries: PushEntry[],
    schemas: SchemaManifestEntry[] = [],
): Promise<PushResult & { schemas?: PushResult }> {
    // One request, so a project's tools and the schemas they refer to arrive
    // together. Sending them separately would let a tool land declaring an
    // input shape whose schema had not been pushed yet.
    const body = (await request(profile, "/api/v1/functions", {
        method: "POST",
        body: JSON.stringify({ functions: entries, schemas }),
    })) as { data?: PushResult & { schemas?: PushResult } };
    return body.data ?? {};
}

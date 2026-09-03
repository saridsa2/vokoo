"use client";

/**
 * Subscribe to a Server-Sent Events route on the control plane.
 *
 * ## Why not `EventSource`
 *
 * The browser's own SSE client cannot send headers, and every route here is
 * authenticated with `authorization` and `x-org-id`. The alternative is putting
 * the access token in the query string, where it is written into every proxy log
 * between the browser and the server and stays there — a bearer token is exactly
 * the thing that must not travel in a URL.
 *
 * `fetch` takes headers and hands back a `ReadableStream`, so the only thing
 * `EventSource` was giving us was the framing, which is four lines.
 *
 * ## What it does not do
 *
 * No polling, and no reconnect on a timer. A dropped stream reconnects once,
 * after a short pause that grows if the server is down — a screen left open
 * overnight against a restarting bridge must not turn into a request every
 * second.
 */

import { useEffect, useRef, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_CONTROLPLANE_API_URL ?? "";

export type StreamState<T> = {
    /** The most recent frame. Each frame is a whole snapshot. */
    data: T | null;
    /** True once a frame has arrived, so a screen can tell "empty" from "not yet". */
    connected: boolean;
    error: string | null;
};

export function useEventStream<T>(
    path: string,
    context: { accessToken: string; organizationId: string } | null,
): StreamState<T> {
    const [state, setState] = useState<StreamState<T>>({
        data: null,
        connected: false,
        error: null,
    });
    // Held across reconnects so a server that is down does not get a request a
    // second for as long as the tab is open.
    const backoff = useRef(1000);

    useEffect(() => {
        if (!context) return;
        let live = true;
        const controller = new AbortController();
        let retry: ReturnType<typeof setTimeout> | undefined;

        const connect = async () => {
            try {
                const response = await fetch(`${API_URL}${path}`, {
                    headers: {
                        authorization: `Bearer ${context.accessToken}`,
                        "x-org-id": context.organizationId,
                        accept: "text/event-stream",
                    },
                    signal: controller.signal,
                });
                if (!response.ok || !response.body) {
                    throw new Error(`the stream answered ${response.status}`);
                }

                backoff.current = 1000;
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";

                while (live) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });

                    // Frames are separated by a blank line. Anything after the
                    // last one is an incomplete frame and stays in the buffer:
                    // a chunk boundary can fall anywhere, and parsing half a
                    // frame would render half a dashboard.
                    const frames = buffer.split("\n\n");
                    buffer = frames.pop() ?? "";
                    for (const frame of frames) {
                        const payload = frame
                            .split("\n")
                            .filter((line) => line.startsWith("data:"))
                            .map((line) => line.slice(5).trim())
                            .join("\n");
                        // A keep-alive is a comment line and carries no data.
                        if (!payload) continue;
                        try {
                            const data = JSON.parse(payload) as T;
                            setState({ data, connected: true, error: null });
                        } catch {
                            // One unparseable frame is not a reason to tear
                            // down a working stream; the next one replaces it
                            // wholesale anyway.
                        }
                    }
                }
            } catch (problem) {
                if (!live || controller.signal.aborted) return;
                setState((current) => ({
                    ...current,
                    connected: false,
                    error: problem instanceof Error ? problem.message : "the stream stopped",
                }));
            }

            if (!live) return;
            retry = setTimeout(connect, backoff.current);
            backoff.current = Math.min(backoff.current * 2, 30_000);
        };

        void connect();
        return () => {
            live = false;
            controller.abort();
            if (retry) clearTimeout(retry);
        };
    }, [path, context?.accessToken, context?.organizationId]);

    return state;
}

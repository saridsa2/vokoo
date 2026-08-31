"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/utils/api-client";
import { useSession } from "./use-session";

/**
 * Read/write a control-plane resource.
 *
 * The API is uniform — `/api/v1/{resource}` for every table — so one hook backs
 * every list screen rather than fifteen near-identical fetchers.
 *
 * Records are kept in local state and patched on mutation instead of refetching
 * the collection. A refetch after every edit makes rows visibly jump on a slow
 * link; patching keeps the table stable and costs one round trip less.
 */

export type ResourceState<T> = {
    records: T[];
    isLoading: boolean;
    /** Non-null when the last request failed. */
    error: ApiError | null;
    /** True when the failure was an expired/absent token, not a real error. */
    isAuthError: boolean;
    refresh: () => Promise<void>;
    create: (body: Partial<T>) => Promise<T | null>;
    update: (id: string, body: Partial<T>) => Promise<T | null>;
    remove: (id: string) => Promise<boolean>;
};

export function useResource<T extends { id: string }>(resource: string): ResourceState<T> {
    const { context, isReady } = useSession();

    const [records, setRecords] = useState<T[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<ApiError | null>(null);

    // Guards against a response from a previous resource landing after the
    // component has switched to a new one and overwriting it.
    const requestId = useRef(0);

    const refresh = useCallback(async () => {
        if (!context) {
            setRecords([]);
            setIsLoading(false);
            return;
        }

        const id = ++requestId.current;
        setIsLoading(true);
        setError(null);

        try {
            const { data } = await api.list<T>(resource, context);
            if (id !== requestId.current) return; // superseded
            setRecords(data ?? []);
        } catch (cause) {
            if (id !== requestId.current) return;
            setError(cause instanceof ApiError ? cause : new ApiError(String(cause), 0));
            setRecords([]);
        } finally {
            if (id === requestId.current) setIsLoading(false);
        }
    }, [resource, context]);

    useEffect(() => {
        // Wait for the stored session to be read, or the first load fires
        // without credentials and comes back empty.
        if (!isReady) return;
        void refresh();
    }, [isReady, refresh]);

    const create = useCallback(
        async (body: Partial<T>) => {
            if (!context) return null;
            try {
                const { data } = await api.create<T>(resource, body, context);
                setRecords((current) => [data, ...current]);
                return data;
            } catch (cause) {
                setError(cause instanceof ApiError ? cause : new ApiError(String(cause), 0));
                return null;
            }
        },
        [resource, context],
    );

    const update = useCallback(
        async (id: string, body: Partial<T>) => {
            if (!context) return null;
            try {
                const { data } = await api.update<T>(resource, id, body, context);
                setRecords((current) => current.map((record) => (record.id === id ? { ...record, ...data } : record)));
                return data;
            } catch (cause) {
                setError(cause instanceof ApiError ? cause : new ApiError(String(cause), 0));
                return null;
            }
        },
        [resource, context],
    );

    const remove = useCallback(
        async (id: string) => {
            if (!context) return false;

            // Optimistic: keep the removed row so it can be restored if the
            // request fails, rather than leaving the table wrong until a reload.
            const previous = records;
            setRecords((current) => current.filter((record) => record.id !== id));

            try {
                await api.remove(resource, id, context);
                return true;
            } catch (cause) {
                setRecords(previous);
                setError(cause instanceof ApiError ? cause : new ApiError(String(cause), 0));
                return false;
            }
        },
        [resource, context, records],
    );

    return {
        records,
        isLoading,
        error,
        isAuthError: error?.isAuthError ?? false,
        refresh,
        create,
        update,
        remove,
    };
}

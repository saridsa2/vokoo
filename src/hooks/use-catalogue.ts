"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/utils/api-client";
import { EMPTY_CATALOGUE, type Catalogue } from "@/utils/capability-registry";
import { useSession } from "./use-session";

/**
 * The capability catalogue, fetched once per session.
 *
 * It describes the platform rather than the organisation, so it does not change
 * while anyone is looking at it and every screen can share one copy. The
 * module-level cache means opening five agents does not fetch it five
 * times, and the in-flight promise is cached too — without that, three screens
 * mounting together would each start their own request.
 */

let cached: Catalogue | null = null;
let inFlight: Promise<Catalogue> | null = null;

export type CatalogueState = {
    catalogue: Catalogue;
    isLoading: boolean;
    error: string | null;
};

export function useCatalogue(): CatalogueState {
    const { context, isReady } = useSession();

    const [catalogue, setCatalogue] = useState<Catalogue>(cached ?? EMPTY_CATALOGUE);
    const [isLoading, setIsLoading] = useState(!cached);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isReady || !context || cached) return;

        let cancelled = false;
        setIsLoading(true);

        inFlight ??= api
            .catalogue<Catalogue>(context)
            .then(({ data }) => {
                cached = {
                    providers: data?.providers ?? [],
                    models: data?.models ?? [],
                    voices: data?.voices ?? [],
                    transcribers: data?.transcribers ?? [],
                    vendors: data?.vendors ?? [],
                    nodeTypes: data?.nodeTypes ?? [],
                };
                return cached;
            })
            .finally(() => {
                inFlight = null;
            });

        inFlight
            .then((value) => {
                if (!cancelled) setCatalogue(value);
            })
            .catch((cause) => {
                if (cancelled) return;
                // Every rule degrades to silence on an empty catalogue, so a
                // failure here means "no guidance" rather than a screen full of
                // warnings about its own loading state.
                setError(cause instanceof ApiError ? cause.message : String(cause));
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [isReady, context]);

    return { catalogue, isLoading, error };
}

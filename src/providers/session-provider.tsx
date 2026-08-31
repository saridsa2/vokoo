"use client";

import { createContext, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AccessContext } from "@/utils/api-client";
import { api } from "@/utils/api-client";
import { clearSession, readSession, writeSession, type StoredSession } from "@/utils/session-storage";

/**
 * Holds the signed-in session for the whole console.
 *
 * Centralised so screens never read localStorage themselves: a component that
 * reads storage directly renders before hydration with whatever the server
 * assumed, and the resulting mismatch shows up as a hydration error rather than
 * as an auth bug, which sends you looking in the wrong place.
 */

/**
 * Every data route requires `x-org-id`, but the API exposes no endpoint listing
 * the organizations a user belongs to — so the client cannot discover it after
 * signing in. Fine while there is one organization; multi-org needs a real
 * `GET /api/v1/me/organizations` and a picker on this screen.
 */
const DEFAULT_ORG_ID = process.env.NEXT_PUBLIC_DEFAULT_ORG_ID ?? "";

type SessionContextValue = {
    session: StoredSession | null;
    /** Auth headers for API calls; null when signed out. */
    context: AccessContext | null;
    /** False until the stored session has been read on the client. */
    isReady: boolean;
    signIn: (email: string, password: string, remember: boolean) => Promise<void>;
    signOut: () => void;
};

/** Renew a little before expiry, so a request never rides an expired token. */
const REFRESH_MARGIN_MS = 60_000;

export const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
    const [session, setSession] = useState<StoredSession | null>(null);
    const [isReady, setIsReady] = useState(false);

    // Read after mount, never during render: localStorage does not exist on the
    // server, so reading it during render would make the two passes disagree.
    useEffect(() => {
        const stored = readSession();

        // A stored session whose access token is spent but which carries a
        // refresh token ("remember me") is renewed before the console loads,
        // so returning users never see the sign-in screen unnecessarily.
        if (stored?.refreshToken && stored.expiresAt - REFRESH_MARGIN_MS <= Date.now()) {
            api.refresh(stored.refreshToken)
                .then(({ data }) => {
                    const renewed: StoredSession = {
                        ...stored,
                        accessToken: data.session.access_token,
                        // Supabase rotates the refresh token on every exchange;
                        // keeping the old one would break the next renewal.
                        refreshToken: data.session.refresh_token ?? stored.refreshToken,
                        expiresAt: Date.now() + (data.session.expires_in ?? 3600) * 1000,
                    };
                    writeSession(renewed);
                    setSession(renewed);
                })
                .catch(() => {
                    // Refresh rejected: the session is genuinely over.
                    clearSession();
                    setSession(null);
                })
                .finally(() => setIsReady(true));
            return;
        }

        setSession(stored);
        setIsReady(true);
    }, []);

    const signIn = useCallback(async (email: string, password: string, remember: boolean) => {
        const { data } = await api.signIn(email, password);

        const next: StoredSession = {
            accessToken: data.session.access_token,
            organizationId: DEFAULT_ORG_ID,
            email: data.user?.email ?? email,
            expiresAt: Date.now() + (data.session.expires_in ?? 3600) * 1000,
            // Stored only when asked for. Without it the session cannot outlive
            // the access token, which is exactly what declining to be
            // remembered should mean.
            refreshToken: remember ? data.session.refresh_token : undefined,
        };

        writeSession(next);
        setSession(next);
    }, []);

    const signOut = useCallback(() => {
        clearSession();
        setSession(null);
    }, []);

    const value = useMemo<SessionContextValue>(
        () => ({
            session,
            context: session ? { accessToken: session.accessToken, organizationId: session.organizationId } : null,
            isReady,
            signIn,
            signOut,
        }),
        [session, isReady, signIn, signOut],
    );

    return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

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
 * Which organisation a session is in.
 *
 * This used to be `NEXT_PUBLIC_DEFAULT_ORG_ID` — an environment variable, set
 * once, sent as `x-org-id` on every request whoever signed in. With one tenant
 * that is invisible; with two it is a person landing in somebody else's
 * workspace, and every session ever created carrying the assumption.
 *
 * The comment that stood here said the API exposed no endpoint listing a user's
 * organizations. It does: `GET /api/v1/me/organizations`, and it is deliberately
 * the one route that does not require `x-org-id` — a route that demanded an
 * organisation could never be the one that found it.
 *
 * The variable survives only as a *preference*: when somebody belongs to
 * several, it decides which they land in. It can no longer put them somewhere
 * they do not belong, because the list comes from their own memberships.
 */
const PREFERRED_ORG_ID = process.env.NEXT_PUBLIC_DEFAULT_ORG_ID ?? "";

export type Organization = {
    id: string;
    name: string;
    slug: string;
    role: string;
    /**
     * What this person is called in this organisation.
     *
     * On the membership rather than the account, because it can differ: the
     * same person is "Priya" in one workspace and "Dr Nair" in another.
     */
    member_name: string | null;
};

type SessionContextValue = {
    session: StoredSession | null;
    /** Auth headers for API calls; null when signed out. */
    context: AccessContext | null;
    /** False until the stored session has been read on the client. */
    isReady: boolean;
    signIn: (email: string, password: string, remember: boolean) => Promise<void>;
    signOut: () => void;
    /** Everywhere this user could be. Empty until a session exists. */
    organizations: Organization[];
    /** Move this session to another of them. */
    switchOrganization: (id: string) => void;
    /**
     * Whether this person runs the platform.
     *
     * Decides whether the operator navigation is offered, and nothing else. The
     * routes refuse on their own — a hidden menu item is a courtesy, not a
     * permission, and treating it as one is how a screen ends up guarded by CSS.
     */
    isOperator: boolean;
};

/** Renew a little before expiry, so a request never rides an expired token. */
const REFRESH_MARGIN_MS = 60_000;

export const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
    const [session, setSession] = useState<StoredSession | null>(null);
    const [isReady, setIsReady] = useState(false);
    const [organizations, setOrganizations] = useState<Organization[]>([]);
    const [isOperator, setIsOperator] = useState(false);

    // Read after mount, never during render: localStorage does not exist on the
    // server, so reading it during render would make the two passes disagree.
    useEffect(() => {
        // **A sign-in link is answered wherever it lands, not only at
        // `/auth/callback`.**
        //
        // GoTrue redirects to `SITE_URL` when a link carries no `redirect_to`,
        // which puts the tokens in the fragment of the *root* — and the root is
        // the sign-in screen, which ignored them. The symptom was a link that
        // "keeps taking me to the login page": the session was in the URL the
        // whole time and nothing read it.
        //
        // Two real cases produce such a link: every invitation, which is sent
        // server-side with no browser origin to name, and every link issued
        // before the callback route existed.
        //
        // Handling it here rather than on one page means the route the link
        // happens to land on stops mattering.
        if (typeof window !== "undefined" && window.location.hash.includes("access_token=")) {
            const hash = window.location.hash;
            // Out of the address bar before anything else can read it: a live
            // refresh token must not sit in history or in a copied URL.
            window.history.replaceState(null, "", window.location.pathname + window.location.search);
            window.location.replace(`/auth/callback${hash}`);
            return;
        }

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

        // Where they actually belong, not where an environment variable says.
        // A membership list of one is the common case and costs one request; a
        // list of none is somebody with an account and no workspace, which is a
        // real state and has to be said rather than rendered as an empty
        // console.
        const { data: mine } = await api.myOrganizations<Organization>(data.session.access_token);
        const belongs = mine ?? [];

        // **An operator is a member of no workspace**, deliberately — that is
        // what makes the platform portal a different product rather than a
        // privileged corner of one. So an empty membership list is two states,
        // not one, and refusing both was refusing the operator their own
        // account: `pop@sarvathra.ai` could not sign in anywhere.
        //
        // Asked here rather than inferred from the email or from a name, and
        // asked only when the list is empty, so the common sign-in still costs
        // one request.
        if (belongs.length === 0) {
            const { data: who } = await api
                .operatorMe<{ operator: boolean }>({
                    accessToken: data.session.access_token,
                    organizationId: "",
                })
                .catch(() => ({ data: { operator: false } }));

            if (!who?.operator) {
                throw new Error(
                    "That account is not a member of any workspace. Ask an owner to add you.",
                );
            }
            setIsOperator(true);
        }

        setOrganizations(belongs);
        // Empty for an operator. Every operator route drops `x-org-id`, and the
        // console's own screens are unreachable without a membership, so there
        // is nothing for it to be.
        const chosen =
            belongs.find((org) => org.id === PREFERRED_ORG_ID)?.id ?? belongs[0]?.id ?? "";

        const next: StoredSession = {
            accessToken: data.session.access_token,
            organizationId: chosen,
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
        setOrganizations([]);
        setIsOperator(false);
    }, []);

    /**
     * Move this session into another workspace.
     *
     * A full reload rather than a state change. Every screen holds data fetched
     * for the organisation it loaded under — a roster, a call list, a live
     * stream — and re-rendering with a new `x-org-id` would leave one
     * organisation's rows on screen under another's name until each screen
     * happened to refetch. Reloading is blunt and cannot be half-done.
     */
    const switchOrganization = useCallback(
        (id: string) => {
            setSession((current) => {
                if (!current || current.organizationId === id) return current;
                const next = { ...current, organizationId: id };
                writeSession(next);
                window.location.reload();
                return next;
            });
        },
        [],
    );

    /**
     * Keep the membership list current for a session restored from storage.
     *
     * Signing in fills it; a reload does not go through `signIn`, so without
     * this a returning user has a session and an empty switcher. It also
     * re-checks that the stored organisation is still one of theirs — a
     * membership can be revoked between visits, and a stale `x-org-id` would
     * otherwise be refused by every request with no explanation.
     */
    useEffect(() => {
        if (!session?.accessToken) return;
        let live = true;
        api.operatorMe<{ operator: boolean }>({
            accessToken: session.accessToken,
            organizationId: session.organizationId,
        })
            .then(({ data }) => live && setIsOperator(Boolean(data?.operator)))
            .catch(() => undefined);
        api.myOrganizations<Organization>(session.accessToken)
            .then(({ data }) => {
                if (!live) return;
                const belongs = data ?? [];
                setOrganizations(belongs);
                if (belongs.length > 0 && !belongs.some((org) => org.id === session.organizationId)) {
                    switchOrganization(belongs[0].id);
                }
            })
            .catch(() => undefined);
        return () => {
            live = false;
        };
    }, [session?.accessToken, session?.organizationId, switchOrganization]);

    const value = useMemo<SessionContextValue>(
        () => ({
            session,
            context: session ? { accessToken: session.accessToken, organizationId: session.organizationId } : null,
            organizations,
            switchOrganization,
            isOperator,
            isReady,
            signIn,
            signOut,
        }),
        [session, isReady, signIn, signOut, organizations, switchOrganization, isOperator],
    );

    return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

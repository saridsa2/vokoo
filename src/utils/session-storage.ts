/**
 * Session persistence for the console.
 *
 * The token lives in localStorage rather than a cookie because the API is a
 * different origin (Rust on :8081) and authenticates via a Bearer header — a
 * cookie would not be sent cross-origin without credentialed CORS we do not
 * otherwise need. The trade-off is that any script on this origin can read it,
 * which is acceptable while the console is tailnet-only and loads no
 * third-party scripts. Revisit if either of those changes.
 *
 * Every accessor is wrapped: localStorage throws outright in some contexts
 * (Safari private mode, storage disabled), and an unguarded read would take the
 * whole console down rather than failing to restore a session.
 */

const STORAGE_KEY = "vokoo.session";

export type StoredSession = {
    accessToken: string;
    organizationId: string;
    email: string;
    /** Epoch milliseconds. */
    expiresAt: number;
    /**
     * Present only when the user ticked "remember me".
     *
     * This is what makes the choice real: with it the console renews the access
     * token silently and the session survives for as long as Supabase allows
     * the refresh chain. Without it the session ends when the hour-long access
     * token expires, and the user signs in again.
     */
    refreshToken?: string;
};

export function readSession(): StoredSession | null {
    if (typeof window === "undefined") return null; // server render

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;

        const session = JSON.parse(raw) as StoredSession;

        // **An empty `organizationId` is valid.** It is what an operator has:
        // a platform administrator belongs to no workspace, which is the whole
        // reason the portal is a separate product, and every operator route
        // strips `x-org-id` deliberately.
        //
        // This check used to reject it, so an operator's session was written by
        // the sign-in and discarded by the very next read — the console then
        // rendered the sign-in screen over a session that existed. `pop@…`, the
        // only account that belongs to no workspace, could not stay signed in
        // by link or by password, and nothing anywhere failed loudly.
        //
        // The rule was correct when written: there was one product, and a
        // session without a workspace could do nothing. The operator portal
        // made it false and nothing rechecked it.
        if (!session.accessToken) return null;

        // An expired token with no refresh token is a dead session: drop it so
        // callers render sign-in instead of firing requests that all 401.
        // With a refresh token the session is recoverable, so it is returned
        // and the provider renews it.
        if (session.expiresAt && session.expiresAt <= Date.now() && !session.refreshToken) {
            window.localStorage.removeItem(STORAGE_KEY);
            return null;
        }

        return session;
    } catch {
        return null;
    }
}

export function writeSession(session: StoredSession) {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
        // Storage unavailable: the session still works for this tab, but will
        // not survive a reload.
    }
}

export function clearSession() {
    try {
        window.localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Nothing to do.
    }
}

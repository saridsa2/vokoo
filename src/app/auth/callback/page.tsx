"use client";

/**
 * Where a sign-in link lands.
 *
 * **Nothing read one before this existed.** GoTrue was sending magic links —
 * proven by a `user_confirmation_requested` audit event and a real SMTP round
 * trip — and the link put its tokens in the URL fragment of a page with no code
 * to take them. So every invitation this console has ever sent arrived at a
 * sign-in form asking for a password the recipient had never set.
 *
 * ## Why the fragment
 *
 * GoTrue's implicit flow returns `#access_token=…&refresh_token=…`. A fragment
 * is never sent to a server, which is the point: the tokens reach the browser
 * and nothing else, and they are not in the request line of any proxy log along
 * the way. It also means only client code can read them, which is why this page
 * is `"use client"` and does its work in an effect.
 *
 * The fragment is cleared with `replaceState` as soon as it is read. Leaving it
 * would put a live refresh token in the address bar, in the back-button history
 * and in anything the reader copies to ask why the page looks odd.
 *
 * ## Where it sends you
 *
 * The account decides, not the hostname. An operator belongs to no workspace,
 * so landing them on the console would show a shell with nothing in it; a
 * member has no platform portal. Both facts come from the session that was
 * just adopted, so this asks and then routes.
 */

import { useEffect, useState } from "react";

import { Button } from "@/components/base/buttons/button";
import { VokooLogo } from "@/components/foundations/logo/vokoo-logo";
import { api } from "@/utils/api-client";
import { writeSession, type StoredSession } from "@/utils/session-storage";

type Organization = { id: string; name: string };

export default function AuthCallbackPage() {
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const query = new URLSearchParams(window.location.search);

        // GoTrue reports a refusal — an expired or already-used link — in the
        // fragment too. Reading it is the difference between "this link has
        // expired, ask for another" and a blank page that appears to hang.
        const refusal = hash.get("error_description") ?? query.get("error_description");
        if (refusal) {
            setError(refusal.replace(/\+/g, " "));
            return;
        }

        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token") ?? undefined;
        if (!accessToken) {
            setError("This link carried no sign-in token. It may have already been used.");
            return;
        }

        // Kept before the address bar is cleared: an operator's session
        // cannot cross to the other host, so the *link* is forwarded instead
        // and this is what gets forwarded.
        const originalHash = window.location.hash;

        // Out of the address bar before anything else can read it.
        window.history.replaceState(null, "", window.location.pathname);

        const expiresAt = Date.now() + Number(hash.get("expires_in") ?? 3600) * 1000;

        void (async () => {
            try {
                const { data: mine } = await api.myOrganizations<Organization>(accessToken);
                const belongs = mine ?? [];

                // **Where to go is decided by the host, not by the account.**
                //
                // The previous version asked "is this an operator?" and only
                // asked it when the account had no memberships — so somebody
                // who is both a workspace member and a platform administrator
                // was treated as a member and sent to `/dashboard`. On the
                // operator host that route does not exist, and the reader got
                // a bare "Not found" after following a valid link.
                //
                // A link lands on the host it was requested from, which is the
                // product the person was trying to enter. That is a better
                // answer than anything inferred from the account, and it is
                // right for the two people here who are legitimately both.
                const onPlatformHost = window.location.hostname.startsWith("platform.");

                let operator = false;
                if (belongs.length === 0 || onPlatformHost) {
                    const { data: who } = await api
                        .operatorMe<{ operator: boolean }>({
                            accessToken,
                            organizationId: "",
                        })
                        .catch(() => ({ data: { operator: false } }));
                    operator = Boolean(who?.operator);
                }

                // Nothing to enter: no workspace and no platform to run.
                if (belongs.length === 0 && !operator) {
                    setError(
                        "You are signed in, but this account belongs to no workspace yet. Ask an owner to add you.",
                    );
                    return;
                }

                // A link issued by the console, followed by somebody whose only
                // home is the operator portal. The session cannot cross origins
                // — `localStorage` is per host, which is why the two products
                // have two of them — so the link is forwarded instead and this
                // origin keeps nothing.
                if (!onPlatformHost && belongs.length === 0 && operator) {
                    const home = platformCallback();
                    if (home) {
                        window.location.replace(home + originalHash);
                        return;
                    }
                }

                // An operator who reached the portal but is not one: say so
                // rather than storing a session that every route will refuse.
                if (onPlatformHost && !operator) {
                    setError(
                        "That account does not administer this platform. Sign in at the console instead.",
                    );
                    return;
                }

                const session: StoredSession = {
                    accessToken,
                    refreshToken,
                    organizationId: belongs[0]?.id ?? "",
                    // The link is the proof of identity, so the account's own
                    // address is what it proves — not something typed here.
                    email: readEmail(accessToken),
                    expiresAt,
                };
                writeSession(session);

                // A full navigation rather than a router push: the session is
                // in storage and every shell reads it on mount, so arriving
                // fresh is what makes it take effect.
                //
                // **An operator has to cross to the other host, not just the
                // other path.** A link is issued against the console — that is
                // where `SITE_URL` and `CONSOLE_URL` both point, and where an
                // invited member belongs — so the callback runs on
                // `console.…`. Sending an operator to `/platform` from there
                // lands on a route the middleware correctly refuses, and the
                // reader sees a bare "Not found" after following a valid link.
                //
                // Derived rather than configured: the two hosts differ by one
                // label, and a `NEXT_PUBLIC_` variable would be baked in at
                // build time — which is exactly the trap that pointed the
                // console at a raw IP earlier today. On localhost, which
                // serves both products, there is no prefix to swap and the
                // relative path is right.
                window.location.replace(onPlatformHost ? "/platform" : "/dashboard");
            } catch (cause) {
                setError((cause as Error).message);
            }
        })();
    }, []);

    return (
        <main className="grid min-h-dvh place-items-center bg-primary p-6">
            <div className="flex w-full max-w-sm flex-col gap-4">
                <VokooLogo className="h-6" />
                {error ? (
                    <>
                        <h1 className="text-lg font-semibold text-primary">That link did not work</h1>
                        <p className="text-sm text-tertiary">{error}</p>
                        <div className="pt-1">
                            <Button size="sm" href="/">
                                Back to sign in
                            </Button>
                        </div>
                    </>
                ) : (
                    <p className="text-sm text-tertiary">Signing you in.</p>
                )}
            </div>
        </main>
    );
}


/**
 * This same page on the operator's host, or null when we are already there.
 *
 * Derived rather than configured: the two hosts differ by one label, and a
 * `NEXT_PUBLIC_` variable is baked in at build time — the trap that pointed the
 * console at a raw IP earlier today. Localhost serves both products from one
 * origin, so there is no prefix to swap and nothing to forward.
 */
function platformCallback(): string | null {
    const { hostname, protocol, port } = window.location;
    if (!hostname.startsWith("console.")) return null;
    const host = `platform.${hostname.slice("console.".length)}`;
    return `${protocol}//${host}${port ? `:${port}` : ""}/auth/callback`;
}

/**
 * The address inside the token, so the shell can print who is signed in.
 *
 * Decoding a JWT payload is not verifying it — the signature is not checked
 * here and must not be relied on. It is safe for this because nothing is
 * granted by it: every request carries the token to a server that does verify,
 * and the worst a forged payload achieves is a wrong name over a session that
 * still cannot read anything.
 */
function readEmail(token: string): string {
    try {
        const [, payload] = token.split(".");
        const json = JSON.parse(
            atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
        ) as { email?: string };
        return json.email ?? "";
    } catch {
        return "";
    }
}

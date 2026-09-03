"use client";

/**
 * Chrome around the platform portal — a different product from the console.
 *
 * ## Why this is not a section of the console
 *
 * It was, for about an hour, and that was wrong in three ways worth writing
 * down because each is easy to re-introduce.
 *
 * **The organisation header.** A console session carries `x-org-id` on every
 * request. An operator browsing tenants would be simultaneously signed into one
 * of them, and a mis-scoped query would read tenant data through a session that
 * happened to have both. Nothing here sends that header, and the shell has no
 * organisation to send.
 *
 * **The vocabulary.** "Platform › Tenants" sitting under Composer and Build
 * makes the console's own words ambiguous — is "Agents" your agents, or a
 * tenant's? Two products in one navigation is two meanings for every noun.
 *
 * **Blast radius.** A screen that ships in the same bundle as every tenant
 * screen runs in a session that can reach `operator_*`. Separating the route
 * tree is half of that; the other half is a separate origin, which arrives when
 * this is deployed at its own host and a console session's storage cannot reach
 * it at all.
 *
 * ## The gate here is a courtesy
 *
 * `is_platform_admin()` is the first statement of every operator function in
 * the database. This shell refusing a non-operator is so they see an
 * explanation rather than a screen of failed requests — it is not what makes
 * them unable to do anything.
 */

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Button } from "@/components/base/buttons/button";
import { LogOut01 } from "@/components/icons";
import { SignInScreen } from "@/components/application/auth/sign-in-screen";
import { useSession } from "@/hooks/use-session";

const NAV = [{ label: "Tenants", href: "/platform" }];

export function PlatformShell({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const { session, isReady, isOperator, signOut } = useSession();

    if (!isReady) {
        return <div className="min-h-dvh bg-primary" />;
    }

    if (!session) {
        return <SignInScreen />;
    }

    // `isOperator` starts false and becomes true when the check answers, so a
    // real operator would see the refusal for a frame. Waiting on the session's
    // own readiness is not enough — this is a second, later answer.
    if (!isOperator) {
        return (
            <main className="grid min-h-dvh place-items-center bg-primary p-6">
                <div className="flex max-w-md flex-col gap-3 border border-secondary p-6">
                    <h1 className="text-lg font-semibold text-primary">Not for this account</h1>
                    <p className="text-sm text-tertiary">
                        This is the platform portal — it manages the workspaces on this
                        installation rather than anything inside one. {session.email} is not an
                        operator.
                    </p>
                    <p className="text-sm text-tertiary">
                        If you were looking for your own workspace, it is at the console.
                    </p>
                    <div className="flex gap-2 pt-2">
                        <Button size="sm" href="/">
                            Go to the console
                        </Button>
                        <Button size="sm" color="secondary" onClick={signOut}>
                            Sign out
                        </Button>
                    </div>
                </div>
            </main>
        );
    }

    return (
        <div className="flex h-dvh min-h-0 flex-col bg-primary">
            {/* A bar, not the console's sidebar. Different chrome is the point:
                somebody should be able to tell at a glance that they are not
                inside a workspace, before they read a single label. */}
            <header className="flex shrink-0 items-center gap-6 border-b border-secondary px-6 py-3">
                <span className="text-sm font-semibold tracking-wide text-primary uppercase">
                    Sarvathra Platform
                </span>
                <nav className="flex items-center gap-1">
                    {NAV.map((item) => (
                        <Button
                            key={item.href}
                            size="sm"
                            color={pathname === item.href ? "secondary" : "link-gray"}
                            href={item.href}
                        >
                            {item.label}
                        </Button>
                    ))}
                </nav>
                <div className="ml-auto flex items-center gap-3">
                    <span className="text-sm text-tertiary">{session.email}</span>
                    <Button
                        size="sm"
                        color="tertiary"
                        iconLeading={LogOut01}
                        onClick={signOut}
                        aria-label="Sign out"
                    />
                </div>
            </header>

            <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
        </div>
    );
}

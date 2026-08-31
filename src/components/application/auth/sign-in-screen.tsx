"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input } from "@/components/base/input/input";
import { VokooLogo } from "@/components/foundations/logo/vokoo-logo";
import { useSession } from "@/hooks/use-session";
import { ApiError } from "@/utils/api-client";

/**
 * Sign-in.
 *
 * Editorial split: a warm taupe band carrying the product statement, and the
 * form on the eggshell canvas. Both halves centre their content as one group —
 * pinning the headline to the bottom and floating the visual in the middle
 * leaves a hole down the page and reads as unfinished.
 *
 * Removed from the stock template, each for a reason:
 *   - **Google sign-in** — no OAuth provider is configured in Supabase, so the
 *     button would fail on click. An absent option beats a broken one.
 *   - **"Sign up"** — accounts are provisioned by an administrator; there is no
 *     self-serve registration to link to.
 *
 * "Remember me" is real: ticking it stores the Supabase refresh token and the
 * console renews the session silently, so it survives a browser restart.
 */

/**
 * The design system's signature visual, and the ONLY sanctioned use of violet
 * (#0447ff) and ember (#ff4704) — the spec reserves both for product artwork
 * and forbids them on buttons, links, badges and borders.
 *
 * Built from layered radial gradients rather than an image: no network request
 * on the auth screen, no hard edge, and it scales without artefacts.
 */
function AudioSphere() {
    return (
        <div
            aria-hidden="true"
            className="relative size-64 rounded-full"
            style={{
                background: `
                    radial-gradient(circle at 32% 30%, color-mix(in oklab, var(--color-violet-spark) 85%, transparent) 0%, transparent 55%),
                    radial-gradient(circle at 70% 38%, color-mix(in oklab, var(--color-ember-orange) 80%, transparent) 0%, transparent 52%),
                    radial-gradient(circle at 52% 74%, color-mix(in oklab, #ff8fb1 75%, transparent) 0%, transparent 58%),
                    radial-gradient(circle at 50% 50%, #f7d9c4 0%, #efe4dc 70%, transparent 100%)
                `,
                // Softens the whole disc so it reads as light rather than a
                // filled shape with an edge.
                filter: "blur(6px)",
            }}
        />
    );
}

function ProductPanel() {
    return (
        <div className="relative hidden flex-col justify-between bg-secondary p-16 lg:flex">
            <div className="flex flex-1 items-center justify-center">
                <AudioSphere />
            </div>

            <div>
                {/* Weight 300 with negative tracking is the system's display
                    voice; bolding it destroys the restraint that defines it. */}
                <h2 className="max-w-lg text-display-sm font-light text-primary">
                    Voice agents that never leave your infrastructure.
                </h2>
                <p className="mt-5 max-w-md text-md text-tertiary">
                    Speech recognition, the language model and speech synthesis all run on hardware you control. Caller audio is
                    never sent to a third-party API.
                </p>

                <dl className="mt-10 flex flex-wrap gap-x-12 gap-y-4 border-t border-secondary pt-6">
                    {[
                        ["Telephony", "KooKoo / Ozonetel"],
                        ["Inference", "Self-hosted"],
                        ["Latency", "Sub-second"],
                    ].map(([label, value]) => (
                        <div key={label}>
                            <dt className="text-xs tracking-wide text-quaternary uppercase">{label}</dt>
                            <dd className="mt-1 text-sm text-secondary">{value}</dd>
                        </div>
                    ))}
                </dl>
            </div>
        </div>
    );
}

export function SignInScreen() {
    const { signIn } = useSession();

    const [isBusy, setIsBusy] = useState(false);
    const [remember, setRemember] = useState(true);
    const [error, setError] = useState<string | null>(null);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        const form = new FormData(event.currentTarget);
        const email = String(form.get("email") ?? "");
        const password = String(form.get("password") ?? "");

        setIsBusy(true);
        setError(null);

        try {
            await signIn(email, password, remember);
        } catch (cause) {
            // Separate "cannot reach the API" from "wrong password". On a
            // tailnet-only deployment the first is common, and a generic
            // failure message sends you debugging the wrong thing.
            setError(
                cause instanceof ApiError && cause.code === "network_error"
                    ? `${cause.message}. Check the control plane is running and the tailnet is connected.`
                    : "That email and password did not match.",
            );
        } finally {
            setIsBusy(false);
        }
    }

    return (
        <section className="grid min-h-dvh grid-cols-1 bg-primary lg:grid-cols-2">
            {/* Product statement left, form right. The panel is hidden below
                `lg`, so on mobile the form is still what renders first. */}
            <ProductPanel />

            <div className="flex flex-col">
                <div className="flex flex-1 items-center justify-center px-6 py-16">
                    <div className="w-full max-w-sm">
                        <VokooLogo />

                        <h1 className="mt-10 text-display-xs font-light text-primary">Welcome back</h1>
                        <p className="mt-2 text-md text-tertiary">Sign in to your control plane.</p>

                        <form onSubmit={submit} className="mt-10 flex flex-col gap-5">
                            <Input
                                isRequired
                                hideRequiredIndicator
                                label="Email"
                                type="email"
                                name="email"
                                size="md"
                                placeholder="you@example.com"
                                autoComplete="email"
                            />
                            <Input
                                isRequired
                                hideRequiredIndicator
                                label="Password"
                                type="password"
                                name="password"
                                size="md"
                                placeholder="••••••••••••"
                                autoComplete="current-password"
                            />

                            <Checkbox label="Remember me" isSelected={remember} onChange={setRemember} />

                            {error && (
                                <p
                                    role="alert"
                                    className="rounded-md bg-error-primary px-3 py-2 text-sm text-error-primary ring-1 ring-error_subtle"
                                >
                                    {error}
                                </p>
                            )}

                            <Button type="submit" size="lg" className="mt-1" isLoading={isBusy} showTextWhileLoading>
                                Sign in
                            </Button>
                        </form>

                        <p className="mt-8 text-sm text-quaternary">Accounts are provisioned by your administrator.</p>
                    </div>
                </div>

                <footer className="px-6 pb-8 lg:px-16">
                    <p className="text-sm text-quaternary">VoKoo · voice AI control plane</p>
                </footer>
            </div>
        </section>
    );
}

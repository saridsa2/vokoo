"use client";

import Image from "next/image";
import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input } from "@/components/base/input/input";
import { VokooLogo } from "@/components/foundations/logo/vokoo-logo";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/utils/api-client";

/**
 * Sign-in.
 *
 * A split: the mark on a quiet ground, and the form. Both halves centre their
 * content, so neither reads as unfinished.
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
 * The left half: the mark, at the size a mark deserves.
 *
 * It was a violet-and-ember gradient sphere, built from a spec that reserved
 * those two colours for "product artwork". That spec belongs to a different
 * brand — Sarvathra's mark is the teal-to-blue fingerprint, and the sphere was
 * standing in for it while the real thing sat 25 pixels tall in the opposite
 * corner. The largest element on the page belonged to no brand at all.
 *
 * Underneath it, one line. What was here before was a positioning statement, a
 * paragraph of it, and a specification table — telephony, inference, latency.
 * All three are for somebody deciding whether to buy. Everybody who reaches
 * this page has already decided; they are trying to get to work.
 */
function ProductPanel() {
    return (
        <div className="relative hidden flex-col items-center justify-center gap-10 bg-secondary p-16 lg:flex">
            <div className="flex flex-col items-center gap-5">
                <Image
                    src="/sarvathra-mark@2x.png"
                    alt=""
                    aria-hidden="true"
                    width={192}
                    height={247}
                    priority
                    // Height-driven, as the logo component is: the mark is
                    // taller than it is wide, so constraining the height is
                    // what keeps it from being cropped by its own bounding box.
                    //
                    // **96px, not 192, and that is an asset limit rather than a
                    // design choice.** `sarvathra-mark@2x.png` is 149x192 — cut
                    // as the 2x of a 96px logo, not for a hero. Drawn at 192 it
                    // is upscaled twice over on a Retina screen and visibly
                    // soft.
                    //
                    // The logo component's own note says the source is
                    // 1824x2350, but that file is in neither the repo nor the
                    // server. Drop a 384px-tall export at
                    // `public/sarvathra-hero.png` and this goes back to `h-48`.
                    className="h-24 w-auto"
                />
                {/* The wordmark belongs with the mark. It repeats the one in
                    the form column on purpose — that one is what a phone sees,
                    since this pane is hidden below `lg`, and the two never
                    appear together on a screen small enough for it to read as
                    duplication. */}
                <span className="text-display-sm font-bold tracking-[0.16em] text-primary">
                    SARVATHRA
                </span>
            </div>
            {/* **Written for two buyers at once, which is the whole trick.**
                A hospital administrator reads "falls through" as revenue — the
                slot that went empty, the refill that went elsewhere. A doctor
                reads it as continuity of care — the follow-up that never
                happened. "Revenue recovery" only speaks to the first, and to
                the second it reads as crass.

                It also covers both directions without naming either: the call
                nobody answered and the follow-up nobody made are the same
                failure to the patient.

                The line beneath says what it means and puts the journey in it,
                which is the frame this market is sold on. */}
            <div className="flex max-w-sm flex-col items-center gap-3 text-center">
                <p className="text-display-xs font-light text-primary">No patient falls through.</p>
                <p className="text-md text-tertiary">
                    Reach every patient, before and after they call.
                </p>
            </div>
        </div>
    );
}


/**
 * What actually went wrong, said in the reader's terms.
 *
 * Deliberately not the shared `readError` used by notifications: this screen is
 * the one place where "your session expired" is meaningless — nobody has a
 * session yet — and where a credential failure needs its own wording and a
 * pointer at the link that does not need a password.
 */
function readSignInError(cause: unknown): string {
    if (!(cause instanceof ApiError)) {
        return "Something went wrong signing in. Try again.";
    }
    if (cause.code === "network_error") {
        return `${cause.message}. Check the control plane is running.`;
    }
    const said = cause.message.toLowerCase();
    if (said.includes("invalid_credentials") || said.includes("invalid login")) {
        return "That email and password did not match. If you have never set a password, use the sign-in link below.";
    }
    if (said.includes("email_not_confirmed")) {
        return "That address has not been confirmed yet. Use the sign-in link below.";
    }
    if (said.includes("over_request_rate_limit") || cause.status === 429) {
        return "Too many attempts. Wait a minute and try again.";
    }
    // Anything else is the server having a problem, not the reader having the
    // wrong password — and saying so is what stops them retyping it.
    return `Sign-in is failing for a reason on our side: ${cause.message}`;
}

/**
 * Which step the form is on.
 *
 * `identify` asks only for the address. What comes back decides the rest, so
 * nobody is shown a password field for an account that has never had one — the
 * situation every invited member is in.
 */
type Step = "identify" | "password" | "link";

export function SignInScreen() {
    const { signIn } = useSession();

    const [step, setStep] = useState<Step>("identify");
    const [isBusy, setIsBusy] = useState(false);
    const [remember, setRemember] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [linkSent, setLinkSent] = useState(false);

    /**
     * Ask which ways this address can sign in, then show that.
     *
     * The answer is deliberately incomplete: a link-only account and an address
     * with no account come back identical, so an unknown address lands on the
     * link step and is told a link is on its way whether or not one was sent.
     * That is the same non-disclosure the send route already makes, and it is
     * why this step can exist at all.
     */
    async function identify(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const address = email.trim();
        if (!address) return;

        setIsBusy(true);
        setError(null);
        try {
            const { data } = await api.authMethods(address);
            setStep(data.password ? "password" : "link");
            // Nothing is sent yet. Somebody who mistyped their address should
            // get to correct it before an email goes anywhere.
        } catch (cause) {
            setError(readSignInError(cause));
        } finally {
            setIsBusy(false);
        }
    }

    async function mailLink() {
        setIsBusy(true);
        setError(null);
        try {
            await api.signInLink(email.trim());
            setLinkSent(true);
        } catch {
            setError("Could not reach the server to send a link.");
        } finally {
            setIsBusy(false);
        }
    }

    async function submitPassword(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setIsBusy(true);
        setError(null);
        try {
            await signIn(email.trim(), password, remember);
        } catch (cause) {
            // **Only say "did not match" when that is what happened.**
            //
            // This used to report every failure that way — a 500, a rate
            // limit, a GoTrue outage — so somebody would sit retyping a
            // correct password against a server refusing for another reason.
            setError(readSignInError(cause));
        } finally {
            setIsBusy(false);
        }
    }

    /** Back to the address, clearing whatever the last step accumulated. */
    function changeEmail() {
        setStep("identify");
        setPassword("");
        setError(null);
        setLinkSent(false);
    }

    return (
        <section className="grid min-h-dvh grid-cols-1 bg-primary lg:grid-cols-2">
            {/* Brand left, form right. The panel is hidden below `lg`, so on a
                phone the form is what renders first. */}
            <ProductPanel />

            <div className="flex flex-col">
                <div className="flex flex-1 items-center justify-center px-6 py-16">
                    <div className="w-full max-w-sm">
                        <VokooLogo />

                        <h1 className="mt-10 text-display-xs font-light text-primary">
                            {step === "identify" ? "Sign in" : linkSent ? "Check your email" : "Sign in"}
                        </h1>

                        {step !== "identify" && (
                            // The address is settled, so it becomes context
                            // rather than a field — and stays changeable,
                            // because a typo is the likeliest reason to be
                            // looking at the wrong step.
                            <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-sm text-tertiary">
                                <span className="text-secondary">{email.trim()}</span>
                                <Button size="sm" color="link-color" onClick={changeEmail}>
                                    Change
                                </Button>
                            </p>
                        )}

                        {step === "identify" && (
                            <form onSubmit={identify} className="mt-8 flex flex-col gap-5">
                                <Input
                                    isRequired
                                    hideRequiredIndicator
                                    label="Email"
                                    type="email"
                                    name="email"
                                    size="md"
                                    placeholder="you@example.com"
                                    autoComplete="email"
                                    autoFocus
                                    value={email}
                                    onChange={setEmail}
                                />
                                {error && <FormError>{error}</FormError>}
                                <Button type="submit" size="lg" isLoading={isBusy} showTextWhileLoading>
                                    Continue
                                </Button>
                            </form>
                        )}

                        {step === "password" && (
                            <form onSubmit={submitPassword} className="mt-8 flex flex-col gap-5">
                                <Input
                                    isRequired
                                    hideRequiredIndicator
                                    label="Password"
                                    type="password"
                                    name="password"
                                    size="md"
                                    placeholder="••••••••••••"
                                    autoComplete="current-password"
                                    autoFocus
                                    value={password}
                                    onChange={setPassword}
                                />
                                <Checkbox label="Remember me" isSelected={remember} onChange={setRemember} />
                                {error && <FormError>{error}</FormError>}
                                <Button type="submit" size="lg" isLoading={isBusy} showTextWhileLoading>
                                    Sign in
                                </Button>

                                <div className="border-t border-secondary pt-5">
                                    <Button
                                        size="sm"
                                        color="link-color"
                                        isDisabled={isBusy}
                                        onClick={mailLink}
                                    >
                                        Email me a link instead
                                    </Button>
                                    {linkSent && (
                                        <p role="status" className="mt-2 text-sm text-secondary">
                                            Sent. It works once and expires in an hour.
                                        </p>
                                    )}
                                </div>
                            </form>
                        )}

                        {step === "link" && (
                            <div className="mt-8 flex flex-col gap-5">
                                {linkSent ? (
                                    <p role="status" className="text-md text-secondary">
                                        If that address has an account here, a link is on its way. It
                                        signs you in without a password, works once, and expires in
                                        an hour.
                                    </p>
                                ) : (
                                    <>
                                        {/* No password field here, because there
                                            is no password — every account made
                                            by invitation is reachable only by
                                            link until somebody sets one. */}
                                        <p className="text-md text-tertiary">
                                            We will email you a link that signs you in. No password
                                            needed.
                                        </p>
                                        {error && <FormError>{error}</FormError>}
                                        <Button
                                            size="lg"
                                            isLoading={isBusy}
                                            showTextWhileLoading
                                            onClick={mailLink}
                                        >
                                            Email me a sign-in link
                                        </Button>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
}

/** The one place a sign-in failure is rendered, so all three steps match. */
const FormError = ({ children }: { children: React.ReactNode }) => (
    <p
        role="alert"
        className="rounded-md bg-error-primary px-3 py-2 text-sm text-error-primary ring-1 ring-error_subtle"
    >
        {children}
    </p>
);

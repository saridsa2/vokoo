"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input } from "@/components/base/input/input";
import { Auth2 } from "@/components/blocks/auth-2";
import { useSession } from "@/hooks/use-session";
import { ApiError, api } from "@/utils/api-client";

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

/* The left half is now the Auth 2 block's panel — see
   `@/components/blocks/auth-2`. The hand-rolled one that used to live here is
   gone rather than kept beside it: two split layouts on one screen is one of
   them silently going stale.

   What survived the move is the decision this comment recorded. The panel had
   been a violet-and-ember gradient sphere from a spec belonging to a different
   brand, while the real mark sat 25 pixels tall in the opposite corner; the
   mark is the artwork now, at the size a mark deserves. And the line beneath it
   is still absent, for the reason the block repeats: the last one written for
   this panel was invented and then handed back to its owner as his own words.

   The asset note is worth carrying: `sarvathra-mark@2x.png` is 149x192, cut as
   the 2x of a 96px logo rather than for a hero, so it goes soft above about
   that height on a Retina screen. Drop a 384px-tall export at
   `public/sarvathra-hero.png` and the block's panel can grow. */

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
        // The block owns the page and the dialog; everything inside is this
        // screen's, because the block's own form was a demo that logged to the
        // console.
        //
        // `VokooLogo` used to open this column and is gone: the block now draws
        // the mark itself, animated, directly above — printing it twice in one
        // card is the same duplication the node view had when it named its type
        // four times.
        <Auth2>
            <h1 className="text-display-xs font-light text-primary">{step === "identify" ? "Sign in" : linkSent ? "Check your email" : "Sign in"}</h1>

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
                        <Button size="sm" color="link-color" isDisabled={isBusy} onClick={mailLink}>
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
                            If that address has an account here, a link is on its way. It signs you in without a password, works once, and expires in an hour.
                        </p>
                    ) : (
                        <>
                            {/* No password field here, because there
                                            is no password — every account made
                                            by invitation is reachable only by
                                            link until somebody sets one. */}
                            <p className="text-md text-tertiary">We will email you a link that signs you in. No password needed.</p>
                            {error && <FormError>{error}</FormError>}
                            <Button size="lg" isLoading={isBusy} showTextWhileLoading onClick={mailLink}>
                                Email me a sign-in link
                            </Button>
                        </>
                    )}
                </div>
            )}
        </Auth2>
    );
}

/** The one place a sign-in failure is rendered, so all three steps match. */
const FormError = ({ children }: { children: React.ReactNode }) => (
    <p role="alert" className="rounded-md bg-error-primary px-3 py-2 text-sm text-error-primary ring-1 ring-error_subtle">
        {children}
    </p>
);

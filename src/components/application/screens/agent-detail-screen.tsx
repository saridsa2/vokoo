"use client";

/**
 * One agent, and the three things you can do to them.
 *
 * Rename, suspend, rotate. Everything else about an agent is either derived
 * (the endpoint, from the org's slug and the extension) or not ours to change
 * here (the auth user they are tied to, which is an invitation rather than a
 * field).
 *
 * ## The extension is not editable
 *
 * `set_agent_endpoint()` re-derives the endpoint on update, so renumbering an
 * agent silently renames what Asterisk knows them as — their softphone stops
 * registering under a username that no longer exists, and the symptom is a
 * person who is on duty and never rings. Offering it as a text box would put
 * that one keystroke away, so it is not offered. Somebody who genuinely needs a
 * different number gets a new agent.
 */

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Input } from "@/components/base/input/input";
import { SIP_SERVER, SipCredentials } from "@/components/application/screens/sip-credentials";
import { ArrowLeft } from "@/components/icons";
import { api } from "@/utils/api-client";
import { generateSipPassword } from "@/utils/sip-password";
import { useSession } from "@/hooks/use-session";

type AgentExtension = {
    id: string;
    display_name: string;
    extension: string;
    endpoint: string;
    status: "active" | "suspended";
    user_id: string | null;
    created_at: string;
};

export const AgentDetailScreen = ({ agentId }: { agentId: string }) => {
    const { context, isReady } = useSession();

    const [agent, setAgent] = useState<AgentExtension | null>(null);
    const [name, setName] = useState("");
    const [busy, setBusy] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    /** Set for as long as a freshly rotated password is on screen. */
    const [rotated, setRotated] = useState<string | null>(null);

    useEffect(() => {
        if (!isReady || !context) return;
        let live = true;
        (async () => {
            try {
                const { data } = await api.get<AgentExtension>("agent-extensions", agentId, context);
                if (!live || !data) return;
                setAgent(data);
                setName(data.display_name);
            } catch (problem) {
                if (live) setError((problem as Error).message);
            }
        })();
        return () => {
            live = false;
        };
    }, [agentId, context, isReady]);

    const patch = useCallback(
        async (what: string, body: Partial<AgentExtension> & { sip_password?: string }, said: string) => {
            if (!context) return false;
            setBusy(what);
            setError(null);
            setNote(null);
            try {
                await api.update("agent-extensions", agentId, body, context);
                setAgent((current) => (current ? { ...current, ...body } : current));
                setNote(said);
                return true;
            } catch (problem) {
                setError((problem as Error).message);
                return false;
            } finally {
                setBusy(null);
            }
        },
        [agentId, context],
    );

    const rotate = useCallback(async () => {
        const password = generateSipPassword();
        const ok = await patch(
            "rotate",
            { sip_password: password },
            // Said rather than implied: the old password stops working the
            // moment this is saved, and an agent mid-shift is registered on it.
            "New password saved. Their softphone will be rejected on its next registration until they enter it.",
        );
        if (ok) setRotated(password);
    }, [patch]);

    const suspended = agent?.status === "suspended";

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6 lg:p-8">
            <header className="flex flex-col gap-3">
                <Button href="/team" color="link-gray" size="sm" iconLeading={ArrowLeft} className="self-start">
                    Team
                </Button>
                <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-display-xs font-semibold text-primary">{agent?.display_name ?? "…"}</h1>
                    <span className="font-mono text-lg text-tertiary">{agent?.extension ?? ""}</span>
                    {agent ? (
                        <Badge color={suspended ? "gray" : "success"} size="sm">
                            {agent.status}
                        </Badge>
                    ) : null}
                </div>
            </header>

            {note ? <p className="text-sm text-brand-secondary">{note}</p> : null}
            {error ? <p className="text-sm text-error-primary">{error}</p> : null}

            {agent ? (
                <div className="flex max-w-2xl flex-col gap-8">
                    <section className="flex flex-col gap-3">
                        <h2 className="text-lg font-semibold text-primary">Name</h2>
                        <p className="text-sm text-tertiary">
                            What a caller sees when this agent is brought onto the call.
                        </p>
                        <div className="flex items-end gap-3">
                            <Input aria-label="Name" value={name} onChange={setName} className="flex-1" />
                            <Button
                                size="sm"
                                isDisabled={!name.trim() || name === agent.display_name}
                                isLoading={busy === "name"}
                                onClick={() =>
                                    void patch("name", { display_name: name.trim() }, "Saved.")
                                }
                            >
                                Save
                            </Button>
                        </div>
                    </section>

                    <section className="flex flex-col gap-3">
                        <h2 className="text-lg font-semibold text-primary">How they sign in</h2>
                        <p className="text-sm text-tertiary">
                            The password is not stored anywhere this screen can read — SIP authentication
                            needs it in plain text, so it is a credential rather than a field. If it has
                            been lost, the answer is a new one.
                        </p>
                        <dl className="divide-y divide-secondary border-y border-secondary">
                            <Row label="Server" value={SIP_SERVER} />
                            <Row label="Username" value={agent.endpoint} />
                            <Row label="Extension" value={agent.extension} />
                        </dl>
                        <Button
                            size="sm"
                            color="secondary"
                            className="self-start"
                            isLoading={busy === "rotate"}
                            onClick={() => void rotate()}
                        >
                            Rotate password
                        </Button>
                    </section>

                    <section className="flex flex-col gap-3">
                        <h2 className="text-lg font-semibold text-primary">
                            {suspended ? "Reinstate" : "Suspend"}
                        </h2>
                        <p className="text-sm text-tertiary">
                            {suspended
                                ? "They can register again and take calls. The extension and everything they handled are unchanged — suspending never removed them."
                                : "Keeps the row, the history and the extension, and stops them being an endpoint: the bridge serves only active agents to Asterisk, so a suspended agent cannot register. A session already open survives until its registration expires, which is within five minutes."}
                        </p>
                        <Button
                            size="sm"
                            color={suspended ? "secondary" : "secondary-destructive"}
                            className="self-start"
                            isLoading={busy === "status"}
                            onClick={() =>
                                void patch(
                                    "status",
                                    { status: suspended ? "active" : "suspended" },
                                    suspended
                                        ? "Reinstated. They can go on duty again."
                                        : "Suspended. They will not be offered another call.",
                                )
                            }
                        >
                            {suspended ? "Reinstate agent" : "Suspend agent"}
                        </Button>
                    </section>
                </div>
            ) : null}

            {/* The rotated password, on screen for exactly as long as this is
                open. Closing it is the only chance to have copied it. */}
            <ModalOverlay isOpen={Boolean(rotated)} onOpenChange={(open) => (open ? undefined : setRotated(null))}>
                <Modal className="max-w-lg">
                    <Dialog>
                        <div className="flex w-full flex-col rounded-xl bg-primary p-6 shadow-xl ring-1 ring-secondary">
                            <h2 className="text-lg font-semibold text-primary">New password</h2>
                            <p className="mt-1 text-sm text-tertiary">
                                Give these to {agent?.display_name ?? "the agent"}. This is the only time
                                the password is shown.
                            </p>
                            <SipCredentials endpoint={agent?.endpoint ?? ""} password={rotated ?? ""} />
                            <div className="mt-6 flex justify-end">
                                <Button size="sm" onClick={() => setRotated(null)}>
                                    Done
                                </Button>
                            </div>
                        </div>
                    </Dialog>
                </Modal>
            </ModalOverlay>
        </div>
    );
};

const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
        <dt className="text-sm text-tertiary">{label}</dt>
        <dd className="font-mono text-sm break-all text-primary select-all">{value}</dd>
    </div>
);

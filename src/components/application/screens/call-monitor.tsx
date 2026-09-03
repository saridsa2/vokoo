"use client";

/**
 * Listen, whisper or barge into a live call.
 *
 * Three buttons over one mechanism. A snoop channel is a real channel carrying
 * a copy of another one's audio, so a supervisor joins it exactly as the AI's
 * leg or a person's leg joins the call — see `stasis::monitor`.
 *
 * ## Whisper is a different act depending on who is answering
 *
 * To a person it is audio into their leg only: their phone rings, they answer,
 * and the caller hears nothing of it.
 *
 * To an AI it cannot be audio at all. Anything pushed at a model's input is
 * transcribed as though the *caller* said it, and the model would answer the
 * supervisor out loud, to the caller — the opposite of a whisper. So it is text
 * into the live session, which is why this asks for a sentence rather than
 * ringing anybody. That is not a workaround; it is the same intent expressed in
 * the only channel a model has.
 *
 * ## The phone rings first
 *
 * Listening and barging call the supervisor's own extension, so the desktop app
 * has to be open and on duty. Said on the button rather than discovered when
 * nothing happens.
 */

import { useState } from "react";

import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Input } from "@/components/base/input/input";
import { api } from "@/utils/api-client";
import { useSession } from "@/hooks/use-session";

type Mode = "listen" | "whisper" | "barge";

type Result = { ok?: boolean; error?: string; delivered?: string; channel?: string };

export const CallMonitor = ({
    callId,
    /** Whether a person is already on the call, which is what whisper turns on. */
    hasHuman,
}: {
    callId: string;
    hasHuman: boolean;
}) => {
    const { context } = useSession();
    const [busy, setBusy] = useState<Mode | null>(null);
    const [said, setSaid] = useState<string | null>(null);
    const [asking, setAsking] = useState(false);
    const [note, setNote] = useState("");

    const run = async (mode: Mode, text?: string) => {
        if (!context) return;
        setBusy(mode);
        setSaid(null);
        try {
            const { data } = await api.monitorCall<Result>(callId, mode, text, context);
            // The bridge answers 200 with `ok: false` for the things that are
            // not faults — nobody registered, no session to steer. A red error
            // for "your softphone is closed" would be reporting a mistake.
            setSaid(
                data?.ok
                    ? MESSAGES[mode]
                    : (data?.error ?? "That did not go through."),
            );
        } catch (problem) {
            setSaid(problem instanceof Error ? problem.message : "That did not go through.");
        } finally {
            setBusy(null);
            setAsking(false);
            setNote("");
        }
    };

    return (
        <>
            <div className="flex items-center justify-end gap-1">
                <Action
                    label="Listen"
                    hint="Hear the call on your own extension. Nobody on the call hears you."
                    busy={busy === "listen"}
                    onClick={() => void run("listen")}
                />
                <Action
                    label="Whisper"
                    hint={
                        hasHuman
                            ? "Speak to the agent only. The caller does not hear you."
                            : "Steer the AI with a note. Nothing is spoken, and the caller hears nothing."
                    }
                    busy={busy === "whisper"}
                    // To a person it rings; to a model it needs the words first.
                    onClick={() => (hasHuman ? void run("whisper") : setAsking(true))}
                />
                <Action
                    label="Barge"
                    hint="Join the call. The caller and the agent both hear you."
                    busy={busy === "barge"}
                    onClick={() => void run("barge")}
                />
            </div>
            {said ? <p className="mt-1 text-right text-xs text-tertiary">{said}</p> : null}

            <ModalOverlay isOpen={asking} onOpenChange={(open) => !open && setAsking(false)}>
                <Modal className="max-w-lg">
                    <Dialog>
                        <div className="flex w-full flex-col rounded-xl bg-primary p-6 shadow-xl ring-1 ring-secondary">
                            <h2 className="text-lg font-semibold text-primary">Whisper to the agent</h2>
                            <p className="mt-1 text-sm text-tertiary">
                                An AI is answering this call, so a whisper is a note rather than a
                                voice — audio would reach it as though the caller had spoken, and it
                                would answer you out loud. This goes into the model directly. The
                                caller hears nothing, and it steers the next thing the agent says.
                            </p>
                            <div className="mt-5">
                                <Input
                                    label="What should it know?"
                                    placeholder="Returning patient — offer Dr Iyer's Thursday slot."
                                    value={note}
                                    onChange={setNote}
                                    autoFocus
                                />
                            </div>
                            <div className="mt-6 flex justify-end gap-3">
                                <Button size="sm" color="secondary" onClick={() => setAsking(false)}>
                                    Cancel
                                </Button>
                                <Button
                                    size="sm"
                                    isDisabled={!note.trim()}
                                    isLoading={busy === "whisper"}
                                    onClick={() => void run("whisper", note.trim())}
                                >
                                    Send
                                </Button>
                            </div>
                        </div>
                    </Dialog>
                </Modal>
            </ModalOverlay>
        </>
    );
};

const MESSAGES: Record<Mode, string> = {
    listen: "Your extension is ringing.",
    whisper: "Sent.",
    barge: "Your extension is ringing — you will be on the call.",
};

const Action = ({
    label,
    hint,
    busy,
    onClick,
}: {
    label: string;
    hint: string;
    busy: boolean;
    onClick: () => void;
}) => (
    <Button
        size="sm"
        color="link-gray"
        isLoading={busy}
        onClick={onClick}
        // The whole explanation, not a shortened one. These three do very
        // different things to somebody's live conversation, and "Barge" alone
        // does not say that the caller will hear you — so the hint is the
        // accessible name and the native tooltip, rather than only a label.
        aria-label={`${label} — ${hint}`}
        title={hint}
    >
        {label}
    </Button>
);

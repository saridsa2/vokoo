"use client";

/**
 * One place errors go.
 *
 * There were 51 of them, hand-rendered across 23 screens in 8 different class
 * combinations — `text-sm text-error-primary`, `mt-4 text-sm`, `text-md`,
 * `font-semibold`. Every screen invented its own, so a failure looked different
 * depending on where you were standing, and several rendered below the fold
 * where nobody saw them.
 *
 * ## Why this is a separate file from `notifications.tsx`
 *
 * That one is Untitled UI's, added with `npx untitledui add notifications`, and
 * it should stay theirs so `untitledui upgrade` can replace it. This is the
 * pattern `vokoo-brand.css` already follows against their `theme.css`: prefer a
 * file of our own that wins over editing one somebody else ships.
 *
 * It was learned the hard way here — the queue and hook were originally written
 * *into* `notifications.tsx`, and `add notifications` overwrote the lot. The
 * file was untracked, so there was nothing to recover from.
 *
 * ## What belongs here, and what does not
 *
 * A notification is for **something you did that failed or succeeded** — a save,
 * a send, a delete. It is not for form validation: "an escalation number must
 * be 7 to 15 digits" belongs against the field, where the reader can see what to
 * change while they change it. A message that names a bad field and then
 * disappears is worse than none.
 *
 * Nor is it for a failed *load*. A list that could not be fetched must say so
 * where the list would have been — a toast that fades leaves an empty table and
 * no explanation of why it is empty.
 *
 * ## Errors are translated, not echoed
 *
 * `notify.failure` reads the `ApiError` rather than printing whatever the server
 * said. A 401 becomes "Your session has expired" on every screen at once,
 * instead of 23 screens each showing a raw message that means nothing to the
 * person reading it.
 */

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";

import { IconNotification } from "@/components/application/notifications/notifications";
import { ApiError } from "@/utils/api-client";

type Tone = "error" | "success" | "info";

type Note = {
    id: number;
    tone: Tone;
    title: string;
    description: string;
};

type NotifyApi = {
    /** Something worked. Dismisses itself. */
    success: (title: string, description?: string) => void;
    /** Something worth knowing. Dismisses itself. */
    info: (title: string, description?: string) => void;
    /**
     * Something failed.
     *
     * Takes the caught value rather than a string, so an `ApiError` is
     * translated once here instead of at every call site. `what` names the
     * action in the reader's terms — "Could not save the settings" — because a
     * server message rarely says which button was pressed.
     */
    failure: (what: string, cause: unknown) => void;
    dismiss: (id: number) => void;
};

const NotifyContext = createContext<NotifyApi | null>(null);

/** How long a note stays. A failure stays longer, because it is read twice. */
const LINGER: Record<Tone, number> = {
    success: 4_000,
    info: 5_000,
    error: 9_000,
};

/** Untitled UI's own colour names for the three tones we raise. */
const COLOR: Record<Tone, "success" | "error" | "gray"> = {
    success: "success",
    error: "error",
    info: "gray",
};

/**
 * What to actually show a person, from whatever was thrown.
 *
 * Exported because a screen that shows an error inline should say the same
 * words — the wording should not depend on which surface it lands on.
 */
export function readError(cause: unknown): { title?: string; detail: string } {
    if (cause instanceof ApiError) {
        if (cause.isAuthError) {
            return { title: "Your session has expired", detail: "Sign in again to continue." };
        }
        if (cause.code === "network_error") {
            return {
                title: "Cannot reach the server",
                detail: "Check your connection, then try again.",
            };
        }
        // Anything else is the server explaining itself, and here it usually
        // does so in a sentence — the database's own refusals are written for
        // a person to read.
        return { detail: cause.message };
    }
    if (cause instanceof Error) return { detail: cause.message };
    return { detail: String(cause) };
}

export function NotificationProvider({ children }: { children: ReactNode }) {
    const [notes, setNotes] = useState<Note[]>([]);
    // A ref, not state: an id must not depend on a render having happened, or
    // two notes raised in the same tick collide and one is dropped.
    const nextId = useRef(1);
    const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

    const dismiss = useCallback((id: number) => {
        setNotes((current) => current.filter((note) => note.id !== id));
        const timer = timers.current.get(id);
        if (timer) {
            clearTimeout(timer);
            timers.current.delete(id);
        }
    }, []);

    const raise = useCallback(
        (tone: Tone, title: string, description: string) => {
            const id = nextId.current++;
            setNotes((current) =>
                // Three at once is already more than anybody reads. The oldest
                // goes, because the newest is the one they just caused.
                [...current, { id, tone, title, description }].slice(-3),
            );
            timers.current.set(id, setTimeout(() => dismiss(id), LINGER[tone]));
        },
        [dismiss],
    );

    // Every pending timer, cleared. Without this a note raised just before a
    // navigation fires its dismiss into an unmounted tree.
    useEffect(() => {
        const pending = timers.current;
        return () => {
            pending.forEach(clearTimeout);
            pending.clear();
        };
    }, []);

    const api = useMemo<NotifyApi>(
        () => ({
            success: (title, description = "") => raise("success", title, description),
            info: (title, description = "") => raise("info", title, description),
            failure: (what, cause) => {
                const { title, detail } = readError(cause);
                // The named action wins the headline: "Could not save the
                // settings" tells the reader which thing failed, which the
                // server's own message almost never does.
                raise("error", title ?? what, title ? `${what}. ${detail}` : detail);
            },
            dismiss,
        }),
        [raise, dismiss],
    );

    return (
        <NotifyContext.Provider value={api}>
            {children}

            {/* Bottom right rather than top: the top of every screen here is a
                header naming the thing you are working on, and covering it to
                say a save failed hides the context needed to fix it.

                `pointer-events-none` on the region and back on for each note,
                so an empty region never swallows a click on what is under it.

                `aria-live="polite"` announces additions without interrupting;
                a failure additionally carries `role="alert"` below, which is
                the one case that should cut in. */}
            <div
                style={{ "--width": "24rem" } as React.CSSProperties}
                className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-end gap-3 p-4 sm:p-6"
                aria-live="polite"
                aria-relevant="additions"
            >
                {notes.map((note) => (
                    <div
                        key={note.id}
                        role={note.tone === "error" ? "alert" : "status"}
                        className="pointer-events-auto w-full max-w-sm"
                    >
                        <IconNotification
                            title={note.title}
                            description={note.description}
                            color={COLOR[note.tone]}
                            // The card already carries a close button in its
                            // corner; the text one below it would be a second
                            // control doing the same thing.
                            hideDismissLabel
                            onClose={() => dismiss(note.id)}
                        />
                    </div>
                ))}
            </div>
        </NotifyContext.Provider>
    );
}

/**
 * The hook every screen uses instead of its own error paragraph.
 *
 * Throws outside the provider rather than returning a no-op: a silently
 * discarded error message is the failure this whole file exists to end.
 */
export function useNotify(): NotifyApi {
    const api = useContext(NotifyContext);
    if (!api) {
        throw new Error("useNotify must be used inside <NotificationProvider>");
    }
    return api;
}

"use client";

/**
 * The people in this workspace.
 *
 * **One population, not two.** There used to be a Members screen listing who
 * could sign in and a Team screen listing who had an extension, with nothing
 * joining them — so a person appeared twice, or once, or as a uuid prefix, and
 * neither list could say whether the other knew about them.
 *
 * There is one list of people. What they may do in the console is their role;
 * whether they answer the phone is whether they have an extension. Both are
 * columns on the same row, which is also what makes supervising a call work:
 * it rings *your* extension, found through your membership.
 *
 * ## Two states that look alike and are not
 *
 * **Role** is what the console will let them do. **Duty** is whether their
 * softphone is registered with Asterisk right now — held in Asterisk's memory,
 * never in the database, and arriving here on the same stream the dashboard
 * uses. A person can be an `admin` who is off duty, or an `agent` on a call.
 *
 * ## The service account is named as one
 *
 * API keys authenticate as a real auth user, so that a key-authenticated
 * request reaches RLS as a member rather than bypassing it with the service
 * role. That is the right design and it puts a row in this list that nobody
 * works with. `org_people` flags it; the screen says so rather than listing a
 * machine as a colleague.
 */

import { useEffect, useState } from "react";

import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Input } from "@/components/base/input/input";
import { SipCredentials } from "@/components/application/screens/sip-credentials";
import { api } from "@/utils/api-client";
import { generateSipPassword } from "@/utils/sip-password";
import { useEventStream } from "@/hooks/use-event-stream";
import { useSession } from "@/hooks/use-session";

type Person = {
    membership_id: string;
    user_id: string;
    email: string | null;
    display_name: string | null;
    role: string;
    joined_at: string;
    extension: string | null;
    endpoint: string | null;
    /** The `agent_extensions` row, so the detail screen can be reached. */
    extension_id: string | null;
    agent_status: string | null;
    is_service: boolean;
};

type Orphan = {
    id: string;
    extension: string;
    display_name: string | null;
    user_id: string | null;
};

type Duty = { agents: Array<{ endpoint: string; state: "online" | "on_call" | "offline" }> };

const DUTY: Record<string, string> = {
    online: "on duty",
    on_call: "on a call",
    offline: "off duty",
};

export const TeamScreen = () => {
    const { context, isReady } = useSession();
    const [people, setPeople] = useState<Person[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [giving, setGiving] = useState<Person | null>(null);
    /**
     * Extensions belonging to nobody.
     *
     * A person-shaped list makes an unattached extension invisible — and
     * Asterisk is still serving it, so it can still ring. That is the worst
     * shape: a thing that works and cannot be seen. Listed under the table
     * rather than attached to somebody automatically, because guessing whose
     * it is would be inventing a fact about a person.
     */
    const [orphans, setOrphans] = useState<Orphan[]>([]);

    // The same stream the dashboard reads. Duty is a registration in Asterisk's
    // memory, so it cannot be fetched with the roster — and opening a second
    // source for it would be a second answer able to disagree with the first.
    const { data: duty } = useEventStream<Duty>("/api/v1/dashboard/stream", context);
    const stateOf = (endpoint: string | null) =>
        (endpoint && duty?.agents.find((a) => a.endpoint === endpoint)?.state) || "offline";

    useEffect(() => {
        if (!isReady || !context) return;
        let live = true;
        api.members<Person>(context)
            .then(({ data }) => live && setPeople(data ?? []))
            .catch((problem) => live && setError((problem as Error).message));
        api.list<Orphan>("agent-extensions", context)
            .then(({ data }) => live && setOrphans((data ?? []).filter((e) => !e.user_id)))
            .catch(() => undefined);
        return () => {
            live = false;
        };
    }, [context?.accessToken, context?.organizationId, isReady]);

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6 lg:p-8">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-display-xs font-semibold text-primary">Team</h1>
                    <p className="mt-1 text-sm text-tertiary">
                        Everyone in this workspace — what they may do, and whether they answer the
                        phone.
                    </p>
                </div>
            </header>

            {error ? <p className="text-sm text-error-primary">{error}</p> : null}

            <div className="overflow-x-auto border border-secondary">
                <table className="w-full min-w-[52rem] border-collapse text-sm">
                    <thead>
                        <tr className="border-b border-secondary bg-secondary text-left">
                            <Th>Person</Th>
                            <Th>Role</Th>
                            <Th>Extension</Th>
                            <Th>Duty</Th>
                            <Th align="right" />
                        </tr>
                    </thead>
                    <tbody>
                        {(people ?? []).map((person) => (
                            <tr
                                key={person.membership_id}
                                className="border-b border-secondary last:border-0"
                            >
                                <Td>
                                    <span className="text-primary">
                                        {person.display_name || person.email || "—"}
                                    </span>
                                    {person.display_name && person.email ? (
                                        <span className="ml-2 text-tertiary">{person.email}</span>
                                    ) : null}
                                </Td>
                                <Td>
                                    <Badge
                                        size="sm"
                                        color={person.role === "owner" ? "brand" : "gray"}
                                    >
                                        {person.role}
                                    </Badge>
                                </Td>
                                <Td mono muted={!person.extension}>
                                    {person.extension ?? "—"}
                                </Td>
                                <Td muted>
                                    {person.is_service
                                        ? "—"
                                        : person.extension
                                          ? DUTY[stateOf(person.endpoint)]
                                          : "no extension"}
                                </Td>
                                <Td align="right">
                                    {person.is_service ? (
                                        // Not a colleague. Saying so beats a row
                                        // that looks like somebody who never
                                        // signs in.
                                        <span className="text-xs text-quaternary">
                                            service account
                                        </span>
                                    ) : person.extension ? (
                                        <Button
                                            size="sm"
                                            color="link-color"
                                            href={`/team/${person.extension_id}`}
                                        >
                                            Extension
                                        </Button>
                                    ) : (
                                        <Button
                                            size="sm"
                                            color="link-gray"
                                            onClick={() => setGiving(person)}
                                        >
                                            Give an extension
                                        </Button>
                                    )}
                                </Td>
                            </tr>
                        ))}
                        {people?.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-4 py-6 text-tertiary">
                                    Nobody here yet.
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>

            {people === null && !error ? (
                <p className="text-sm text-tertiary">Loading.</p>
            ) : null}

            {orphans.length > 0 ? (
                <section className="flex flex-col gap-2 border border-dashed border-secondary p-4">
                    <h2 className="text-sm font-semibold text-primary">
                        Extensions belonging to nobody
                    </h2>
                    <p className="text-sm text-tertiary">
                        Asterisk still serves these, so they can still ring — but no person owns
                        them, which means nobody can fetch their own credentials and a call they
                        take is recorded against a handset rather than a colleague. Open one to
                        say whose it is.
                    </p>
                    <ul className="flex flex-wrap gap-2 pt-1">
                        {orphans.map((orphan) => (
                            <li key={orphan.id}>
                                <Button size="sm" color="secondary" href={`/team/${orphan.id}`}>
                                    {orphan.extension}
                                    {orphan.display_name ? ` · ${orphan.display_name}` : ""}
                                </Button>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}

            {giving ? (
                <GiveExtension person={giving} onClose={() => setGiving(null)} />
            ) : null}
        </div>
    );
};

/**
 * Give somebody an extension.
 *
 * Attaches to a person who is already here rather than creating a parallel
 * record: the extension carries their `user_id` from the start, which is what
 * makes "who took this call" a person and lets them fetch their own credentials
 * when they sign in.
 *
 * The password is generated, shown once, and never returned by any route again.
 * SIP digest authentication needs the plaintext to compute a response, so it
 * cannot be hashed the way a login password is — which makes it a credential
 * rather than a field.
 */
const GiveExtension = ({ person, onClose }: { person: Person; onClose: () => void }) => {
    const { context } = useSession();
    const [extension, setExtension] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [created, setCreated] = useState<{ endpoint: string; password: string } | null>(null);

    const valid = /^[0-9]{3,6}$/.test(extension);

    const create = async () => {
        if (!context || !valid) return;
        setSaving(true);
        setError(null);
        const password = generateSipPassword();
        try {
            const { data } = await api.create<{ endpoint: string }>(
                "agent-extensions",
                {
                    org_id: context.organizationId,
                    user_id: person.user_id,
                    display_name: person.display_name || person.email || "",
                    extension: extension.trim(),
                    sip_password: password,
                    status: "active",
                },
                context,
            );
            // Read back rather than composed here: the endpoint is derived by
            // the database from the org's slug, and the app must show the name
            // Asterisk will actually know.
            setCreated({ endpoint: data?.endpoint ?? "", password });
        } catch (problem) {
            setError(problem instanceof Error ? problem.message : "Could not add the extension");
        } finally {
            setSaving(false);
        }
    };

    const finish = () => {
        onClose();
        window.location.reload();
    };

    return (
        <ModalOverlay isOpen onOpenChange={(open) => !open && (created ? finish() : onClose())}>
            <Modal className="max-w-lg">
                <Dialog>
                    <div className="flex w-full flex-col rounded-xl bg-primary p-6 shadow-xl ring-1 ring-secondary">
                        {created ? (
                            <>
                                <h2 className="text-lg font-semibold text-primary">
                                    Extension added
                                </h2>
                                <p className="mt-1 text-sm text-tertiary">
                                    Give these to {person.display_name || person.email}. The
                                    password is shown now and cannot be shown again — SIP
                                    authentication needs it in plain text, so it is not stored in a
                                    form anything can read back.
                                </p>
                                <SipCredentials
                                    endpoint={created.endpoint}
                                    password={created.password}
                                />
                                <div className="mt-6 flex justify-end">
                                    <Button size="sm" onClick={finish}>
                                        Done
                                    </Button>
                                </div>
                            </>
                        ) : (
                            <>
                                <h2 className="text-lg font-semibold text-primary">
                                    Give {person.display_name || person.email} an extension
                                </h2>
                                <p className="mt-1 text-sm text-tertiary">
                                    They will be able to take calls the AI hands over.
                                </p>
                                <div className="mt-5">
                                    <Input
                                        label="Extension"
                                        placeholder="4002"
                                        value={extension}
                                        onChange={setExtension}
                                        isRequired
                                        autoFocus
                                        hint={
                                            extension && !valid
                                                ? "Three to six digits."
                                                : "What a colleague would say out loud. Unique in your organisation."
                                        }
                                        isInvalid={Boolean(extension) && !valid}
                                    />
                                </div>
                                {error ? (
                                    <p className="mt-4 text-sm text-error-primary">{error}</p>
                                ) : null}
                                <div className="mt-6 flex justify-end gap-3">
                                    <Button size="sm" color="secondary" onClick={onClose}>
                                        Cancel
                                    </Button>
                                    <Button
                                        size="sm"
                                        isDisabled={!valid}
                                        isLoading={saving}
                                        onClick={create}
                                    >
                                        Add extension
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
};

const Th = ({ children, align }: { children?: React.ReactNode; align?: "right" }) => (
    <th
        scope="col"
        className={`px-4 py-2.5 text-xs font-medium text-tertiary ${
            align === "right" ? "text-right" : "text-left"
        }`}
    >
        {children}
    </th>
);

const Td = ({
    children,
    align,
    mono,
    muted,
}: {
    children: React.ReactNode;
    align?: "right";
    mono?: boolean;
    muted?: boolean;
}) => (
    <td
        className={[
            "px-4 py-3",
            align === "right" ? "text-right" : "text-left",
            mono ? "font-mono tabular-nums" : "",
            muted ? "text-tertiary" : "text-primary",
        ].join(" ")}
    >
        {children}
    </td>
);

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
import { Select } from "@/components/base/select/select";
import { SipCredentials } from "@/components/application/screens/sip-credentials";
import { api } from "@/utils/api-client";
import { generateSipPassword } from "@/utils/sip-password";
import { useNotify } from "@/components/application/notifications/notification-provider";
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
    /** Added, and has not signed in. Not the same as having no name. */
    is_pending: boolean;
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
    /**
     * The roster failing to load, and only that.
     *
     * It stays on the page rather than becoming a toast: the table below has
     * nothing in it either way, and a message that disappears leaves an empty
     * roster with no account of why — and the "Loading." line under it waiting
     * for something that is never coming. What a person *does* here — adding a
     * member, giving an extension — reports through `notify`.
     */
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
    const [adding, setAdding] = useState(false);

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
                <Button size="sm" onClick={() => setAdding(true)}>
                    Add Member
                </Button>
            </header>

            {error ? <p className="text-sm text-error-primary">{error}</p> : null}

            <div className="overflow-x-auto border border-secondary">
                <table className="w-full min-w-[52rem] border-collapse text-sm">
                    <thead>
                        <tr className="border-b border-secondary bg-secondary text-left">
                            <Th>Member</Th>
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
                                        : person.is_pending
                                          ? "not signed in"
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

            {adding ? <AddMember onClose={() => setAdding(false)} /> : null}
        </div>
    );
};

/**
 * Add a member.
 *
 * **One step, because they are one person.** This used to be impossible: a
 * membership required an auth account, so nobody could be added before they had
 * signed in, and the button that promised it did nothing.
 *
 * The extension is optional and in the same form, because for most of the
 * people added here it is the whole reason — a receptionist needs a number and
 * the desktop app, and their job never touches this console.
 *
 * The email is optional too, for the same reason. It is where they will sign in
 * *if* they ever do; `claim_membership()` attaches them to this row when they
 * do, along with the extension held for them.
 */
const AddMember = ({ onClose }: { onClose: () => void }) => {
    const { context } = useSession();
    const notify = useNotify();
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [role, setRole] = useState("agent");
    const [extension, setExtension] = useState("");
    const [saving, setSaving] = useState(false);
    const [done, setDone] = useState<{ endpoint: string; password: string } | null>(null);

    const extensionOk = extension.trim() === "" || /^[0-9]{3,6}$/.test(extension.trim());
    const valid = name.trim().length > 0 && extensionOk;

    const submit = async () => {
        if (!context || !valid) return;
        setSaving(true);
        try {
            const { data } = await api.addMember<{
                extension?: { endpoint: string };
                sip_password?: string;
            }>(
                {
                    name: name.trim(),
                    email: email.trim() || undefined,
                    role,
                    extension: extension.trim() || undefined,
                },
                context,
            );
            if (data?.sip_password && data.extension) {
                setDone({ endpoint: data.extension.endpoint, password: data.sip_password });
            } else {
                window.location.reload();
            }
        } catch (problem) {
            notify.failure("Could not add the member", problem);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalOverlay isOpen onOpenChange={(open) => !open && (done ? window.location.reload() : onClose())}>
            <Modal className="max-w-lg">
                <Dialog>
                    <div className="flex w-full flex-col rounded-xl bg-primary p-6 shadow-xl ring-1 ring-secondary">
                        {done ? (
                            <>
                                <h2 className="text-lg font-semibold text-primary">
                                    {name.trim()} is on the team
                                </h2>
                                <p className="mt-1 text-sm text-tertiary">
                                    These are the credentials for their softphone. The password is
                                    shown now and cannot be shown again.
                                </p>
                                <SipCredentials endpoint={done.endpoint} password={done.password} />
                                <div className="mt-6 flex justify-end">
                                    <Button size="sm" onClick={() => window.location.reload()}>
                                        Done
                                    </Button>
                                </div>
                            </>
                        ) : (
                            <>
                                <h2 className="text-lg font-semibold text-primary">Add a member</h2>
                                <p className="mt-1 text-sm text-tertiary">
                                    Somebody who works here. Give them an extension if they answer
                                    the phone.
                                </p>
                                <div className="mt-5 flex flex-col gap-4">
                                    <Input
                                        label="Name"
                                        placeholder="Priya Nair"
                                        value={name}
                                        onChange={setName}
                                        isRequired
                                        autoFocus
                                    />
                                    <Input
                                        label="Email"
                                        placeholder="priya@clinic.in"
                                        value={email}
                                        onChange={setEmail}
                                        hint="Where they would sign in. Optional — somebody who only answers the phone never needs to."
                                    />
                                    {/* The meaning goes under the field, not
                                        beside the value. As `supportingText` it
                                        rendered inside the trigger and squeezed
                                        the role's own name to "A…" — the label
                                        losing to its own explanation. */}
                                    <Select
                                        label="Role"
                                        selectedKey={role}
                                        onSelectionChange={(key) => setRole(String(key))}
                                        items={ROLES}
                                        hint={ROLES.find((r) => r.id === role)?.means}
                                    >
                                        {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                                    </Select>
                                    <Input
                                        label="Extension"
                                        placeholder="4002"
                                        value={extension}
                                        onChange={setExtension}
                                        hint={
                                            extension && !extensionOk
                                                ? "Three to six digits."
                                                : "Optional. Give them one and they can take calls the AI hands over."
                                        }
                                        isInvalid={Boolean(extension) && !extensionOk}
                                    />
                                </div>
                                <div className="mt-6 flex justify-end gap-3">
                                    <Button size="sm" color="secondary" onClick={onClose}>
                                        Cancel
                                    </Button>
                                    <Button
                                        size="sm"
                                        isDisabled={!valid}
                                        isLoading={saving}
                                        onClick={submit}
                                    >
                                        Add member
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

/**
 * What each role means, said where it is chosen.
 *
 * `owner` is absent: there is one, it is whoever created the workspace, and
 * handing it out from an add form is not a thing to discover you have done.
 */
const ROLES = [
    { id: "agent", label: "Agent", means: "Answers the phone. Sees only their own credentials." },
    { id: "admin", label: "Admin", means: "Configures everything, and can listen to live calls." },
    { id: "developer", label: "Developer", means: "Holds API keys and pushes tools." },
    { id: "viewer", label: "Viewer", means: "Reads the console and changes nothing." },
];

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
    const notify = useNotify();
    const [extension, setExtension] = useState("");
    const [saving, setSaving] = useState(false);
    const [created, setCreated] = useState<{ endpoint: string; password: string } | null>(null);

    const valid = /^[0-9]{3,6}$/.test(extension);

    const create = async () => {
        if (!context || !valid) return;
        setSaving(true);
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
            notify.failure("Could not add the extension", problem);
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

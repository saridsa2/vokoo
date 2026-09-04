"use client";

/**
 * What the platform holds and hands out.
 *
 * Numbers bought from a carrier, provider accounts the platform pays for, and
 * the templates a workspace is built from. None of it belongs to a tenant,
 * which is why none of it appears in the console — a workspace sees the number
 * it was given and the engine it was seeded, and cannot reach the pool either
 * came from.
 *
 * Three screens in one file because they are one idea and each is a table with
 * one action. Splitting them would mean three copies of the same fetch, the
 * same empty state and the same error line.
 */

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { Plus, RefreshCcw02, Trash01 } from "@/components/icons";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { api } from "@/utils/api-client";
import { keepPhone, PHONE_INPUT } from "@/utils/numeric-input";
import { useNotify } from "@/components/application/notifications/notification-provider";
import { useSession } from "@/hooks/use-session";

/* ------------------------------------------------------------------ numbers */

type PoolNumber = {
    id: string;
    number: string;
    label: string;
    carrier: string;
    status: string;
    org_id: string | null;
    org_name: string | null;
};

type Tenant = { id: string; name: string };

export const NumbersScreen = () => {
    const { context, isReady } = useSession();
    const notify = useNotify();
    const [numbers, setNumbers] = useState<PoolNumber[] | null>(null);
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [adding, setAdding] = useState(false);

    const load = useCallback(() => {
        if (!context) return;
        api.operatorNumbers<PoolNumber>(context)
            .then(({ data }) => setNumbers(data ?? []))
            .catch((problem) => notify.failure("Something went wrong", problem));
        api.operatorTenants<Tenant>(context)
            .then(({ data }) => setTenants(data ?? []))
            .catch(() => undefined);
    }, [context]);

    useEffect(() => {
        if (isReady && context) load();
    }, [isReady, context, load]);

    const free = (numbers ?? []).filter((n) => !n.org_id).length;

    return (
        <Screen
            title="Numbers"
            description="Numbers this platform has bought and lends to a workspace."
            action={
                <Button size="sm" onClick={() => setAdding(true)}>
                    Add Number
                </Button>
            }
            note={
                numbers && numbers.length > 0
                    ? `${free} of ${numbers.length} unassigned.`
                    : undefined
            }
            loading={numbers === null}
        >
            <Table head={["Number", "Label", "Carrier", "Workspace", ""]}>
                {(numbers ?? []).map((n) => (
                    <tr key={n.id} className="border-b border-secondary last:border-0">
                        <Td mono>{n.number}</Td>
                        <Td muted>{n.label}</Td>
                        <Td muted>{n.carrier}</Td>
                        <Td>
                            {n.org_name ? (
                                n.org_name
                            ) : (
                                <Badge size="sm" color="gray">
                                    in the pool
                                </Badge>
                            )}
                        </Td>
                        <Td align="right">
                            <div className="flex items-center justify-end gap-2">
                                <Select
                                    aria-label={`Assign ${n.number}`}
                                    selectedKey={n.org_id ?? ""}
                                    onSelectionChange={(key) =>
                                        void api
                                            .operatorAssignNumber(
                                                n.id,
                                                String(key) || null,
                                                context!,
                                            )
                                            .then(load)
                                            .catch((p) => notify.failure("Something went wrong", p))
                                    }
                                    items={[
                                        { id: "", label: "— release to the pool —" },
                                        ...tenants.map((t) => ({ id: t.id, label: t.name })),
                                    ]}
                                >
                                    {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                                </Select>
                            </div>
                        </Td>
                    </tr>
                ))}
            </Table>

            {numbers?.length === 0 ? (
                <Empty>
                    No numbers yet. A workspace cannot answer a call until it has one.
                </Empty>
            ) : null}

            {adding ? (
                <AddNumber
                    onClose={() => setAdding(false)}
                    onAdded={() => {
                        setAdding(false);
                        load();
                    }}
                />
            ) : null}
        </Screen>
    );
};

const AddNumber = ({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) => {
    const { context } = useSession();
    const notify = useNotify();
    const [number, setNumber] = useState("+91");
    const [label, setLabel] = useState("");
    const [carrier, setCarrier] = useState("kookoo");
    const [saving, setSaving] = useState(false);

    // E.164, matched here as well as in the database. The database is what
    // enforces it; this is so somebody is told before they press the button.
    const valid = /^\+[1-9][0-9]{7,14}$/.test(number.trim());

    return (
        <ModalOverlay isOpen onOpenChange={(o) => !o && onClose()}>
            <Modal className="max-w-md">
                <Dialog>
                    <div className="flex w-full flex-col rounded-xl bg-primary p-6 shadow-xl ring-1 ring-secondary">
                        <h2 className="text-lg font-semibold text-primary">Add a number</h2>
                        <p className="mt-1 text-sm text-tertiary">
                            It goes into the pool unassigned.
                        </p>
                        <div className="mt-5 flex flex-col gap-4">
                            {/* Filtered as it is typed: this holds E.164, so
                                letters, spaces and brackets are not a format
                                to strip later but characters the field should
                                never take. */}
                            <Input
                                label="Number"
                                value={number}
                                onChange={(next) => setNumber(keepPhone(next))}
                                {...PHONE_INPUT}
                                autoFocus
                                isInvalid={Boolean(number) && !valid}
                                hint={
                                    number && !valid
                                        ? "E.164, like +918040802529."
                                        : "E.164 with the country code, like +918040802529."
                                }
                            />
                            <Input
                                label="Label"
                                value={label}
                                onChange={setLabel}
                                hint="What this line is for."
                            />
                            <Select
                                label="Carrier"
                                selectedKey={carrier}
                                onSelectionChange={(k) => setCarrier(String(k))}
                                items={[
                                    { id: "kookoo", label: "KooKoo / Ozonetel" },
                                    { id: "whatsapp", label: "WhatsApp Business" },
                                ]}
                            >
                                {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                            </Select>
                        </div>
                        <div className="mt-6 flex justify-end gap-3">
                            <Button size="sm" color="secondary" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                isDisabled={!valid}
                                isLoading={saving}
                                onClick={() => {
                                    if (!context) return;
                                    setSaving(true);
                                    void api
                                        .operatorAddNumber(
                                            { number: number.trim(), label, carrier },
                                            context,
                                        )
                                        .then(onAdded)
                                        .catch((p) => {
                                            notify.failure("Something went wrong", p);
                                            setSaving(false);
                                        });
                                }}
                            >
                                Add
                            </Button>
                        </div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
};

/* --------------------------------------------------------------------- keys */

type PlatformKey = { vendor: string; label: string; hint: string; updated_at: string };

/**
 * The provider accounts a tenant's calls run on.
 *
 * **No route returns a key.** The listing carries the last four characters and
 * a date — enough to tell two keys apart while checking which is installed, and
 * useless to anybody who obtains it. This screen is exactly where somebody
 * would think to add "and show me the value", so it is worth saying that it
 * cannot.
 */
export const PlatformKeysScreen = () => {
    const { context, isReady } = useSession();
    const notify = useNotify();
    const [keys, setKeys] = useState<PlatformKey[] | null>(null);
    const [editing, setEditing] = useState<string | null>(null);

    const load = useCallback(() => {
        if (!context) return;
        api.operatorPlatformKeys<PlatformKey>(context)
            .then(({ data }) => setKeys(data ?? []))
            .catch((problem) => notify.failure("Something went wrong", problem));
    }, [context]);

    useEffect(() => {
        if (isReady && context) load();
    }, [isReady, context, load]);

    const installed = new Map((keys ?? []).map((k) => [k.vendor, k]));

    return (
        <Screen
            title="Provider Keys"
            description="The accounts a workspace's calls run on when it brings none of its own. Keys are encrypted and never returned — replace one rather than reading it."
            loading={keys === null}
        >
            <Table head={["Provider", "What it does", "Key", "Updated", ""]}>
                {VENDORS.map((v) => {
                    const key = installed.get(v.id);
                    return (
                        <tr key={v.id} className="border-b border-secondary last:border-0">
                            <Td>{v.label}</Td>
                            <Td muted>{v.does}</Td>
                            <Td mono muted>
                                {key ? `…${key.hint}` : "—"}
                            </Td>
                            <Td muted>
                                {key ? new Date(key.updated_at).toLocaleDateString() : ""}
                            </Td>
                            <Td align="right">
                                {/* Icons, because the words were the widest
                                    thing in the column and repeated down every
                                    row — "Replace / Remove" seven times says
                                    nothing the icon does not. `ButtonUtility`
                                    carries the tooltip and the accessible name
                                    with it, so nothing is lost to a reader who
                                    cannot see the glyph. */}
                                <div className="flex justify-end gap-1">
                                    <ButtonUtility
                                        size="xs"
                                        color="tertiary"
                                        icon={key ? RefreshCcw02 : Plus}
                                        tooltip={key ? `Replace the ${v.label} key` : `Add a ${v.label} key`}
                                        onClick={() => setEditing(v.id)}
                                    />
                                    {key ? (
                                        <ButtonUtility
                                            size="xs"
                                            color="tertiary"
                                            icon={Trash01}
                                            tooltip={`Remove the ${v.label} key`}
                                            onClick={() =>
                                                void api
                                                    .operatorDeletePlatformKey(v.id, context!)
                                                    .then(load)
                                            }
                                        />
                                    ) : null}
                                </div>
                            </Td>
                        </tr>
                    );
                })}
            </Table>

            {editing ? (
                <SetKey
                    vendor={VENDORS.find((v) => v.id === editing)!}
                    onClose={() => setEditing(null)}
                    onSaved={() => {
                        setEditing(null);
                        load();
                    }}
                />
            ) : null}
        </Screen>
    );
};

/**
 * The vendors a platform key can exist for.
 *
 * Written here rather than read from `catalogue_providers`, deliberately: that
 * table is what a *tenant* may compose an engine from, and this is the list of
 * accounts the platform can hold — including the carrier, which is not a
 * provider of intelligence and has never been in that catalogue.
 */
const VENDORS = [
    { id: "gemini", label: "Google Gemini", does: "Hears and speaks, natively." },
    { id: "openai", label: "OpenAI", does: "Thinks, in a relay. Also a realtime model." },
    { id: "sarvam", label: "Sarvam", does: "Hears and speaks Indian languages." },
    { id: "deepgram", label: "Deepgram", does: "Hears, in a relay." },
    { id: "elevenlabs", label: "ElevenLabs", does: "Speaks, in a relay." },
    { id: "minimax", label: "MiniMax", does: "Reads finished calls." },
    { id: "kookoo", label: "KooKoo / Ozonetel", does: "The carrier. Answers the phone." },
];

const SetKey = ({
    vendor,
    onClose,
    onSaved,
}: {
    vendor: { id: string; label: string };
    onClose: () => void;
    onSaved: () => void;
}) => {
    const { context } = useSession();
    const notify = useNotify();
    const [secret, setSecret] = useState("");
    const [saving, setSaving] = useState(false);

    return (
        <ModalOverlay isOpen onOpenChange={(o) => !o && onClose()}>
            <Modal className="max-w-md">
                <Dialog>
                    <div className="flex w-full flex-col rounded-xl bg-primary p-6 shadow-xl ring-1 ring-secondary">
                        <h2 className="text-lg font-semibold text-primary">{vendor.label}</h2>
                        <p className="mt-1 text-sm text-tertiary">
                            Encrypted on save. Only the bridge decrypts one, per call.
                        </p>
                        <div className="mt-5">
                            <Input
                                label="Key"
                                type="password"
                                value={secret}
                                onChange={setSecret}
                                autoFocus
                                hint="Replacing keeps the same vault reference."
                            />
                        </div>
                        <div className="mt-6 flex justify-end gap-3">
                            <Button size="sm" color="secondary" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                isDisabled={!secret.trim()}
                                isLoading={saving}
                                onClick={() => {
                                    if (!context) return;
                                    setSaving(true);
                                    void api
                                        .operatorSetPlatformKey(
                                            vendor.id,
                                            { secret: secret.trim(), label: vendor.label },
                                            context,
                                        )
                                        .then(onSaved)
                                        .catch((p) => {
                                            notify.failure("Something went wrong", p);
                                            setSaving(false);
                                        });
                                }}
                            >
                                Save
                            </Button>
                        </div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
};

/* --------------------------------------------------------------------------
 * Templates moved out.
 *
 * `TemplatesScreen` listed the four template rows in a table. Those rows are a
 * pack's contents now, and a pack is what somebody actually chooses — see
 * `platform-packs.tsx`. Left as a note rather than deleted silently, because
 * the route it served is gone too.
 * -------------------------------------------------------------------------- */

/* ------------------------------------------------------------------ shared */

const Screen = ({
    title,
    description,
    action,
    note,
    loading,
    children,
}: {
    title: string;
    description: string;
    action?: React.ReactNode;
    note?: string;
    loading: boolean;
    children: React.ReactNode;
}) => (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6 lg:p-8">
        <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-2xl">
                <h1 className="text-display-xs font-semibold text-primary">{title}</h1>
                <p className="mt-1 text-sm text-tertiary">{description}</p>
                {note ? <p className="mt-1 text-sm text-quaternary">{note}</p> : null}
            </div>
            {action}
        </header>
        {children}
        {loading ? <p className="text-sm text-tertiary">Loading.</p> : null}
    </div>
);

const Table = ({ head, children }: { head: string[]; children: React.ReactNode }) => (
    <div className="overflow-x-auto border border-secondary">
        <table className="w-full min-w-[52rem] border-collapse text-sm">
            <thead>
                <tr className="border-b border-secondary bg-secondary text-left">
                    {head.map((h, i) => (
                        <th
                            key={h || i}
                            scope="col"
                            className={`px-4 py-2.5 text-xs font-medium text-tertiary ${
                                i === head.length - 1 && h === "" ? "text-right" : "text-left"
                            }`}
                        >
                            {h}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>{children}</tbody>
        </table>
    </div>
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

const Empty = ({ children }: { children: React.ReactNode }) => (
    <p className="border border-dashed border-secondary p-6 text-sm text-tertiary">{children}</p>
);

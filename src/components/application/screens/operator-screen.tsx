"use client";

/**
 * Every tenant on the platform.
 *
 * **Outside only, on purpose.** This screen shows facts *about* a tenant —
 * how many members, how many numbers, how many calls, what plan — and never its
 * content. No transcript, no recording, no caller number. That decision is
 * enforced in the database by what `operator_tenants()` selects rather than by
 * what this screen chooses to render, so a later screen cannot quietly widen it.
 *
 * ## Why none of this sends an organisation header
 *
 * An operator is a member of no tenant. Every table gates on `is_org_member`,
 * so RLS shows them nothing — which is the correct default, and the reason each
 * query goes through a `security definer` function guarded by
 * `is_platform_admin()`. Sending `x-org-id` would be pretending they act from
 * inside a tenancy they are not in.
 *
 * ## Entitlements have three states
 *
 * A plan carries a set of catalogue items. A tenant may be granted something
 * its plan lacks, or denied something its plan has, and **no override at all**
 * is the third state — "ask the plan". Two states would make revoking something
 * a plan grants impossible without editing that plan for everybody on it.
 */

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { api } from "@/utils/api-client";
import { useNotify } from "@/components/application/notifications/notification-provider";
import { useSession } from "@/hooks/use-session";

type Tenant = {
    id: string;
    name: string;
    slug: string;
    plan: string;
    status: "active" | "suspended";
    created_at: string;
    members: number;
    agents: number;
    numbers: number;
    calls_30d: number;
    last_call_at: string | null;
};

type Entitlement = {
    kind: string;
    item_id: string;
    label: string;
    by_plan: boolean;
    override: boolean | null;
    effective: boolean;
};

const PLANS = [
    { id: "starter", label: "Starter" },
    { id: "growth", label: "Growth" },
];

export const OperatorScreen = () => {
    const { context, isReady } = useSession();
    const notify = useNotify();
    const [tenants, setTenants] = useState<Tenant[] | null>(null);
    const [adding, setAdding] = useState(false);

    const load = useCallback(() => {
        if (!context) return;
        api.operatorTenants<Tenant>(context)
            .then(({ data }) => setTenants(data ?? []))
            .catch((problem) => notify.failure("Something went wrong", problem));
    }, [context]);

    useEffect(() => {
        if (isReady && context) load();
    }, [isReady, context, load]);

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6 lg:p-8">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-display-xs font-semibold text-primary">Tenants</h1>
                    <p className="mt-1 text-sm text-tertiary">
                        Every workspace on this platform. What they are sold, what they may reach,
                        and how much they use — never what their callers said.
                    </p>
                </div>
                <Button size="sm" onClick={() => setAdding(true)}>
                    New Workspace
                </Button>
            </header>

            {/* **Cards, not a table.** A tenant is not one fact per column —
                it is a customer whose name, plan, state and shape you take in
                at once before deciding whether to open it. A row of eight
                right-aligned numbers makes you read across to answer "is this
                one working", which is the question that brought you here.

                Everything that changes a tenant moved inside the card's own
                screen. A plan dropdown and a Suspend button sitting in a list
                are one mis-click from changing the wrong customer, and neither
                is a thing you do while scanning. */}
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {(tenants ?? []).map((tenant) => (
                    <li key={tenant.id}>
                        <a
                            href={`/platform/tenants/${tenant.id}`}
                            // Hover darkens the card's own border and nothing
                            // else. Filling it with `bg-secondary_hover` read as
                            // a grey slab that swallowed the border — the card
                            // lost its outline at exactly the moment it was
                            // being pointed at, so the hovered one looked like a
                            // different kind of object rather than the same one,
                            // lit.
                            className="flex h-full flex-col gap-4 border border-secondary bg-primary p-5 transition duration-100 ease-linear hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="truncate text-md font-medium text-primary">
                                        {tenant.name}
                                    </p>
                                    <p className="mt-0.5 truncate font-mono text-xs text-quaternary">
                                        {tenant.slug}
                                    </p>
                                </div>
                                <Badge
                                    size="sm"
                                    color={tenant.status === "active" ? "success" : "gray"}
                                >
                                    {tenant.status}
                                </Badge>
                            </div>

                            <dl className="grid grid-cols-4 gap-3">
                                <Stat label="Members" value={tenant.members} />
                                <Stat label="Agents" value={tenant.agents} />
                                <Stat label="Numbers" value={tenant.numbers} />
                                <Stat label="Calls 30d" value={tenant.calls_30d} />
                            </dl>

                            <div className="mt-auto flex items-center justify-between gap-3 border-t border-secondary pt-3">
                                <span className="text-xs text-quaternary capitalize">
                                    {tenant.plan}
                                </span>
                                <span className="text-xs text-quaternary">
                                    {/* When they were last used, not when they
                                        signed up. A workspace created in March
                                        with no call since is the one worth
                                        opening, and a creation date hides it. */}
                                    {tenant.last_call_at
                                        ? `last call ${relative(tenant.last_call_at)}`
                                        : "no calls yet"}
                                </span>
                            </div>
                        </a>
                    </li>
                ))}
            </ul>

            {tenants?.length === 0 ? (
                <p className="border border-dashed border-secondary p-6 text-sm text-tertiary">
                    No workspaces yet. Creating one seeds it from the templates it is entitled to,
                    so it can answer a call the day it is made.
                </p>
            ) : null}

            {tenants === null ? <p className="text-sm text-tertiary">Loading.</p> : null}

            {adding ? (
                <NewTenant
                    onClose={() => setAdding(false)}
                    onCreated={() => {
                        setAdding(false);
                        load();
                    }}
                />
            ) : null}

        </div>
    );
};

/**
 * Create a workspace, and invite whoever will own it.
 *
 * **The slug cannot be changed afterwards**, and not for tidiness: it becomes
 * half of every agent's SIP endpoint name, and the database re-derives those on
 * write — so renaming it would rename every endpoint Asterisk knows. Said here,
 * at the only moment it can be chosen.
 *
 * The owner may have no account. That is the state migration 0078 exists for:
 * the membership carries their address, the invitation is an email rather than
 * a password handed over, and `claim_membership()` attaches them the first time
 * they sign in.
 */
const NewTenant = ({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) => {
    const { context } = useSession();
    const notify = useNotify();
    const [name, setName] = useState("");
    const [slug, setSlug] = useState("");
    const [email, setEmail] = useState("");
    const [plan, setPlan] = useState("starter");
    const [saving, setSaving] = useState(false);
    const [done, setDone] = useState<{ slug: string; sent: boolean; reason?: string } | null>(null);

    // Suggested from the name, and editable — it is permanent, so it should not
    // be decided silently by a slugifier the operator never saw.
    const suggested = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32);
    const chosen = slug || suggested;
    const slugOk = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(chosen);
    const valid = name.trim().length > 0 && slugOk;

    const submit = async () => {
        if (!context || !valid) return;
        setSaving(true);
        try {
            const { data } = await api.operatorCreateTenant<{
                tenant: { slug: string };
                invitation: { sent: boolean; reason?: string };
            }>(
                {
                    name: name.trim(),
                    slug: chosen,
                    owner_email: email.trim() || undefined,
                    plan,
                },
                context,
            );
            setDone({
                slug: data?.tenant?.slug ?? chosen,
                sent: Boolean(data?.invitation?.sent),
                reason: data?.invitation?.reason,
            });
        } catch (problem) {
            notify.failure("Could not create it", problem);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalOverlay isOpen onOpenChange={(o) => !o && (done ? onCreated() : onClose())}>
            <Modal className="max-w-lg">
                <Dialog>
                    <div className="flex w-full flex-col rounded-xl bg-primary p-6 shadow-xl ring-1 ring-secondary">
                        {done ? (
                            <>
                                <h2 className="text-lg font-semibold text-primary">
                                    {name.trim()} exists
                                </h2>
                                <p className="mt-1 text-sm text-tertiary">
                                    Its agents will register as{" "}
                                    <span className="font-mono text-primary">{done.slug}-4001</span>{" "}
                                    and so on.
                                </p>
                                <p className="mt-4 text-sm text-tertiary">
                                    {done.sent
                                        ? `An invitation is on its way to ${email.trim()}. Following it signs them in and attaches them as the owner.`
                                        : `No invitation was sent — ${done.reason ?? "no address was given"}. The workspace exists either way; somebody can be invited from its own team screen later.`}
                                </p>
                                <div className="mt-6 flex justify-end">
                                    <Button size="sm" onClick={onCreated}>
                                        Done
                                    </Button>
                                </div>
                            </>
                        ) : (
                            <>
                                <h2 className="text-lg font-semibold text-primary">New workspace</h2>
                                <p className="mt-1 text-sm text-tertiary">
                                    A customer of this platform.
                                </p>
                                <div className="mt-5 flex flex-col gap-4">
                                    <Input
                                        label="Name"
                                        placeholder="Vayuveda Clinic"
                                        value={name}
                                        onChange={setName}
                                        isRequired
                                        autoFocus
                                    />
                                    <Input
                                        label="Slug"
                                        placeholder={suggested || "vayuveda-clinic"}
                                        value={slug}
                                        onChange={setSlug}
                                        hint={
                                            chosen && !slugOk
                                                ? "Three to thirty-two characters: lowercase letters, digits and hyphens."
                                                : `Permanent. It becomes half of every agent's SIP endpoint — ${chosen || "slug"}-4001 — and the database re-derives those on write, so it cannot be changed later.`
                                        }
                                        isInvalid={Boolean(chosen) && !slugOk}
                                    />
                                    <Input
                                        label="Owner email"
                                        placeholder="owner@clinic.in"
                                        value={email}
                                        onChange={setEmail}
                                        hint="They are emailed a link that signs them in and makes them the owner. Optional — a workspace can be created now and claimed later."
                                    />
                                    <Select
                                        label="Plan"
                                        selectedKey={plan}
                                        onSelectionChange={(key) => setPlan(String(key))}
                                        items={PLANS}
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
                                        onClick={submit}
                                    >
                                        Create workspace
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
 * One tenant's catalogue, and what it may reach.
 *
 * Shows the plan's answer and the override separately rather than only the
 * result, because "why can this tenant not use Gemini" has two possible answers
 * and a single tick cannot distinguish them.
 */

/** One number on a card. Four of them read as a shape, not as a row. */
const Stat = ({ label, value }: { label: string; value: number }) => (
    <div>
        <dt className="text-[0.6875rem] tracking-wide text-quaternary uppercase">{label}</dt>
        <dd className="mt-0.5 text-lg font-light tabular-nums text-primary">{value}</dd>
    </div>
);

/**
 * "3 days ago" rather than a date.
 *
 * On a card the question is how long since, and a reader converting
 * "2026-08-31" into that themselves is doing arithmetic to answer it.
 */
function relative(iso: string): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "unknown";
    const minutes = Math.round((Date.now() - then) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return days === 1 ? "yesterday" : `${days}d ago`;
}

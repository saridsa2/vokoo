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
import { Select } from "@/components/base/select/select";
import { api } from "@/utils/api-client";
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
    const [tenants, setTenants] = useState<Tenant[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [open, setOpen] = useState<string | null>(null);

    const load = useCallback(() => {
        if (!context) return;
        api.operatorTenants<Tenant>(context)
            .then(({ data }) => setTenants(data ?? []))
            .catch((problem) => setError((problem as Error).message));
    }, [context]);

    useEffect(() => {
        if (isReady && context) load();
    }, [isReady, context, load]);

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6 lg:p-8">
            <header>
                <h1 className="text-display-xs font-semibold text-primary">Tenants</h1>
                <p className="mt-1 text-sm text-tertiary">
                    Every workspace on this platform. What they are sold, what they may reach, and
                    how much they use — never what their callers said.
                </p>
            </header>

            {error ? <p className="text-sm text-error-primary">{error}</p> : null}

            <div className="overflow-x-auto border border-secondary">
                <table className="w-full min-w-[60rem] border-collapse text-sm">
                    <thead>
                        <tr className="border-b border-secondary bg-secondary text-left">
                            <Th>Workspace</Th>
                            <Th>Plan</Th>
                            <Th>Status</Th>
                            <Th align="right">Members</Th>
                            <Th align="right">Agents</Th>
                            <Th align="right">Numbers</Th>
                            <Th align="right">Calls 30d</Th>
                            <Th align="right" />
                        </tr>
                    </thead>
                    <tbody>
                        {(tenants ?? []).map((tenant) => (
                            <tr key={tenant.id} className="border-b border-secondary last:border-0">
                                <Td>
                                    <span className="text-primary">{tenant.name}</span>
                                    <span className="ml-2 font-mono text-xs text-quaternary">
                                        {tenant.slug}
                                    </span>
                                </Td>
                                <Td>
                                    <Select
                                        aria-label={`Plan for ${tenant.name}`}
                                        selectedKey={tenant.plan}
                                        onSelectionChange={(key) =>
                                            void api
                                                .operatorSetTenant(
                                                    tenant.id,
                                                    { plan: String(key) },
                                                    context!,
                                                )
                                                .then(load)
                                        }
                                        items={PLANS}
                                    >
                                        {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                                    </Select>
                                </Td>
                                <Td>
                                    <Badge
                                        size="sm"
                                        color={tenant.status === "active" ? "success" : "gray"}
                                    >
                                        {tenant.status}
                                    </Badge>
                                </Td>
                                <Td align="right" mono>{tenant.members}</Td>
                                <Td align="right" mono>{tenant.agents}</Td>
                                <Td align="right" mono>{tenant.numbers}</Td>
                                <Td align="right" mono>{tenant.calls_30d}</Td>
                                <Td align="right">
                                    <div className="flex justify-end gap-1">
                                        <Button
                                            size="sm"
                                            color="link-color"
                                            onClick={() =>
                                                setOpen(open === tenant.id ? null : tenant.id)
                                            }
                                        >
                                            {open === tenant.id ? "Hide" : "Entitlements"}
                                        </Button>
                                        <Button
                                            size="sm"
                                            color={
                                                tenant.status === "active"
                                                    ? "link-destructive"
                                                    : "link-gray"
                                            }
                                            onClick={() =>
                                                void api
                                                    .operatorSetTenant(
                                                        tenant.id,
                                                        {
                                                            status:
                                                                tenant.status === "active"
                                                                    ? "suspended"
                                                                    : "active",
                                                        },
                                                        context!,
                                                    )
                                                    .then(load)
                                            }
                                        >
                                            {tenant.status === "active" ? "Suspend" : "Reinstate"}
                                        </Button>
                                    </div>
                                </Td>
                            </tr>
                        ))}
                        {tenants?.length === 0 ? (
                            <tr>
                                <td colSpan={8} className="px-4 py-6 text-tertiary">
                                    No tenants.
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>

            {tenants === null && !error ? <p className="text-sm text-tertiary">Loading.</p> : null}

            {open ? (
                <Entitlements
                    tenant={tenants?.find((t) => t.id === open)}
                    onClose={() => setOpen(null)}
                />
            ) : null}

            <p className="max-w-3xl border border-dashed border-secondary p-4 text-sm text-tertiary">
                <strong className="text-primary">Suspension is stored and not enforced.</strong>{" "}
                The bridge has to refuse a call for a suspended organisation, and does not yet —
                so this marks a tenant rather than stopping one. Entitlements are stored and read
                by nothing: making the catalogue filter on them is the change that touches the
                engine composer and the agent editor, and it is the next piece.
            </p>
        </div>
    );
};

/**
 * One tenant's catalogue, and what it may reach.
 *
 * Shows the plan's answer and the override separately rather than only the
 * result, because "why can this tenant not use Gemini" has two possible answers
 * and a single tick cannot distinguish them.
 */
const Entitlements = ({ tenant, onClose }: { tenant?: Tenant; onClose: () => void }) => {
    const { context } = useSession();
    const [rows, setRows] = useState<Entitlement[] | null>(null);

    const load = useCallback(() => {
        if (!context || !tenant) return;
        api.operatorEntitlements<Entitlement>(tenant.id, context)
            .then(({ data }) => setRows(data ?? []))
            .catch(() => setRows([]));
    }, [context, tenant?.id]);

    useEffect(load, [load]);

    if (!tenant) return null;

    const set = (row: Entitlement, allowed: boolean | null) =>
        void api
            .operatorSetEntitlement(
                tenant.id,
                { kind: row.kind, item_id: row.item_id, allowed },
                context!,
            )
            .then(load);

    return (
        <section className="flex flex-col gap-3 border border-secondary p-5">
            <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-semibold text-primary">
                    {tenant.name} · what it may reach
                </h2>
                <Button size="sm" color="link-gray" onClick={onClose}>
                    Close
                </Button>
            </div>
            <p className="text-sm text-tertiary">
                On the <strong className="text-primary">{tenant.plan}</strong> plan. Inherit takes
                whatever the plan says; grant and deny override it for this tenant alone.
            </p>

            <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                    <thead>
                        <tr className="border-b border-secondary text-left">
                            <Th>Item</Th>
                            <Th>Kind</Th>
                            <Th>Plan</Th>
                            <Th align="right">This tenant</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {(rows ?? []).map((row) => (
                            <tr
                                key={`${row.kind}:${row.item_id}`}
                                className="border-b border-secondary last:border-0"
                            >
                                <Td>
                                    <span className={row.effective ? "text-primary" : "text-tertiary"}>
                                        {row.label}
                                    </span>
                                </Td>
                                <Td muted>{row.kind}</Td>
                                <Td muted>{row.by_plan ? "allows" : "does not"}</Td>
                                <Td align="right">
                                    <div className="flex justify-end gap-1">
                                        {(
                                            [
                                                ["Inherit", null],
                                                ["Grant", true],
                                                ["Deny", false],
                                            ] as const
                                        ).map(([label, value]) => (
                                            <button
                                                key={label}
                                                type="button"
                                                onClick={() => set(row, value)}
                                                className={`px-2 py-1 text-xs transition duration-100 ease-linear ${
                                                    row.override === value
                                                        ? "bg-brand-solid text-white"
                                                        : "text-tertiary hover:bg-primary_hover"
                                                }`}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                </Td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {rows === null ? <p className="text-sm text-tertiary">Loading.</p> : null}
        </section>
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

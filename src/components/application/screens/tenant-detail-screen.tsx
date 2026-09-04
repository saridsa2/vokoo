"use client";

/**
 * One customer, opened.
 *
 * The list answers "who are my customers". This answers the three questions you
 * open one to ask, and they are genuinely different questions with different
 * shapes — how much are they using, what will they be billed, and is their
 * workspace set up to work at all. Tabs rather than one long page because
 * nobody reads all three at once, and stacking them would put the thing you
 * came for below two screens of the things you did not.
 *
 * ## The line, again
 *
 * Facts *about* a workspace, never its content. No transcript, no recording, no
 * caller number, no agent prompt. Enforced in the database by what
 * `operator_tenant_*` selects rather than by what this renders — see migration
 * 0089. An aggregate over rows an operator may not read is still not the rows.
 *
 * The one exception is the phone number, named rather than counted, because it
 * is the platform's own property lent to the tenant.
 *
 * ## Every tab admits what is not yet true
 *
 * Billing shows a cost of zero beside the count of things nobody has priced,
 * because a call nobody has priced and a call that cost nothing are different
 * facts and reporting the second as the first is how a wrong invoice goes out.
 * Configuration says when suspension is stored and not enforced. Both are
 * cheaper to say than to discover from a customer.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/base/badges/badges";
// The kit's own, built on React Aria's Switch. What was here was a hand-rolled
// `<button role="switch">` with a translating span — square, with a knob that
// did not fit its track and no hover or focus states.
import { Toggle } from "@/components/base/toggle/toggle";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { ConfirmDialog } from "@/components/application/modals/confirm-dialog";
import { IconApiKeys, IconNotifiers, Trash01 } from "@/components/icons";
import { InfoHint } from "@/components/base/tooltip/info-hint";
import { Input } from "@/components/base/input/input";
import { Button } from "@/components/base/buttons/button";
import { Chart } from "@/components/application/charts/chart";
import { DataTable, type DataColumn } from "@/components/application/table/data-table";
import { Select, type SelectItemType } from "@/components/base/select/select";
import { keepDigits, keepPhone, NUMERIC_INPUT, PHONE_INPUT } from "@/utils/numeric-input";
import { Tabs } from "@/components/application/tabs/tabs";
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

type UsageDay = { day: string; calls: number; answered: number; seconds: number };

type Billing = {
    sessions: number;
    currency: string;
    cost: number;
    unpriced_items: number;
    unpriced_vendors: string[];
};

type Entitlement = {
    kind: string;
    item_id: string;
    label: string;
    by_plan: boolean;
    override: boolean | null;
    effective: boolean;
};

// **Entitlements is gone.** Of its 24 rows, 23 were read by nothing —
// denying a model or a provider changed no behaviour anywhere — and the one
// that worked, `byo_intelligence`, was withdrawn in 0090. What survives of the
// idea is which engines a workspace may use, which is a list on Configuration
// rather than a tab of its own.
//
// Members replaces it, because there was no way to help a locked-out customer.
const TABS = [
    { id: "usage", label: "Usage" },
    { id: "billing", label: "Billing" },
    { id: "configuration", label: "Configuration" },
    { id: "members", label: "Members" },
] as const;

type TabId = (typeof TABS)[number]["id"];

type PlanOption = { id: string; label: string; is_active: boolean };

export const TenantDetailScreen = ({ id }: { id: string }) => {
    const { context, isReady } = useSession();
    const notify = useNotify();
    const [tab, setTab] = useState<TabId>("usage");
    const [tenant, setTenant] = useState<Tenant | null>(null);
    const [suspending, setSuspending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // **Fetched, not a literal.** This was a hardcoded pair — Starter and
    // Growth — while the database has held four since 0099 and can hold any
    // number since 0105. Two of a tenant's four possible plans were
    // unreachable from the screen that assigns them, and a plan added today
    // would never have appeared.
    const [plans, setPlans] = useState<PlanOption[]>([]);
    // A closed period nobody has paid blocks the move (0107). Read here so the
    // selector can say why rather than refusing after the click.
    const [owed, setOwed] = useState(0);

    const loadTenant = useCallback(() => {
        if (!context) return;
        // The list route, filtered here. There is no `operator_tenant(id)` and
        // adding one would be a second implementation of the same query — the
        // fault this project already records against its first pre-flight.
        api.operatorTenants<Tenant>(context)
            .then(({ data }) => {
                const found = (data ?? []).find((row) => row.id === id) ?? null;
                setTenant(found);
                if (!found) setError("No workspace with that id.");
            })
            .catch((problem) => notify.failure("Something went wrong", problem));
    }, [context, id]);

    useEffect(() => {
        if (isReady && context) loadTenant();
    }, [isReady, context, loadTenant]);

    useEffect(() => {
        if (!isReady || !context) return;
        api.operatorPlans<PlanOption>(context)
            .then(({ data }) => setPlans(data ?? []))
            .catch(() => setPlans([]));
        api.operatorTenantPeriods<{ status: string; settled_at: string | null }>(id, context)
            .then(({ data }) =>
                setOwed(
                    (data ?? []).filter((row) => row.status === "closed" && !row.settled_at).length,
                ),
            )
            .catch(() => setOwed(0));
    }, [isReady, context, id]);

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* **No `border-b` here.** `Tabs.List type="underline"` draws its own
                rule the full width of the tab strip, so a border on the header
                put a second line a few pixels below the first. The tabs' rule is
                the one that means something — it is what the selected tab sits
                on — so the header does without.

                `shrink-0` and no scrolling: the name, the plan and Suspend stay
                put while a tab's body moves under them. A header that scrolls
                away takes the workspace's name with it, and four tabs later you
                are reading numbers without knowing whose. */}
            <header className="flex shrink-0 flex-col gap-4 p-6 pb-0 lg:px-8">
                <Button size="sm" color="link-gray" href="/platform" className="self-start">
                    ← All tenants
                </Button>

                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-display-xs font-semibold text-primary">
                                {tenant?.name ?? "…"}
                            </h1>
                            {tenant ? (
                                <Badge
                                    size="sm"
                                    color={tenant.status === "active" ? "success" : "gray"}
                                >
                                    {tenant.status}
                                </Badge>
                            ) : null}
                        </div>
                        <p className="mt-1 font-mono text-xs text-quaternary">{tenant?.slug}</p>
                    </div>

                    {tenant ? (
                        <div className="flex items-center gap-2">
                            <span className="flex items-center gap-1.5">
                                <Select
                                    aria-label="Plan"
                                    selectedKey={tenant.plan}
                                    // A plan cannot be moved while the
                                    // workspace owes for a closed period. The
                                    // control is disabled rather than the
                                    // change being refused afterwards — the
                                    // refusal is correct either way, but a
                                    // dropdown that accepts a choice and then
                                    // undoes it reads as a bug.
                                    isDisabled={owed > 0}
                                    onSelectionChange={(key) => {
                                        if (!context || String(key) === tenant.plan) return;
                                        void api
                                            .operatorSetTenant(id, { plan: String(key) }, context)
                                            .then(loadTenant)
                                            // This had no catch at all, so
                                            // every refusal — including the new
                                            // one — was silent and the old plan
                                            // simply stayed on screen.
                                            .catch((problem) =>
                                                notify.failure("Something went wrong", problem),
                                            );
                                    }}
                                    items={plans.filter(
                                        // A withdrawn plan is not offered, but
                                        // one already in use stays listed —
                                        // otherwise the selector cannot show
                                        // what this workspace is actually on.
                                        (option) => option.is_active || option.id === tenant.plan,
                                    )}
                                >
                                    {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                                </Select>
                                {owed > 0 ? (
                                    <InfoHint
                                        title="An invoice is pending"
                                        description={`${owed} closed billing period${owed === 1 ? " is" : "s are"} unpaid. Record payment on the Billing tab, and the plan can be changed.`}
                                        className="text-warning-primary"
                                    />
                                ) : null}
                            </span>
                            <Button
                                size="sm"
                                color={
                                    tenant.status === "active" ? "secondary-destructive" : "secondary"
                                }
                                onClick={() => {
                                    // Reinstating is not destructive, so it does
                                    // not ask. Suspending reaches a whole
                                    // customer, so it does.
                                    if (tenant.status !== "active") {
                                        void api
                                            .operatorSetTenant(id, { status: "active" }, context!)
                                            .then(loadTenant)
                                            .catch((p) =>
                                                notify.failure("Could not reinstate the workspace", p),
                                            );
                                        return;
                                    }
                                    setSuspending(true);
                                }}
                            >
                                {tenant.status === "active" ? "Suspend" : "Reinstate"}
                            </Button>
                        </div>
                    ) : null}
                </div>

                <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key) as TabId)}>
                    <Tabs.List type="underline" items={TABS.map((t) => ({ ...t }))}>
                        {(item) => <Tabs.Item {...item} />}
                    </Tabs.List>
                </Tabs>
            </header>

            {error ? <p className="shrink-0 px-6 pt-4 text-sm text-error-primary lg:px-8">{error}</p> : null}

            {suspending && tenant ? (
                <ConfirmDialog
                    title={`Suspend ${tenant.name}?`}
                    body={
                        <>
                            <p>
                                This marks the workspace as suspended across the platform. Their
                                people keep access and their configuration is untouched.
                            </p>
                            <p className="mt-2">
                                {/* Said because the button reads as if it does
                                    more, and somebody suspending a customer for
                                    non-payment needs to know it does not. */}
                                <strong className="text-primary">
                                    It does not yet stop their calls.
                                </strong>{" "}
                                The bridge has to refuse a call for a suspended workspace and does
                                not do so.
                            </p>
                        </>
                    }
                    confirmLabel="Suspend"
                    confirmText={tenant.slug}
                    onCancel={() => setSuspending(false)}
                    onConfirm={() => {
                        setSuspending(false);
                        void api
                            .operatorSetTenant(id, { status: "suspended" }, context!)
                            .then(loadTenant)
                            .catch((p) => notify.failure("Could not suspend the workspace", p));
                    }}
                />
            ) : null}

            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6 lg:p-8">
                {tab === "usage" ? <UsageTab id={id} /> : null}
                {tab === "billing" ? <BillingTab id={id} plan={tenant?.plan} /> : null}
                {tab === "configuration" ? <ConfigurationTab id={id} /> : null}
                {tab === "members" ? <MembersTab id={id} /> : null}
            </div>
        </div>
    );
};

/* -------------------------------------------------------------------- usage */

const UsageTab = ({ id }: { id: string }) => {
    const { context } = useSession();
    const notify = useNotify();
    const [days, setDays] = useState<UsageDay[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!context) return;
        api.operatorTenantUsage<UsageDay>(id, context)
            .then(({ data }) => setDays(data ?? []))
            .catch((problem) => notify.failure("Something went wrong", problem));
    }, [context, id]);

    const totals = useMemo(() => {
        const rows = days ?? [];
        return {
            calls: rows.reduce((sum, d) => sum + d.calls, 0),
            answered: rows.reduce((sum, d) => sum + d.answered, 0),
            seconds: rows.reduce((sum, d) => sum + d.seconds, 0),
            busiest: rows.reduce<UsageDay | null>(
                (best, d) => (best === null || d.calls > best.calls ? d : best),
                null,
            ),
        };
    }, [days]);

    if (error) return <p className="text-sm text-error-primary">{error}</p>;
    if (!days) return <p className="text-sm text-tertiary">Loading.</p>;

    return (
        <>
            <dl className="grid grid-cols-2 gap-px border border-secondary bg-secondary lg:grid-cols-4">
                <Figure label="Calls, 30 days" value={totals.calls.toLocaleString()} />
                {/* "Answered", not "completed". The old filter looked for
                    `status = 'completed'`, a value `calls` has never held — the
                    real ones are `ended`, `in-progress` and `unconfigured` — so
                    it read 0 of 65 on a line that answers every day. */}
                <Figure
                    label="Answered"
                    value={totals.answered.toLocaleString()}
                    note={
                        totals.calls > 0
                            ? `${Math.round((totals.answered / totals.calls) * 100)}% of them`
                            : undefined
                    }
                />
                <Figure label="Talk time" value={formatDuration(totals.seconds)} />
                <Figure
                    label="Busiest day"
                    value={totals.busiest && totals.busiest.calls > 0 ? `${totals.busiest.calls}` : "—"}
                    note={
                        totals.busiest && totals.busiest.calls > 0
                            ? new Date(totals.busiest.day).toLocaleDateString(undefined, {
                                  day: "numeric",
                                  month: "short",
                              })
                            : "no calls yet"
                    }
                />
            </dl>

            <section className="border border-secondary p-5">
                {/* Every day is plotted, including the empty ones — a series
                    drawn only from days that had calls draws a straight line
                    across a quiet week and reports it as steady use. That is a
                    fact about the data and it belongs here, not on screen: the
                    reader wants the shape, not an essay under the title. */}
                <h2 className="text-sm font-medium text-primary">Calls a day</h2>
                <div className="mt-4">
                    <Chart
                        height={260}
                        ariaLabel="Calls a day over the last thirty days"
                        option={{
                            grid: { left: 44, right: 16, top: 16, bottom: 28 },
                            tooltip: { trigger: "axis" },
                            xAxis: {
                                type: "category",
                                data: days.map((d) =>
                                    new Date(d.day).toLocaleDateString(undefined, {
                                        day: "numeric",
                                        month: "short",
                                    }),
                                ),
                                axisTick: { show: false },
                            },
                            yAxis: { type: "value", minInterval: 1 },
                            series: [
                                {
                                    type: "bar",
                                    name: "Calls",
                                    data: days.map((d) => d.calls),
                                    barMaxWidth: 18,
                                    // The section's own accent, not ECharts'
                                    // default indigo. The console's rule is one
                                    // hue per navigation section and the data
                                    // takes it; a chart in a borrowed palette
                                    // reads as a chart from another product.
                                    itemStyle: { color: "var(--chart-accent, #B45309)" },
                                },
                            ],
                        }}
                    />
                </div>
            </section>
        </>
    );
};

/* ------------------------------------------------------------------ billing */

/**
 * What this workspace has cost, what it has been billed, and what is owed.
 *
 * ## Two things are not in "priced so far", and neither is a setting
 *
 * **A realtime call records nothing.** `src/services/realtime/*.rs` carries no
 * `BillingCollector` at all, so a workspace whose engine is Gemini Live or
 * OpenAI Realtime shows a cost of zero however much it is used. Only the relay
 * shape meters its stt, llm and tts.
 *
 * **Nothing emits `call_second`**, so the carrier's own charge — the largest
 * fixed cost per line — is unmeasured on every call of either shape.
 *
 * Both are producers that do not exist yet rather than rates somebody forgot to
 * enter, which is why they cannot appear in `unpriced_vendors`: that counts
 * quantities that *were* measured and have no rate. A missing producer measures
 * nothing, so it leaves no trace in the ledger to count.
 *
 * The screen says "priced so far" rather than "cost" for exactly this reason,
 * and reports unpriced quantities beside the total instead of folding them in.
 * A call nobody has priced and a call that cost nothing are different facts,
 * and reporting the second as the first is how a wrong invoice goes out.
 */
const BillingTab = ({ id, plan }: { id: string; plan?: string }) => {
    const { context } = useSession();
    const notify = useNotify();
    const [billing, setBilling] = useState<Billing | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!context) return;
        api.operatorTenantBilling<Billing>(id, context)
            // `returns table` gives one row in an array, always.
            .then(({ data }) => setBilling(data?.[0] ?? null))
            .catch((problem) => notify.failure("Something went wrong", problem));
    }, [context, id]);

    if (error) return <p className="text-sm text-error-primary">{error}</p>;
    if (!billing) return <p className="text-sm text-tertiary">Loading.</p>;

    const unpriced = billing.unpriced_items > 0;

    return (
        <>
            <BillingPeriod id={id} />

            <Invoices id={id} />

            <dl className="grid grid-cols-2 gap-px border border-secondary bg-secondary lg:grid-cols-4">
                <Figure label="Plan" value={plan ? plan[0].toUpperCase() + plan.slice(1) : "—"} />
                <Figure label="Billable sessions" value={billing.sessions.toLocaleString()} />
                <Figure
                    label="Priced so far"
                    value={`${billing.currency} ${Number(billing.cost).toFixed(2)}`}
                />
                <Figure
                    label="Unpriced"
                    value={billing.unpriced_items.toLocaleString()}
                    note={unpriced ? "not in the total" : "none"}
                />
            </dl>

            {/* Why this figure is not an invoice, in one line rather than three
                paragraphs of it. Every rate in `catalogue_vendor_rates` is
                deliberately null until somebody reads it off the vendor's own
                page, so "priced so far" is nearly always short — and a call
                nobody has priced and a call that cost nothing are different
                facts. Naming the vendors is the actionable half; the reasoning
                is why the code is shaped this way and stays here. */}
            {unpriced ? (
                <section className="flex flex-wrap items-center gap-x-3 gap-y-2 border border-secondary p-4">
                    <span className="text-sm text-secondary">
                        {billing.unpriced_items.toLocaleString()} quantities have no rate yet
                        {billing.unpriced_vendors.length > 0 ? " —" : "."}
                    </span>
                    {billing.unpriced_vendors.map((vendor) => (
                        <Badge key={vendor} size="sm" color="warning">
                            {vendor}
                        </Badge>
                    ))}
                </section>
            ) : null}
        </>
    );
};

type PeriodRow = {
    period_id: string | null;
    starts_at: string | null;
    ends_at: string | null;
    plan_id: string | null;
    price: number | null;
    currency: string | null;
    included_minutes: number | null;
    used_minutes: number | null;
    overage_minutes: number | null;
    overage_per_minute: number | null;
    overage_charge: number | null;
    total: number | null;
};

/**
 * The month the allowance is measured over.
 *
 * Everything else on this screen is a rolling thirty days, which is a window
 * and not a month — it never starts, ends or resets, so an allowance against it
 * could never be used up or renewed. This is the row a bill is made from.
 *
 * Opening one is a button rather than automatic because nothing rolls periods
 * over yet. Saying so on screen is cheaper than a customer discovering in
 * October that September never closed.
 */
type InvoiceRow = {
    id: string;
    starts_at: string | null;
    ends_at: string | null;
    plan_id: string | null;
    price: number | null;
    currency: string | null;
    included_minutes: number | null;
    used_minutes: number | null;
    overage_minutes: number | null;
    total: number | null;
    status: "open" | "closed";
    settled_at: string | null;
};

/**
 * What this workspace has been billed, and what is still owed.
 *
 * A closed period is the invoice — it carries the dates, the plan, the price
 * agreed and the allowance, all snapshotted when it opened, so it says what was
 * owed even after the plan has moved on. `settled_at` is the other end of it.
 *
 * **An unpaid one blocks a plan change** (0107), which is why it is on screen
 * rather than a fact only the database holds: a refusal with nowhere to go and
 * look is a dead end.
 *
 * The open period is listed and cannot be settled. It is a month in progress,
 * not a bill, and offering the button on it would invite somebody to mark a
 * month paid halfway through.
 */
const Invoices = ({ id }: { id: string }) => {
    const { context } = useSession();
    const notify = useNotify();
    const [rows, setRows] = useState<InvoiceRow[] | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [settling, setSettling] = useState<InvoiceRow | null>(null);

    const load = useCallback(() => {
        if (!context) return;
        api.operatorTenantPeriods<InvoiceRow>(id, context)
            .then(({ data }) => setRows(data ?? []))
            .catch((problem) => notify.failure("Something went wrong", problem));
    }, [context, id]);

    useEffect(load, [load]);

    // A period still open is not a bill, so it is not counted here.
    const owed = (rows ?? []).filter((row) => row.status === "closed" && !row.settled_at);

    // One period and it is the open one: there is nothing to call history yet,
    // and an empty table under a heading reads as something that failed to load.
    if (rows !== null && rows.every((row) => row.status === "open")) return null;

    return (
        <section className="border border-secondary p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-sm font-medium text-primary">Invoices</h2>
                {owed.length > 0 ? (
                    <span className="text-sm text-warning-primary">
                        {owed.length} unpaid — the plan cannot be changed until they are settled
                    </span>
                ) : null}
            </div>

            {rows === null ? (
                <p className="mt-3 text-sm text-tertiary">Loading.</p>
            ) : (
                <ul className="mt-3 flex flex-col gap-2">
                    {rows.map((row) => (
                        <li
                            key={row.id}
                            className="flex flex-wrap items-center justify-between gap-3 border border-secondary px-3 py-2"
                        >
                            <span className="flex flex-wrap items-center gap-3">
                                <span className="text-primary">{monthOf(row.starts_at)}</span>
                                <span className="text-xs text-quaternary">{row.plan_id ?? "—"}</span>
                                <span className="tabular-nums text-sm text-tertiary">
                                    {row.total === null
                                        ? "—"
                                        : `${row.currency ?? "INR"} ${Number(row.total).toFixed(0)}`}
                                </span>
                                <span className="text-xs text-quaternary">
                                    {Number(row.used_minutes ?? 0)} min used
                                </span>
                            </span>

                            <span className="flex items-center gap-3">
                                {row.status === "open" ? (
                                    <Badge size="sm" color="brand">
                                        in progress
                                    </Badge>
                                ) : row.settled_at ? (
                                    <Badge size="sm" color="success">
                                        paid {new Date(row.settled_at).toLocaleDateString()}
                                    </Badge>
                                ) : (
                                    <>
                                        <Badge size="sm" color="warning">
                                            unpaid
                                        </Badge>
                                        <Button
                                            size="sm"
                                            color="secondary"
                                            isLoading={busy === row.id}
                                            onClick={() => setSettling(row)}
                                        >
                                            Record payment
                                        </Button>
                                    </>
                                )}
                            </span>
                        </li>
                    ))}
                </ul>
            )}

            {/* Confirmed, because it is a claim about money that somebody else
                will act on and there is no route here to take it back. */}
            {settling ? (
                <ConfirmDialog
                    title={`Record ${monthOf(settling.starts_at)} as paid?`}
                    body={
                        <>
                            {settling.currency ?? "INR"}{" "}
                            {settling.total === null ? "—" : Number(settling.total).toFixed(0)} on
                            the {settling.plan_id ?? "—"} plan. This says the money arrived, and
                            nothing here can undo it.
                        </>
                    }
                    confirmLabel="Record payment"
                    tone="neutral"
                    isBusy={busy === settling.id}
                    onCancel={() => setSettling(null)}
                    onConfirm={() => {
                        if (!context) return;
                        setBusy(settling.id);
                        void api
                            .operatorSettlePeriod(settling.id, context)
                            .then(() => {
                                setSettling(null);
                                load();
                            })
                            .catch((problem) => notify.failure("Something went wrong", problem))
                            .finally(() => setBusy(null));
                    }}
                />
            ) : null}
        </section>
    );
};

/** "September 2026", or the id's stand-in when a period has no start. */
function monthOf(iso: string | null): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

const BillingPeriod = ({ id }: { id: string }) => {
    const { context } = useSession();
    const notify = useNotify();
    const [period, setPeriod] = useState<PeriodRow | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(() => {
        if (!context) return;
        api.operatorTenantPeriod<PeriodRow>(id, context)
            .then(({ data }) => setPeriod(data?.[0] ?? null))
            .catch((problem) => notify.failure("Something went wrong", problem))
            .finally(() => setLoaded(true));
    }, [context, id]);

    useEffect(load, [load]);

    if (!loaded) return null;

    if (!period?.period_id) {
        return (
            <section className="flex flex-wrap items-center justify-between gap-3 border border-secondary p-5">
                <div>
                    <h2 className="text-sm font-medium text-primary">No open billing period</h2>
                    <p className="mt-1 text-sm text-tertiary">
                        Nothing is being counted against an allowance. Calls are still recorded.
                    </p>
                </div>
                <Button
                    size="sm"
                    isLoading={busy}
                    onClick={() => {
                        if (!context) return;
                        setBusy(true);
                        void api
                            .operatorOpenPeriod(id, context)
                            .then(load)
                            .catch((p) => notify.failure("Something went wrong", p))
                            .finally(() => setBusy(false));
                    }}
                >
                    Open this month
                </Button>
                {error ? <p className="w-full text-sm text-error-primary">{error}</p> : null}
            </section>
        );
    }

    const used = Number(period.used_minutes ?? 0);
    const included = period.included_minutes;
    const share = included && included > 0 ? Math.min(used / included, 1) : 0;
    const over = Number(period.overage_minutes ?? 0) > 0;

    return (
        <section className="border border-secondary p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-sm font-medium text-primary">
                    {period.starts_at
                        ? new Date(period.starts_at).toLocaleDateString(undefined, {
                              month: "long",
                              year: "numeric",
                          })
                        : "This period"}
                </h2>
                <span className="text-sm text-tertiary">
                    {period.currency ?? "INR"} {Number(period.total ?? 0).toFixed(0)} owed
                </span>
            </div>

            <p className="mt-3 text-sm text-secondary">
                {used.toLocaleString()} of{" "}
                {included === null ? "unmetered" : included.toLocaleString()} minutes
                {over
                    ? ` — ${Number(period.overage_minutes).toLocaleString()} over, at ${period.currency ?? "INR"} ${period.overage_per_minute}/min`
                    : ""}
            </p>

            {included !== null ? (
                <div
                    className="mt-2 h-2 w-full bg-secondary"
                    role="img"
                    aria-label={`${Math.round(share * 100)}% of the allowance used`}
                >
                    <div
                        className={over ? "h-full bg-error-solid" : "h-full bg-brand-solid"}
                        style={{ width: `${Math.max(share * 100, 2)}%` }}
                    />
                </div>
            ) : null}
        </section>
    );
};

/* ------------------------------------------------------------ configuration */

type Config = {
    timezone: string | null;
    escalation_number: string | null;
    retention_days: number | null;
    intelligence_provider: string | null;
    intelligence_model: string | null;
    max_concurrent_calls: number | null;
    record_calls: boolean;
    byo_intelligence: boolean;
    engines: Array<{ id: string; name: string; allowed: boolean; in_use: boolean }>;
    agents: number;
    flows: number;
    published_flows: number;
    tools: number;
    members: number;
    own_keys: number;
    numbers: Array<{ id: string; number: string; label: string; carrier: string; bound: boolean }>;
};

type TimezoneChoice = { name: string; utc_offset: string };

/**
 * What the timezone and reader fields may be set to.
 *
 * **Fetched, not written here.** Both were free-text boxes over closed sets, and
 * both fail late: a mistyped zone sends a caller to a clinic the flow believes
 * is open, and a mistyped reader fails after the caller has hung up, inside a
 * post-call flow, where the only evidence is a log line.
 *
 * The lists come from the database — `timezone_choices()` reads Postgres's own
 * `pg_timezone_names`, and `reader_choices()` reads the `can_read` columns that
 * `host()` in the bridge works from. A list typed into this file would be a
 * second copy free to disagree with what the server will accept, which is the
 * fault this project keeps recording against itself.
 *
 * The dropdown is the courtesy; `operator_set_tenant_settings` refuses a bad
 * value whatever sends it.
 */
type Choices = {
    timezones: TimezoneChoice[];
    readers: Array<{
        provider_id: string;
        provider_label: string;
        model_id: string;
        model_label: string;
    }>;
};

/**
 * How a workspace is set up — and now, how it is changed.
 *
 * It was a card of read-only values on a screen whose purpose is configuring a
 * tenant. Recording, retention, the escalation number and the concurrency cap
 * are all things an operator legitimately changes on a customer's behalf, and
 * having to reach for SQL to turn recording off is not a policy, it is a
 * missing form.
 *
 * Saved on blur rather than behind a Save button: there is no draft state worth
 * having for four independent settings, and a button implies the four are one
 * transaction when each is its own row update.
 */
const ConfigurationTab = ({ id }: { id: string }) => {
    const { context } = useSession();
    const notify = useNotify();
    const [config, setConfig] = useState<Config | null>(null);
    const [choices, setChoices] = useState<Choices | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState<string | null>(null);

    const load = useCallback(() => {
        if (!context) return;
        api.operatorTenantConfig<Config>(id, context)
            .then(({ data }) => setConfig(data ?? null))
            .catch((problem) => notify.failure("Something went wrong", problem));
    }, [context, id]);

    useEffect(load, [load]);

    // Fetched once and not with `load`: the lists do not change when a setting
    // is saved, and refetching 518 timezones on every keystroke-committed edit
    // is work nobody asked for.
    useEffect(() => {
        if (!context) return;
        api.settingChoices<Choices>(context)
            .then(({ data }) => setChoices(data ?? null))
            // Deliberately quiet. The fields disable themselves without the
            // lists, which says what happened; a toast on a background fetch
            // interrupts somebody editing something else entirely.
            .catch(() => undefined);
    }, [context]);

    // Distinct providers, in the order the server returned them — the query
    // orders by `sort_order`, so the first is the one to offer first.
    const readerProviders = useMemo(() => {
        const seen = new Map<string, { id: string; label: string }>();
        for (const row of choices?.readers ?? []) {
            if (!seen.has(row.provider_id)) {
                seen.set(row.provider_id, { id: row.provider_id, label: row.provider_label });
            }
        }
        return [...seen.values()];
    }, [choices]);

    // `SelectItemType` is the kit's own item shape — `id`, `label`,
    // `supportingText` — so the list is mapped into it once here rather than
    // each row being reshaped at render.
    const timezoneItems = useMemo<SelectItemType[]>(
        () =>
            (choices?.timezones ?? []).map((zone) => ({
                id: zone.name,
                label: zone.name,
                // Already carries its sign. The server formats it, because a
                // "UTC+" written here would be wrong for every zone west of
                // Greenwich.
                supportingText: `UTC${zone.utc_offset}`,
            })),
        [choices],
    );

    const readerModels = useMemo(
        () =>
            (choices?.readers ?? [])
                .filter((row) => row.provider_id === config?.intelligence_provider)
                .map((row) => ({ id: row.model_id, label: row.model_label })),
        [choices, config?.intelligence_provider],
    );

    const save = (patch: Record<string, unknown>, what: string) => {
        if (!context) return;
        setSaving(what);
        setError(null);
        void api
            .operatorSetTenantSettings(id, patch, context)
            .then(load)
            .catch((problem) => notify.failure("Something went wrong", problem))
            .finally(() => setSaving(null));
    };

    if (error && !config) return <p className="text-sm text-error-primary">{error}</p>;
    if (!config) return <p className="text-sm text-tertiary">Loading.</p>;

    const keyless = config.byo_intelligence && config.own_keys === 0;
    const unpublished = config.flows > 0 && config.published_flows === 0;
    const noEngine = config.engines.filter((e) => e.allowed).length === 0;

    return (
        <>
            {keyless || unpublished || config.numbers.length === 0 || noEngine ? (
                <section className="border border-secondary p-5">
                    <h2 className="text-sm font-medium text-primary">
                        This workspace cannot answer a call
                    </h2>
                    <ul className="mt-2 flex flex-col gap-1 text-sm text-tertiary">
                        {config.numbers.length === 0 ? (
                            <li>
                                No number is assigned. Give it one from{" "}
                                <a className="text-brand-secondary underline" href="/platform/numbers">
                                    Numbers
                                </a>
                                .
                            </li>
                        ) : null}
                        {noEngine ? <li>Every engine is denied, so no agent can run.</li> : null}
                        {keyless ? (
                            <li>It brings its own intelligence and has installed no provider key.</li>
                        ) : null}
                        {unpublished ? (
                            <li>
                                {config.flows} flow{config.flows === 1 ? "" : "s"} drawn and none
                                published. A call never reaches a draft.
                            </li>
                        ) : null}
                    </ul>
                </section>
            ) : null}

            {error ? <p className="text-sm text-error-primary">{error}</p> : null}

            <dl className="grid grid-cols-2 gap-px border border-secondary bg-secondary lg:grid-cols-4">
                <Figure label="Members" value={String(config.members)} />
                <Figure label="Agents" value={String(config.agents)} />
                <Figure
                    label="Engines allowed"
                    value={`${config.engines.filter((e) => e.allowed).length} of ${config.engines.length}`}
                />
                <Figure
                    label="Flows"
                    value={String(config.flows)}
                    note={`${config.published_flows} published`}
                />
            </dl>

            {/* **This is what the Entitlements tab became.** Which engines a
                workspace may point an agent at is the one entitlement anything
                reads — `available_engines` filters on it — and it belongs
                beside the rest of the workspace's configuration rather than in
                a tab of its own. */}
            <section className="border border-secondary p-5">
                <h2 className="text-sm font-medium text-primary">Engines</h2>
                <p className="mt-1 text-sm text-tertiary">
                    What this workspace may point an agent at.
                </p>
                <ul className="mt-3 flex flex-col gap-2">
                    {config.engines.map((engine) => (
                        <li
                            key={engine.id}
                            className="flex flex-wrap items-center justify-between gap-3 border border-secondary px-3 py-2"
                        >
                            <span className="flex items-center gap-2">
                                <span className={engine.allowed ? "text-primary" : "text-tertiary"}>
                                    {engine.name}
                                </span>
                                {engine.in_use ? (
                                    <Badge size="sm" color="gray">
                                        in use
                                    </Badge>
                                ) : null}
                            </span>
                            <Toggle
                                isSelected={engine.allowed}
                                isDisabled={saving === engine.id}
                                aria-label={`Allow ${engine.name}`}
                                onChange={(next) => {
                                    if (!context) return;
                                    setSaving(engine.id);
                                    void api
                                        .operatorSetEngineAccess(id, engine.id, next, context)
                                        .then(load)
                                        .catch((p) => notify.failure("Something went wrong", p))
                                        .finally(() => setSaving(null));
                                }}
                            />
                        </li>
                    ))}
                </ul>
                {config.engines.some((e) => e.in_use && !e.allowed) ? (
                    <p className="mt-3 text-sm text-warning-primary">
                        An engine an agent is already using has been denied. That agent will fall
                        back to the server default on its next call.
                    </p>
                ) : null}
            </section>

            <section className="border border-secondary p-5">
                <h2 className="text-sm font-medium text-primary">Numbers</h2>
                <p className="mt-1 text-sm text-tertiary">Bound means a flow answers on it.</p>
                {config.numbers.length === 0 ? (
                    <p className="mt-3 text-sm text-tertiary">None assigned.</p>
                ) : (
                    <ul className="mt-3 flex flex-col gap-2">
                        {config.numbers.map((number) => (
                            <li
                                key={number.id}
                                className="flex flex-wrap items-center gap-3 border border-secondary px-3 py-2"
                            >
                                <span className="font-mono tabular-nums text-primary">
                                    {number.number}
                                </span>
                                <span className="text-sm text-tertiary">{number.label}</span>
                                <span className="text-xs text-quaternary">{number.carrier}</span>
                                <Badge size="sm" color={number.bound ? "success" : "warning"}>
                                    {number.bound ? "bound" : "nothing answers"}
                                </Badge>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className="border border-secondary p-5">
                <h2 className="text-sm font-medium text-primary">Settings</h2>
                <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
                    <Setting
                        label="Recording"
                        hint="Whether the carrier records the call. Turning it off does not delete what is already stored."
                    >
                        <Toggle
                            isSelected={config.record_calls}
                            isDisabled={saving === "record"}
                            aria-label="Record calls"
                            onChange={(next) => save({ record_calls: next }, "record")}
                        />
                    </Setting>

                    <Setting
                        label="Retention"
                        hint="How long a call's content is kept. Empty keeps everything. Stored and swept by nothing yet — this records the intention."
                    >
                        <Editable
                            value={config.retention_days === null ? "" : String(config.retention_days)}
                            placeholder="keeps everything"
                            suffix="days"
                            accepts="digits"
                            busy={saving === "retention"}
                            onCommit={(v) => save({ retention_days: v }, "retention")}
                        />
                    </Setting>

                    <Setting
                        label="Escalation number"
                        hint="Where a failed call is handed off. Empty means the caller hears silence."
                    >
                        <Editable
                            value={config.escalation_number ?? ""}
                            placeholder="none"
                            accepts="phone"
                            busy={saving === "escalation"}
                            onCommit={(v) => save({ escalation_number: v }, "escalation")}
                        />
                    </Setting>

                    <Setting
                        label="Concurrent calls"
                        hint="A cap of our own. The carrier allows three per extension whatever this says."
                    >
                        <Editable
                            value={
                                config.max_concurrent_calls === null
                                    ? ""
                                    : String(config.max_concurrent_calls)
                            }
                            placeholder="not capped"
                            accepts="digits"
                            busy={saving === "concurrency"}
                            onCommit={(v) => save({ max_concurrent_calls: v }, "concurrency")}
                        />
                    </Setting>

                    <Setting
                        label="Timezone"
                        hint="The business day this workspace is measured in — opening hours, the day's call counts, the boundary of a billing period."
                    >
                        {/* A ComboBox rather than a Select: 518 zones is a list
                            you type at, not one you scroll. */}
                        <Select.ComboBox
                            aria-label="Timezone"
                            size="sm"
                            placeholder={config.timezone ?? "not set"}
                            selectedKey={config.timezone ?? null}
                            isDisabled={saving === "timezone" || !choices}
                            items={timezoneItems}
                            onSelectionChange={(key) =>
                                key && key !== config.timezone
                                    ? save({ timezone: String(key) }, "timezone")
                                    : undefined
                            }
                        >
                            {(zone: SelectItemType) => (
                                <Select.Item id={zone.id} supportingText={zone.supportingText}>
                                    {zone.label}
                                </Select.Item>
                            )}
                        </Select.ComboBox>
                    </Setting>

                    {/* Two selects rather than one list of provider·model pairs:
                        the provider is the decision — it is what decides which
                        API the bridge speaks — and the model is a choice within
                        it. Flattening them would read as eight unrelated
                        options. */}
                    <Setting
                        label="Intelligence model"
                        hint="Which model reads a finished call into a shape, for a post-call flow. Only providers serving an API this platform speaks are offered."
                    >
                        <span className="flex flex-wrap items-center gap-2">
                            <Select
                                aria-label="Intelligence provider"
                                size="sm"
                                placeholder="not set"
                                selectedKey={config.intelligence_provider ?? null}
                                isDisabled={saving === "reader" || !choices}
                                items={readerProviders}
                                onSelectionChange={(key) => {
                                    if (!key || key === config.intelligence_provider) return;
                                    // The stored model belongs to the old
                                    // provider and the database refuses the
                                    // pair, so the first model of the new one
                                    // goes with it. Saving the provider alone
                                    // would fail on a rule the reader cannot
                                    // see.
                                    const first = choices?.readers.find(
                                        (row) => row.provider_id === key,
                                    );
                                    save(
                                        {
                                            intelligence_provider: String(key),
                                            intelligence_model: first?.model_id ?? null,
                                        },
                                        "reader",
                                    );
                                }}
                            >
                                {(row: SelectItemType) => (
                                    <Select.Item id={row.id}>{row.label}</Select.Item>
                                )}
                            </Select>
                            <Select
                                aria-label="Intelligence model"
                                size="sm"
                                placeholder="model"
                                selectedKey={config.intelligence_model ?? null}
                                isDisabled={
                                    saving === "reader" || !config.intelligence_provider || !choices
                                }
                                items={readerModels}
                                onSelectionChange={(key) =>
                                    key && key !== config.intelligence_model
                                        ? save({
                                              // Sent together: the check is on
                                              // the pair, and a model with no
                                              // provider named is refused.
                                              intelligence_provider: config.intelligence_provider,
                                              intelligence_model: String(key),
                                          }, "reader")
                                        : undefined
                                }
                            >
                                {(row: SelectItemType) => (
                                    <Select.Item id={row.id}>{row.label}</Select.Item>
                                )}
                            </Select>
                        </span>
                    </Setting>
                </div>
            </section>
        </>
    );
};

/* ------------------------------------------------------------------ members */

type Member = {
    membership_id: string;
    user_id: string | null;
    email: string | null;
    display_name: string | null;
    role: string;
    invited_email: string | null;
    last_sign_in: string | null;
    is_operator: boolean;
    /** A service account, not a person. See migration 0102. */
    is_machine: boolean;
    joined: string;
};

/**
 * The people in a workspace, and how to get one of them back in.
 *
 * There was no route for a locked-out customer at all. Accounts here are made
 * by invitation — a link — so nobody has ever chosen a password, and until now
 * an operator could neither send another link nor set one.
 *
 * A link is offered first because it needs no secret to travel between two
 * people. A password is for the case where their mail is the thing that is
 * broken.
 */
const MembersTab = ({ id }: { id: string }) => {
    const { context } = useSession();
    const notify = useNotify();
    const [members, setMembers] = useState<Member[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [settingPassword, setSettingPassword] = useState<Member | null>(null);
    const [removing, setRemoving] = useState<Member | null>(null);

    const load = useCallback(() => {
        if (!context) return;
        api.operatorMembers<Member>(id, context)
            .then(({ data }) => setMembers(data ?? []))
            .catch((problem) => notify.failure("Something went wrong", problem));
    }, [context, id]);

    useEffect(load, [load]);

    const act = (member: Member, action: "send_link" | "remove") => {
        if (!context) return;
        setBusy(member.membership_id);
        setError(null);
        setNote(null);
        void api
            .operatorMemberAction<{ sent?: boolean; reason?: string }>(
                id,
                action === "send_link"
                    ? { action, email: member.email ?? member.invited_email ?? "" }
                    : { action, membership_id: member.membership_id },
                context,
            )
            .then(({ data }) => {
                if (action === "send_link") {
                    setNote(
                        data?.sent
                            ? `A sign-in link is on its way to ${member.email ?? member.invited_email}.`
                            : `The link was not sent — ${data?.reason ?? "no reason given"}.`,
                    );
                }
                load();
            })
            .catch((problem) => notify.failure("Something went wrong", problem))
            .finally(() => setBusy(null));
    };

    if (error && !members) return <p className="text-sm text-error-primary">{error}</p>;
    if (!members) return <p className="text-sm text-tertiary">Loading.</p>;

    return (
        <>
            {error ? <p className="text-sm text-error-primary">{error}</p> : null}
            {note ? <p className="border border-secondary p-3 text-sm text-secondary">{note}</p> : null}

            <ul className="flex flex-col gap-2">
                {members.map((member) => (
                    <li
                        key={member.membership_id}
                        className="flex flex-wrap items-center justify-between gap-3 border border-secondary bg-primary p-4"
                    >
                        <div className="min-w-0">
                            <p className="flex items-center gap-2 text-primary">
                                {member.display_name ?? member.email ?? member.invited_email ?? "—"}
                                <Badge size="sm" color="gray">
                                    {member.role}
                                </Badge>
                                {member.is_operator ? (
                                    <Badge size="sm" color="brand">
                                        operator
                                    </Badge>
                                ) : null}
                                {member.is_machine ? (
                                    <Badge size="sm" color="gray">
                                        service account
                                    </Badge>
                                ) : !member.user_id ? (
                                    <Badge size="sm" color="warning">
                                        invited, never signed in
                                    </Badge>
                                ) : null}
                            </p>
                            <p className="mt-0.5 text-xs text-quaternary">
                                {member.is_machine
                                    ? "Signs API requests. Not a person, and it has no mailbox."
                                    : (member.email ?? member.invited_email ?? "no address") +
                                      (member.last_sign_in
                                          ? ` · last signed in ${new Date(member.last_sign_in).toLocaleDateString()}`
                                          : " · never signed in")}
                            </p>
                        </div>

                        {/* **A fixed-width action cell, so the icons line up
                            down the column.** Rows carry different numbers of
                            actions — a service account has none, an operator
                            cannot have a password set — and left to itself each
                            row's buttons ended at a different place, which is
                            what made a column of text links look ragged.

                            Icons rather than words for the same reason as the
                            keys screen: "Send sign-in link" repeated down four
                            rows is the widest thing in the column and says
                            nothing the icon does not. `ButtonUtility` carries
                            the tooltip and the accessible name with it. */}
                        <div className="flex w-24 shrink-0 items-center justify-end gap-1">
                            {member.is_machine ? (
                                // Nothing to offer. It has no mailbox and
                                // nothing signs in as it — the row exists so
                                // the workspace's API identity is visible, not
                                // so somebody can act on it.
                                <span className="text-xs text-quaternary">no actions</span>
                            ) : (
                                <>
                                    <ButtonUtility
                                        size="xs"
                                        color="tertiary"
                                        icon={IconNotifiers}
                                        tooltip="Email them a sign-in link"
                                        isDisabled={busy === member.membership_id}
                                        onClick={() => act(member, "send_link")}
                                    />
                                    {/* Absent, not disabled, on an operator:
                                        the database refuses it, and offering a
                                        control that will be refused is worse
                                        than offering none. */}
                                    {member.user_id && !member.is_operator ? (
                                        <ButtonUtility
                                            size="xs"
                                            color="tertiary"
                                            icon={IconApiKeys}
                                            tooltip="Set a password for them"
                                            onClick={() => setSettingPassword(member)}
                                        />
                                    ) : null}
                                    <ButtonUtility
                                        size="xs"
                                        color="tertiary"
                                        icon={Trash01}
                                        tooltip="Remove from this workspace"
                                        isDisabled={busy === member.membership_id}
                                        onClick={() => setRemoving(member)}
                                    />
                                </>
                            )}
                        </div>
                    </li>
                ))}
            </ul>

            {removing ? (
                <ConfirmDialog
                    title={`Remove ${removing.display_name ?? removing.email ?? "this member"}?`}
                    body={
                        <>
                            They lose access to this workspace immediately. The account itself is
                            kept — they may belong to others — so this can be undone by inviting
                            them back.
                        </>
                    }
                    confirmLabel="Remove"
                    isBusy={busy === removing.membership_id}
                    onCancel={() => setRemoving(null)}
                    onConfirm={() => {
                        const member = removing;
                        setRemoving(null);
                        act(member, "remove");
                    }}
                />
            ) : null}

            {settingPassword ? (
                <SetPasswordDialog
                    id={id}
                    member={settingPassword}
                    onClose={() => setSettingPassword(null)}
                    onDone={() => {
                        setSettingPassword(null);
                        setNote("Password set. Ask them to change it once they are in.");
                        load();
                    }}
                />
            ) : null}
        </>
    );
};

const SetPasswordDialog = ({
    id,
    member,
    onClose,
    onDone,
}: {
    id: string;
    member: Member;
    onClose: () => void;
    onDone: () => void;
}) => {
    const { context } = useSession();
    const notify = useNotify();
    const [password, setPassword] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Twelve is what the database enforces. Checked here as well so somebody
    // is told before they press the button, never instead of.
    const valid = password.trim().length >= 12;

    return (
        <ModalOverlay isOpen onOpenChange={(o) => !o && onClose()}>
            <Modal className="max-w-md">
                <Dialog>
                    <div className="flex w-full flex-col bg-primary p-6 shadow-xl ring-1 ring-secondary">
                        <h2 className="text-lg font-semibold text-primary">
                            Password for {member.display_name ?? member.email}
                        </h2>
                        <p className="mt-1 text-sm text-tertiary">
                            For somebody whose email is the thing that is broken. A sign-in link is
                            the better route when it works, because it travels without a secret
                            passing between two people.
                        </p>
                        <div className="mt-5">
                            <Input
                                label="New password"
                                type="password"
                                value={password}
                                onChange={setPassword}
                                autoFocus
                                hint="At least 12 characters. You will need to read it to them, so they should change it once they are in."
                            />
                        </div>
                        {error ? <p className="mt-4 text-sm text-error-primary">{error}</p> : null}
                        <div className="mt-6 flex justify-end gap-3">
                            <Button size="sm" color="secondary" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                isDisabled={!valid}
                                isLoading={saving}
                                onClick={() => {
                                    if (!context || !member.user_id) return;
                                    setSaving(true);
                                    setError(null);
                                    void api
                                        .operatorMemberAction(
                                            id,
                                            {
                                                action: "set_password",
                                                user_id: member.user_id,
                                                password: password.trim(),
                                            },
                                            context,
                                        )
                                        .then(onDone)
                                        .catch((problem) => {
                                            notify.failure("Something went wrong", problem);
                                            setSaving(false);
                                        });
                                }}
                            >
                                Set it
                            </Button>
                        </div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
};

/* ------------------------------------------------------------------- pieces */

const Figure = ({ label, value, note }: { label: string; value: string; note?: string }) => (
    <div className="bg-primary px-4 py-4">
        <dt className="text-xs tracking-wide text-quaternary uppercase">{label}</dt>
        <dd className="mt-1 text-display-xs font-light tabular-nums text-primary">{value}</dd>
        {note ? <p className="mt-0.5 text-xs text-quaternary">{note}</p> : null}
    </div>
);

const Row = ({ label, value, note }: { label: string; value: string; note?: string }) => (
    <div>
        <dt className="text-xs tracking-wide text-quaternary uppercase">{label}</dt>
        <dd className="mt-1 text-sm text-primary">{value}</dd>
        {note ? <p className="mt-0.5 text-xs text-quaternary">{note}</p> : null}
    </div>
);

/** Hours and minutes; seconds alone stop being readable after about a minute. */
function formatDuration(seconds: number): string {
    if (seconds <= 0) return "—";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    if (hours === 0) return `${minutes}m`;
    return `${hours}h ${minutes}m`;
}

/** A label, an explanation, and whatever changes it. */
const Setting = ({
    label,
    hint,
    children,
}: {
    label: string;
    hint: string;
    children: React.ReactNode;
}) => (
    <div>
        <dt className="flex items-center gap-1 text-xs tracking-wide text-quaternary uppercase">
            {label}
            <InfoHint title={label} description={hint} />
        </dt>
        <dd className="mt-1.5">{children}</dd>
    </div>
);

/**
 * A value that saves when you leave it.
 *
 * **The kit's `Input`, styled — not a bare `<input>` with borrowed border
 * classes**, which is what this was. The compact look is kept through
 * `size="sm"` and `wrapperClassName`; what it gains is everything the kit
 * already decided: the focus ring, the disabled treatment, the invalid state,
 * and the field sizing every other input on the screen uses.
 *
 * The rule this follows is the one `vokoo-brand.css` already states for
 * colour — style the component, do not re-implement it. A hand-rolled control
 * looks right on the day it is written and drifts from every other one after.
 *
 * Commits on blur and on Enter, reverts on Escape. No Save button: these are
 * independent settings, and a button would imply they are one transaction.
 *
 * `accepts` filters what can be typed. Three of these five settings are numbers
 * — a day count, a call cap and a phone number — and all three were taking
 * letters, which the database then refused after the field had been left.
 */
const Editable = ({
    value,
    placeholder,
    suffix,
    busy,
    accepts,
    onCommit,
}: {
    value: string;
    placeholder: string;
    suffix?: string;
    busy?: boolean;
    accepts?: "digits" | "phone";
    onCommit: (next: string) => void;
}) => {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);

    const clean =
        accepts === "digits" ? keepDigits : accepts === "phone" ? keepPhone : (v: string) => v;

    return (
        <span className="flex items-center gap-2">
            <Input
                aria-label={placeholder}
                size="sm"
                value={draft}
                placeholder={placeholder}
                isDisabled={busy}
                {...(accepts === "phone"
                    ? PHONE_INPUT
                    : accepts === "digits"
                      ? NUMERIC_INPUT
                      : {})}
                onChange={(next) => setDraft(clean(next))}
                onBlur={() => draft !== value && onCommit(draft)}
                onKeyDown={(event) => {
                    const field = event.target as HTMLInputElement;
                    if (event.key === "Enter") field.blur();
                    if (event.key === "Escape") {
                        setDraft(value);
                        field.blur();
                    }
                }}
                wrapperClassName="w-40"
            />
            {suffix ? <span className="text-xs text-quaternary">{suffix}</span> : null}
        </span>
    );
};

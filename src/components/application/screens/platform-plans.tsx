"use client";

/**
 * The price list, and what each workspace owes this month.
 *
 * Prices were worked out in a spreadsheet against measured cost — ₹2.34 a
 * minute on a booking call that completed, plus a margin for a sample of two.
 * A spreadsheet is a good place to work a price out and a bad place to keep
 * one: nothing enforced it, nothing displayed it, and the two plan summaries
 * were describing an allowance that did not exist.
 *
 * ## Price is configured; cost is measured
 *
 * The line this screen holds. There is no cost field here and there will not
 * be one: costs are read off vendors' pages into `catalogue_vendor_rates`, and
 * margin is computed from the two. The moment a cost becomes editable beside a
 * price, somebody types one and every margin figure afterwards is invented.
 *
 * ## The one check the screen does itself
 *
 * Overage has to sit above the in-plan rate. Below it, a customer who exceeds
 * their allowance is better off staying over than moving up a tier — which is
 * backwards, since a heavier customer on a bigger plan is the whole point. The
 * first version of this pricing got it wrong in exactly that direction, so the
 * comparison is on screen rather than in somebody's head.
 */

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/base/badges/badges";
import { Input } from "@/components/base/input/input";
import { InfoHint } from "@/components/base/tooltip/info-hint";
import { api } from "@/utils/api-client";
import { useNotify } from "@/components/application/notifications/notification-provider";
import { useSession } from "@/hooks/use-session";

type Plan = {
    id: string;
    label: string;
    summary: string;
    price: number | null;
    currency: string;
    included_minutes: number | null;
    included_numbers: number;
    overage_per_minute: number | null;
    is_active: boolean;
    workspaces: number;
    effective_per_min: number | null;
};

type Period = {
    org_id: string;
    org_name: string;
    plan_id: string | null;
    price: number | null;
    currency: string | null;
    included_minutes: number | null;
    used_minutes: number | null;
    overage_minutes: number | null;
    overage_charge: number | null;
    total: number | null;
    starts_at: string | null;
    ends_at: string | null;
};

export const PlatformPlansScreen = () => {
    const { context, isReady } = useSession();
    const notify = useNotify();
    const [plans, setPlans] = useState<Plan[] | null>(null);
    const [periods, setPeriods] = useState<Period[] | null>(null);
    const [saving, setSaving] = useState<string | null>(null);

    const load = useCallback(() => {
        if (!context) return;
        api.operatorPlans<Plan>(context)
            .then(({ data }) => setPlans(data ?? []))
            .catch((problem) => notify.failure("Something went wrong", problem));
        api.operatorPeriods<Period>(context)
            .then(({ data }) => setPeriods(data ?? []))
            .catch(() => setPeriods([]));
    }, [context]);

    useEffect(() => {
        if (isReady && context) load();
    }, [isReady, context, load]);

    const save = (id: string, patch: Record<string, unknown>) => {
        if (!context) return;
        setSaving(id);
        void api
            .operatorSetPlan(id, patch, context)
            .then(load)
            .catch((problem) => notify.failure("Something went wrong", problem))
            .finally(() => setSaving(null));
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <header className="flex shrink-0 flex-col gap-1 p-6 pb-4 lg:px-8 lg:pt-8">
                <h1 className="text-display-xs font-semibold text-primary">Plans</h1>
                <p className="max-w-2xl text-sm text-tertiary">
                    What a workspace pays, and what that buys. No workspace can see this.
                </p>
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto p-6 pt-0 lg:px-8 lg:pb-8">

                <div className="overflow-x-auto border border-secondary">
                    <table className="w-full min-w-[62rem] border-collapse text-sm">
                        <thead>
                            <tr className="border-b border-secondary bg-secondary text-left">
                                {["Plan", "Price", "Minutes", "In-plan ₹/min", "Overage ₹/min", "Numbers", "On it"].map(
                                    (h) => (
                                        <th
                                            key={h}
                                            scope="col"
                                            className="px-4 py-2.5 text-xs font-medium text-tertiary"
                                        >
                                            {h}
                                        </th>
                                    ),
                                )}
                            </tr>
                        </thead>
                        <tbody>
                            {(plans ?? []).map((plan) => {
                                // The check that matters, done where it is read.
                                const inverted =
                                    plan.effective_per_min !== null &&
                                    plan.overage_per_minute !== null &&
                                    Number(plan.overage_per_minute) <= Number(plan.effective_per_min);

                                return (
                                    <tr key={plan.id} className="border-b border-secondary last:border-0">
                                        <td className="px-4 py-3">
                                            <span className="text-primary">{plan.label}</span>
                                            {!plan.is_active ? (
                                                <Badge size="sm" color="gray" className="ml-2">
                                                    withdrawn
                                                </Badge>
                                            ) : null}
                                            <p className="mt-0.5 text-xs text-quaternary">{plan.summary}</p>
                                        </td>
                                        <Cell>
                                            <Money
                                                value={plan.price}
                                                currency={plan.currency}
                                                busy={saving === plan.id}
                                                onCommit={(v) => save(plan.id, { price: v })}
                                            />
                                        </Cell>
                                        <Cell>
                                            <Money
                                                value={plan.included_minutes}
                                                busy={saving === plan.id}
                                                onCommit={(v) => save(plan.id, { included_minutes: v })}
                                            />
                                        </Cell>
                                        <td className="px-4 py-3 tabular-nums text-tertiary">
                                            {plan.effective_per_min ?? "—"}
                                        </td>
                                        <Cell>
                                            <span className="flex items-center gap-1.5">
                                                <Money
                                                    value={plan.overage_per_minute}
                                                    busy={saving === plan.id}
                                                    onCommit={(v) =>
                                                        save(plan.id, { overage_per_minute: v })
                                                    }
                                                />
                                                {inverted ? (
                                                    <InfoHint
                                                        title="Below the in-plan rate"
                                                        description="A customer over their allowance is paying less per minute than one inside it, so going over is cheaper than moving up a tier. Raise this above the in-plan rate."
                                                        className="text-warning-primary"
                                                    />
                                                ) : null}
                                            </span>
                                        </Cell>
                                        <Cell>
                                            <Money
                                                value={plan.included_numbers}
                                                busy={saving === plan.id}
                                                onCommit={(v) => save(plan.id, { included_numbers: v })}
                                            />
                                        </Cell>
                                        <td className="px-4 py-3 tabular-nums text-tertiary">
                                            {plan.workspaces}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {plans === null ? <p className="text-sm text-tertiary">Loading.</p> : null}

                <section className="flex flex-col gap-3">
                    <h2 className="text-xs font-bold tracking-wide text-quaternary uppercase">
                        This month
                    </h2>
                    <div className="overflow-x-auto border border-secondary">
                        <table className="w-full min-w-[52rem] border-collapse text-sm">
                            <thead>
                                <tr className="border-b border-secondary bg-secondary text-left">
                                    {["Workspace", "Plan", "Used", "Allowance", "Overage", "Owed"].map((h) => (
                                        <th
                                            key={h}
                                            scope="col"
                                            className="px-4 py-2.5 text-xs font-medium text-tertiary"
                                        >
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {(periods ?? []).map((p) => (
                                    <tr key={p.org_id} className="border-b border-secondary last:border-0">
                                        <td className="px-4 py-3 text-primary">{p.org_name}</td>
                                        <td className="px-4 py-3 text-tertiary">
                                            {p.plan_id ?? (
                                                // No open period is a real state
                                                // and a fixable one, so it says
                                                // so rather than showing blanks.
                                                <span className="text-warning-primary">
                                                    no open period
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 tabular-nums text-primary">
                                            {p.used_minutes ?? "—"}
                                        </td>
                                        <td className="px-4 py-3 tabular-nums text-tertiary">
                                            {p.included_minutes ?? "unmetered"}
                                        </td>
                                        <td className="px-4 py-3 tabular-nums text-tertiary">
                                            {p.overage_minutes ? `${p.overage_minutes} min` : "—"}
                                        </td>
                                        <td className="px-4 py-3 tabular-nums text-primary">
                                            {p.total === null
                                                ? "—"
                                                : `${p.currency ?? "INR"} ${Number(p.total).toFixed(0)}`}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {/* Said plainly because it is the difference between a
                        billing system and a screen that looks like one. */}
                    <p className="text-sm text-quaternary">
                        Periods do not roll over on their own yet — nothing closes September and
                        opens October. Until that job exists, a period is opened from the
                        workspace&rsquo;s own Billing tab.
                    </p>
                </section>
            </div>
        </div>
    );
};

const Cell = ({ children }: { children: React.ReactNode }) => (
    <td className="px-4 py-3">{children}</td>
);

/**
 * A number that saves when you leave it.
 *
 * The kit's `Input`, styled to sit in a table cell — same reasoning as
 * `Editable` on the tenant screen: style the component, do not re-implement it.
 *
 * Blank is meaningful and is kept: a null allowance is an unmetered contract,
 * which is not the same as an allowance of zero.
 */
const Money = ({
    value,
    currency,
    busy,
    onCommit,
}: {
    value: number | null;
    currency?: string;
    busy?: boolean;
    onCommit: (next: string) => void;
}) => {
    const asText = value === null || value === undefined ? "" : String(value);
    const [draft, setDraft] = useState(asText);
    useEffect(() => setDraft(asText), [asText]);

    return (
        <span className="flex items-center gap-1">
            {currency ? <span className="text-xs text-quaternary">{currency}</span> : null}
            <Input
                aria-label="Amount"
                size="sm"
                value={draft}
                placeholder="—"
                isDisabled={busy}
                inputMode="decimal"
                onChange={setDraft}
                onBlur={() => draft !== asText && onCommit(draft)}
                onKeyDown={(event) => {
                    const field = event.target as HTMLInputElement;
                    if (event.key === "Enter") field.blur();
                    if (event.key === "Escape") {
                        setDraft(asText);
                        field.blur();
                    }
                }}
                wrapperClassName="w-24"
                inputClassName="tabular-nums"
            />
        </span>
    );
};

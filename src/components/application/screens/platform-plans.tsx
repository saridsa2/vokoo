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
 * ## A plan somebody is on cannot be edited
 *
 * `billing_periods` snapshots the terms when it opens, so an edit never
 * rewrites a period already running — but it does silently change what the
 * customer pays next month, with nothing recording that the deal moved. The
 * database refuses it (0105); the screen shows the fields as read-only rather
 * than letting somebody type into one and be told afterwards.
 *
 * Raising a price is a new plan and a move at a period boundary. That is more
 * work, and it is the work.
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
import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Plus } from "@/components/icons";
import { Input } from "@/components/base/input/input";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { DECIMAL_INPUT, keepDecimal, keepDigits, NUMERIC_INPUT } from "@/utils/numeric-input";
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
    /** Public names of the engines this plan includes. */
    engines: string[];
    /** Somebody is on it, so the terms are settled. From the database, not
        derived here — the rule has one statement. */
    is_locked: boolean;
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
    const [adding, setAdding] = useState(false);

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
            <header className="flex shrink-0 flex-wrap items-end justify-between gap-4 p-6 pb-4 lg:px-8 lg:pt-8">
                <div className="flex flex-col gap-1">
                    <h1 className="text-display-xs font-semibold text-primary">Plans</h1>
                    <p className="max-w-2xl text-sm text-tertiary">
                        What a workspace pays, and what that buys. No workspace can see this.
                    </p>
                </div>
                <Button size="sm" iconLeading={Plus} onClick={() => setAdding(true)}>
                    Add plan
                </Button>
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto p-6 pt-0 lg:px-8 lg:pb-8">

                <div className="overflow-x-auto border border-secondary">
                    <table className="w-full min-w-[62rem] border-collapse text-sm">
                        <thead>
                            <tr className="border-b border-secondary bg-secondary text-left">
                                {["Plan", "Price", "Minutes", "In-plan ₹/min", "Overage ₹/min", "Numbers", "Engines", "On it"].map(
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
                                                locked={plan.is_locked}
                                                onCommit={(v) => save(plan.id, { price: v })}
                                            />
                                        </Cell>
                                        <Cell>
                                            <Money
                                                value={plan.included_minutes}
                                                busy={saving === plan.id}
                                                locked={plan.is_locked}
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
                                                    locked={plan.is_locked}
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
                                                locked={plan.is_locked}
                                                onCommit={(v) => save(plan.id, { included_numbers: v })}
                                            />
                                        </Cell>
                                        {/* Named, not counted. "3 engines" does
                                            not answer whether the one this
                                            customer needs is among them — and a
                                            plan with none cannot answer a call
                                            at all, so that says so. */}
                                        <td className="px-4 py-3">
                                            {plan.engines.length === 0 ? (
                                                <span className="text-xs text-warning-primary">
                                                    none — cannot answer a call
                                                </span>
                                            ) : (
                                                <span className="flex flex-wrap gap-1">
                                                    {plan.engines.map((engine) => (
                                                        <Badge key={engine} size="sm" color="gray">
                                                            {engine}
                                                        </Badge>
                                                    ))}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 tabular-nums text-tertiary">
                                            <span className="flex items-center gap-1.5">
                                                {plan.workspaces}
                                                {plan.is_locked ? (
                                                    <InfoHint
                                                        title="Settled"
                                                        description="Somebody is on this plan, so its terms cannot change — they agreed to them. Raising a price means a new plan and moving the workspace to it at the end of its billing period. Withdrawing it from new sign-ups is still allowed."
                                                    />
                                                ) : null}
                                            </span>
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
                </section>
            </div>

            {adding ? (
                <AddPlan
                    onClose={() => setAdding(false)}
                    onAdded={() => {
                        setAdding(false);
                        load();
                    }}
                />
            ) : null}
        </div>
    );
};

/**
 * A new plan.
 *
 * Asks for the id first because it is the one thing that can never be changed —
 * `organizations.plan` and `plan_entitlements.plan_id` both store it, so
 * renaming it would orphan every workspace on it. The label beside it is what
 * anybody reads and can be changed freely until somebody is on the plan.
 *
 * **Created withdrawn.** A plan appears the moment it exists, and one made
 * half-filled must not be sellable while its engines are still being picked.
 * Activating it is a second, deliberate click on the row.
 */
const AddPlan = ({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) => {
    const { context } = useSession();
    const notify = useNotify();
    const [id, setId] = useState("");
    const [label, setLabel] = useState("");
    const [summary, setSummary] = useState("");
    const [price, setPrice] = useState("");
    const [minutes, setMinutes] = useState("");
    const [overage, setOverage] = useState("");
    const [numbers, setNumbers] = useState("1");
    const [engines, setEngines] = useState<string[]>([]);
    const [offered, setOffered] = useState<Array<{ id: string; name: string }> | null>(null);
    const [saving, setSaving] = useState(false);

    // The platform's own engines, which is what a plan may include. Fetched
    // rather than typed, for the reason every list on this portal is.
    useEffect(() => {
        if (!context) return;
        api.operatorEngines<{ id: string; public_name: string | null; name: string }>(context)
            .then(({ data }) =>
                setOffered(
                    (data ?? [])
                        .filter((engine) => engine.public_name)
                        .map((engine) => ({ id: engine.id, name: engine.public_name as string })),
                ),
            )
            .catch(() => setOffered([]));
    }, [context]);

    // Matches `operator_create_plan`, so the button is refused here rather than
    // by a message after the dialog has been filled in.
    const idOk = /^[a-z][a-z0-9-]{1,30}$/.test(id);
    const ready = idOk && label.trim() !== "";

    // Shown while typing, for the same reason the table shows it: a plan whose
    // overage sits below its in-plan rate rewards a customer for going over.
    const perMin =
        Number(price) > 0 && Number(minutes) > 0
            ? Math.round((Number(price) / Number(minutes)) * 100) / 100
            : null;
    const inverted = perMin !== null && overage !== "" && Number(overage) <= perMin;

    return (
        <ModalOverlay isOpen onOpenChange={(open) => !open && onClose()}>
            <Modal className="max-w-lg">
                <Dialog>
                    <div className="flex max-h-[85vh] w-full flex-col overflow-y-auto bg-primary p-6 shadow-xl ring-1 ring-secondary">
                        <h2 className="text-lg font-semibold text-primary">Add a plan</h2>
                        <p className="mt-1 text-sm text-tertiary">
                            It starts withdrawn. Activate it when its engines are right.
                        </p>

                        <div className="mt-5 flex flex-col gap-4">
                            <Input
                                label="Id"
                                value={id}
                                onChange={(next) => setId(next.toLowerCase())}
                                autoFocus
                                isInvalid={Boolean(id) && !idOk}
                                hint={
                                    id && !idOk
                                        ? "Lowercase letters, digits and hyphens, starting with a letter."
                                        : "Stored on every workspace, so it can never be changed. Like enterprise or clinic-plus."
                                }
                            />
                            <Input
                                label="Name"
                                value={label}
                                onChange={setLabel}
                                hint="What this is called on an invoice."
                            />
                            <Input
                                label="Summary"
                                value={summary}
                                onChange={setSummary}
                                hint="One line. Who it is for."
                            />

                            <div className="grid grid-cols-2 gap-4">
                                <Input
                                    label="Price (INR)"
                                    value={price}
                                    onChange={(next) => setPrice(keepDecimal(next))}
                                    {...DECIMAL_INPUT}
                                    hint="Per billing period."
                                />
                                <Input
                                    label="Included minutes"
                                    value={minutes}
                                    onChange={(next) => setMinutes(keepDigits(next))}
                                    {...NUMERIC_INPUT}
                                    hint="Empty is unmetered."
                                />
                                <Input
                                    label="Overage (INR/min)"
                                    value={overage}
                                    onChange={(next) => setOverage(keepDecimal(next))}
                                    {...DECIMAL_INPUT}
                                    isInvalid={inverted}
                                    hint={
                                        inverted
                                            ? `Below the in-plan rate of ${perMin}. Going over would be cheaper than moving up a tier.`
                                            : perMin !== null
                                              ? `In plan, a minute costs ${perMin}.`
                                              : "Charged past the allowance."
                                    }
                                />
                                <Input
                                    label="Numbers included"
                                    value={numbers}
                                    onChange={(next) => setNumbers(keepDigits(next))}
                                    {...NUMERIC_INPUT}
                                    hint="Phone lines in the price."
                                />
                            </div>

                            {/* Without at least one, `available_engines` offers
                                a workspace on this plan nothing and it cannot
                                answer a call. Said here rather than discovered
                                by the first customer. */}
                            <fieldset className="flex flex-col gap-2">
                                <legend className="text-sm font-medium text-secondary">
                                    Engines
                                </legend>
                                {offered === null ? (
                                    <p className="text-sm text-tertiary">Loading.</p>
                                ) : offered.length === 0 ? (
                                    <p className="text-sm text-warning-primary">
                                        No engine has a customer-facing name yet, so none can be
                                        included. Give one a public name on Engines first.
                                    </p>
                                ) : (
                                    <div className="flex flex-col gap-2 border border-secondary p-3">
                                        {offered.map((engine) => (
                                            <Checkbox
                                                key={engine.id}
                                                label={engine.name}
                                                isSelected={engines.includes(engine.id)}
                                                onChange={(on) =>
                                                    setEngines((current) =>
                                                        on
                                                            ? [...current, engine.id]
                                                            : current.filter((x) => x !== engine.id),
                                                    )
                                                }
                                            />
                                        ))}
                                    </div>
                                )}
                                {offered !== null && offered.length > 0 && engines.length === 0 ? (
                                    <p className="text-xs text-warning-primary">
                                        With none, a workspace on this plan cannot answer a call.
                                    </p>
                                ) : null}
                            </fieldset>
                        </div>

                        <div className="mt-6 flex justify-end gap-3">
                            <Button size="sm" color="secondary" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                isDisabled={!ready}
                                isLoading={saving}
                                onClick={() => {
                                    if (!context) return;
                                    setSaving(true);
                                    void api
                                        .operatorCreatePlan(
                                            {
                                                id,
                                                label: label.trim(),
                                                summary: summary.trim(),
                                                price,
                                                included_minutes: minutes,
                                                overage_per_minute: overage,
                                                included_numbers: numbers,
                                                engines,
                                            },
                                            context,
                                        )
                                        .then(onAdded)
                                        .catch((problem) =>
                                            notify.failure("Something went wrong", problem),
                                        )
                                        .finally(() => setSaving(false));
                                }}
                            >
                                Add plan
                            </Button>
                        </div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
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
    locked,
    onCommit,
}: {
    value: number | null;
    currency?: string;
    busy?: boolean;
    /** The plan is in use, so this is a fact rather than a field. */
    locked?: boolean;
    onCommit: (next: string) => void;
}) => {
    const asText = value === null || value === undefined ? "" : String(value);
    const [draft, setDraft] = useState(asText);
    useEffect(() => setDraft(asText), [asText]);

    // Text, not a disabled input. A greyed-out box still reads as a field that
    // is temporarily unavailable; this is a number that is settled, and the row
    // should look like a record rather than a form nobody may fill in.
    if (locked) {
        return (
            <span className="flex items-center gap-1 tabular-nums text-tertiary">
                {currency ? <span className="text-xs text-quaternary">{currency}</span> : null}
                {asText === "" ? "—" : asText}
            </span>
        );
    }

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
                // `inputMode` asks a phone for the right keypad and refuses a
                // desktop keyboard nothing, so the filter is what actually
                // keeps letters out of a price.
                onChange={(next) => setDraft(keepDecimal(next))}
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

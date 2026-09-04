"use client";

/**
 * The engines the platform sells, and what each one is sold for.
 *
 * This is the price list. An engine is which model hears, which thinks, which
 * speaks and in what order — the product — so it belongs here rather than in a
 * customer's console, and since 0091 the database agrees: a tenant reads no row
 * of `engines` at all.
 *
 * ## Two names, and the second one is the one that leaks
 *
 * `name` is yours: `Hindi relay (Sarvam)`, useful for telling two chains apart.
 * `public_name` is the customer's: `Hindi`. An engine with no public name is
 * offered to nobody, which is the safe failure — a missing dropdown entry is
 * noticed, a vendor's name in a customer's picker is not.
 *
 * The card shows both, with the customer-facing one first, because that is the
 * one you have to get right and the one that is easy to forget.
 *
 * ## Why the price sits beside the volume
 *
 * A price per minute means nothing without the minutes it applies to. Setting
 * one while looking at "25 sessions, 12.4 minutes" is a different act from
 * setting one on an empty form.
 */
import { useCallback, useEffect, useState } from "react";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { InfoHint } from "@/components/base/tooltip/info-hint";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { useNotify } from "@/components/application/notifications/notification-provider";
import { useSession } from "@/hooks/use-session";
import { api } from "@/utils/api-client";

type Engine = {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    public_name: string | null;
    public_description: string | null;
    mode: string;
    status: string;
    price_per_minute: number | null;
    price_per_call: number | null;
    price_currency: string;
    sessions_30d: number;
    minutes_30d: number;
    workspaces: number;
};

export const PlatformEnginesScreen = () => {
    const { context, isReady } = useSession();
    const notify = useNotify();
    const [engines, setEngines] = useState<Engine[] | null>(null);
    const [pricing, setPricing] = useState<Engine | null>(null);
    const [creating, setCreating] = useState(false);

    const load = useCallback(() => {
        if (!context) return;
        api.operatorEngines<Engine>(context)
            .then(({ data }) => setEngines(data ?? []))
            .catch((problem) => notify.failure("Something went wrong", problem));
    }, [context]);

    useEffect(() => {
        if (isReady && context) load();
    }, [isReady, context, load]);

    const unpriced = (engines ?? []).filter((e) => e.status === "published" && e.price_per_minute === null && e.price_per_call === null).length;
    const unnamed = (engines ?? []).filter((e) => !e.public_name).length;

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* The title and New Engine stay put; the cards move under them.
                A header that scrolls away takes the only way to add an engine
                with it, and on a long list that means scrolling back up to
                reach a control that was never meant to leave. */}
            <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 p-6 pb-4 lg:px-8 lg:pt-8">
                <div className="max-w-2xl">
                    <h1 className="text-display-xs font-semibold text-primary">Engines</h1>
                    <p className="mt-1 text-sm text-tertiary">
                        What a call runs through, and what a minute on it is sold for. No workspace can see any of this.
                    </p>
                </div>
                <Button size="sm" onClick={() => setCreating(true)}>
                    New Engine
                </Button>
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6 pt-0 lg:px-8 lg:pb-8">

                {/* Two states worth naming before somebody hits them: an engine
                nobody has priced bills nothing, and one with no public name is
                offered to nobody. Both are silent in the tenant console. */}
                {unpriced > 0 || unnamed > 0 ? (
                    <p className="border border-secondary p-4 text-sm text-secondary">
                        {unpriced > 0
                            ? `${unpriced} published engine${unpriced === 1 ? "" : "s"} carry no price, so calls on ${unpriced === 1 ? "it" : "them"} bill nothing. `
                            : ""}
                        {unnamed > 0
                            ? `${unnamed} ${unnamed === 1 ? "engine has" : "engines have"} no customer-facing name, so ${unnamed === 1 ? "it is" : "they are"} offered to nobody.`
                            : ""}
                    </p>
                ) : null}

                <ul className="grid gap-4 xl:grid-cols-2">
                    {(engines ?? []).map((engine) => (
                        <li key={engine.id} className="flex flex-col gap-4 border border-secondary bg-primary p-5">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    {/* The customer's name first — it is the one
                                    that has to be right, and the one that is
                                    easy to leave unset. */}
                                    <div className="flex items-center gap-1.5">
                                        <p className="truncate text-md font-medium text-primary">
                                            {engine.public_name ?? <span className="text-warning-primary">Not offered</span>}
                                        </p>
                                        {/* **The description lives here, not in the card.**
                                            Rendered as a paragraph it ran to one line on
                                            one engine and two on another, so the rule
                                            under it — and everything below — sat at a
                                            different height on every card. A grid of
                                            cards whose dividers do not line up reads as
                                            broken, and no amount of `min-h` fixes it
                                            for the next description somebody writes.

                                            It is the customer-facing sentence, which is
                                            worth checking and not worth reading five
                                            times down a list. */}
                                        {/* `InfoHint`, which this project already
                                            has for exactly this — an ⓘ beside a thing,
                                            explaining what it is.

                                            My first two attempts were a plain `<button>`
                                            inside a `Tooltip`, which silently never
                                            opens (React Aria hands its hover props to a
                                            React Aria `Button`, and a DOM button never
                                            receives them), and then a `ButtonUtility`,
                                            which works but is a control that does
                                            something. This is neither: survey before
                                            building. */}
                                        {engine.public_description ? (
                                            <InfoHint
                                                title="What the customer is told"
                                                description={engine.public_description}
                                                className="shrink-0"
                                            />
                                        ) : null}
                                    </div>
                                    <p className="mt-0.5 truncate text-xs text-quaternary">internally {engine.name}</p>
                                </div>
                                <div className="flex shrink-0 gap-2">
                                    <Badge size="sm" color={engine.status === "published" ? "success" : "gray"}>
                                        {engine.status}
                                    </Badge>
                                </div>
                            </div>

                            <dl className="grid grid-cols-3 gap-3 border-t border-secondary pt-3">
                                <Stat
                                    label="Price"
                                    value={engine.price_per_minute === null ? "—" : `${engine.price_currency} ${Number(engine.price_per_minute).toFixed(2)}`}
                                    note={engine.price_per_minute === null ? "unpriced" : "per minute"}
                                />
                                <Stat label="Sessions 30d" value={String(engine.sessions_30d)} note={`${engine.minutes_30d} min`} />
                                <Stat label="Workspaces" value={String(engine.workspaces)} note={engine.workspaces === 0 ? "unused" : undefined} />
                            </dl>

                            <div className="mt-auto flex justify-end gap-2">
                                <Button size="sm" color="secondary" onClick={() => setPricing(engine)}>
                                    Set price
                                </Button>
                                <Button size="sm" href={`/platform/engines/${engine.id}`}>
                                    Compose
                                </Button>
                            </div>
                        </li>
                    ))}
                </ul>

                {engines?.length === 0 ? <p className="border border-dashed border-secondary p-6 text-sm text-tertiary">No engines yet.</p> : null}
                {engines === null ? <p className="text-sm text-tertiary">Loading.</p> : null}
            </div>

            {pricing ? (
                <PriceDialog
                    engine={pricing}
                    onClose={() => setPricing(null)}
                    onSaved={() => {
                        setPricing(null);
                        load();
                    }}
                />
            ) : null}

            {creating ? (
                <NewEngineDialog
                    onClose={() => setCreating(false)}
                    onCreated={() => {
                        setCreating(false);
                        load();
                    }}
                />
            ) : null}
        </div>
    );
};

const PriceDialog = ({ engine, onClose, onSaved }: { engine: Engine; onClose: () => void; onSaved: () => void }) => {
    const { context } = useSession();
    const notify = useNotify();
    const [perMinute, setPerMinute] = useState(engine.price_per_minute === null ? "" : String(engine.price_per_minute));
    const [perCall, setPerCall] = useState(engine.price_per_call === null ? "" : String(engine.price_per_call));
    const [saving, setSaving] = useState(false);

    const minute = perMinute.trim() === "" ? null : Number(perMinute);
    const call = perCall.trim() === "" ? null : Number(perCall);
    const valid = (minute === null || (Number.isFinite(minute) && minute >= 0)) && (call === null || (Number.isFinite(call) && call >= 0));

    return (
        <ModalOverlay isOpen onOpenChange={(o) => !o && onClose()}>
            <Modal className="max-w-md">
                <Dialog>
                    <div className="flex w-full flex-col bg-primary p-6 shadow-xl ring-1 ring-secondary">
                        <h2 className="text-lg font-semibold text-primary">{engine.public_name ?? engine.name}</h2>
                        <p className="mt-1 text-sm text-tertiary">
                            {engine.sessions_30d} sessions and {engine.minutes_30d} minutes in the last 30 days.
                        </p>

                        <div className="mt-5 flex flex-col gap-4">
                            <Input
                                label={`Per minute (${engine.price_currency})`}
                                value={perMinute}
                                onChange={setPerMinute}
                                autoFocus
                                hint="Each call rounds up to the next whole minute."
                            />
                            <Input
                                label={`Per call (${engine.price_currency})`}
                                value={perCall}
                                onChange={setPerCall}
                                hint="A connect fee, charged once. Leave blank for none."
                            />
                        </div>

                        {/* Blank is not zero, and the difference reaches the
                            invoice: an unpriced engine is reported as unpriced
                            rather than folded into a total as free. */}
                        <p className="mt-4 text-sm text-quaternary">
                            {minute === null && call === null
                                ? "Both blank means unpriced — calls on this engine will be counted and not billed."
                                : `A five-minute call bills ${engine.price_currency} ${((call ?? 0) + (minute ?? 0) * 5).toFixed(2)}.`}
                        </p>

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
                                        .operatorSetEnginePrice(
                                            engine.id,
                                            {
                                                per_minute: minute,
                                                per_call: call,
                                                currency: engine.price_currency,
                                            },
                                            context,
                                        )
                                        .then(onSaved)
                                        .catch((problem) => {
                                            notify.failure("Something went wrong", problem);
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

const NewEngineDialog = ({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) => {
    const { context } = useSession();
    const notify = useNotify();
    const [name, setName] = useState("");
    const [mode, setMode] = useState("cascading");
    const [saving, setSaving] = useState(false);

    return (
        <ModalOverlay isOpen onOpenChange={(o) => !o && onClose()}>
            <Modal className="max-w-md">
                <Dialog>
                    <div className="flex w-full flex-col bg-primary p-6 shadow-xl ring-1 ring-secondary">
                        <h2 className="text-lg font-semibold text-primary">New engine</h2>
                        <p className="mt-1 text-sm text-tertiary">
                            It starts as a draft with no customer-facing name, so it reaches nobody until you compose it and name it.
                        </p>
                        <div className="mt-5 flex flex-col gap-4">
                            <Input
                                label="Internal name"
                                value={name}
                                onChange={setName}
                                autoFocus
                                hint="Yours, not the customer's. Name it after what it is made of."
                            />
                            <Select
                                label="Shape"
                                selectedKey={mode}
                                onSelectionChange={(k) => setMode(String(k))}
                                items={[
                                    {
                                        id: "cascading",
                                        label: "Relay",
                                        supportingText: "Three services",
                                    },
                                    {
                                        id: "realtime",
                                        label: "One model",
                                        supportingText: "Lowest latency",
                                    },
                                ]}
                            >
                                {(item) => (
                                    <Select.Item id={item.id} supportingText={item.supportingText}>
                                        {item.label}
                                    </Select.Item>
                                )}
                            </Select>
                        </div>
                        <div className="mt-6 flex justify-end gap-3">
                            <Button size="sm" color="secondary" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                isDisabled={!name.trim()}
                                isLoading={saving}
                                onClick={() => {
                                    if (!context) return;
                                    setSaving(true);
                                    void api
                                        .operatorCreateEngine(name.trim(), mode, context)
                                        .then(onCreated)
                                        .catch((problem) => {
                                            notify.failure("Something went wrong", problem);
                                            setSaving(false);
                                        });
                                }}
                            >
                                Create
                            </Button>
                        </div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
};

const Stat = ({ label, value, note }: { label: string; value: string; note?: string }) => (
    <div>
        <dt className="text-[0.6875rem] tracking-wide text-quaternary uppercase">{label}</dt>
        <dd className="mt-0.5 text-lg font-light text-primary tabular-nums">{value}</dd>
        {note ? <p className="text-xs text-quaternary">{note}</p> : null}
    </div>
);

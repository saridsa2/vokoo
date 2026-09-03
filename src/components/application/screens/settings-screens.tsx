"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { ScreenHeader } from "@/components/application/screen/screen-header";
import { Tabs } from "@/components/application/tabs/tabs";
import { Table, TableCard } from "@/components/application/table/table";
import { useSession } from "@/hooks/use-session";
import { ApiError, api } from "@/utils/api-client";
import { dateTime, timeAgo } from "@/utils/format";

/**
 * Settings screens.
 *
 * These do not go through `useResource`: organization and members sit behind
 * dedicated endpoints rather than the generic `/api/v1/{resource}` route,
 * because each has rules the generic CRUD path deliberately does not allow —
 * creating an organization is an atomic RPC that also writes the owner's
 * membership.
 */

/** Shared loader for the dedicated settings endpoints. */
function useSettingsData<T>(load: (context: NonNullable<ReturnType<typeof useSession>["context"]>) => Promise<{ data: T }>) {
    const { context, isReady } = useSession();
    const [data, setData] = useState<T | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<ApiError | null>(null);

    const refresh = useCallback(async () => {
        if (!context) return;
        setIsLoading(true);
        setError(null);
        try {
            const result = await load(context);
            setData(result.data);
        } catch (cause) {
            setError(cause instanceof ApiError ? cause : new ApiError(String(cause), 0));
        } finally {
            setIsLoading(false);
        }
    }, [context, load]);

    useEffect(() => {
        if (!isReady) return;
        void refresh();
    }, [isReady, refresh]);

    return { data, isLoading, error, refresh };
}

function ErrorNote({ error }: { error: ApiError }) {
    return (
        <div className="rounded-xl bg-error-primary p-6 ring-1 ring-error_subtle">
            <p className="text-sm font-semibold text-error-primary">Could not load</p>
            <p className="mt-1 text-sm text-error-primary">{error.message}</p>
        </div>
    );
}

/* --------------------------------------------------------- Organization */

/**
 * Everything the workspace has decided.
 *
 * ## Sections are questions, not tables
 *
 * "When a call fails" rather than "Call settings"; "What is kept" rather than
 * "Data". A section named after a question tells somebody whether their answer
 * is in it; a section named after a table tells them where it is stored, which
 * they do not care about.
 *
 * ## Tabs, the same ones Providers uses
 *
 * Four sections read fine stacked; six do not — the reader scrolls past three
 * things to reach the one they came for. The console already answers this on
 * the Providers screen with an underline tab strip, so this uses that component
 * rather than a lookalike: two tab bars that drift apart is the same fault as
 * two implementations of anything else.
 *
 * Each tab carries the question its section answers, under the strip rather
 * than in it — a one-word label leaves the reader guessing which of six holds
 * the thing they came for, and six questions in the strip would not fit.
 *
 * ## Some of these are ahead of their readers, and say so
 *
 * This project's rule is not to build what nothing reads — eight agent tabs
 * went for exactly that. These are built ahead deliberately, so the structure
 * exists before the features land. What that costs is a page that can lie, so
 * every field with no reader carries a `pending` note naming what has to be
 * built, and **Compliance is read-only entirely**: somebody switching DND
 * scrubbing on and believing they are compliant is a regulatory problem, not a
 * UI one, and outbound does not exist to honour it.
 */

type Organization = {
    id: string;
    name: string;
    slug: string;
    plan: string;
    created_at: string;
    timezone: string | null;
    escalation_number: string | null;
    retention_days: number | null;
    intelligence_provider: string | null;
    intelligence_model: string | null;
    max_concurrent_calls: number | null;
    record_calls: boolean;
    redact_transcripts: boolean;
    dnd_scrubbing: boolean;
    calling_window_start: string | null;
    calling_window_end: string | null;
    daily_call_cap: number | null;
    announce_recording: boolean;
};

type Draft = Partial<Record<keyof Organization, string>>;

const SECTIONS: ReadonlyArray<{
    id: SectionId;
    label: string;
    asks: string;
    badge?: string;
}> = [
    // Alphabetical. Not the order these were reasoned in — that ran from
    // identity through operation to cost — but the order somebody scans a strip
    // of six in when they already know the name of the one they want.
    { id: "billing", label: "Billing", asks: "What does it cost?" },
    { id: "calls", label: "Calls", asks: "How does the line behave?" },
    {
        id: "compliance",
        label: "Compliance",
        asks: "What are we obliged to do?",
        // Not a count. On Providers the badge answers "have I finished here",
        // and there is no finishing this one until outbound exists — a "0/4"
        // would read as work somebody could do today.
        badge: "Read-only",
    },
    { id: "data", label: "Data", asks: "What do we keep?" },
    { id: "identity", label: "Identity", asks: "Who is this business?" },
    { id: "intelligence", label: "Intelligence", asks: "Who reads our calls?" },
];

type SectionId = "identity" | "calls" | "intelligence" | "data" | "compliance" | "billing";

export function OrganizationScreen() {
    const { context } = useSession();
    const { data, isLoading, error, refresh } = useSettingsData<Organization>(
        useCallback((ctx) => api.organization<Organization>(ctx), []),
    );

    // Identity is where somebody lands, even though Billing sorts first.
    const [section, setSection] = useState<SectionId>("identity");
    const [draft, setDraft] = useState<Draft>({});
    const [isSaving, setIsSaving] = useState(false);

    // Cleared whenever the row is re-read, so a save leaves the form showing
    // what was stored rather than what was typed.
    useEffect(() => setDraft({}), [data]);

    const value = (field: keyof Organization) =>
        draft[field] ?? (data?.[field] == null ? "" : String(data[field]));
    const set = (field: keyof Organization) => (next: string) =>
        setDraft((current) => ({ ...current, [field]: next }));
    const isDirty = Object.keys(draft).length > 0;

    async function save() {
        if (!context || !data || !isDirty) return;
        setIsSaving(true);
        try {
            // Empty is null, not an empty string: a number column and a time
            // column both treat "" as a value and neither should.
            const body: Record<string, unknown> = {};
            for (const [field, typed] of Object.entries(draft)) {
                const trimmed = typed.trim();
                body[field] =
                    trimmed === ""
                        ? null
                        : field === "retention_days" ||
                            field === "max_concurrent_calls" ||
                            field === "daily_call_cap"
                          ? Number(trimmed)
                          : trimmed === "true" || trimmed === "false"
                            ? trimmed === "true"
                            : trimmed;
            }
            // PATCH /settings/organization, not the generic resource route:
            // organizations are not in the API's resource allowlist.
            await fetch(`${process.env.NEXT_PUBLIC_CONTROLPLANE_API_URL}/api/v1/settings/organization`, {
                method: "PATCH",
                headers: {
                    "content-type": "application/json",
                    authorization: `Bearer ${context.accessToken}`,
                    "x-org-id": context.organizationId,
                },
                body: JSON.stringify(body),
            });
            await refresh();
        } finally {
            setIsSaving(false);
        }
    }

    const here = SECTIONS.find((item) => item.id === section)!;

    return (
        <>
            <ScreenHeader
                title="Organization"
                description="Who this business is, and what it has decided."
                actions={
                    <Button
                        size="sm"
                        isDisabled={!isDirty}
                        isLoading={isSaving}
                        showTextWhileLoading
                        onClick={save}
                    >
                        Save
                    </Button>
                }
            />

            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
                <Tabs
                    selectedKey={section}
                    onSelectionChange={(key) => setSection(String(key) as SectionId)}
                >
                    <Tabs.List
                        type="underline"
                        items={SECTIONS.map((item) => ({
                            id: item.id,
                            label: item.label,
                            // A badge only where there is something true to
                            // count. "Compliance 0/4" would read as work to do
                            // rather than as a section nothing enforces yet.
                            badge: item.badge,
                        }))}
                    >
                        {(item) => <Tabs.Item {...item} />}
                    </Tabs.List>
                </Tabs>

                {error ? (
                    <ErrorNote error={error} />
                ) : isLoading ? (
                    <p className="text-sm text-tertiary">Loading…</p>
                ) : !data ? (
                    <p className="text-sm text-tertiary">No organization found.</p>
                ) : (
                    // 65/35. The controls are what somebody came to change; the
                    // prose is what they read once and then never again, so it
                    // stops sitting between the fields and pushing them apart.
                    <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[65fr_35fr]">
                        <div className="flex flex-col gap-5">
                            <Pane
                                section={section}
                                data={data}
                                value={value}
                                set={set}
                                context={context}
                            />
                        </div>
                        <aside className="flex flex-col gap-4 border-l border-secondary pl-6 lg:sticky lg:top-0">
                            <h2 className="text-sm font-semibold text-primary">{here.asks}</h2>
                            <Help section={section} />
                        </aside>
                    </div>
                )}
            </div>
        </>
    );
}

/**
 * The prose, on the right.
 *
 * It used to sit between the fields as hints and notices, which made a form of
 * four controls three screens tall — and put the thing somebody reads once
 * permanently between the things they came to change. Fields keep a short hint
 * where the consequence is not obvious from the label; everything longer is
 * here.
 */
const Help = ({ section }: { section: SectionId }) => {
    switch (section) {
        case "identity":
            return (
                <>
                    <P>
                        The slug is fixed at creation, and not for tidiness:{" "}
                        <strong className="text-primary">
                            it is half of every agent&rsquo;s SIP endpoint name
                        </strong>
                        . The database re-derives those on write, so renaming it would rename every
                        endpoint Asterisk knows and break every registration at once.
                    </P>
                    <P>
                        The timezone is the business day. Left empty, anything that says
                        &ldquo;today&rdquo; falls back to whichever timezone the person reading it
                        is in — so two people in different places see different numbers and both
                        are right.
                    </P>
                </>
            );

        case "calls":
            return (
                <>
                    <P>
                        The escalation number is where a caller goes when the agent breaks and no
                        exception flow is bound to the number they dialled. Empty means they hear
                        silence, which is what happens today on a number with neither.
                    </P>
                    <P>
                        A concurrency ceiling is one you impose below the carrier&rsquo;s three —
                        useful when a busy tone is a better answer than a queue nobody is going to
                        reach.
                    </P>
                    <Note>
                        Nothing enforces that ceiling yet: the bridge would have to count an
                        organisation&rsquo;s live calls and refuse above it. The carrier&rsquo;s
                        own three still applies either way, and a fourth caller gets SIP 486
                        before the bridge ever sees them.
                    </Note>
                </>
            );

        case "intelligence":
            return (
                <>
                    <P>
                        This is the model that reads a call after it has ended and fills in a
                        shape. It must serve the Anthropic Messages API, because the reading is
                        held to its shape by a forced tool call rather than by parsing a reply —
                        which is what makes these two interchangeable.
                    </P>
                    <P>
                        One choice for the whole workspace. Four post-call flows would otherwise
                        carry four copies of it, and changing what reads your calls would mean
                        opening four boards and hoping you found them all.
                    </P>
                    <Note>
                        MiniMax publishes no models endpoint, so its entry is hand-maintained —
                        the same situation as Sarvam, which is the provider whose retired model
                        put silence on a live call. Anthropic publishes one and discovery should
                        own those. And nothing pre-flights a reader the way it pre-flights an
                        engine, so a wrong pairing is found when a call ends.
                    </Note>
                </>
            );

        case "data":
            return (
                <>
                    <P>
                        Retention covers a call&rsquo;s <em>content</em> — transcript, recording,
                        analysis. The call record itself always stays, because that is what
                        billing counts.
                    </P>
                    <P>
                        A recording URL expires at the carrier, so the moment it is handed over on
                        hangup is the only moment it can be kept.
                    </P>
                    <Note>
                        Retention is stored and nothing sweeps on it — nothing has ever been
                        deleted. Recording is always on: the answering XML includes
                        &lt;start-record/&gt; unconditionally. Redaction is not implemented, and
                        belongs before the transcript is written rather than after, because after
                        is a copy that already existed.
                    </Note>
                </>
            );

        case "compliance":
            return (
                <>
                    <P>
                        India&rsquo;s TRAI rules for outbound calling: scrub against the national
                        Do Not Disturb registry, keep inside 09:00&ndash;21:00, and stay under
                        fifty calls a day per registered sender.
                    </P>
                    <Note tone="strong">
                        <strong className="text-primary">Read-only, on purpose.</strong> This
                        platform has no outbound path, so nothing here can be enforced. A switch
                        that stores &ldquo;DND scrubbing: on&rdquo; and changes nothing is not an
                        empty field — it is a claim of compliance that is untrue, and the
                        consequence of that one is a fine. They become editable the day there is
                        a dialer to honour them.
                    </Note>
                </>
            );

        case "billing":
            return (
                <>
                    <P>
                        What the calls consumed, and what it cost — by engine, so a change of
                        provider shows up as a change in the bill rather than as a mystery.
                    </P>
                    <Note>
                        Every rate in the card is deliberately null. A figure written from memory
                        into a table that produces invoices is exactly how a wrong invoice goes
                        out, so until each is read off a vendor&rsquo;s own page this reports
                        quantities and refuses to guess. A call nobody has priced and a call that
                        cost nothing are different facts.
                    </Note>
                    <Note>
                        A relay meters every step. A realtime engine records nothing at all, and
                        no call has ever emitted the carrier&rsquo;s own charge — so an engine
                        missing from the table may be unused, or may be unmeasured.
                    </Note>
                </>
            );
    }
};

const P = ({ children }: { children: React.ReactNode }) => (
    <p className="text-sm text-tertiary">{children}</p>
);

const Note = ({ children, tone }: { children: React.ReactNode; tone?: "strong" }) => (
    <p
        className={`p-3 text-sm text-tertiary ${
            tone === "strong"
                ? "border border-warning bg-warning-primary"
                : "border border-dashed border-secondary"
        }`}
    >
        {children}
    </p>
);

/** What each section holds. Split out so the screen above stays about layout. */
const Pane = ({
    section,
    data,
    value,
    set,
    context,
}: {
    section: SectionId;
    data: Organization;
    value: (field: keyof Organization) => string;
    set: (field: keyof Organization) => (next: string) => void;
    context: { accessToken: string; organizationId: string } | null;
}) => {
    switch (section) {
        case "identity":
            return (
                <Card>
                    <Input label="Name" value={value("name")} onChange={set("name")} />
                    <Input
                        label="Slug"
                        value={data.slug}
                        isDisabled
                        hint="Fixed at creation."
                    />
                    <Input
                        label="Timezone"
                        value={value("timezone")}
                        onChange={set("timezone")}
                        placeholder="Asia/Kolkata"
                        hint="IANA name, like Asia/Kolkata."
                    />
                    <div className="flex items-center justify-between border-t border-secondary pt-4">
                        <div>
                            <p className="text-sm font-medium text-secondary">Plan</p>
                            <p className="mt-0.5 text-xs text-tertiary">
                                Created {dateTime(data.created_at)}
                            </p>
                        </div>
                        <Badge size="sm" type="pill-color" color="brand">
                            {data.plan}
                        </Badge>
                    </div>
                </Card>
            );

        case "calls":
            return (
                <Card>
                    <Input
                        label="Escalation number"
                        value={value("escalation_number")}
                        onChange={set("escalation_number")}
                        placeholder="6309248884"
                        hint="Empty means the caller hears silence."
                    />
                    <Input
                        label="Concurrent call limit"
                        value={value("max_concurrent_calls")}
                        onChange={set("max_concurrent_calls")}
                        placeholder="Leave empty for the carrier's limit"
                        hint="Empty means the carrier's three is the only limit."
                    />
                </Card>
            );

        case "intelligence":
            return (
                <Intelligence
                    context={context}
                    provider={value("intelligence_provider")}
                    model={value("intelligence_model")}
                    set={set}
                />
            );

        case "data":
            return (
                <Card>
                    <Input
                        label="Retention (days)"
                        value={value("retention_days")}
                        onChange={set("retention_days")}
                        placeholder="Leave empty to keep everything"
                        hint="Empty keeps everything."
                    />
                    <Toggle
                        label="Record calls"
                        checked={value("record_calls") === "true"}
                        onChange={(next) => set("record_calls")(String(next))}
                        hint="The carrier records and hands over a URL on hangup."
                    />
                    <Toggle
                        label="Redact transcripts"
                        checked={value("redact_transcripts") === "true"}
                        onChange={(next) => set("redact_transcripts")(String(next))}
                        hint="Strip card and id numbers before storing."
                    />
                </Card>
            );

        case "compliance":
            return (
                <>
                    <Card>
                        <Toggle
                            label="Scrub against DND"
                            checked={data.dnd_scrubbing}
                            isDisabled
                            hint="Check the national registry before dialling."
                        />
                        <div className="grid grid-cols-2 gap-4">
                            <Input
                                label="Calling from"
                                value={data.calling_window_start ?? ""}
                                isDisabled
                                hint="TRAI permits 09:00."
                            />
                            <Input
                                label="Calling until"
                                value={data.calling_window_end ?? ""}
                                isDisabled
                                hint="And forbids past 21:00."
                            />
                        </div>
                        <Input
                            label="Daily call cap"
                            value={String(data.daily_call_cap ?? "")}
                            isDisabled
                            hint="TRAI allows 50."
                        />
                        <Toggle
                            label="Announce recording"
                            checked={data.announce_recording}
                            isDisabled
                            hint="Before the agent speaks."
                        />
                    </Card>
                </>
            );

        case "billing":
            return <Billing context={context} plan={data.plan} />;
    }
};

/**
 * Who reads the calls, chosen from the catalogue.
 *
 * These were two text boxes, which is the shape that has hurt this project
 * before: a relay was published on a Sarvam model months after Sarvam retired
 * it, and the caller heard silence. A typed model id fails at the one moment
 * nobody is watching — after the call has ended.
 *
 * So both come from `catalogue_models`, like every other model in the console.
 * Changing the provider clears the model rather than leaving one provider's id
 * against another's name, which would save cleanly and fail on the next call.
 *
 * **There is no pre-flight for this.** `POST /engine/preflight` builds and runs
 * the real processors for an engine; nothing does the equivalent for the
 * workspace's reader, so a wrong pairing is still discovered when a call ends —
 * only now it takes two deliberate choices rather than a typo.
 */
const Intelligence = ({
    context,
    provider,
    model,
    set,
}: {
    context: { accessToken: string; organizationId: string } | null;
    provider: string;
    model: string;
    set: (field: keyof Organization) => (next: string) => void;
}) => {
    const [catalogue, setCatalogue] = useState<{
        providers: Array<{ id: string; label: string; summary?: string }>;
        models: Array<{ id: string; label: string; provider_id: string; summary?: string }>;
    } | null>(null);

    useEffect(() => {
        if (!context) return;
        let live = true;
        api.catalogue<{
            providers: Array<{ id: string; label: string; summary?: string }>;
            models: Array<{ id: string; label: string; provider_id: string; summary?: string }>;
        }>(context)
            .then(({ data }) => live && setCatalogue(data ?? { providers: [], models: [] }))
            .catch(() => live && setCatalogue({ providers: [], models: [] }));
        return () => {
            live = false;
        };
    }, [context?.accessToken, context?.organizationId]);

    // Only the two the bridge can actually talk to. `host()` in
    // `intelligence.rs` is a two-arm match on the Anthropic Messages API, and a
    // provider outside it fails with a message saying so — offering the rest of
    // the catalogue here would be offering a choice that cannot work.
    const READERS = ["minimax", "anthropic"];
    const providers = (catalogue?.providers ?? []).filter((p) => READERS.includes(p.id));
    const models = (catalogue?.models ?? []).filter((m) => m.provider_id === provider);

    return (
        <Card>
            <Select
                label="Provider"
                selectedKey={provider}
                onSelectionChange={(key) => {
                    set("intelligence_provider")(String(key));
                    // A model belongs to one provider. Carrying the old id over
                    // would save cleanly and fail on the next call that ended.
                    set("intelligence_model")("");
                }}
                items={providers}
                hint="Must serve the Anthropic Messages API."
            >
                {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
            </Select>

            <Select
                label="Model"
                selectedKey={model}
                onSelectionChange={(key) => set("intelligence_model")(String(key))}
                items={models}
                isDisabled={models.length === 0}
                placeholder={
                    providers.length === 0
                        ? "Loading…"
                        : models.length === 0
                          ? "Choose a provider first"
                          : "Choose a model"
                }
                hint="One choice for the whole workspace."
            >
                {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
            </Select>

        </Card>
    );
};

/**
 * What the calls have cost.
 *
 * Real, unlike the two sections above it: `call_costs` and `engine_costs` are
 * views that exist and are populated. **Every rate in the card is deliberately
 * null** — writing prices from memory into a table that produces invoices is
 * the one thing this must not do — so the honest report is quantities, and the
 * names of the vendors somebody still has to go and price.
 */
const Billing = ({
    context,
    plan,
}: {
    context: { accessToken: string; organizationId: string } | null;
    plan: string;
}) => {
    const [engines, setEngines] = useState<EngineCost[] | null>(null);
    const [rates, setRates] = useState<Rate[] | null>(null);

    useEffect(() => {
        if (!context) return;
        let live = true;
        api.list<EngineCost>("engine-costs", context)
            .then(({ data }) => live && setEngines(data ?? []))
            .catch(() => live && setEngines([]));
        api.list<Rate>("vendor-rates", context)
            .then(({ data }) => live && setRates(data ?? []))
            .catch(() => live && setRates([]));
        return () => {
            live = false;
        };
    }, [context?.accessToken, context?.organizationId]);

    const rows = engines ?? [];
    const calls = rows.reduce((total, row) => total + (row.calls ?? 0), 0);
    const seconds = rows.reduce((total, row) => total + Number(row.total_seconds ?? 0), 0);
    const priced = rows.reduce((total, row) => total + Number(row.total_cost ?? 0), 0);
    const unpriced = rows.reduce((total, row) => total + (row.unpriced_items ?? 0), 0);
    const currency = rows.find((row) => row.currency)?.currency ?? "USD";
    const toPrice = [...new Set((rates ?? []).filter((r) => r.rate_per_unit == null).map((r) => r.vendor_id))];

    return (
        <>
            <Card>
                <div className="grid grid-cols-3 gap-4">
                    <Figure label="Spend" value={priced > 0 ? `${currency} ${priced.toFixed(2)}` : "—"} />
                    <Figure label="Calls" value={String(calls)} />
                    <Figure label="Talk time" value={`${Math.round(seconds / 60)}m`} />
                </div>
                {priced === 0 && unpriced > 0 ? (
                    // The honest answer to "what have I incurred". Not zero —
                    // unknown, with the reason and the remedy attached. A call
                    // nobody has priced and a call that cost nothing are
                    // different facts, and reporting the second as the first is
                    // how a wrong invoice goes out.
                    <p className="border-t border-secondary pt-4 text-sm text-tertiary">
                        <strong className="text-primary">Nothing is priced yet</strong>, so this
                        is not a bill of zero — it is {unpriced} metered quantit
                        {unpriced === 1 ? "y" : "ies"} nobody has attached a rate to. Every rate in
                        the card is deliberately null: a figure written from memory into a table
                        that produces invoices is exactly how a wrong invoice goes out.
                    </p>
                ) : null}
            </Card>

            <Card>
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm font-medium text-secondary">Plan</p>
                        <p className="mt-0.5 text-xs text-tertiary">
                            Changing plans is not self-serve yet.
                        </p>
                    </div>
                    <Badge size="sm" type="pill-color" color="brand">
                        {plan}
                    </Badge>
                </div>
            </Card>

            <Card>
                <p className="text-sm font-medium text-secondary">By engine</p>
                {engines === null ? (
                    <p className="text-sm text-tertiary">Loading…</p>
                ) : rows.length === 0 ? (
                    <p className="text-sm text-tertiary">
                        Nothing metered yet. A relay meters every step; a realtime engine records
                        nothing at all, and no call has ever emitted the carrier&rsquo;s own charge
                        — so an engine missing here may be unused or may be unmeasured.
                    </p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-sm">
                            <thead>
                                <tr className="border-b border-secondary text-left">
                                    <th className="py-2 pr-4 text-xs font-medium text-tertiary">
                                        Engine
                                    </th>
                                    <th className="py-2 pr-4 text-xs font-medium text-tertiary">
                                        Calls
                                    </th>
                                    <th className="py-2 pr-4 text-xs font-medium text-tertiary">
                                        Minutes
                                    </th>
                                    <th className="py-2 text-right text-xs font-medium text-tertiary">
                                        Cost
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => (
                                    <tr key={row.engine_id} className="border-b border-secondary last:border-0">
                                        <td className="py-2.5 pr-4 text-primary">
                                            {row.engine_name}
                                            <span className="ml-2 text-xs text-quaternary">
                                                {row.mode}
                                            </span>
                                        </td>
                                        <td className="py-2.5 pr-4 tabular-nums text-tertiary">
                                            {row.calls}
                                        </td>
                                        <td className="py-2.5 pr-4 tabular-nums text-tertiary">
                                            {Math.round(Number(row.total_seconds ?? 0) / 60)}
                                        </td>
                                        <td className="py-2.5 text-right tabular-nums text-tertiary">
                                            {row.total_cost == null
                                                ? `${row.unpriced_items ?? 0} unpriced`
                                                : `${currency} ${Number(row.total_cost).toFixed(2)}`}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

                    </>
    );
};

type EngineCost = {
    engine_id: string;
    engine_name: string;
    mode: string;
    currency: string | null;
    calls: number | null;
    total_cost: number | null;
    total_seconds: number | null;
    unpriced_items: number | null;
};

type Rate = { vendor_id: string; stage: string; unit: string; rate_per_unit: number | null };

/** One number, on the billing summary. */
const Figure = ({ label, value }: { label: string; value: string }) => (
    <div className="flex flex-col gap-1">
        <span className="text-xs text-tertiary">{label}</span>
        <span className="text-display-xs font-semibold text-primary tabular-nums">{value}</span>
    </div>
);

const Card = ({ children }: { children: React.ReactNode }) => (
    <section className="flex flex-col gap-5 rounded-xl p-5 ring-1 ring-secondary">{children}</section>
);

/** A labelled switch, with its explanation under it like every other field. */
const Toggle = ({
    label,
    checked,
    onChange,
    hint,
    isDisabled,
}: {
    label: string;
    checked: boolean;
    onChange?: (next: boolean) => void;
    hint?: string;
    isDisabled?: boolean;
}) => (
    <div className="flex flex-col gap-1.5">
        <label className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium text-secondary">{label}</span>
            <input
                type="checkbox"
                checked={checked}
                disabled={isDisabled}
                onChange={(event) => onChange?.(event.target.checked)}
                className="size-4 accent-current disabled:opacity-50"
            />
        </label>
        {hint ? <p className="text-xs text-tertiary">{hint}</p> : null}
    </div>
);

/* -------------------------------------------------------------- Members */

/**
 * Gone, deliberately.
 *
 * It listed `memberships` and could not name anybody: an email lives in
 * `auth.users`, which PostgREST does not serve, so it rendered the first eight
 * characters of a uuid. Beside it, a separate Team screen listed extensions
 * belonging to nobody.
 *
 * There is one population now — see `team-screen.tsx`. `/settings/members`
 * redirects there rather than 404ing, because it is a link people will have.
 */

/* ------------------------------------------------------------- API keys */



"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
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
    id: string;
    label: string;
    asks: string;
    badge?: string;
}> = [
    { id: "identity", label: "Identity", asks: "Who is this business?" },
    { id: "calls", label: "Calls", asks: "How does the line behave?" },
    { id: "intelligence", label: "Intelligence", asks: "Who reads our calls?" },
    { id: "data", label: "Data", asks: "What do we keep?" },
    {
        id: "compliance",
        label: "Compliance",
        asks: "What are we obliged to do?",
        // Not a count. On Providers the badge answers "have I finished here",
        // and there is no finishing this one until outbound exists — a "0/4"
        // would read as work somebody could do today.
        badge: "Read-only",
    },
    { id: "billing", label: "Billing", asks: "What does it cost?" },
] as const;

type SectionId = "identity" | "calls" | "intelligence" | "data" | "compliance" | "billing";

export function OrganizationScreen() {
    const { context } = useSession();
    const { data, isLoading, error, refresh } = useSettingsData<Organization>(
        useCallback((ctx) => api.organization<Organization>(ctx), []),
    );

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

                <div className="flex max-w-2xl flex-col gap-5">
                    <p className="text-sm text-tertiary">{here.asks}</p>

                    {error ? (
                        <ErrorNote error={error} />
                    ) : isLoading ? (
                        <p className="text-sm text-tertiary">Loading…</p>
                    ) : !data ? (
                        <p className="text-sm text-tertiary">No organization found.</p>
                    ) : (
                        <Pane
                            section={section}
                            data={data}
                            value={value}
                            set={set}
                            context={context}
                        />
                    )}
                </div>
            </div>
        </>
    );
}

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
                        hint={`Half of every agent's SIP endpoint name — ${data.slug}-4001. Changing it would rename every endpoint Asterisk knows and break every registration, so it is fixed at creation.`}
                    />
                    <Input
                        label="Timezone"
                        value={value("timezone")}
                        onChange={set("timezone")}
                        placeholder="Asia/Kolkata"
                        hint="The business day. Left empty, anything that says 'today' falls back to whichever timezone the person reading it is in — so two people in different places see different numbers and both are right."
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
                        hint="Where a caller is sent when the agent breaks and no exception flow is bound to the number. Empty means they hear silence — which is what happens today on a number with neither."
                    />
                    <Input
                        label="Concurrent call limit"
                        value={value("max_concurrent_calls")}
                        onChange={set("max_concurrent_calls")}
                        placeholder="Leave empty for the carrier's limit"
                        hint="A ceiling you impose below the carrier's three. Useful when a busy tone is a better answer than a queue nobody is going to reach."
                    />
                    <Pending>
                        Nothing enforces this limit yet — the bridge would have to count an
                        organisation's live calls and refuse above it. The carrier's own three
                        still applies either way.
                    </Pending>
                </Card>
            );

        case "intelligence":
            return (
                <Card>
                    <Input
                        label="Provider"
                        value={value("intelligence_provider")}
                        onChange={set("intelligence_provider")}
                        placeholder="minimax"
                        hint="Must serve the Anthropic Messages API — anthropic or minimax. The reading is held to its shape by a forced tool call, and a provider outside that list fails saying so."
                    />
                    <Input
                        label="Model"
                        value={value("intelligence_model")}
                        onChange={set("intelligence_model")}
                        placeholder="MiniMax-M2"
                        hint="One choice for the whole workspace. Four post-call flows would otherwise carry four copies of it, and changing what reads your calls would mean opening four boards and hoping you found them all."
                    />
                </Card>
            );

        case "data":
            return (
                <Card>
                    <Input
                        label="Retention (days)"
                        value={value("retention_days")}
                        onChange={set("retention_days")}
                        placeholder="Leave empty to keep everything"
                        hint="How long a call's content — transcript, recording, analysis — is kept. The call record itself always stays, because that is what billing counts."
                    />
                    <Toggle
                        label="Record calls"
                        checked={value("record_calls") === "true"}
                        onChange={(next) => set("record_calls")(String(next))}
                        hint="The carrier records and hands over a URL when the call ends. The URL expires at the carrier, so the moment it is offered is the only moment it can be kept."
                    />
                    <Toggle
                        label="Redact transcripts"
                        checked={value("redact_transcripts") === "true"}
                        onChange={(next) => set("redact_transcripts")(String(next))}
                        hint="Strip anything shaped like a card or government id number before the transcript is stored."
                    />
                    <Pending>
                        Retention is stored and nothing sweeps on it — nothing has ever been
                        deleted. Recording is always on: `&lt;start-record/&gt;` is in the
                        answering XML unconditionally. Redaction is not implemented, and belongs
                        before the transcript is written rather than after, because after is a
                        copy that already existed.
                    </Pending>
                </Card>
            );

        case "compliance":
            return (
                <>
                    <Pending tone="strong">
                        <strong className="text-primary">Read-only, on purpose.</strong>{" "}
                        These are India&rsquo;s TRAI rules for outbound calling, and this platform has no
                        outbound path — so nothing here can be enforced. A switch that stores
                        &ldquo;DND scrubbing: on&rdquo; and changes nothing is not an empty field,
                        it is a claim of compliance that is untrue. They become editable the day
                        there is a dialer to honour them.
                    </Pending>
                    <Card>
                        <Toggle
                            label="Scrub against DND"
                            checked={data.dnd_scrubbing}
                            isDisabled
                            hint="Check the national Do Not Disturb registry before dialling a number."
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
                            hint="TRAI's own limit is 50 calls a day per registered sender."
                        />
                        <Toggle
                            label="Announce recording"
                            checked={data.announce_recording}
                            isDisabled
                            hint="Tell the caller the call is recorded, before the agent speaks. It belongs in the flow's first node."
                        />
                    </Card>
                </>
            );

        case "billing":
            return <Billing context={context} plan={data.plan} />;
    }
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
    const [costs, setCosts] = useState<Array<Record<string, unknown>> | null>(null);
    const [rates, setRates] = useState<Array<Record<string, unknown>> | null>(null);

    useEffect(() => {
        if (!context) return;
        let live = true;
        api.list<Record<string, unknown>>("engine-costs", context)
            .then(({ data }) => live && setCosts(data ?? []))
            .catch(() => live && setCosts([]));
        api.list<Record<string, unknown>>("vendor-rates", context)
            .then(({ data }) => live && setRates(data ?? []))
            .catch(() => live && setRates([]));
        return () => {
            live = false;
        };
    }, [context?.accessToken, context?.organizationId]);

    const unpriced = (rates ?? []).filter((r) => r.unit_price == null);

    return (
        <>
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
                <p className="text-sm font-medium text-secondary">Cost by engine</p>
                {costs === null ? (
                    <p className="text-sm text-tertiary">Loading…</p>
                ) : costs.length === 0 ? (
                    <p className="text-sm text-tertiary">
                        Nothing recorded yet. A relay meters every step; a realtime engine
                        currently records nothing at all, and no call has ever emitted the
                        carrier&rsquo;s own charge.
                    </p>
                ) : (
                    <ul className="flex flex-col divide-y divide-secondary">
                        {costs.slice(0, 8).map((row, index) => (
                            <li
                                key={index}
                                className="flex items-baseline justify-between gap-4 py-2 text-sm"
                            >
                                <span className="text-primary">
                                    {String(row.engine_name ?? "—")}
                                </span>
                                <span className="text-tertiary tabular-nums">
                                    {String(row.calls ?? 0)} calls
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

            {unpriced.length > 0 ? (
                <Pending>
                    <strong className="text-primary">
                        {unpriced.length} rate{unpriced.length === 1 ? "" : "s"} are unpriced.
                    </strong>{" "}
                    Every rate in the card is null on purpose — a figure written from memory into
                    a table that produces invoices is how a wrong invoice goes out. Until each is
                    read off a vendor&rsquo;s own page, a call nobody has priced and a call that
                    cost nothing stay different facts.
                </Pending>
            ) : null}
        </>
    );
};

const Card = ({ children }: { children: React.ReactNode }) => (
    <section className="flex flex-col gap-5 rounded-xl p-5 ring-1 ring-secondary">{children}</section>
);

/**
 * What is not wired up yet, said where somebody would otherwise assume it was.
 *
 * The alternative was leaving these sections out until their readers existed —
 * which is this project's own rule. Building ahead is a deliberate choice, and
 * this note is the price of it: a field that does nothing has to say so, or the
 * page is a list of settings that quietly are not settings.
 */
const Pending = ({
    children,
    tone,
}: {
    children: React.ReactNode;
    tone?: "strong";
}) => (
    <p
        className={`p-4 text-sm text-tertiary ${
            tone === "strong"
                ? "border border-warning bg-warning-primary"
                : "border border-dashed border-secondary"
        }`}
    >
        {children}
    </p>
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



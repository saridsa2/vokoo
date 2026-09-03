"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { ScreenHeader } from "@/components/application/screen/screen-header";
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

type Organization = {
    id: string;
    name: string;
    slug: string;
    plan: string;
    created_at: string;
    /** The business's own clock. Null means nobody has set one. */
    timezone: string | null;
    /** Where a failed call goes when no exception flow is bound. */
    escalation_number: string | null;
    /** How long a call's content is kept. Null keeps everything. */
    retention_days: number | null;
    intelligence_provider: string | null;
    intelligence_model: string | null;
};

/** What a field is worth on this screen, and what happens if it is wrong. */
type Draft = Partial<Record<keyof Organization, string>>;

export function OrganizationScreen() {
    const { context } = useSession();
    const { data, isLoading, error, refresh } = useSettingsData<Organization>(
        useCallback((ctx) => api.organization<Organization>(ctx), []),
    );

    const [draft, setDraft] = useState<Draft>({});
    const [isSaving, setIsSaving] = useState(false);

    // Reset whenever the row arrives or is re-read, so a save leaves the form
    // showing what was actually stored rather than what was typed.
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
            // Empty is null, not an empty string. `retention_days` is a number
            // and `timezone` is read by a zone parser — both treat "" as a
            // value and neither should.
            const body: Record<string, unknown> = {};
            for (const [field, typed] of Object.entries(draft)) {
                const trimmed = typed.trim();
                body[field] =
                    trimmed === ""
                        ? null
                        : field === "retention_days"
                          ? Number(trimmed)
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

    return (
        <>
            <ScreenHeader
                title="Organization"
                description="Who this business is, and what it has decided."
                actions={
                    <Button size="sm" isDisabled={!isDirty} isLoading={isSaving} showTextWhileLoading onClick={save}>
                        Save
                    </Button>
                }
            />

            <div className="min-h-0 flex-1 overflow-y-auto p-6">
                <div className="flex max-w-2xl flex-col gap-8">
                {error ? (
                    <ErrorNote error={error} />
                ) : isLoading ? (
                    <p className="text-sm text-tertiary">Loading…</p>
                ) : !data ? (
                    <p className="text-sm text-tertiary">No organization found.</p>
                ) : (
                    <>
                        {/* Sections rather than one card, because this screen
                            will grow — and a section is additive where a flat
                            form is a rewrite. What does *not* belong here is
                            anything the workspace connects to: a Google or Meta
                            connection is a credential and lives under Providers,
                            and a WhatsApp number is a number and lives under
                            Phone Numbers. Two screens meaning "things we plugged
                            in" is how a credential ends up on whichever one
                            somebody opened first. */}
                        <Section title="Identity">
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
                                    <p className="mt-0.5 text-xs text-tertiary">Created {dateTime(data.created_at)}</p>
                                </div>
                                <Badge size="sm" type="pill-color" color="brand">
                                    {data.plan}
                                </Badge>
                            </div>
                        </Section>

                        <Section title="When a call fails">
                            <Input
                                label="Escalation number"
                                value={value("escalation_number")}
                                onChange={set("escalation_number")}
                                placeholder="6309248884"
                                hint="Where a caller is sent when the agent breaks and no exception flow is bound to the number. Empty means they hear silence — which is what happens today on a number with neither."
                            />
                        </Section>

                        <Section title="What is kept">
                            <Input
                                label="Retention (days)"
                                value={value("retention_days")}
                                onChange={set("retention_days")}
                                placeholder="Leave empty to keep everything"
                                hint="How long a call's content — transcript, recording, analysis — is kept. The call record itself always stays, because that is what billing counts. Nothing has ever been deleted; setting this is the first half of making it real."
                            />
                        </Section>

                        <Section title="Who reads the calls">
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
                        </Section>
                    </>
                )}
                </div>
            </div>
        </>
    );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="flex flex-col gap-5">
        <h2 className="text-sm font-semibold text-primary">{title}</h2>
        <div className="flex flex-col gap-5 rounded-xl p-5 ring-1 ring-secondary">{children}</div>
    </section>
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



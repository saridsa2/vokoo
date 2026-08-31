"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { Tabs } from "@/components/application/tabs/tabs";
import { Tooltip } from "@/components/base/tooltip/tooltip";
import { TextArea } from "@/components/base/textarea/textarea";
import { ClockRewind, Copy01, SearchLg } from "@/components/icons";
import { useResource } from "@/hooks/use-resource";
import { useClipboard } from "@/hooks/use-clipboard";
import { useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/utils/api-client";
import { diffAgents } from "@/utils/agent-diff";
import { modelsFor, type CapabilityScope } from "@/utils/capability-registry";
import { reconcileModel, reconcileProvider, type Rewrite } from "@/utils/capability-reconcile";
import { useCatalogue } from "@/hooks/use-catalogue";
import { useFindings, useMarkTabSeen } from "@/hooks/use-findings";
import { FindingList, RewriteNotice, TabMarker } from "./finding-markers";
import { statusColor, statusLabel } from "@/utils/status";
import { timeAgo } from "@/utils/format";
import { AgentPublishDialog } from "./agent-publish-dialog";
import { AgentVersionsPanel } from "./agent-versions-panel";
import {
    AdvancedPanel,
    AnalysisPanel,
    CompliancePanel,
    ConfigCard,
    ConfigSection,
    ModelSectionIcon,
    MonitorsPanel,
    ToolsPanel,
    TranscriberPanel,
    VoicePanel,
    configValue,
    type JsonConfig,
} from "./agent-tabs";

/**
 * Agent configuration.
 *
 * Two panes, following the reference console: the agent list on the left,
 * the configuration for the selected one on the right. Fields map directly onto
 * the `agents` row, so there is no translation layer between what is edited
 * here and what the telephony bridge reads.
 */

type Agent = {
    id: string;
    name: string;
    status: string;
    provider: string;
    model: string;
    system_prompt: string;
    first_message: string;
    voice_config: JsonConfig | null;
    transcriber_config: JsonConfig | null;
    analysis_config: JsonConfig | null;
    compliance_config: JsonConfig | null;
    config: JsonConfig | null;
    updated_at?: string;
};

const TABS = ["Model", "Voice", "Transcriber", "Tools", "Analysis", "Monitors", "Compliance", "Advanced"] as const;



const FIRST_MESSAGE_MODES = [
    { id: "agent-first", label: "Agent speaks first" },
    { id: "user-first", label: "User speaks first" },
];

/** Defaults for a new agent, matching the spec's create behaviour. */
const NEW_AGENT: Partial<Agent> = {
    name: "Untitled agent",
    status: "draft",
    provider: "local",
    model: "gemma-4-12b",
    first_message: "Hello! How can I help you today?",
    system_prompt:
        "[Identity]\nYou are a receptionist.\n\n" +
        "[Style]\n- Warm, brief, and clear.\n- One short sentence per turn.\n\n" +
        "[Task & Goals]\n1. Find out what the caller needs.\n2. Answer it, or take a message.\n\n" +
        "[Error Handling]\n- If you did not catch something, ask them to repeat it once.",
    voice_config: {},
    transcriber_config: {},
    analysis_config: {},
    compliance_config: {},
    config: {},
};

export function AgentsScreen() {
    const { records, isLoading, error, create, refresh } = useResource<Agent>("agents");
    const { context } = useSession();
    const { copied, copy } = useClipboard();

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [draft, setDraft] = useState<Agent | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [query, setQuery] = useState("");
    const [tab, setTab] = useState<(typeof TABS)[number]>("Model");
    const [isReviewOpen, setIsReviewOpen] = useState(false);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [publishError, setPublishError] = useState<string | null>(null);
    const [nextVersion, setNextVersion] = useState<number | null>(null);
    const [rewrites, setRewrites] = useState<Rewrite[]>([]);

    /**
     * Findings for the draft, and which of them have been read.
     *
     * Evaluated against the draft rather than the saved row: the reader needs to
     * see the consequence of the change they made a moment ago, not of the
     * configuration that is live.
     */
    const scope = useMemo<CapabilityScope | null>(
        () =>
            draft
                ? {
                      provider: draft.provider,
                      model: draft.model,
                      voice: (draft.voice_config?.voice as string) ?? null,
                      transcriber: (draft.transcriber_config?.transcriber as string) ?? null,
                      latencyThresholdMs: (draft.config?.latency_threshold_ms as number) ?? null,
                  }
                : null,
        [draft],
    );

    const { catalogue } = useCatalogue();
    const findings = useFindings(selectedId, scope);

    // Opening a tab is reading it — the whole of the "the dot clears when you
    // look" rule. Depends on `markSeen`, which is stable across renders, rather
    // than on the state object, which is not.
    useMarkTabSeen(findings, tab);

    /**
     * `updated_at` of the row the draft was taken from.
     *
     * Compared against the saved row to detect a publish by someone else while
     * this draft was open. Held in a ref rather than state because changing it
     * must not re-render — it is read at publish time, not drawn.
     */
    const baseline = useRef<string | null>(null);

    /**
     * Choose an initial agent once the list arrives.
     *
     * Deliberately only when nothing is selected. Re-deriving the draft on every
     * `records` change would overwrite an in-progress edit whenever the list
     * refreshed — the edit would vanish with no message, which is the exact
     * silent-clobber the conflict rule exists to prevent. Selection changes go
     * through `selectAgent`, which asks first.
     */
    useEffect(() => {
        if (selectedId || !records.length) return;
        setSelectedId(records[0].id);
        setDraft(records[0]);
        baseline.current = records[0].updated_at ?? null;
    }, [records, selectedId]);

    // After a publish the saved record is the new truth, so re-sync the draft to
    // it — but only when nothing is pending, so this can never eat an edit.
    useEffect(() => {
        if (!selectedId || isDirty) return;
        const saved = records.find((record) => record.id === selectedId);
        if (saved && saved !== draft) {
            setDraft(saved);
            baseline.current = saved.updated_at ?? null;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [records, selectedId]);

    /**
     * Name the version this release will become, so the reviewer sees "Version
     * 4" rather than an unnumbered write. Fetched when the review opens rather
     * than kept current: it is one number on one dialog, and polling it would
     * cost a request per agent selection for something usually unread.
     */
    useEffect(() => {
        if (!isReviewOpen || !selectedId || !context) return;

        let cancelled = false;
        setNextVersion(null);

        api.agentVersions<{ version: number }>(selectedId, context)
            .then(({ data }) => {
                if (cancelled) return;
                const highest = (data ?? []).reduce((max, row) => Math.max(max, row.version), 0);
                setNextVersion(highest + 1);
            })
            // A missing version number is cosmetic; failing to show it must not
            // block the release the reviewer came here to make.
            .catch(() => undefined);

        return () => {
            cancelled = true;
        };
    }, [isReviewOpen, selectedId, context]);

    const selected = records.find((record) => record.id === selectedId) ?? null;

    /**
     * What the release would change, compared against the saved record.
     *
     * The same comparison arms Publish and fills the review dialog, so the two
     * can never disagree — a button enabled by one rule and a diff built by
     * another eventually shows "no changes" on an armed Publish.
     *
     * jsonb columns are compared structurally inside `diffAgents`; identity
     * comparison on objects would report a change on every render and leave
     * Publish permanently armed.
     */
    const changes = diffAgents(selected, draft);
    const isDirty = !!draft && !!selected && changes.length > 0;

    /**
     * The saved row moved since this draft was taken from it — someone else
     * published while it was open. Only meaningful with unsaved edits: a clean
     * draft has already adopted the newer row through the effect above.
     */
    const hasConflict = isDirty && !!selected && baseline.current !== null && (selected.updated_at ?? null) !== baseline.current;

    // Publishing a blocking finding produces an agent that cannot answer a
    // call. The database refuses it too; refusing here names the tab to open.
    const blockingCount = findings.blockingFindings.length;
    const blockingTabs = [...new Set(findings.blockingFindings.map((finding) => finding.tab))].join(", ");

    /**
     * Publish writes the row, sets it published, and appends a snapshot to
     * `agent_versions` — one database function, one transaction. A PATCH
     * with `status: "published"` would update the row and write no history,
     * which is only discovered by someone with nothing to roll back to.
     */
    async function confirmPublish() {
        if (!draft || !context) return;
        setIsSaving(true);
        setPublishError(null);

        try {
            await api.publishAgent(
                draft.id,
                {
                    name: draft.name,
                    provider: draft.provider,
                    model: draft.model,
                    system_prompt: draft.system_prompt,
                    first_message: draft.first_message,
                    voice_config: draft.voice_config ?? {},
                    transcriber_config: draft.transcriber_config ?? {},
                    analysis_config: draft.analysis_config ?? {},
                    compliance_config: draft.compliance_config ?? {},
                    config: draft.config ?? {},
                },
                context,
            );

            // Refetch rather than patching local state: the function sets
            // `published_at`, `updated_at` and `status` server-side, so the row
            // the client holds is not the row that now exists.
            await refresh();
            setIsReviewOpen(false);
            // The release is out. Anything the reader acknowledged was about the
            // draft that has now become the live configuration, so the next
            // change is judged from a clean slate.
            setRewrites([]);
            findings.resetSeen();
        } catch (cause) {
            setPublishError(cause instanceof ApiError ? cause.message : String(cause));
        } finally {
            setIsSaving(false);
        }
    }

    const patch = (changes: Partial<Agent>) => setDraft((current) => (current ? { ...current, ...changes } : current));

    // `tagline`, not `summary`. A select trigger renders the supporting text
    // beside the label, so a sentence there pushes the name out of view — the
    // Provider control read as a paragraph of data-protection guidance with no
    // provider name visible. The sentence belongs on the Compliance row and in
    // the finding, both of which have room for it.
    /**
     * Tab items, carrying their own marker.
     *
     * The marker has to be part of `items` rather than computed inside the
     * render function. React Aria builds the tab collection from the `items`
     * array and caches it; with a module-level constant the array identity
     * never changes, so the collection was built once — before the catalogue
     * had loaded, when every marker was null — and never rebuilt when findings
     * arrived. The dots silently stopped appearing.
     *
     * Keyed off `markerFor`, which only changes when the unseen set does, so
     * this is not a new array on every render.
     */
    const { markerFor } = findings;
    const tabItems = useMemo(
        () => TABS.map((name) => ({ id: name, label: name, badge: <TabMarker severity={markerFor(name)} /> })),
        [markerFor],
    );

    const providerItems = catalogue.providers.map((provider) => ({
        id: provider.id,
        label: provider.label,
        supportingText: provider.tagline,
    }));

    const modelItems = (draft ? modelsFor(catalogue, draft.provider) : []).map((model) => ({
        id: model.id,
        label: model.label,
        supportingText: model.tagline,
    }));

    /**
     * Change the provider, carrying the rest of the configuration with it.
     *
     * A provider change invalidates the voice, the model and often the
     * transcriber, so those are rewritten to the new provider's defaults and the
     * rewrites are reported. Leaving them would put the editor in a state the
     * publish gate refuses, with the reason three tabs away.
     */
    function changeProvider(next: string) {
        if (!draft || next === draft.provider) return;
        const { next: reconciled, rewrites: applied } = reconcileProvider(catalogue, draft, next);
        setDraft(reconciled);
        setRewrites(applied);
    }

    /**
     * Change the model within a provider.
     *
     * Narrower: the voice is unaffected, but a text model with nothing
     * transcribing for it produces a call where the caller speaks and the
     * agent never answers, so that gap is filled rather than flagged.
     */
    function changeModel(next: string) {
        if (!draft || next === draft.model) return;
        const { next: reconciled, rewrites: applied } = reconcileModel(catalogue, draft, next);
        setDraft(reconciled);
        setRewrites(applied);
    }

    /**
     * Switching away from an edited agent loses the edit, and a system
     * prompt is a lot of work to lose to a stray click. Confirm first.
     */
    function selectAgent(id: string) {
        if (id === selectedId) return;
        if (isDirty && !window.confirm("Discard unsaved changes to this agent?")) return;
        const next = records.find((record) => record.id === id) ?? null;
        setSelectedId(id);
        setDraft(next);
        baseline.current = next?.updated_at ?? null;
        setRewrites([]);
    }

    async function createAgent() {
        if (isDirty && !window.confirm("Discard unsaved changes to this agent?")) return;
        setIsCreating(true);
        const created = await create(NEW_AGENT);
        setIsCreating(false);
        if (created) {
            setSelectedId(created.id);
            setDraft(created);
            baseline.current = created.updated_at ?? null;
            setTab("Model");
        }
    }

    // Filter by name only. The subtitle is derived, so matching against it would
    // surface agents whose name has nothing to do with what was typed.
    const visible = query.trim()
        ? records.filter((record) => record.name.toLowerCase().includes(query.trim().toLowerCase()))
        : records;

    if (error) {
        return (
            <div className="grid h-dvh place-items-center p-8">
                <div className="max-w-md text-center">
                    <p className="text-sm font-semibold text-primary">Could not load agents</p>
                    <p className="mt-1 text-sm text-tertiary">{error.message}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="grid h-dvh grid-cols-1 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
            {/* ---------- list ---------- */}
            <aside className="flex min-h-0 flex-col border-secondary lg:border-r">
                <div className="flex items-center justify-between px-5 py-4">
                    <h2 className="text-sm font-semibold text-primary">Agents</h2>
                    <span className="text-sm text-tertiary">{query ? `${visible.length}/${records.length}` : records.length}</span>
                </div>

                <div className="flex flex-col gap-3 px-4 pb-3">
                    <Button size="sm" className="w-full" isLoading={isCreating} showTextWhileLoading onClick={createAgent}>
                        Create Agent
                    </Button>
                    {records.length > 0 && (
                        <Input
                            size="sm"
                            icon={SearchLg}
                            placeholder="Search agents"
                            aria-label="Search agents"
                            value={query}
                            onChange={(value) => setQuery(String(value))}
                        />
                    )}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
                    {/* Skeleton rather than a spinner: it holds the list's shape so
                        nothing jumps when the data arrives. */}
                    {isLoading &&
                        Array.from({ length: 3 }).map((_, index) => (
                            <div key={index} className="mb-0.5 flex flex-col gap-1.5 px-3 py-2.5">
                                <div className="h-3.5 w-2/3 animate-pulse rounded bg-secondary" />
                                <div className="h-2.5 w-1/2 animate-pulse rounded bg-secondary" />
                            </div>
                        ))}

                    {!isLoading && records.length === 0 && (
                        <div className="px-3 py-8 text-center">
                            <p className="text-sm font-medium text-primary">No agents yet</p>
                            <p className="mt-1 text-sm text-tertiary">
                                An agent defines how VoKoo answers a call — what it says, which model thinks, which voice
                                speaks.
                            </p>
                        </div>
                    )}

                    {!isLoading && records.length > 0 && visible.length === 0 && (
                        <p className="px-3 py-8 text-center text-sm text-tertiary">Nothing matches “{query}”.</p>
                    )}

                    {visible.map((agent) => (
                        <button
                            key={agent.id}
                            onClick={() => selectAgent(agent.id)}
                            className={`mb-0.5 block w-full rounded-md px-3 py-2 text-left transition duration-100 ease-linear ${
                                agent.id === selectedId ? "bg-active" : "hover:bg-primary_hover"
                            }`}
                        >
                            <span className="block truncate text-sm font-medium text-primary">{agent.name}</span>
                            <span className="block truncate text-xs text-tertiary">
                                {/* Mirrors the reference's "deepgram · openai · vapi" subtitle, but
                                    describing the stack this agent actually runs on. */}
                                {[
                                    (agent.transcriber_config?.provider as string) ?? "no transcriber",
                                    agent.model,
                                    "kookoo",
                                ].join(" · ")}
                            </span>
                        </button>
                    ))}
                </div>
            </aside>

            {/* ---------- editor ---------- */}
            <section className="flex min-h-0 min-w-0 flex-col overflow-y-auto">
                {!draft ? (
                    <div className="grid flex-1 place-items-center p-8">
                        <p className="text-sm text-tertiary">{isLoading ? "Loading…" : "Select an agent."}</p>
                    </div>
                ) : (
                    <>
                        <header className="border-b border-secondary px-6 pt-5">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h1 className="truncate text-xl font-semibold text-primary">{draft.name}</h1>
                                    <button
                                        onClick={() => copy(draft.id)}
                                        className="mt-0.5 flex items-center gap-1.5 font-mono text-xs text-tertiary hover:text-secondary"
                                        title="Copy agent id"
                                    >
                                        {draft.id}
                                        <Copy01 className="size-3" />
                                        {copied && <span className="font-sans text-brand-secondary">copied</span>}
                                    </button>
                                </div>

                                <div className="flex flex-none items-center gap-2">
                                    <Badge size="sm" type="pill-color" color={statusColor(draft.status)}>
                                        {statusLabel(draft.status)}
                                    </Badge>
                                    {isDirty && (
                                        <Badge size="sm" type="pill-color" color="warning">
                                            Unsaved changes
                                        </Badge>
                                    )}
                                    {hasConflict && (
                                        <Badge size="sm" type="pill-color" color="error">
                                            Published elsewhere
                                        </Badge>
                                    )}
                                    {blockingCount > 0 && (
                                        <Badge size="sm" type="pill-color" color="warning">
                                            {blockingCount === 1 ? "1 issue" : `${blockingCount} issues`}
                                        </Badge>
                                    )}
                                    <Button
                                        size="sm"
                                        color="tertiary"
                                        iconLeading={ClockRewind}
                                        onClick={() => setIsHistoryOpen(true)}
                                        aria-label="Version history"
                                    >
                                        History
                                    </Button>
                                    <Button size="sm" color="secondary">
                                        Test
                                    </Button>
                                    {/* Opens the review rather than publishing:
                                        the write happens after the diff is seen.
                                        Refused outright while a blocking finding
                                        stands — the database would reject it, and
                                        a refusal here names the tab to fix. */}
                                    <Tooltip
                                        title={
                                            blockingCount > 0
                                                ? `${blockingCount === 1 ? "One setting stops" : `${blockingCount} settings stop`} this agent answering a call`
                                                : "Review the changes, then release"
                                        }
                                        description={blockingCount > 0 ? `See ${blockingTabs}.` : undefined}
                                    >
                                        <Button
                                            size="sm"
                                            isDisabled={!isDirty || blockingCount > 0}
                                            onClick={() => {
                                                setPublishError(null);
                                                setIsReviewOpen(true);
                                            }}
                                        >
                                            Publish
                                        </Button>
                                    </Tooltip>
                                </div>
                            </div>

                            {/* Untitled UI Tabs: React Aria handles roving focus
                                and arrow-key navigation, which a row of plain
                                buttons does not. */}
                            <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(key as (typeof TABS)[number])}>
                                <Tabs.List type="underline" className="-mb-px mt-4" items={tabItems}>
                                    {(item) => <Tabs.Item {...item} />}
                                </Tabs.List>
                            </Tabs>

                            <RewriteNotice rewrites={rewrites} onDismiss={() => setRewrites([])} />
                        </header>

                        <div className="min-w-0 p-6">
                            <FindingList findings={findings.forTab(tab)} />

                            {tab === "Model" ? (
                                <ConfigSection icon={ModelSectionIcon} label="Model">
                                    <ConfigCard title="Model" description="Configure the behaviour of the agent.">
                                        <Input
                                            label="Name"
                                            value={draft.name}
                                            onChange={(value) => patch({ name: String(value) })}
                                            hint="Shown in call logs and phone number routing."
                                        />

                                        <div className="grid gap-4 sm:grid-cols-2">
                                            <Select
                                                label="Provider"
                                                items={providerItems}
                                                selectedKey={draft.provider}
                                                onSelectionChange={(key) => changeProvider(String(key))}
                                                hint="Decides where caller audio is processed."
                                            >
                                                {(item) => (
                                                    <Select.Item id={item.id} supportingText={item.supportingText}>
                                                        {item.label}
                                                    </Select.Item>
                                                )}
                                            </Select>

                                            {/* Filtered by provider. An unfiltered list lets you
                                                pick a model that cannot run where you chose to
                                                run it, and the failure surfaces on a call. */}
                                            <Select
                                                label="Model"
                                                items={modelItems}
                                                placeholder={modelItems.length ? "Select a model" : "No models for this provider"}
                                                isDisabled={!modelItems.length}
                                                selectedKey={draft.model}
                                                onSelectionChange={(key) => changeModel(String(key))}
                                            >
                                                {(item) => (
                                                    <Select.Item id={item.id} supportingText={item.supportingText}>
                                                        {item.label}
                                                    </Select.Item>
                                                )}
                                            </Select>
                                        </div>

                                        <Select
                                            label="First Message Mode"
                                            items={FIRST_MESSAGE_MODES}
                                            selectedKey={configValue(draft.config, "first_message_mode", "agent-first")}
                                            onSelectionChange={(key) =>
                                                patch({ config: { ...draft.config, first_message_mode: String(key) } })
                                            }
                                            hint="KooKoo does not stream caller audio until our end sends audio first. User-first still sends priming silence — it never sends nothing."
                                        >
                                            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                                        </Select>

                                        <Input
                                            label="First Message"
                                            value={draft.first_message}
                                            onChange={(value) => patch({ first_message: String(value) })}
                                            placeholder="Hello."
                                        />

                                        <TextArea
                                            label="System Prompt"
                                            rows={10}
                                            value={draft.system_prompt}
                                            onChange={(value) => patch({ system_prompt: String(value) })}
                                            hint="Sent to the model on every turn."
                                        />

                                        <div className="grid gap-4 sm:grid-cols-2">
                                            <Input
                                                label="Max tokens"
                                                type="number"
                                                value={String(configValue(draft.config, "max_tokens", 120))}
                                                onChange={(value) =>
                                                    patch({ config: { ...draft.config, max_tokens: Number(value) || 120 } })
                                                }
                                                hint="Caps reply length. Too low and replies truncate mid-sentence, which on a call sounds like a dropped line."
                                            />
                                            <Input
                                                label="Temperature"
                                                type="number"
                                                value={String(configValue(draft.config, "temperature", 0.4))}
                                                onChange={(value) =>
                                                    patch({ config: { ...draft.config, temperature: Number(value) } })
                                                }
                                                hint="0–2. Higher wanders; a receptionist wants low."
                                            />
                                        </div>

                                        {draft.updated_at && (
                                            <p className="text-sm text-tertiary">Last updated {timeAgo(draft.updated_at)}.</p>
                                        )}
                                    </ConfigCard>
                                </ConfigSection>
                            ) : tab === "Voice" ? (
                                <VoicePanel
                                    config={draft.voice_config}
                                    patch={(next) => patch({ voice_config: next })}
                                    catalogue={catalogue}
                                    provider={draft.provider}
                                />
                            ) : tab === "Transcriber" ? (
                                <TranscriberPanel
                                    config={draft.transcriber_config}
                                    patch={(next) => patch({ transcriber_config: next })}
                                    catalogue={catalogue}
                                    provider={draft.provider}
                                />
                            ) : tab === "Tools" ? (
                                <ToolsPanel />
                            ) : tab === "Analysis" ? (
                                <AnalysisPanel config={draft.analysis_config} patch={(next) => patch({ analysis_config: next })} />
                            ) : tab === "Monitors" ? (
                                <MonitorsPanel config={draft.config} patch={(next) => patch({ config: next })} />
                            ) : tab === "Compliance" ? (
                                <CompliancePanel
                                    config={draft.compliance_config}
                                    patch={(next) => patch({ compliance_config: next })}
                                    catalogue={catalogue}
                                    provider={draft.provider}
                                />
                            ) : (
                                <AdvancedPanel config={draft.config} patch={(next) => patch({ config: next })} />
                            )}
                        </div>
                    </>
                )}
            </section>

            <AgentPublishDialog
                isOpen={isReviewOpen}
                onOpenChange={setIsReviewOpen}
                changes={changes}
                nextVersion={nextVersion}
                conflict={hasConflict ? {} : null}
                isPublishing={isSaving}
                error={publishError}
                onConfirm={confirmPublish}
            />

            <AgentVersionsPanel
                isOpen={isHistoryOpen}
                onOpenChange={setIsHistoryOpen}
                agentId={selectedId}
                context={context}
                current={selected}
                onRestored={() => {
                    // The restore republished an older snapshot, so the draft in
                    // hand is stale. Drop it and take the new row.
                    baseline.current = null;
                    setDraft(null);
                    void refresh();
                }}
            />
        </div>
    );
}

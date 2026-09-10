"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { TextArea } from "@/components/base/textarea/textarea";
import { SearchLg } from "@/components/icons";
import { useNotify } from "@/components/application/notifications/notification-provider";
import { useSession } from "@/hooks/use-session";
import {
    type OperatorCapabilityAdapter,
    type OperatorCapabilityRequest,
    capabilityLabel,
    normalizeOperatorCapabilityAdapters,
    normalizeOperatorCapabilityRequests,
    operatorActions,
} from "@/lib/compiler-capability-requests";
import { compilerCapabilityRequestStatusLabel } from "@/lib/document-workspace";
import { api } from "@/utils/api-client";

const STATUS_FILTERS = [
    { id: "open", label: "Open requests" },
    { id: "all", label: "All requests" },
    { id: "requested", label: "Requested" },
    { id: "under_review", label: "Under review" },
    { id: "needs_information", label: "More information needed" },
    { id: "delivering", label: "Being delivered" },
    { id: "resolved", label: "Resolved" },
    { id: "declined", label: "Declined" },
] as const;

const RECIPIENTS = [
    { id: "primary_team", label: "Primary care team" },
    { id: "on_call", label: "On-call clinician" },
    { id: "clinician", label: "Attached clinician" },
    { id: "coordinator", label: "Care coordinator" },
] as const;

const URGENCIES = [
    { id: "routine", label: "Routine" },
    { id: "soon", label: "Soon" },
    { id: "urgent", label: "Urgent" },
    { id: "immediate", label: "Immediate" },
] as const;

const TERMINAL_STATUSES = new Set(["resolved", "declined", "cancelled"]);
const CONTRACT_LABELS: Readonly<Record<string, string>> = {
    actor: "Responsible role",
    what: "Requested work",
    instructions: "Instructions",
    expires_days: "Due within",
    observation: "Observation",
    operator: "Condition",
    value: "Threshold",
    unit: "Unit",
};

function displayValue(key: string, value: unknown): string {
    if (key === "expires_days" && typeof value === "number") return `${value} days`;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
    return JSON.stringify(value) ?? "Not specified";
}

function statusColor(status: OperatorCapabilityRequest["status"]): "success" | "error" | "warning" | "gray" {
    if (status === "resolved") return "success";
    if (status === "declined" || status === "cancelled") return "error";
    if (status === "needs_information") return "warning";
    return "gray";
}

export function PlatformCapabilityRequestsScreen() {
    const { context, isReady } = useSession();
    const notify = useNotify();
    const [requests, setRequests] = useState<OperatorCapabilityRequest[] | null>(null);
    const [adapters, setAdapters] = useState<OperatorCapabilityAdapter[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState("open");
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        if (!context) return;
        try {
            const [requestResponse, adapterResponse] = await Promise.all([
                api.operatorCapabilityRequests<unknown>(context),
                api.operatorCompilerCapabilityAdapters<unknown>(context),
            ]);
            const normalizedRequests = normalizeOperatorCapabilityRequests(requestResponse.data);
            setRequests(normalizedRequests);
            setAdapters(normalizeOperatorCapabilityAdapters(adapterResponse.data));
            setSelectedId((current) => (current && normalizedRequests.some((item) => item.id === current) ? current : normalizedRequests[0]?.id ?? null));
        } catch (problem) {
            notify.failure("Could not load capability requests", problem);
            setRequests([]);
        }
    }, [context, notify]);

    useEffect(() => {
        if (isReady && context) void load();
    }, [context, isReady, load]);

    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return (requests ?? []).filter((request) => {
            const matchesStatus =
                statusFilter === "all" ||
                (statusFilter === "open" ? !TERMINAL_STATUSES.has(request.status) : request.status === statusFilter);
            const matchesQuery =
                !needle ||
                request.organization_name.toLowerCase().includes(needle) ||
                capabilityLabel(request.capability_key).toLowerCase().includes(needle);
            return matchesStatus && matchesQuery;
        });
    }, [query, requests, statusFilter]);

    useEffect(() => {
        if (selectedId && visible.some((request) => request.id === selectedId)) return;
        setSelectedId(visible[0]?.id ?? null);
    }, [selectedId, visible]);

    const selected = (requests ?? []).find((request) => request.id === selectedId) ?? null;

    const perform = async (work: () => Promise<unknown>, success: string) => {
        setBusy(true);
        try {
            await work();
            await load();
            notify.success(success);
        } catch (problem) {
            notify.failure("Could not update the request", problem);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <header className="shrink-0 border-b border-secondary px-6 py-5 lg:px-8">
                <h1 className="text-display-xs font-semibold text-primary">Capability requests</h1>
            </header>
            <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[22rem_minmax(0,1fr)] lg:overflow-hidden">
                <aside className="flex min-h-[20rem] flex-col border-b border-secondary lg:min-h-0 lg:border-r lg:border-b-0">
                    <div className="shrink-0 space-y-3 border-b border-secondary p-4">
                        <Input
                            size="sm"
                            icon={SearchLg}
                            aria-label="Search capability requests"
                            placeholder="Search requests"
                            value={query}
                            onChange={(value) => setQuery(String(value))}
                        />
                        <Select
                            size="sm"
                            label="Status"
                            selectedKey={statusFilter}
                            onSelectionChange={(key) => setStatusFilter(String(key))}
                            items={[...STATUS_FILTERS]}
                        >
                            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                        </Select>
                    </div>
                    <ol className="min-h-0 flex-1 overflow-y-auto">
                        {visible.map((request) => (
                            <li key={request.id} className="border-b border-secondary last:border-0">
                                <button
                                    type="button"
                                    className={`w-full px-4 py-4 text-left hover:bg-primary_hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand ${selectedId === request.id ? "bg-secondary" : ""}`}
                                    onClick={() => setSelectedId(request.id)}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <p className="text-sm font-medium text-primary">{capabilityLabel(request.capability_key)}</p>
                                        <Badge size="sm" type="pill-color" color={statusColor(request.status)}>
                                            {compilerCapabilityRequestStatusLabel(request.status)}
                                        </Badge>
                                    </div>
                                    <p className="mt-1 truncate text-xs text-tertiary">{request.organization_name}</p>
                                    <p className="mt-2 text-xs text-quaternary">Requested {new Date(request.created_at).toLocaleDateString()}</p>
                                </button>
                            </li>
                        ))}
                    </ol>
                    {requests === null ? <p className="p-4 text-sm text-tertiary">Loading.</p> : null}
                    {requests !== null && visible.length === 0 ? <p className="p-4 text-sm text-tertiary">No matching requests.</p> : null}
                </aside>
                <section className="min-h-0 overflow-y-auto">
                    {selected ? (
                        <CapabilityRequestDetail
                            key={selected.id}
                            request={selected}
                            adapters={adapters.filter((adapter) => adapter.capability_key === selected.capability_key)}
                            busy={busy}
                            onTransition={(action, response) => {
                                if (!context) return;
                                void perform(
                                    () => api.operatorTransitionCapabilityRequest(selected.id, action, { response }, context),
                                    "Request updated",
                                );
                            }}
                            onResolve={(adapter, node, mapping, response) => {
                                if (!context) return;
                                void perform(
                                    () =>
                                        api.operatorResolveCapability(
                                            selected.id,
                                            {
                                                adapter_key: adapter,
                                                node_type_id: node,
                                                mapping,
                                                operator_response: response,
                                            },
                                            context,
                                        ),
                                    "Resolution activated",
                                );
                            }}
                        />
                    ) : (
                        <div className="grid min-h-[20rem] place-items-center p-8 text-sm text-tertiary">Select a request.</div>
                    )}
                </section>
            </div>
        </div>
    );
}

function CapabilityRequestDetail({
    request,
    adapters,
    busy,
    onTransition,
    onResolve,
}: {
    request: OperatorCapabilityRequest;
    adapters: OperatorCapabilityAdapter[];
    busy: boolean;
    onTransition: (action: "review" | "request-information" | "deliver" | "decline", response: string) => void;
    onResolve: (
        adapter: string,
        node: string,
        mapping: { to: "primary_team" | "on_call" | "clinician" | "coordinator"; urgency: "routine" | "soon" | "urgent" | "immediate" },
        response: string,
    ) => void;
}) {
    const availableActions = operatorActions(request);
    const [adapterKey, setAdapterKey] = useState<string>(adapters[0]?.adapter_key ?? "");
    const adapter = adapters.find((item) => item.adapter_key === adapterKey) ?? null;
    const [nodeType, setNodeType] = useState<string>(adapter?.compatible_nodes[0]?.id ?? "");
    const [recipient, setRecipient] = useState<(typeof RECIPIENTS)[number]["id"]>("clinician");
    const [urgency, setUrgency] = useState<(typeof URGENCIES)[number]["id"]>("routine");
    const [note, setNote] = useState(request.operator_response ?? "");
    const contractRows = Object.entries(request.requested_contract).filter(([key, value]) => key in CONTRACT_LABELS && value !== null && value !== "");
    const canResolve = availableActions.includes("resolve_existing") && adapter && nodeType && note.trim();

    return (
        <div className="mx-auto max-w-3xl p-6 lg:p-8">
            <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-start justify-between gap-3 bg-primary px-1 pb-5">
                <div>
                    <h2 className="text-xl font-semibold text-primary">{capabilityLabel(request.capability_key)}</h2>
                    <p className="mt-1 text-sm text-tertiary">{request.organization_name}</p>
                </div>
                <Badge size="sm" type="pill-color" color={statusColor(request.status)}>
                    {compilerCapabilityRequestStatusLabel(request.status)}
                </Badge>
            </div>

            <dl className="grid gap-4 border-y border-secondary py-5 sm:grid-cols-2">
                <div>
                    <dt className="text-xs text-tertiary">Demand</dt>
                    <dd className="mt-1 text-sm font-medium text-primary">{request.demand_count} matching request{request.demand_count === 1 ? "" : "s"}</dd>
                </div>
                <div>
                    <dt className="text-xs text-tertiary">Workspace note</dt>
                    <dd className="mt-1 text-sm text-primary">{request.workspace_note || "No note provided"}</dd>
                </div>
            </dl>

            <section className="mt-6">
                <h3 className="text-sm font-semibold text-primary">Requested contract</h3>
                {contractRows.length > 0 ? (
                    <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-3 text-sm">
                        {contractRows.map(([key, value]) => (
                            <div key={key} className="contents">
                                <dt className="text-tertiary">{CONTRACT_LABELS[key]}</dt>
                                <dd className="break-words text-primary">{displayValue(key, value)}</dd>
                            </div>
                        ))}
                    </dl>
                ) : (
                    <p className="mt-2 text-sm text-tertiary">No structured fields were supplied.</p>
                )}
            </section>

            {availableActions.length > 0 ? (
                <section className="mt-8 border-t border-secondary pt-6">
                    <h3 className="text-sm font-semibold text-primary">Operator action</h3>
                    <TextArea
                        className="mt-4"
                        label="Operator note"
                        rows={3}
                        maxLength={2_000}
                        value={note}
                        onChange={(value) => setNote(String(value))}
                    />

                    {availableActions.includes("resolve_existing") && adapters.length > 0 ? (
                        <div className="mt-5 rounded-xl border border-secondary p-4">
                            <p className="text-sm font-medium text-primary">Use existing capability</p>
                            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                                <Select
                                    label="Adapter"
                                    selectedKey={adapterKey}
                                    onSelectionChange={(key) => {
                                        const next = String(key);
                                        setAdapterKey(next);
                                        setNodeType(adapters.find((item) => item.adapter_key === next)?.compatible_nodes[0]?.id ?? "");
                                    }}
                                    items={adapters.map((item) => ({ id: item.adapter_key, label: item.label }))}
                                >
                                    {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                                </Select>
                                <Select
                                    label="Workflow component"
                                    selectedKey={nodeType}
                                    onSelectionChange={(key) => setNodeType(String(key))}
                                    items={(adapter?.compatible_nodes ?? []).map((item) => ({ id: item.id, label: item.label }))}
                                >
                                    {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                                </Select>
                                <Select label="Recipient" selectedKey={recipient} onSelectionChange={(key) => setRecipient(String(key) as typeof recipient)} items={[...RECIPIENTS]}>
                                    {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                                </Select>
                                <Select label="Urgency" selectedKey={urgency} onSelectionChange={(key) => setUrgency(String(key) as typeof urgency)} items={[...URGENCIES]}>
                                    {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                                </Select>
                            </div>
                            <div className="mt-4 flex justify-end">
                                <Button
                                    size="sm"
                                    isDisabled={!canResolve || busy}
                                    isLoading={busy}
                                    onClick={() => {
                                        if (adapter && nodeType && note.trim()) onResolve(adapter.adapter_key, nodeType, { to: recipient, urgency }, note.trim());
                                    }}
                                >
                                    Activate resolution
                                </Button>
                            </div>
                        </div>
                    ) : null}

                    <div className="mt-5 flex flex-wrap gap-2">
                        {availableActions.includes("review") ? (
                            <Button size="sm" isDisabled={busy} isLoading={busy} onClick={() => onTransition("review", note.trim())}>
                                Start review
                            </Button>
                        ) : null}
                        {availableActions.includes("request_information") ? (
                            <Button size="sm" color="secondary" isDisabled={!note.trim() || busy} onClick={() => onTransition("request-information", note.trim())}>
                                Request information
                            </Button>
                        ) : null}
                        {availableActions.includes("deliver") ? (
                            <Button size="sm" color="secondary" isDisabled={!note.trim() || busy} onClick={() => onTransition("deliver", note.trim())}>
                                Mark as delivering
                            </Button>
                        ) : null}
                        {availableActions.includes("decline") ? (
                            <Button size="sm" color="secondary-destructive" isDisabled={!note.trim() || busy} onClick={() => onTransition("decline", note.trim())}>
                                Decline
                            </Button>
                        ) : null}
                    </div>
                </section>
            ) : null}

            {request.operator_response ? (
                <section className="mt-8 border-t border-secondary pt-5">
                    <h3 className="text-sm font-semibold text-primary">Operator response</h3>
                    <p className="mt-2 text-sm text-tertiary">{request.operator_response}</p>
                </section>
            ) : null}
        </div>
    );
}

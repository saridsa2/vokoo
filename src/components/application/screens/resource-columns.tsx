"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/base/badges/badges";
import { dateTime, duration, phoneNumber, timeAgo } from "@/utils/format";
import { statusColor, statusLabel } from "@/utils/status";

/**
 * Column definitions for the generic resource list.
 *
 * Every list screen reads `/api/v1/{resource}` and differs only in which
 * columns it shows, so the difference lives here as data rather than as fifteen
 * near-identical components that drift apart.
 */

export type Row = Record<string, unknown> & { id: string };

export type ColumnDef = {
    id: string;
    label: string;
    /** Renders the cell. Falls back to the raw field when omitted. */
    render?: (row: Row) => ReactNode;
    /** Hidden below `lg`, for columns that are useful but not identifying. */
    secondary?: boolean;
};

export type ResourceView = {
    /**
     * Where a row leads, when it leads anywhere.
     *
     * Absent means the list is the whole screen. Present, the row becomes a
     * link — which React Aria turns into real navigation, so a middle click and
     * a keyboard both do what a reader expects.
     */
    detailHref?: (row: Row) => string;
    title: string;
    description: string;
    resource: string;
    columns: ColumnDef[];
    /** Shown when the API returns no rows. */
    emptyTitle: string;
    emptyBody: string;
    /** Label for the create action; omitted when the screen is read-only. */
    createLabel?: string;
};

const text = (field: string) => (row: Row) => (row[field] as string) || "—";

const statusCell = (field = "status") =>
    function StatusCell(row: Row) {
        const value = row[field] as string;
        return (
            <Badge size="sm" type="pill-color" color={statusColor(value)}>
                {statusLabel(value)}
            </Badge>
        );
    };

const updated = (field = "updated_at") => (row: Row) => timeAgo(row[field] as string);

export const RESOURCE_VIEWS: Record<string, ResourceView> = {
    "agent-extensions": {
        // "Team", not "Agents". An agent here is a person and an agent under
        // Build is a prompt, and two screens headed the same word leave the
        // reader working out which one they are on from the columns.
        title: "Team",
        description: "The people who take calls the AI hands over.",
        resource: "agent-extensions",
        createLabel: "Add Agent",
        detailHref: (row) => `/team/${row.id}`,
        emptyTitle: "No agents yet",
        emptyBody:
            "An agent is a person with an extension. When a caller asks for somebody, the call is handed to whoever is on duty — the AI stays on the line, muted, and keeps taking notes.",
        columns: [
            { id: "display_name", label: "Name", render: text("display_name") },
            { id: "extension", label: "Extension", render: text("extension") },
            // What Asterisk knows them as. Shown because it is the name in
            // every log line and CLI command, so somebody debugging a call
            // should not have to derive it.
            { id: "endpoint", label: "Endpoint", render: text("endpoint"), secondary: true },
            { id: "status", label: "Status", render: statusCell() },
            { id: "created_at", label: "Added", render: updated("created_at"), secondary: true },
        ],
    },

    skills: {
        title: "Skills",
        description: "What an agent can do, and the tools each one grants.",
        resource: "skills",
        createLabel: "Create Skill",
        detailHref: (row) => `/skills/${row.id}`,
        emptyTitle: "No skills yet",
        emptyBody:
            "A skill is one thing an agent can do — book an appointment, cancel one. It holds the wording the agent uses and the tools it may call.",
        columns: [
            { id: "name", label: "Name", render: text("name") },
            { id: "description", label: "Description", render: text("description") },
            { id: "status", label: "Status", render: statusCell() },
            { id: "updated_at", label: "Updated", render: updated(), secondary: true },
        ],
    },

    tools: {
        title: "Tools",
        description: "Functions and integrations your agents can call.",
        resource: "tools",
        createLabel: "Create Tool",
        detailHref: (row) => `/tools/${row.id}`,
        emptyTitle: "No tools yet",
        emptyBody: "Tools let an agent do something during a call — look up a booking, transfer to a human, end the call.",
        // `kind`, not `type`, and there is no `status` column on this table —
        // both were read from fields that do not exist, so every row showed a
        // name and two dashes. `current_version` is the useful third fact: it
        // separates a tool pushed with the SDK from one made here by hand.
        columns: [
            { id: "name", label: "Name", render: text("name") },
            { id: "kind", label: "Kind", render: text("kind") },
            {
                id: "current_version",
                label: "Version",
                render: (row) => {
                    const version = Number(row.current_version ?? 0);
                    return version > 0 ? `v${version}` : "—";
                },
            },
            { id: "updated_at", label: "Updated", render: updated(), secondary: true },
        ],
    },

    "phone-numbers": {
        title: "Phone Numbers",
        description: "KooKoo/Ozonetel numbers and the agent each one routes to.",
        resource: "phone-numbers",
        detailHref: (row) => `/phone-numbers/${row.id}`,
        createLabel: "Connect Number",
        emptyTitle: "No numbers connected",
        emptyBody: "Connect a KooKoo DID to route incoming calls to an agent.",
        columns: [
            { id: "number", label: "Number", render: (row) => phoneNumber(row.number as string) },
            // `carrier`, not `provider` — there is no `provider` column, so
            // that cell rendered empty on every row.
            { id: "carrier", label: "Carrier", render: text("carrier") },
            {
                id: "answers",
                label: "Answers with",
                // Read from `number_flows`, which is what the bridge resolves.
                // The old cell asked `agent_id` and said "Unassigned" for a
                // number that was answering calls — and somebody fixing that
                // would have assigned an agent, which is not how this routes.
                render: (row) => {
                    const bindings = (row.number_flows ?? []) as {
                        trigger_event: string;
                        flows?: { name?: string } | null;
                    }[];
                    const answered = bindings.find((binding) => binding.trigger_event === "call.answered");
                    if (!answered?.flows?.name) return "Nothing";
                    const after = bindings.filter((binding) => binding.trigger_event !== "call.answered").length;
                    return after > 0 ? `${answered.flows.name} (+${after} after)` : answered.flows.name;
                },
            },
            { id: "status", label: "Status", render: statusCell() },
        ],
    },

    engines: {
        title: "Engines",
        description: "The models and services a call runs through.",
        resource: "engines",
        detailHref: (row) => `/engines/${row.id}`,
        createLabel: "Create Engine",
        emptyTitle: "No engines yet",
        // Deliberately concrete about the two shapes, because they are what an
        // engine chooses between and nothing else in the console explains it.
        emptyBody: "The chain a call runs through: one speech-to-speech model, or listening, thinking and speaking as separate steps.",
        columns: [
            { id: "name", label: "Name", render: text("name") },
            {
                id: "mode",
                label: "Kind",
                // "realtime" and "cascading" are rustvani's words. What a reader
                // needs to know is whether it is one model or a relay.
                render: (row) => (row.mode === "realtime" ? "One model" : "Relay"),
            },
            {
                id: "config",
                label: "Runs through",
                render: (row) => {
                    const config = (row.config ?? {}) as Record<string, { provider?: string; model?: string }>;
                    if (row.mode === "realtime") {
                        const rt = config.realtime ?? {};
                        return [rt.provider, rt.model].filter(Boolean).join(" · ") || "—";
                    }
                    // The relay, in the order a call passes through it.
                    return ["stt", "llm", "tts"].map((stage) => config[stage]?.provider ?? "—").join(" → ");
                },
            },
            { id: "status", label: "Status", render: statusCell() },
            { id: "updated_at", label: "Updated", render: updated(), secondary: true },
        ],
    },

    files: {
        title: "Knowledge",
        description: "Documents an agent can draw on when a caller asks something the prompt does not answer.",
        resource: "files",
        createLabel: "Add document",
        emptyTitle: "Nothing here yet",
        emptyBody: "Add a document — a price list, an FAQ, an admissions policy — and an agent can answer from it instead of improvising.",
        columns: [
            { id: "name", label: "Name", render: text("name") },
            { id: "mime_type", label: "Type", render: text("mime_type"), secondary: true },
            { id: "status", label: "Status", render: statusCell() },
            { id: "created_at", label: "Added", render: updated("created_at"), secondary: true },
        ],
    },

    flows: {
        title: "Flows",
        description: "Visual call flows.",
        resource: "flows",
        createLabel: "Create Flow",
        emptyTitle: "No flows yet",
        emptyBody: "A flow describes a call as a graph of nodes rather than a single prompt.",
        columns: [
            { id: "name", label: "Name", render: text("name") },
            { id: "status", label: "Status", render: statusCell() },
            { id: "updated_at", label: "Updated", render: updated(), secondary: true },
        ],
    },

    "test-suites": {
        title: "Test Suites",
        description: "Scripted conversations run against an agent.",
        resource: "test-suites",
        createLabel: "Create Suite",
        emptyTitle: "No test suites yet",
        emptyBody: "A suite replays scripted conversations against an agent so a prompt change cannot quietly break it.",
        columns: [
            { id: "name", label: "Name", render: text("name") },
            { id: "status", label: "Status", render: statusCell() },
            { id: "updated_at", label: "Last run", render: updated(), secondary: true },
        ],
    },

    evals: {
        title: "Evals",
        description: "Rubrics scored automatically against real calls.",
        resource: "evals",
        createLabel: "Create Eval",
        emptyTitle: "No evals yet",
        emptyBody: "An eval scores finished calls against a rubric — whether the agent confirmed identity, stayed on policy.",
        columns: [
            { id: "name", label: "Name", render: text("name") },
            { id: "status", label: "Status", render: statusCell() },
            { id: "updated_at", label: "Updated", render: updated(), secondary: true },
        ],
    },

    issues: {
        title: "Issues",
        description: "Problems detected in production calls.",
        resource: "issues",
        emptyTitle: "No issues",
        emptyBody: "Issues are raised by monitors when a call fails or behaves oddly. Nothing has been raised yet.",
        columns: [
            { id: "title", label: "Issue", render: text("title") },
            { id: "category", label: "Category", render: text("category"), secondary: true },
            { id: "severity", label: "Severity", render: statusCell("severity") },
            { id: "status", label: "Status", render: statusCell() },
            { id: "created_at", label: "Raised", render: updated("created_at"), secondary: true },
        ],
    },

    monitors: {
        title: "Monitors",
        description: "Rules that watch call quality and reliability.",
        resource: "monitors",
        createLabel: "Create Monitor",
        emptyTitle: "No monitors yet",
        emptyBody: "A monitor watches finished calls and raises an issue when something looks wrong.",
        columns: [
            { id: "name", label: "Name", render: text("name") },
            { id: "status", label: "Status", render: statusCell() },
            { id: "updated_at", label: "Updated", render: updated(), secondary: true },
        ],
    },

    notifiers: {
        title: "Notifiers",
        description: "Where alerts are delivered.",
        resource: "notifiers",
        createLabel: "Add Notifier",
        emptyTitle: "No notifiers yet",
        emptyBody: "Add a webhook or email address so issues reach someone rather than sitting in the console.",
        columns: [
            { id: "name", label: "Name", render: text("name") },
            { id: "type", label: "Type", render: text("type") },
            { id: "status", label: "Status", render: statusCell() },
        ],
    },

    boards: {
        title: "Boards",
        description: "Saved analytics views.",
        resource: "boards",
        createLabel: "Create Board",
        emptyTitle: "No boards yet",
        emptyBody: "A board is a saved set of charts over your call data.",
        columns: [
            { id: "name", label: "Name", render: text("name") },
            { id: "updated_at", label: "Updated", render: updated(), secondary: true },
        ],
    },

    "chat-logs": {
        title: "Chat Logs",
        description: "Text conversations.",
        resource: "chat-logs",
        emptyTitle: "No chats yet",
        emptyBody: "Text conversations appear here. VoKoo currently answers voice calls only.",
        columns: [
            { id: "id", label: "Chat", render: (row) => String(row.id).slice(0, 8) },
            { id: "status", label: "Status", render: statusCell() },
            { id: "created_at", label: "Started", render: (row) => dateTime(row.created_at as string) },
        ],
    },

    "structured-outputs": {
        title: "Structured Outputs",
        description: "JSON schemas extracted from conversations.",
        resource: "structured-outputs",
        createLabel: "Create Output",
        emptyTitle: "No structured outputs yet",
        emptyBody: "Define a schema and the agent will extract it from each call — appointment details, callback numbers.",
        columns: [
            { id: "name", label: "Name", render: text("name") },
            { id: "type", label: "Type", render: text("type"), secondary: true },
            { id: "updated_at", label: "Updated", render: updated(), secondary: true },
        ],
    },

    "call-logs": {
        title: "Call Logs",
        description: "Every call, with transcript and recording.",
        resource: "call-logs",
        detailHref: (row) => `/call-logs/${row.id}`,
        emptyTitle: "No calls recorded yet",
        emptyBody: "Calls answered by the telephony bridge appear here.",
        columns: [
            { id: "from_number", label: "From", render: (row) => phoneNumber(row.from_number as string) },
            { id: "to_number", label: "To", render: (row) => phoneNumber(row.to_number as string), secondary: true },
            { id: "duration_seconds", label: "Duration", render: (row) => duration(row.duration_seconds as number) },
            { id: "status", label: "Status", render: statusCell() },
            { id: "started_at", label: "Started", render: (row) => dateTime(row.started_at as string) },
        ],
    },
};

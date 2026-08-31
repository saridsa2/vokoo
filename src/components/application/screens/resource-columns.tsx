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
    squads: {
        title: "Squads",
        description: "Hand a call from one agent to another mid-conversation.",
        resource: "squads",
        createLabel: "Create Squad",
        emptyTitle: "No squads yet",
        emptyBody: "A squad lets one agent transfer a live call to another — for example reception handing off to billing.",
        columns: [
            { id: "name", label: "Name", render: text("name") },
            { id: "status", label: "Status", render: statusCell() },
            { id: "updated_at", label: "Updated", render: updated(), secondary: true },
        ],
    },

    tools: {
        title: "Tools",
        description: "Functions and integrations your agents can call.",
        resource: "tools",
        createLabel: "Create Tool",
        emptyTitle: "No tools yet",
        emptyBody: "Tools let an agent do something during a call — look up a booking, transfer to a human, end the call.",
        columns: [
            { id: "name", label: "Name", render: text("name") },
            { id: "type", label: "Type", render: text("type") },
            { id: "status", label: "Status", render: statusCell() },
            { id: "updated_at", label: "Updated", render: updated(), secondary: true },
        ],
    },

    "phone-numbers": {
        title: "Phone Numbers",
        description: "KooKoo/Ozonetel numbers and the agent each one routes to.",
        resource: "phone-numbers",
        createLabel: "Connect Number",
        emptyTitle: "No numbers connected",
        emptyBody: "Connect a KooKoo DID to route incoming calls to an agent.",
        columns: [
            { id: "number", label: "Number", render: (row) => phoneNumber(row.number as string) },
            { id: "provider", label: "Provider", render: text("provider") },
            { id: "agent_id", label: "Agent", render: (row) => (row.agent_id ? "Assigned" : "Unassigned") },
            { id: "status", label: "Status", render: statusCell() },
        ],
    },

    "voice-library": {
        title: "Voice Library",
        description: "Voices available to your agents.",
        resource: "voice-library",
        emptyTitle: "No voices synced",
        emptyBody: "Voices come from the speech engines running on your own hardware — Qwen3-TTS and Kokoro.",
        columns: [
            { id: "name", label: "Voice", render: text("name") },
            { id: "provider", label: "Engine", render: text("provider") },
            { id: "language", label: "Language", render: text("language") },
            { id: "status", label: "Status", render: statusCell() },
        ],
    },

    files: {
        title: "Files",
        description: "Knowledge assets and their ingestion status.",
        resource: "files",
        createLabel: "Upload File",
        emptyTitle: "No files yet",
        emptyBody: "Upload documents an agent can draw on during a call.",
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
        emptyTitle: "No calls recorded yet",
        emptyBody:
            "Calls answered by the telephony bridge appear here once it writes them to the control plane. The bridge currently logs to the server journal instead.",
        columns: [
            { id: "from_number", label: "From", render: (row) => phoneNumber(row.from_number as string) },
            { id: "to_number", label: "To", render: (row) => phoneNumber(row.to_number as string), secondary: true },
            { id: "duration_seconds", label: "Duration", render: (row) => duration(row.duration_seconds as number) },
            { id: "status", label: "Status", render: statusCell() },
            { id: "started_at", label: "Started", render: (row) => dateTime(row.started_at as string) },
        ],
    },
};

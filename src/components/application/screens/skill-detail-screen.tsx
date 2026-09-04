"use client";

/**
 * One skill: what the agent is told, and what it may call.
 *
 * Editable, unlike a tool's source. A tool pushed with the SDK has its authority
 * in a repository, so editing it here would make the console a second author.
 * A skill's wording has no repository — this screen is where it is written.
 *
 * The tool list is the reason this screen exists. `compose_agent_tools` walks
 * agent → skills → tools, so a tool that is not attached to a skill the agent
 * has is one the model is never declared — it can be described in the prompt and
 * still be uncallable, which is how a real call once reported "Internal error
 * checking slots" for a tool it had no channel to invoke.
 *
 * Until now that link could only be edited in SQL.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
// Still used by the collected-fields editor, where a single toggle is not a table.
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input } from "@/components/base/input/input";
import { Label } from "@/components/base/input/label";
import { InfoHint } from "@/components/base/tooltip/info-hint";
import { Table, TableCard } from "@/components/application/table/table";
import { ArrowLeft, Check, Plus, Trash01 } from "@/components/icons";
import { api } from "@/utils/api-client";
import { useNotify } from "@/components/application/notifications/notification-provider";
import { useSession } from "@/hooks/use-session";

type Skill = {
    id: string;
    name: string;
    slug: string;
    description: string;
    instructions: string | null;
    completion: string | null;
    status: string;
    collects?: unknown;
};

type Tool = { id: string; name: string; description: string; kind: string; current_version?: number };

/** One thing the agent has to get from the caller before the skill can finish. */
type Collected = { name: string; label: string; type: string; required?: boolean };
type SkillTool = { id: string; tool_id: string; sort_order: number };

export const SkillDetailScreen = ({ skillId }: { skillId: string }) => {
    const { context, isReady } = useSession();
    const notify = useNotify();

    const [skill, setSkill] = useState<Skill | null>(null);
    // The edited copy. `skill` stays as it was loaded, so Save can tell what
    // moved and a failed save does not leave the screen claiming a change it
    // did not make.
    const [draft, setDraft] = useState<Skill | null>(null);
    const [collects, setCollects] = useState<Collected[]>([]);
    const [tools, setTools] = useState<Tool[]>([]);
    const [granted, setGranted] = useState<Set<string>>(new Set());
    const [saved, setSaved] = useState<Set<string>>(new Set());
    const [saving, setSaving] = useState(false);
    /** Why the screen has nothing to show. What went wrong is a notification. */
    const [unopened, setUnopened] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    useEffect(() => {
        if (!isReady || !context) return;
        let live = true;
        (async () => {
            try {
                const [detail, allTools, links] = await Promise.all([
                    api.get<Skill>("skills", skillId, context),
                    api.list<Tool>("tools", context),
                    api.skillTools<SkillTool>(skillId, context),
                ]);
                if (!live) return;
                setSkill(detail.data);
                setDraft(detail.data);
                setCollects(Array.isArray(detail.data.collects) ? (detail.data.collects as Collected[]) : []);
                setTools(allTools.data ?? []);
                const ids = new Set((links.data ?? []).map((row) => row.tool_id));
                setGranted(ids);
                // Kept apart so the Save button can tell whether anything moved.
                setSaved(new Set(ids));
            } catch (problem) {
                if (!live) return;
                setUnopened(true);
                notify.failure("Could not open this skill", problem);
            }
        })();
        return () => {
            live = false;
        };
    }, [skillId, context, isReady, notify]);

    const toolsChanged = useMemo(
        () => granted.size !== saved.size || [...granted].some((id) => !saved.has(id)),
        [granted, saved],
    );
    const proseChanged = useMemo(() => {
        if (!skill || !draft) return false;
        return (
            skill.name !== draft.name ||
            skill.description !== draft.description ||
            (skill.instructions ?? "") !== (draft.instructions ?? "") ||
            (skill.completion ?? "") !== (draft.completion ?? "") ||
            JSON.stringify(skill.collects ?? []) !== JSON.stringify(collects)
        );
    }, [skill, draft, collects]);
    const changed = toolsChanged || proseChanged;

    const edit = (patch: Partial<Skill>) => {
        setNote(null);
        setDraft((current) => (current ? { ...current, ...patch } : current));
    };

    const toggle = (toolId: string) => {
        setNote(null);
        setGranted((current) => {
            const next = new Set(current);
            if (next.has(toolId)) next.delete(toolId);
            else next.add(toolId);
            return next;
        });
    };

    const save = useCallback(async () => {
        if (!context) return;
        setSaving(true);
        try {
            if (proseChanged && draft) {
                // Only the fields this screen owns. Sending the whole row back
                // would carry `status` along with it, and publishing is its own
                // decision rather than something a wording edit does quietly.
                const updated = await api.update<Skill>(
                    "skills",
                    skillId,
                    {
                        name: draft.name,
                        description: draft.description,
                        instructions: draft.instructions,
                        completion: draft.completion,
                        collects: collects.filter((field) => field.name.trim()),
                    },
                    context,
                );
                setSkill(updated.data);
            }

            // Ordered by the list on screen, so `sort_order` matches what a
            // reader saw rather than the order they happened to click.
            const ids = tools.filter((tool) => granted.has(tool.id)).map((tool) => tool.id);
            await api.setSkillTools(skillId, ids, context);
            setSaved(new Set(ids));
            setNote(
                ids.length === 0
                    ? "Saved. This skill grants no tools, so agents can talk about it but not act."
                    : `Saved. Agents with this skill can now call ${ids.length === 1 ? "1 tool" : `${ids.length} tools`}.`,
            );
        } catch (problem) {
            notify.failure("Could not save this skill", problem);
        } finally {
            setSaving(false);
        }
    }, [context, skillId, tools, granted, proseChanged, draft, collects, notify]);

    /**
     * Publishing is what makes a skill reachable at all: both prompt composers
     * filter on `status = 'published'`, so a draft is invisible to every agent.
     */
    const publish = useCallback(async () => {
        if (!context || !skill) return;
        setSaving(true);
        const next = skill.status === "published" ? "draft" : "published";
        try {
            const updated = await api.update<Skill>("skills", skillId, { status: next }, context);
            setSkill(updated.data);
            setDraft((current) => (current ? { ...current, status: next } : current));
            setNote(
                next === "published"
                    ? "Published. Agents with this skill will use it on the next call."
                    : "Unpublished. No agent will offer this until it is published again.",
            );
        } catch (problem) {
            notify.failure(
                next === "published" ? "Could not publish this skill" : "Could not unpublish this skill",
                problem,
            );
        } finally {
            setSaving(false);
        }
    }, [context, skill, skillId, notify]);

    if (unopened && !skill) {
        return (
            <div className="p-8">
                <p className="text-md text-tertiary">
                    This skill could not be opened. It may have been deleted, or the request did not reach the server.
                </p>
            </div>
        );
    }

    // Below xl the columns stack and the page scrolls, as any page does. Side by
    // side they are two separate readings — a list you scan and wording you
    // write — so each gets its own scroll and neither drags the other past its
    // heading.
    return (
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6 lg:p-8 xl:overflow-hidden">
            <header className="flex flex-col gap-3">
                <Button href="/skills" color="link-gray" size="sm" iconLeading={ArrowLeft} className="self-start">
                    Skills
                </Button>

                {/* The action sits with the title, not inside the section it
                    happens to affect — it is what you came to this page to do,
                    and it stays put as the sections below change. */}
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-3">
                            <h1 className="text-display-xs font-semibold text-primary">{draft?.name ?? "…"}</h1>
                            {skill ? (
                                <Badge color={skill.status === "published" ? "success" : "gray"} size="sm">
                                    {skill.status}
                                </Badge>
                            ) : null}
                        </div>
                                {skill?.status === "draft" ? (
                            <p className="text-sm text-tertiary">
                                A draft is not offered to any agent. Publish it when the wording is right.
                            </p>
                        ) : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                        {skill ? (
                            <Button
                                size="sm"
                                color="secondary"
                                isDisabled={saving || changed}
                                onClick={publish}
                                // Disabled while there are unsaved edits:
                                // publishing then would release wording that is
                                // not what is on screen.
                                title={changed ? "Save your changes first" : undefined}
                            >
                                {skill.status === "published" ? "Unpublish" : "Publish"}
                            </Button>
                        ) : null}
                        <Button
                            size="sm"
                            iconLeading={Check}
                            isDisabled={!changed || saving}
                            isLoading={saving}
                            showTextWhileLoading
                            onClick={save}
                        >
                            {saving ? "Saving…" : "Save"}
                        </Button>
                    </div>
                </div>
            </header>

            <div className="grid gap-6 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <section className="flex min-w-0 flex-col gap-3 xl:min-h-0">
                    <h2 className="flex items-center gap-1.5 text-lg font-semibold text-primary">
                        Tools this skill grants
                        <InfoHint title="An agent can only call the tools its skills grant. Anything else, it hands to a person." />
                    </h2>

                    {note ? <p className="text-sm text-brand-secondary">{note}</p> : null}

                    {/* Only the list scrolls. The heading and anything just
                        saved stay where they were put. */}
                    <div className="xl:min-h-0 xl:flex-1 xl:overflow-y-auto">

                    {tools.length === 0 ? (
                        <p className="text-sm text-tertiary">
                            This workspace has no tools yet. Push one with the vokoo CLI, or create one on the Tools
                            screen.
                        </p>
                    ) : (
                        // The kit's table, with its own selection column. A row
                        // of hand-placed checkboxes lines up only by accident,
                        // and this one also lets a whole set be picked at once.
                        <TableCard.Root size="sm">
                            <Table
                                aria-label="Tools this skill grants"
                                selectionMode="multiple"
                                selectedKeys={granted}
                                onSelectionChange={(keys) => {
                                    setNote(null);
                                    setGranted(
                                        keys === "all" ? new Set(tools.map((tool) => tool.id)) : new Set([...keys].map(String)),
                                    );
                                }}
                            >
                                <Table.Header>
                                    <Table.Head id="name" label="Tool" isRowHeader />
                                    <Table.Head id="description" label="What it does" />
                                    <Table.Head id="kind" label="Kind" className="hidden lg:table-cell" />
                                </Table.Header>
                                <Table.Body items={tools}>
                                    {(tool) => (
                                        <Table.Row id={tool.id}>
                                            <Table.Cell className="font-mono whitespace-nowrap text-primary">
                                                {tool.name}
                                            </Table.Cell>
                                            <Table.Cell>{tool.description || "—"}</Table.Cell>
                                            <Table.Cell className="hidden lg:table-cell">
                                                <span className="flex items-center gap-2">
                                                    <Badge color="gray" size="sm">
                                                        {tool.kind}
                                                    </Badge>
                                                    {tool.current_version ? (
                                                        <span className="text-xs text-quaternary">v{tool.current_version}</span>
                                                    ) : null}
                                                </span>
                                            </Table.Cell>
                                        </Table.Row>
                                    )}
                                </Table.Body>
                            </Table>
                        </TableCard.Root>
                    )}
                    </div>
                </section>

                <section className="flex min-w-0 flex-col gap-3 xl:min-h-0">
                    <h2 className="flex items-center gap-1.5 text-lg font-semibold text-primary">
                        What the agent is told
                        <InfoHint title="Folded into the agent's prompt alongside its other skills." />
                    </h2>

                    {/* pr-1 so a focus ring on a field is not clipped by its
                        own scroll container. */}
                    <div className="flex flex-col gap-5 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:px-1 xl:pb-8">
                    <Input
                        label="Name"
                        value={draft?.name ?? ""}
                        onChange={(value) => edit({ name: String(value) })}
                    />

                    {/* The trigger. The model matches a caller's request against
                        this, so it is written as the situation, not the task. */}
                    <Field
                        label="When to use it"
                        hint="The situation, in the caller's terms."
                        placeholder="the caller wants to cancel a booking they already have"
                        value={draft?.description ?? ""}
                        onChange={(value) => edit({ description: value })}
                        rows={2}
                    />

                    <Field
                        label="What the agent does"
                        hint="How to handle it, and anything it must confirm first."
                        placeholder="Confirm the reference back to the caller before cancelling."
                        value={draft?.instructions ?? ""}
                        onChange={(value) => edit({ instructions: value })}
                        rows={4}
                    />

                    <Collects value={collects} onChange={(next) => { setNote(null); setCollects(next); }} />

                    {/* The stop condition. Without one the agent keeps going
                        after the caller's need is met. */}
                    <Field
                        label="When it is finished"
                        hint="What has to be true for this to be done."
                        placeholder="The booking is cancelled and the caller has been told so."
                        value={draft?.completion ?? ""}
                        onChange={(value) => edit({ completion: value })}
                        rows={2}
                    />
                    </div>
                </section>
            </div>
        </div>
    );
};

const Field = ({
    label,
    hint,
    placeholder,
    value,
    onChange,
    rows,
}: {
    label: string;
    /** Shown on the help icon rather than as a line under the label. */
    hint: string;
    placeholder: string;
    value: string;
    onChange: (value: string) => void;
    rows: number;
}) => (
    <div className="flex flex-col gap-1.5">
        {/* The kit's Label, so this help icon is the same one every input in
            the console already has. */}
        <Label>
            {label}
            <InfoHint title={hint} />
        </Label>
        <textarea
            rows={rows}
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            className="w-full resize-y rounded-lg bg-primary p-3 text-sm text-primary ring-1 ring-primary placeholder:text-placeholder focus:outline-2 focus:outline-offset-2 focus:outline-brand-solid"
        />
    </div>
);

/**
 * What the agent has to get from the caller before the skill can finish.
 *
 * A row at a time, because this is a short list somebody reads aloud in their
 * head — "doctor, day, patient name" — not a schema they design.
 */
const Collects = ({ value, onChange }: { value: Collected[]; onChange: (next: Collected[]) => void }) => {
    const set = (index: number, patch: Partial<Collected>) =>
        onChange(value.map((field, i) => (i === index ? { ...field, ...patch } : field)));

    return (
        <div className="flex flex-col gap-2">
            <Label>
                What it needs from the caller
                <InfoHint title="The agent keeps asking until it has these. Leave empty if it needs nothing." />
            </Label>

            {value.map((field, index) => (
                <div key={index} className="flex items-center gap-2">
                    <Input
                        size="sm"
                        aria-label="Label"
                        placeholder="Patient name"
                        value={field.label}
                        // The name is what a tool receives; the label is what a
                        // person reads. Derived so nobody maintains both.
                        onChange={(next) =>
                            set(index, {
                                label: String(next),
                                name: String(next).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""),
                            })
                        }
                    />
                    <Checkbox
                        isSelected={field.required !== false}
                        onChange={(checked) => set(index, { required: checked })}
                        label="Required"
                    />
                    <Button
                        size="sm"
                        color="tertiary-destructive"
                        iconLeading={Trash01}
                        aria-label={`Remove ${field.label || "field"}`}
                        onClick={() => onChange(value.filter((_, i) => i !== index))}
                    />
                </div>
            ))}

            <Button
                size="sm"
                color="secondary"
                iconLeading={Plus}
                className="self-start"
                onClick={() => onChange([...value, { name: "", label: "", type: "string", required: true }])}
            >
                Add
            </Button>
        </div>
    );
};

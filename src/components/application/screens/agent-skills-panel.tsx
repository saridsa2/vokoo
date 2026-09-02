"use client";

/**
 * The skills an agent has, and what they let it do.
 *
 * This replaces a panel that offered to attach tools directly, which this schema
 * does not do: tools belong to skills, and skills belong to agents. Both prompt
 * composers walk agent → skills → tools, so this is the switch that decides what
 * an agent is told and what it is allowed to call.
 *
 * The tool list below the picker is derived, not chosen. It is the answer to
 * "so what can this agent actually do", which is otherwise only answerable by
 * opening every skill in turn.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Check, IconAgents } from "@/components/icons";
import { InfoHint } from "@/components/base/tooltip/info-hint";
import { Table, TableCard } from "@/components/application/table/table";
import { api } from "@/utils/api-client";
import { useSession } from "@/hooks/use-session";

type Skill = { id: string; name: string; description: string; status: string };
type SkillTool = { id: string; tool_id: string };
type Tool = { id: string; name: string };
type AgentSkill = { id: string; skill_id: string };

export const AgentSkillsPanel = ({ agentId }: { agentId: string }) => {
    const { context, isReady } = useSession();

    const [skills, setSkills] = useState<Skill[]>([]);
    const [tools, setTools] = useState<Tool[]>([]);
    const [grantsBySkill, setGrantsBySkill] = useState<Record<string, string[]>>({});
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [saved, setSaved] = useState<Set<string>>(new Set());
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);

    useEffect(() => {
        if (!isReady || !context || !agentId) return;
        let live = true;
        (async () => {
            try {
                const [allSkills, allTools, mine] = await Promise.all([
                    api.list<Skill>("skills", context),
                    api.list<Tool>("tools", context),
                    api.agentSkills<AgentSkill>(agentId, context),
                ]);
                if (!live) return;
                setSkills(allSkills.data ?? []);
                setTools(allTools.data ?? []);
                const ids = new Set((mine.data ?? []).map((row) => row.skill_id));
                setSelected(ids);
                setSaved(new Set(ids));

                // One request per skill. There are a handful of them, and a
                // dedicated endpoint would be a second way to ask the same
                // question.
                const grants = await Promise.all(
                    (allSkills.data ?? []).map(async (skill) => {
                        const links = await api.skillTools<SkillTool>(skill.id, context);
                        return [skill.id, (links.data ?? []).map((row) => row.tool_id)] as const;
                    }),
                );
                if (!live) return;
                setGrantsBySkill(Object.fromEntries(grants));
            } catch (problem) {
                if (live) setError((problem as Error).message);
            }
        })();
        return () => {
            live = false;
        };
    }, [agentId, context, isReady]);

    const changed = useMemo(
        () => selected.size !== saved.size || [...selected].some((id) => !saved.has(id)),
        [selected, saved],
    );

    /** What the agent can call, once these skills are on it. */
    const reachable = useMemo(() => {
        const names = new Map(tools.map((tool) => [tool.id, tool.name]));
        const ids = new Set<string>();
        for (const skillId of selected) for (const toolId of grantsBySkill[skillId] ?? []) ids.add(toolId);
        return [...ids].map((id) => names.get(id) ?? id).sort();
    }, [selected, grantsBySkill, tools]);

    /** A published skill reaches a call; a draft never does. */
    const draftsSelected = useMemo(
        () => skills.filter((skill) => selected.has(skill.id) && skill.status !== "published"),
        [skills, selected],
    );

    const save = useCallback(async () => {
        if (!context) return;
        setSaving(true);
        setError(null);
        try {
            const ids = skills.filter((skill) => selected.has(skill.id)).map((skill) => skill.id);
            await api.setAgentSkills(agentId, ids, context);
            setSaved(new Set(ids));
            setNote(ids.length === 0 ? "Saved. No skills attached." : "Saved.");
        } catch (problem) {
            setError((problem as Error).message);
        } finally {
            setSaving(false);
        }
    }, [context, agentId, skills, selected]);

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="flex items-center gap-1.5 text-lg font-semibold text-primary">
                    Skills
                    <InfoHint title="What this agent can do. Each skill brings its own tools." />
                </h3>
                <Button size="sm" iconLeading={Check} isDisabled={!changed || saving} isLoading={saving} showTextWhileLoading onClick={save}>
                    {saving ? "Saving…" : "Save"}
                </Button>
            </div>

            {note ? <p className="text-sm text-brand-secondary">{note}</p> : null}
            {error ? <p className="text-sm text-error-primary">{error}</p> : null}

            {skills.length === 0 ? (
                <EmptyPanel />
            ) : (
                <TableCard.Root size="sm">
                    <Table
                        aria-label="Skills this agent has"
                        selectionMode="multiple"
                        selectedKeys={selected}
                        onSelectionChange={(keys) => {
                            setNote(null);
                            setSelected(keys === "all" ? new Set(skills.map((s) => s.id)) : new Set([...keys].map(String)));
                        }}
                    >
                        <Table.Header>
                            <Table.Head id="name" label="Skill" isRowHeader />
                            <Table.Head id="description" label="When it is used" />
                            <Table.Head id="tools" label="Brings" className="hidden lg:table-cell" />
                        </Table.Header>
                        <Table.Body items={skills}>
                            {(skill) => (
                                <Table.Row id={skill.id}>
                                    <Table.Cell className="whitespace-nowrap text-primary">
                                        <span className="flex items-center gap-2">
                                            {skill.name}
                                            {skill.status !== "published" ? (
                                                <Badge color="gray" size="sm">
                                                    draft
                                                </Badge>
                                            ) : null}
                                        </span>
                                    </Table.Cell>
                                    <Table.Cell>{skill.description || "—"}</Table.Cell>
                                    <Table.Cell className="hidden lg:table-cell">
                                        {(grantsBySkill[skill.id] ?? []).length || "no"} tools
                                    </Table.Cell>
                                </Table.Row>
                            )}
                        </Table.Body>
                    </Table>
                </TableCard.Root>
            )}

            {draftsSelected.length > 0 ? (
                <p className="text-sm text-warning-primary">
                    {draftsSelected.map((skill) => skill.name).join(", ")}{" "}
                    {draftsSelected.length === 1 ? "is a draft" : "are drafts"}. Publish to use on calls.
                </p>
            ) : null}

            <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-1.5 text-sm font-medium text-secondary">
                    What this agent can call
                    <InfoHint title="Every tool the selected skills bring." />
                </span>
                {reachable.length === 0 ? (
                    <p className="text-sm text-tertiary">Nothing yet.</p>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {reachable.map((name) => (
                            <span key={name} className="rounded-md bg-secondary px-2 py-1 font-mono text-xs text-secondary ring-1 ring-primary">
                                {name}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

const EmptyPanel = () => (
    <div className="flex flex-col items-start gap-2 rounded-lg bg-secondary p-6 ring-1 ring-primary">
        <IconAgents className="size-5 text-fg-quaternary" aria-hidden="true" />
        <p className="text-md font-medium text-primary">No skills yet</p>
        <p className="max-w-lg text-sm text-tertiary">
            Create one under Build → Skills, give it the tools it needs, then attach it here.
        </p>
    </div>
);

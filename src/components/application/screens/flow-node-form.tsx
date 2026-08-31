"use client";

import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { Toggle } from "@/components/base/toggle/toggle";
import { Button } from "@/components/base/buttons/button";
import { Trash01 } from "@/components/icons";
import type { CatalogueNodeType } from "@/utils/capability-registry";
import type { FlowNode } from "@/utils/flow-graph";

/**
 * A node's settings, generated from the registry.
 *
 * The registry declares each node type's fields, so this renders a form for a
 * node type it has never seen — which is the point of the registry being data.
 * A new carrier action becomes a row and its form appears with it.
 *
 * There is no Apply button. A field writes on change, the canvas updates, and
 * the header shows the flow as unsaved. An Apply button on a panel that already
 * shows what it is editing invites someone to close it and lose the edit.
 */

const WEEKDAYS = [
    { value: 1, label: "Mon" },
    { value: 2, label: "Tue" },
    { value: 3, label: "Wed" },
    { value: 4, label: "Thu" },
    { value: 5, label: "Fri" },
    { value: 6, label: "Sat" },
    { value: 7, label: "Sun" },
];

type AgentOption = { id: string; name: string; status: string };

export function FlowNodeForm({
    node,
    definition,
    agents,
    onChange,
    onRename,
    onDelete,
    onMakeStart,
    isStart,
}: {
    node: FlowNode;
    definition: CatalogueNodeType | null;
    agents: AgentOption[];
    onChange: (changes: Record<string, unknown>) => void;
    onRename: (name: string) => void;
    onDelete: () => void;
    onMakeStart: () => void;
    isStart: boolean;
}) {
    const fields = definition?.fields ?? [];

    return (
        <div className="flex flex-col gap-5">
            <div>
                <p className="text-xs tracking-wide text-tertiary uppercase">{definition?.label ?? node.implementation}</p>
                {definition?.description && <p className="mt-1.5 text-sm text-tertiary">{definition.description}</p>}
            </div>

            <Input
                label="Name"
                value={node.name}
                onChange={(value) => onRename(String(value))}
                hint="Shown on the canvas and in the call log."
            />

            {fields.length === 0 ? (
                <p className="text-sm text-tertiary">Nothing to configure.</p>
            ) : (
                <div className="flex flex-col gap-4">
                    {fields.map((field) => (
                        <Field
                            key={field.key}
                            field={field}
                            value={node.config[field.key]}
                            agents={agents}
                            onChange={(value) => onChange({ [field.key]: value })}
                        />
                    ))}
                </div>
            )}

            {definition?.suspends && (
                <p className="border border-secondary bg-secondary px-3 py-2 text-xs text-tertiary">
                    This node waits. If nothing happens within{" "}
                    {(node.config.timeout_seconds as number) ?? definition.default_timeout_seconds}s it finishes as{" "}
                    <span className="font-mono">timeout</span>, so wire that outcome somewhere.
                </p>
            )}

            <div className="flex flex-col gap-2 border-t border-secondary pt-4">
                {!isStart && (
                    <Button size="sm" color="secondary" onClick={onMakeStart}>
                        Answer the call here
                    </Button>
                )}
                <Button size="sm" color="tertiary-destructive" iconLeading={Trash01} onClick={onDelete}>
                    Delete node
                </Button>
            </div>
        </div>
    );
}

function Field({
    field,
    value,
    agents,
    onChange,
}: {
    field: { key: string; label: string; type: string; required?: boolean; hint?: string };
    value: unknown;
    agents: AgentOption[];
    onChange: (value: unknown) => void;
}) {
    switch (field.type) {
        case "boolean":
            return (
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-secondary">{field.label}</p>
                        {field.hint && <p className="mt-0.5 text-xs text-tertiary">{field.hint}</p>}
                    </div>
                    <Toggle size="sm" aria-label={field.label} isSelected={value === true} onChange={onChange} />
                </div>
            );

        case "agent":
            return (
                <Select
                    label={field.label}
                    isRequired={field.required}
                    items={agents.map((agent) => ({ id: agent.id, label: agent.name, supportingText: agent.status }))}
                    placeholder={agents.length ? "Choose an agent" : "No agents yet"}
                    isDisabled={!agents.length}
                    selectedKey={typeof value === "string" ? value : null}
                    onSelectionChange={(key) => onChange(String(key))}
                    // A draft agent may not answer a call, so the state is part
                    // of the choice rather than something discovered at publish.
                    hint={field.hint}
                >
                    {(item) => (
                        <Select.Item id={item.id} supportingText={item.supportingText}>
                            {item.label}
                        </Select.Item>
                    )}
                </Select>
            );

        case "weekdays": {
            const days = Array.isArray(value) ? (value as number[]) : [];
            return (
                <div>
                    <p className="text-sm font-medium text-secondary">{field.label}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                        {WEEKDAYS.map((day) => {
                            const on = days.includes(day.value);
                            return (
                                <button
                                    key={day.value}
                                    type="button"
                                    aria-pressed={on}
                                    onClick={() =>
                                        onChange(
                                            on
                                                ? days.filter((d) => d !== day.value)
                                                : [...days, day.value].sort((a, b) => a - b),
                                        )
                                    }
                                    className={`px-2 py-1 text-xs transition duration-100 ease-linear ${
                                        on
                                            ? "bg-brand-solid text-white"
                                            : "text-tertiary ring-1 ring-secondary hover:text-secondary"
                                    }`}
                                >
                                    {day.label}
                                </button>
                            );
                        })}
                    </div>
                    {field.hint && <p className="mt-1 text-xs text-tertiary">{field.hint}</p>}
                </div>
            );
        }

        case "number":
            return (
                <Input
                    label={field.label}
                    type="number"
                    isRequired={field.required}
                    value={value === undefined || value === null ? "" : String(value)}
                    onChange={(next) => onChange(next === "" ? undefined : Number(next))}
                    hint={field.hint}
                />
            );

        // `time`, `phone`, `url`, `text`, `expression` and `code` are all a
        // single line today. They are listed apart because each will grow its
        // own control — a time picker, a country-aware phone field — and
        // collapsing them now would hide which ones still need one.
        case "time":
        case "phone":
        case "url":
        case "expression":
        case "code":
        case "text":
        default:
            return (
                <Input
                    label={field.label}
                    isRequired={field.required}
                    value={typeof value === "string" ? value : ""}
                    onChange={(next) => onChange(String(next))}
                    hint={field.hint}
                    className={field.type === "expression" || field.type === "code" ? "font-mono" : undefined}
                />
            );
    }
}

"use client";

/**
 * Schemas: every named shape in the workspace, wherever it came from.
 *
 * A registry entry is a shape something **else** wants: an intelligence node
 * fills one in, a webhook sends one on, a tool names one with `inputSchema`.
 *
 * A tool's inline `input` is deliberately **not** here. It is private to that
 * tool, and listing it made the registry a directory of everything rather than
 * of what is shared — a reader would click a schema and arrive at a tool. A
 * tool that wants a shared shape references one, and then it appears here on
 * its own, once.
 *
 * **Fields rather than raw JSON.** The vocabulary is deliberately the one the
 * tools SDK already uses for a tool's inputs — name, type, description,
 * required — because they compile to the same JSON Schema and are read by the
 * same kind of model. A textarea of raw schema would be quicker to build and
 * would make the first mistake invisible until a call had already ended.
 *
 * What it will not express is nesting. A flat object covers a CRM row, which is
 * what these are for, and the day it does not the answer is a real schema
 * editor rather than a half-nested one.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { ScreenHeader } from "@/components/application/screen/screen-header";
import { IconLock, Trash01, SearchLg } from "@/components/icons";
import { api } from "@/utils/api-client";
import { useNotify } from "@/components/application/notifications/notification-provider";
import { useSession } from "@/hooks/use-session";

/** The types the SDK's `compileSchema` accepts, and nothing it does not. */
const TYPES = ["string", "number", "integer", "boolean"] as const;

type Field = { name: string; type: string; description: string; required: boolean };

type Shape = {
    id: string;
    name: string;
    description: string;
    schema: { type?: string; properties?: Record<string, Record<string, unknown>>; required?: string[] };
    enabled: boolean;
    locked: boolean;
    origin: "console" | "push";
    updated_at?: string;
};

/** A stored schema, back as rows somebody can edit. */
function toFields(schema: Shape["schema"]): Field[] {
    const required = new Set(schema?.required ?? []);
    return Object.entries(schema?.properties ?? {}).map(([name, property]) => ({
        name,
        type: typeof property.type === "string" ? property.type : "string",
        description: typeof property.description === "string" ? property.description : "",
        required: required.has(name),
    }));
}

/**
 * Rows back to a schema.
 *
 * `required: []` is left out rather than emitted empty — it means the same
 * thing and some validators reject it, which is the same rule the SDK follows.
 */
function toSchema(fields: Field[]): Shape["schema"] {
    const properties: Record<string, Record<string, unknown>> = {};
    const required: string[] = [];
    for (const field of fields) {
        const name = field.name.trim();
        if (!name) continue;
        properties[name] = field.description.trim()
            ? { type: field.type, description: field.description.trim() }
            : { type: field.type };
        if (field.required) required.push(name);
    }
    return required.length > 0
        ? { type: "object", properties, required }
        : { type: "object", properties };
}

export function SchemasScreen() {
    const router = useRouter();
    const { context, isReady } = useSession();
    const notify = useNotify();
    const [shapes, setShapes] = useState<Shape[]>([]);
    /**
     * Who names each schema, by schema id.
     *
     * Both kinds, because either alone is a half-truth: a card showing only
     * tools would read as unused while a post-call flow depended on it. A
     * schema nothing names is worth seeing too — it is the one safe to change.
     */
    const [usedBy, setUsedBy] = useState<Map<string, { label: string; kind: "tool" | "flow" }[]>>(new Map());
    const [query, setQuery] = useState("");
    const [editing, setEditing] = useState<Shape | null>(null);
    const [creating, setCreating] = useState(false);

    const load = useCallback(async () => {
        if (!context) return;
        try {
            const { data } = await api.list<Shape>("structured-outputs", context);
            setShapes(data ?? []);

            const [tools, flows] = await Promise.all([
                api.list<{ id: string; name: string; schema_id: string | null }>("tools", context),
                api.list<{ id: string; name: string; graph: { nodes?: { config?: Record<string, unknown> }[] } }>(
                    "flows",
                    context,
                ),
            ]);

            const uses = new Map<string, { label: string; kind: "tool" | "flow" }[]>();
            const note = (schemaId: string | null | undefined, label: string, kind: "tool" | "flow") => {
                if (!schemaId) return;
                const seen = uses.get(schemaId) ?? [];
                // A flow may fill the same schema at two nodes; it is still one
                // flow, and two identical pills would read as two dependents.
                if (!seen.some((entry) => entry.label === label && entry.kind === kind)) {
                    uses.set(schemaId, [...seen, { label, kind }]);
                }
            };

            for (const tool of tools.data ?? []) note(tool.schema_id, tool.name, "tool");
            for (const flow of flows.data ?? []) {
                for (const node of flow.graph?.nodes ?? []) {
                    note(node.config?.shape_id as string | undefined, flow.name, "flow");
                }
            }
            setUsedBy(uses);
        } catch (problem) {
            notify.failure("Could not load the schemas", problem);
        }
    }, [context, notify]);

    useEffect(() => {
        if (isReady) void load();
    }, [isReady, load]);

    const needle = query.trim().toLowerCase();
    const visible = needle
        ? shapes.filter((shape) => `${shape.name} ${shape.description}`.toLowerCase().includes(needle))
        : shapes;

    return (
        <>
            <ScreenHeader
                title="Schemas"
                description="Named shapes — what a tool takes, and what a call gets read into."
                search={
                    <div className="w-full md:w-64">
                        <Input
                            icon={SearchLg}
                            placeholder="Search schemas"
                            value={query}
                            onChange={(value) => setQuery(String(value))}
                            aria-label="Search schemas"
                        />
                    </div>
                }
                actions={
                    <Button size="sm" onClick={() => setCreating(true)}>
                        New schema
                    </Button>
                }
            />

            <div className="min-h-0 flex-1 overflow-y-auto p-6">
                {visible.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-secondary p-12 text-center">
                        <p className="text-sm font-medium text-primary">
                            {shapes.length === 0 ? "No schemas yet" : "No schemas match that"}
                        </p>
                        <p className="mx-auto mt-1 max-w-md text-sm text-tertiary">
                            A schema is a named shape: what a tool takes as its input, or what a finished call
                            gets read into. Tools bring their own; the rest are written here.
                        </p>
                    </div>
                ) : (
                    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {visible.map((shape) => {
                            const fields = toFields(shape.schema);
                            return (
                                <li key={shape.id}>
                                    <button
                                        type="button"
                                        onClick={() => router.push(`/structured-outputs/${shape.id}`)}
                                        className="flex h-full w-full flex-col gap-3 rounded-xl bg-primary p-5 text-left ring-1 ring-secondary transition duration-100 ease-linear hover:ring-brand"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <p className="text-sm font-semibold text-primary">{shape.name}</p>
                                            {shape.locked ? (
                                                // The icon rather than a word:
                                                // it appears on every card that
                                                // has one, and a column of
                                                // "locked" reads as noise.
                                                <IconLock
                                                    className="size-3.5 shrink-0 text-fg-quaternary"
                                                    aria-label={
                                                        shape.origin === "push"
                                                            ? "Locked — authored in a repository"
                                                            : "Locked"
                                                    }
                                                />
                                            ) : shape.enabled ? null : (
                                                <Badge size="sm" color="gray" type="pill-color">
                                                    off
                                                </Badge>
                                            )}
                                        </div>
                                        {shape.description ? (
                                            <p className="line-clamp-2 text-sm text-tertiary">{shape.description}</p>
                                        ) : null}
                                        <p className="mt-auto text-xs text-quaternary">
                                            {fields.length} {fields.length === 1 ? "field" : "fields"}
                                            {fields.length > 0 ? ` · ${fields.map((f) => f.name).join(", ")}` : ""}
                                        </p>

                                        {/* Who would notice if this changed. A
                                            schema with no pills is the one that
                                            is safe to edit. */}
                                        {(usedBy.get(shape.id) ?? []).length > 0 ? (
                                            <div className="flex flex-wrap gap-1.5">
                                                {(usedBy.get(shape.id) ?? []).map((user) => (
                                                    <Badge
                                                        key={`${user.kind}-${user.label}`}
                                                        size="sm"
                                                        // Told apart by shape, not by a colour the
                                                        // palette does not contain. This app's accent
                                                        // is ink — purple and blue were arbitrary, and
                                                        // purple is the borrowed editor's accent, not
                                                        // ours.
                                                        type={user.kind === "tool" ? "modern" : "pill-color"}
                                                        color="gray"
                                                    >
                                                        {user.label}
                                                    </Badge>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-xs text-quaternary">Nothing names this yet</p>
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}

            </div>

            {creating || editing ? (
                <ShapeDialog
                    shape={editing}
                    onClose={() => {
                        setCreating(false);
                        setEditing(null);
                    }}
                    onSaved={(id) => {
                        setCreating(false);
                        setEditing(null);
                        if (id) router.push(`/structured-outputs/${id}`);
                        else void load();
                    }}
                />
            ) : null}
        </>
    );
}

function ShapeDialog({
    shape,
    onClose,
    onSaved,
}: {
    shape: Shape | null;
    onClose: () => void;
    onSaved: (id?: string) => void;
}) {
    const { context } = useSession();
    const notify = useNotify();
    const [name, setName] = useState(shape?.name ?? "");
    const [description, setDescription] = useState(shape?.description ?? "");
    const [fields, setFields] = useState<Field[]>(
        shape ? toFields(shape.schema) : [{ name: "", type: "string", description: "", required: false }],
    );
    const [saving, setSaving] = useState(false);

    const save = async () => {
        if (!context || !name.trim()) return;
        setSaving(true);
        const body = { name: name.trim(), description: description.trim(), schema: toSchema(fields) };
        try {
            if (shape) {
                await api.update("structured-outputs", shape.id, body, context);
                onSaved();
            } else {
                const { data } = await api.create<{ id: string }>(
                    "structured-outputs",
                    { ...body, enabled: true },
                    context,
                );
                // Straight into the editor, where the compiled JSON is.
                onSaved(data.id);
            }
        } catch (problem) {
            notify.failure("Could not save the schema", problem);
        } finally {
            setSaving(false);
        }
    };

    const set = (index: number, patch: Partial<Field>) =>
        setFields((rows) => rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));

    return (
        <ModalOverlay isOpen onOpenChange={(next) => !next && onClose()} isDismissable={!saving}>
            <Modal className="max-w-2xl">
                <Dialog>
                    <div className="flex max-h-[85vh] w-full flex-col gap-5 overflow-y-auto rounded-xl bg-primary p-6 shadow-xl ring-1 ring-secondary">
                        <div className="flex flex-col gap-1">
                            <h2 className="text-lg font-semibold text-primary">
                                {shape ? shape.name : "New schema"}
                            </h2>
                            <p className="text-sm text-tertiary">
                                Each field&rsquo;s description is read by the model deciding what to put in it, so
                                write it for that reader.
                            </p>
                        </div>

                        <Input label="Name" placeholder="Clinic lead" value={name} onChange={(v) => setName(String(v))} isRequired />
                        <Input
                            label="What it is for"
                            placeholder="What a clinic wants in its CRM after a call."
                            value={description}
                            onChange={(v) => setDescription(String(v))}
                        />

                        <fieldset className="flex flex-col gap-2">
                            <legend className="text-sm font-medium text-secondary">Fields</legend>
                            {fields.map((field, index) => (
                                <div
                                    key={index}
                                    className="grid grid-cols-[minmax(0,1fr)_7rem_minmax(0,1.4fr)_auto_2rem] items-center gap-2"
                                >
                                    <input
                                        className="h-9 rounded-lg bg-primary px-3 text-sm text-primary ring-1 ring-secondary outline-none focus:ring-brand"
                                        placeholder="patient_name"
                                        aria-label="Field name"
                                        value={field.name}
                                        onChange={(event) => set(index, { name: event.target.value })}
                                    />
                                    <select
                                        className="h-9 rounded-lg bg-primary px-2 text-sm text-primary ring-1 ring-secondary outline-none focus:ring-brand"
                                        aria-label="Type"
                                        value={field.type}
                                        onChange={(event) => set(index, { type: event.target.value })}
                                    >
                                        {TYPES.map((type) => (
                                            <option key={type} value={type}>
                                                {type}
                                            </option>
                                        ))}
                                    </select>
                                    <input
                                        className="h-9 rounded-lg bg-primary px-3 text-sm text-primary ring-1 ring-secondary outline-none focus:ring-brand"
                                        placeholder="The caller's name, as they said it"
                                        aria-label="Description"
                                        value={field.description}
                                        onChange={(event) => set(index, { description: event.target.value })}
                                    />
                                    <label className="flex items-center gap-1.5 text-xs text-tertiary">
                                        <input
                                            type="checkbox"
                                            checked={field.required}
                                            onChange={(event) => set(index, { required: event.target.checked })}
                                        />
                                        required
                                    </label>
                                    <button
                                        type="button"
                                        aria-label="Remove field"
                                        className="grid size-8 place-items-center rounded-lg text-fg-quaternary hover:bg-error-primary hover:text-error-primary"
                                        onClick={() => setFields((rows) => rows.filter((_, at) => at !== index))}
                                    >
                                        <Trash01 className="size-4" aria-hidden="true" />
                                    </button>
                                </div>
                            ))}
                            <Button
                                size="sm"
                                color="secondary"
                                className="self-start"
                                onClick={() =>
                                    setFields((rows) => [...rows, { name: "", type: "string", description: "", required: false }])
                                }
                            >
                                Add a field
                            </Button>
                        </fieldset>

                        <div className="flex justify-end gap-2">
                            <Button color="secondary" size="sm" onClick={onClose} isDisabled={saving}>
                                Cancel
                            </Button>
                            <Button size="sm" onClick={save} isDisabled={!name.trim()} isLoading={saving}>
                                Save
                            </Button>
                        </div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}

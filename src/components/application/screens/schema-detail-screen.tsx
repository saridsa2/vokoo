"use client";

/**
 * One schema: fields on the left, the JSON they compile to on the right.
 *
 * The right pane is the reason this is a screen rather than a dialog. **The
 * compiled schema is what the model is actually shown** — the rows are how you
 * write it. Whether `required` landed where you meant, or an enum matched its
 * field's type, is a question about the JSON, and until it was visible beside
 * the fields the answer arrived when a call failed.
 *
 * The same shape as the tool editor next door, and for the same reason: a
 * record is a place you go, and the pane that tells you whether it works
 * belongs beside it rather than a click away.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { ArrowLeft, IconLock, IconUnlock, Trash01 } from "@/components/icons";
import { api } from "@/utils/api-client";
import { useSession } from "@/hooks/use-session";

/** The types the SDK's `compileSchema` accepts, and nothing it does not. */
const TYPES = ["string", "number", "integer", "boolean"] as const;

type Field = { name: string; type: string; description: string; required: boolean };

type Schema = {
    id: string;
    name: string;
    description: string;
    schema: { type?: string; properties?: Record<string, Record<string, unknown>>; required?: string[] };
    enabled: boolean;
    locked: boolean;
    origin: "console" | "push";
};

function toFields(schema: Schema["schema"]): Field[] {
    const required = new Set(schema?.required ?? []);
    return Object.entries(schema?.properties ?? {}).map(([name, property]) => ({
        name,
        type: typeof property.type === "string" ? property.type : "string",
        description: typeof property.description === "string" ? property.description : "",
        required: required.has(name),
    }));
}

/**
 * Rows back to a schema — the same rules `compileSchema` follows in the SDK.
 *
 * Kept in step deliberately: this is what the right pane shows, and if it
 * disagreed with what the push produces then the preview would be describing a
 * schema nothing ever runs.
 */
function toSchema(fields: Field[]): Schema["schema"] {
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
    // `required: []` is rejected by some validators and means what saying
    // nothing means, so it is left out rather than emitted empty.
    return required.length > 0
        ? { type: "object", properties, required }
        : { type: "object", properties };
}

export function SchemaDetailScreen({ schemaId }: { schemaId: string }) {
    const { context, isReady } = useSession();

    const [schema, setSchema] = useState<Schema | null>(null);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [fields, setFields] = useState<Field[]>([]);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);
    /** Tools that named this schema. Deleting or changing it reaches them. */
    const [usedBy, setUsedBy] = useState<{ id: string; name: string }[]>([]);

    useEffect(() => {
        if (!isReady || !context) return;
        let live = true;
        (async () => {
            try {
                const { data } = await api.get<Schema>("structured-outputs", schemaId, context);
                if (!live) return;
                setSchema(data);
                setName(data.name);
                setDescription(data.description ?? "");
                setFields(toFields(data.schema));

                const tools = await api.list<{ id: string; name: string; schema_id: string | null }>("tools", context);
                if (live) setUsedBy((tools.data ?? []).filter((tool) => tool.schema_id === schemaId));
            } catch (problem) {
                if (live) setError((problem as Error).message);
            }
        })();
        return () => {
            live = false;
        };
    }, [schemaId, context, isReady]);

    // Recomputed as you type. This is the whole point of the right pane.
    const compiled = useMemo(() => toSchema(fields), [fields]);

    const set = useCallback(
        (index: number, patch: Partial<Field>) =>
            setFields((rows) => rows.map((row, at) => (at === index ? { ...row, ...patch } : row))),
        [],
    );

    /**
     * Lock or unlock, for a schema this console made.
     *
     * A lock on something written here is somebody saying "this is settled" —
     * and the same person may change their mind. A lock on something pushed
     * from a repository is not ours to lift: the database refuses it, and this
     * is why the button is absent rather than disabled with an explanation
     * nobody asked for.
     */
    const setLock = async (locked: boolean) => {
        if (!context || !schema || schema.origin === "push") return;
        setSaving(true);
        setError(null);
        try {
            await api.update("structured-outputs", schema.id, { locked }, context);
            setSchema({ ...schema, locked });
        } catch (problem) {
            setError((problem as Error).message);
        } finally {
            setSaving(false);
        }
    };

    const save = async () => {
        if (!context || !schema) return;
        setSaving(true);
        setError(null);
        setSaved(false);
        try {
            await api.update(
                "structured-outputs",
                schema.id,
                { name: name.trim(), description: description.trim(), schema: compiled },
                context,
            );
            setSaved(true);
        } catch (problem) {
            setError((problem as Error).message);
        } finally {
            setSaving(false);
        }
    };

    if (error && !schema) {
        return (
            <div className="grid h-full place-items-center p-8">
                <div className="max-w-md text-center">
                    <p className="text-sm font-medium text-primary">Could not open this schema</p>
                    <p className="mt-1 text-sm text-tertiary">{error}</p>
                </div>
            </div>
        );
    }

    if (!schema) {
        return (
            <div className="flex min-h-0 flex-1 flex-col p-6">
                <p className="text-sm text-tertiary">Loading…</p>
            </div>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <header className="flex shrink-0 flex-col gap-3 border-b border-secondary p-6 lg:px-8">
                <Button href="/structured-outputs" color="link-gray" size="sm" iconLeading={ArrowLeft} className="self-start">
                    Schemas
                </Button>

                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                        <h1 className="text-display-xs font-semibold text-primary">{schema.name}</h1>
                        {schema.locked ? (
                            <Badge color="gray" size="sm" type="modern">
                                {schema.origin === "push" ? "authored elsewhere" : "locked"}
                            </Badge>
                        ) : null}
                        {usedBy.length > 0 ? (
                            <Badge color="brand" size="sm" type="pill-color">
                                used by {usedBy.length} {usedBy.length === 1 ? "tool" : "tools"}
                            </Badge>
                        ) : null}
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Only for what this console made. A pushed schema is
                            released at its source, and offering a button that
                            the database refuses would be worse than offering
                            none. */}
                        {schema.origin === "console" ? (
                            <Button
                                color="secondary"
                                size="sm"
                                iconLeading={schema.locked ? IconUnlock : IconLock}
                                isDisabled={saving}
                                onClick={() => void setLock(!schema.locked)}
                            >
                                {schema.locked ? "Unlock" : "Lock"}
                            </Button>
                        ) : null}
                        {schema.locked ? null : (
                            <Button size="sm" onClick={save} isLoading={saving}>
                                {saved ? "Saved" : "Save"}
                            </Button>
                        )}
                    </div>
                </div>

                {schema.locked ? (
                    // Said once, plainly, where the edit would have been. The
                    // database refuses it either way; a screen that offered the
                    // edit and then reported a failure would be worse than one
                    // that never offered it.
                    <p className="max-w-2xl text-sm text-tertiary">
                        {schema.origin === "push" ? (
                            <>
                                This schema was pushed from a repository, so it is edited where it is written. Push it
                                again with <code className="text-secondary">locked: false</code> to release it, or
                                delete the file to take it over here.
                            </>
                        ) : (
                            "Locked so it is not changed by accident. Unlock it to edit."
                        )}
                    </p>
                ) : null}

                {error ? <p className="text-sm text-error-primary">{error}</p> : null}
            </header>

            <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto p-6 lg:px-8 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] xl:overflow-hidden">
                <section className="flex flex-col gap-4 xl:min-h-0 xl:overflow-y-auto xl:pr-1">
                    <Input label="Name" value={name} onChange={(v) => setName(String(v))} isDisabled={schema.locked} />
                    <Input
                        label="What it is for"
                        hint="Read by a person choosing between schemas, and by the model filling this one in."
                        value={description}
                        onChange={(v) => setDescription(String(v))}
                        isDisabled={schema.locked}
                    />

                    <fieldset className="flex flex-col gap-2">
                        <legend className="text-sm font-medium text-secondary">Fields</legend>
                        {fields.map((field, index) => (
                            <div
                                key={index}
                                className="grid grid-cols-[minmax(0,1fr)_6.5rem_minmax(0,1.3fr)_auto_2rem] items-center gap-2"
                            >
                                <input
                                    className="h-9 rounded-lg bg-primary px-3 text-sm text-primary ring-1 ring-secondary outline-none focus:ring-brand disabled:opacity-50"
                                    placeholder="patient_name"
                                    aria-label="Field name"
                                    value={field.name}
                                    disabled={schema.locked}
                                    onChange={(event) => set(index, { name: event.target.value })}
                                />
                                <select
                                    className="h-9 rounded-lg bg-primary px-2 text-sm text-primary ring-1 ring-secondary outline-none focus:ring-brand disabled:opacity-50"
                                    aria-label="Type"
                                    value={field.type}
                                    disabled={schema.locked}
                                    onChange={(event) => set(index, { type: event.target.value })}
                                >
                                    {TYPES.map((type) => (
                                        <option key={type} value={type}>
                                            {type}
                                        </option>
                                    ))}
                                </select>
                                <input
                                    className="h-9 rounded-lg bg-primary px-3 text-sm text-primary ring-1 ring-secondary outline-none focus:ring-brand disabled:opacity-50"
                                    placeholder="The caller's name, as they said it"
                                    aria-label="Description"
                                    value={field.description}
                                    disabled={schema.locked}
                                    onChange={(event) => set(index, { description: event.target.value })}
                                />
                                <label className="flex items-center gap-1.5 text-xs text-tertiary">
                                    <input
                                        type="checkbox"
                                        checked={field.required}
                                        disabled={schema.locked}
                                        onChange={(event) => set(index, { required: event.target.checked })}
                                    />
                                    required
                                </label>
                                <button
                                    type="button"
                                    aria-label="Remove field"
                                    disabled={schema.locked}
                                    className="grid size-8 place-items-center rounded-lg text-fg-quaternary hover:bg-error-primary hover:text-error-primary disabled:opacity-50"
                                    onClick={() => setFields((rows) => rows.filter((_, at) => at !== index))}
                                >
                                    <Trash01 className="size-4" aria-hidden="true" />
                                </button>
                            </div>
                        ))}
                        {schema.locked ? null : (
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
                        )}
                    </fieldset>

                    {usedBy.length > 0 ? (
                        <div className="flex flex-col gap-2 rounded-lg bg-secondary p-4">
                            <p className="text-sm font-medium text-primary">Named by</p>
                            <p className="text-sm text-tertiary">
                                These tools carry a snapshot of this schema taken when they were pushed. Changing it
                                here does not change theirs — push them again to bring them into step.
                            </p>
                            <ul className="flex flex-wrap gap-2">
                                {usedBy.map((tool) => (
                                    <li key={tool.id}>
                                        <Button href={`/tools/${tool.id}`} color="secondary" size="sm">
                                            {tool.name}
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                </section>

                <aside className="flex flex-col gap-2 xl:min-h-0">
                    <h2 className="text-sm font-semibold text-secondary">What the model is shown</h2>
                    <p className="text-sm text-tertiary">
                        Compiled from the fields, and identical to what a push produces.
                    </p>
                    <pre className="min-h-0 flex-1 overflow-auto rounded-lg bg-secondary p-4 font-mono text-xs text-primary">
                        {JSON.stringify(compiled, null, 2)}
                    </pre>
                </aside>
            </div>
        </div>
    );
}

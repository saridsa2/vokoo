/**
 * What changed between two agent configurations.
 *
 * Publishing an agent changes what real callers hear, so the release is
 * reviewed before it is written. That review needs a field-level comparison,
 * not a "there are changes" boolean — the whole point is to see which field.
 *
 * The five jsonb columns are compared key by key rather than as blobs. A whole
 * -object diff on `config` would report "config changed" for a one-key edit,
 * which tells the reader nothing they did not already know.
 */

export type JsonConfig = Record<string, unknown>;

export type FieldChange = {
    /** Column, and key within it for jsonb fields. */
    column: string;
    key?: string;
    /** Human label for the row. */
    label: string;
    before: unknown;
    after: unknown;
    kind: "added" | "removed" | "changed";
};

/** Scalar columns, in the order they appear in the editor. */
export const SCALAR_FIELDS = [
    "name",
    // The engine is the biggest change anyone can make to an agent — it decides
    // how the call sounds and whether tools can be called at all. It was missing
    // here, so switching engines produced no diff, the editor never became
    // dirty, and Publish stayed disabled with nothing saying why.
    "engine_id",
    "provider",
    "model",
    "first_message",
    "system_prompt",
] as const;

/** jsonb columns, each backing one tab. */
export const CONFIG_FIELDS = ["voice_config", "transcriber_config", "analysis_config", "compliance_config", "config"] as const;

const COLUMN_LABELS: Record<string, string> = {
    name: "Name",
    engine_id: "Engine",
    provider: "Provider",
    model: "Model",
    first_message: "First message",
    system_prompt: "System prompt",
    voice_config: "Voice",
    transcriber_config: "Transcriber",
    analysis_config: "Analysis",
    compliance_config: "Compliance",
    config: "Advanced",
};

export function columnLabel(column: string) {
    return COLUMN_LABELS[column] ?? column;
}

/** `max_tokens` reads as "Max tokens" — the stored key is not a label. */
function keyLabel(key: string) {
    return key.replace(/[_-]+/g, " ").replace(/^./, (character) => character.toUpperCase());
}

function same(a: unknown, b: unknown) {
    // Structural, not identity: two objects with equal contents are equal here,
    // or every render would report a change on every jsonb column.
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

type Comparable = Record<string, unknown> | null | undefined;

/**
 * Compare a draft against the record it will replace.
 *
 * Both arguments are the same shape; `before` is the currently saved row and
 * `after` is the draft. A null `before` (a never-published agent) yields
 * every populated field as an addition, which reads correctly for a first
 * release.
 */
export function diffAgents(before: Comparable, after: Comparable): FieldChange[] {
    if (!after) return [];
    const changes: FieldChange[] = [];

    for (const column of SCALAR_FIELDS) {
        const previous = before?.[column];
        const next = after[column];
        if (same(previous, next)) continue;
        changes.push({
            column,
            label: columnLabel(column),
            before: previous,
            after: next,
            kind: previous == null || previous === "" ? "added" : next == null || next === "" ? "removed" : "changed",
        });
    }

    for (const column of CONFIG_FIELDS) {
        const previous = (before?.[column] ?? {}) as JsonConfig;
        const next = (after[column] ?? {}) as JsonConfig;
        const keys = [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort();

        for (const key of keys) {
            if (same(previous[key], next[key])) continue;
            changes.push({
                column,
                key,
                label: `${columnLabel(column)} · ${keyLabel(key)}`,
                before: previous[key],
                after: next[key],
                kind: !(key in previous) ? "added" : !(key in next) ? "removed" : "changed",
            });
        }
    }

    return changes;
}

/** A value as one line of review text. */
export function formatValue(value: unknown): string {
    if (value === undefined || value === null || value === "") return "—";
    if (typeof value === "boolean") return value ? "on" : "off";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

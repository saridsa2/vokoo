/**
 * Turning a tool's declared inputs into the JSON Schema everything else reads.
 *
 * There is one declaration and three readers, and they must not drift:
 *
 *  - Gemini takes it as a function declaration's `parameters`. The bridge passes
 *    `tools.schema` through unchanged (`vokoo_bridge.rs:132`) rather than
 *    translating it, so whatever this emits is what the model is shown.
 *  - The dispatcher validates arguments against it before running anything
 *    (`supabase/functions/tools/index.ts`). It reads `required` as a list of
 *    names and `properties[key].type` as a primitive name.
 *  - The composer renders a config form from it.
 *
 * A schema that satisfies one reader and not another produces the worst failure
 * this system has: the model is shown one contract, calls it correctly, and the
 * executor rejects the call. So the shape emitted here is deliberately plain —
 * an object with typed properties and a list of required names, and nothing a
 * reader might not understand.
 */

/** The types a caller can be asked for. Matched to what the dispatcher checks. */
export const INPUT_TYPES = ["string", "number", "integer", "boolean", "array", "object"] as const;

export type InputType = (typeof INPUT_TYPES)[number];

export type InputField = {
    type: InputType;
    /** Shown to the model. Write it for a reader deciding what to pass. */
    description?: string;
    /** Absent means optional. */
    required?: boolean;
    /** A closed set of acceptable values. */
    enum?: readonly (string | number)[];
    /** The element type, for `array`. */
    items?: { type: InputType };
};

export type InputMap = Record<string, InputField>;

export type JsonSchema = {
    type: "object";
    properties: Record<string, Record<string, unknown>>;
    required?: string[];
};

/**
 * Compile declared inputs to JSON Schema.
 *
 * Throws on anything a reader downstream would silently misinterpret. Failing
 * here costs a build; failing later costs a caller mid-sentence.
 */
export function compileSchema(input: InputMap | undefined): JsonSchema {
    const properties: Record<string, Record<string, unknown>> = {};
    const required: string[] = [];

    for (const [name, field] of Object.entries(input ?? {})) {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
            throw new Error(
                `input "${name}" is not a usable argument name — use letters, digits and underscores, starting with a letter`,
            );
        }
        if (!field || typeof field !== "object") {
            throw new Error(`input "${name}" must be an object describing the argument`);
        }
        if (!INPUT_TYPES.includes(field.type)) {
            throw new Error(
                `input "${name}" has type "${field.type}", which is not one of ${INPUT_TYPES.join(", ")}`,
            );
        }

        const property: Record<string, unknown> = { type: field.type };
        if (field.description) property.description = field.description;

        if (field.type === "array") {
            // Without `items` the model is told to send a list and told nothing
            // about what goes in it, which it fills with whatever it invents.
            if (!field.items || !INPUT_TYPES.includes(field.items.type)) {
                throw new Error(`input "${name}" is an array and needs items: { type: … }`);
            }
            property.items = { type: field.items.type };
        } else if (field.items) {
            throw new Error(`input "${name}" is a ${field.type}, so it cannot have items`);
        }

        if (field.enum) {
            if (!Array.isArray(field.enum) || field.enum.length === 0) {
                throw new Error(`input "${name}" has an empty enum, which allows nothing`);
            }
            // An enum whose values are a different type than the field declares
            // is a contradiction the model resolves by guessing.
            const wanted = field.type === "integer" ? "number" : field.type;
            const wrong = field.enum.find((value) => typeof value !== wanted);
            if (wrong !== undefined) {
                throw new Error(
                    `input "${name}" is a ${field.type} but its enum contains ${JSON.stringify(wrong)}`,
                );
            }
            property.enum = [...field.enum];
        }

        properties[name] = property;
        if (field.required) required.push(name);
    }

    // `required: []` is rejected by JSON Schema draft-04 validators and means
    // the same as saying nothing, so it is left out rather than emitted empty.
    return required.length > 0 ? { type: "object", properties, required } : { type: "object", properties };
}

/**
 * A stored JSON Schema, back as declared inputs.
 *
 * The inverse of `compileSchema`, and it exists for one reason: a tool made in
 * the console has a schema on the server and no source anywhere. `vokoo pull`
 * writes it a file, and that file has to declare the same arguments the model is
 * already being shown — otherwise adopting a tool would quietly change its
 * contract.
 *
 * Anything it cannot express is dropped rather than guessed at. A schema is
 * larger than this vocabulary, and inventing a field to carry `minLength` would
 * mean `compileSchema` and this one disagreeing about what a tool is.
 */
export function decompileSchema(schema: unknown): InputMap {
    const object = (schema ?? {}) as { properties?: Record<string, unknown>; required?: unknown };
    const properties = (object.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = new Set(Array.isArray(object.required) ? (object.required as string[]) : []);

    const input: InputMap = {};
    for (const [name, property] of Object.entries(properties)) {
        const type = property?.type;
        if (typeof type !== "string" || !INPUT_TYPES.includes(type as InputType)) continue;

        const field: InputField = { type: type as InputType };
        if (typeof property.description === "string" && property.description) {
            field.description = property.description;
        }
        if (required.has(name)) field.required = true;

        const items = property.items as { type?: string } | undefined;
        if (field.type === "array") {
            // `compileSchema` refuses an array without one, so a stored schema
            // missing it predates the SDK. String is the least surprising guess
            // and the reader can correct it.
            field.items = { type: INPUT_TYPES.includes(items?.type as InputType) ? (items!.type as InputType) : "string" };
        }
        if (Array.isArray(property.enum) && property.enum.length > 0) {
            field.enum = property.enum as (string | number)[];
        }

        input[name] = field;
    }
    return input;
}

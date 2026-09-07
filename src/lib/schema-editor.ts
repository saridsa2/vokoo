export type JsonSchema = Record<string, unknown>;

export type SchemaTreeRow = {
    name: string;
    type: string;
    description: string;
    required: boolean;
    children: SchemaTreeRow[];
};

const FIELD_TYPES = new Set(["string", "number", "integer", "boolean"]);

function record(value: unknown): JsonSchema {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonSchema) : {};
}

function typeOf(schema: JsonSchema): string {
    if (typeof schema.type === "string") return schema.type;
    if (Array.isArray(schema.oneOf)) return "oneOf";
    if (Array.isArray(schema.anyOf)) return "anyOf";
    if (typeof schema.$ref === "string") return "reference";
    return "unknown";
}

function row(name: string, value: unknown, required = false): SchemaTreeRow {
    const schema = record(value);
    const type = typeOf(schema);
    const requiredNames = new Set(Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : []);
    let children: SchemaTreeRow[] = [];

    if (type === "object") {
        children = Object.entries(record(schema.properties)).map(([childName, child]) => row(childName, child, requiredNames.has(childName)));
    } else if (type === "array" && schema.items) {
        children = [row("items", schema.items)];
    } else if (type === "oneOf" || type === "anyOf") {
        children = (schema[type] as unknown[]).map((choice, index) => row(`${type} ${index + 1}`, choice));
    }

    return {
        name,
        type,
        description: typeof schema.description === "string" ? schema.description : "",
        required,
        children,
    };
}

export function schemaEditorPresentation(schema: JsonSchema) {
    const required = new Set(Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : []);
    const properties = Object.entries(record(schema.properties));
    const rows = properties.map(([name, value]) => row(name, value, required.has(name)));
    const editableAsFields = schema.type === "object" && properties.every(([, value]) => FIELD_TYPES.has(typeOf(record(value))));

    return { editableAsFields, preview: schema, rows };
}

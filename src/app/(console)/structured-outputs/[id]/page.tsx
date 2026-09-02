import { SchemaDetailScreen } from "@/components/application/screens/schema-detail-screen";

/**
 * One schema: its fields, and the JSON they compile to.
 *
 * Its own route rather than a dialog, because the compiled schema is the thing
 * worth seeing and a modal has nowhere to put it. What the model is actually
 * shown is the JSON, not the rows — and until it was on screen beside them,
 * whether `required` landed where somebody meant was invisible until a call
 * failed.
 */
export default async function SchemaPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <SchemaDetailScreen schemaId={id} />;
}

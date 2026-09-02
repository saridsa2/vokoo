import { ToolDetailScreen } from "@/components/application/screens/tool-detail-screen";

/**
 * One tool: its source, and a way to run it.
 *
 * Its own route rather than a case in the catch-all, for the same reason
 * `flows/[id]` is: the catch-all resolves a screen from a route name, and this
 * one is a record.
 */
export default async function ToolPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <ToolDetailScreen toolId={id} />;
}

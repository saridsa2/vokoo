import { FlowComposerScreen } from "@/components/application/screens/flow-composer-screen";

/**
 * One flow, on the canvas.
 *
 * Its own route rather than a case in the catch-all: the catch-all resolves a
 * screen from a route name, and this one is a record. It also sits inside the
 * (console) group, so it is behind the same auth gate as everything else — the
 * scratch /canvas-preview route is not.
 */
export default async function FlowPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <FlowComposerScreen flowId={id} />;
}

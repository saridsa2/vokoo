import { EngineDetailScreen } from "@/components/application/screens/engine-detail-screen";

/**
 * Composing one engine.
 *
 * The same board the console used to carry. It is here because an engine is the
 * platform's since 0091 — and because its data now comes from operator routes
 * that a tenant's session cannot call.
 */
export default async function PlatformEnginePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <EngineDetailScreen engineId={id} />;
}

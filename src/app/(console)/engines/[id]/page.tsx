import { EngineDetailScreen } from "@/components/application/screens/engine-detail-screen";

/** One engine: the chain a call runs through. */
export default async function EnginePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <EngineDetailScreen engineId={id} />;
}

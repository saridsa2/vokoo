import { AgentDetailScreen } from "@/components/application/screens/agent-detail-screen";

/** One agent: rename, suspend, rotate their SIP password. */
export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <AgentDetailScreen agentId={id} />;
}

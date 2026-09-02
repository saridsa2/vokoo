import { CallDetailScreen } from "@/components/application/screens/call-detail-screen";

/** One call, as it happened. */
export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <CallDetailScreen callId={id} />;
}

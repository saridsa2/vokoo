import { TenantDetailScreen } from "@/components/application/screens/tenant-detail-screen";

/** One customer: what they use, what they are billed, how they are set up. */
export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <TenantDetailScreen id={id} />;
}

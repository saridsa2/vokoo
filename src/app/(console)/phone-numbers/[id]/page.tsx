import { PhoneNumberDetailScreen } from "@/components/application/screens/phone-number-detail-screen";

/** One number, and which flow answers which event on it. */
export default async function PhoneNumberPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <PhoneNumberDetailScreen numberId={id} />;
}

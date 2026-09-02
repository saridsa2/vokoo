import { SkillDetailScreen } from "@/components/application/screens/skill-detail-screen";

/**
 * One skill, and the tools it grants.
 *
 * Its own route rather than a case in the catch-all, for the same reason
 * `tools/[id]` and `flows/[id]` are: the catch-all resolves a screen from a
 * route name, and this one is a record.
 */
export default async function SkillPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <SkillDetailScreen skillId={id} />;
}

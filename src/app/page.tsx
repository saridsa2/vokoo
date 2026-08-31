import { redirect } from "next/navigation";

/**
 * The console has no dashboard of its own yet, so the root lands on Agents
 * — the screen you actually start from when configuring an agent.
 */
export default function Home() {
    redirect("/agents");
}

import { redirect } from "next/navigation";

/**
 * The console lands on the dashboard.
 *
 * It used to land on Agents, with a comment saying there was no dashboard yet.
 * There is one now: what is on the line, who can take a call, and what the day
 * has come to — which is what you want to know before you decide to configure
 * anything.
 */
export default function Home() {
    redirect("/dashboard");
}

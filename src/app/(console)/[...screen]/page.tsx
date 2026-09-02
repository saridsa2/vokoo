import { notFound, redirect } from "next/navigation";
import { ScreenPlaceholder } from "@/components/application/screen/screen-placeholder";
import { AgentsScreen } from "@/components/application/screens/agents-screen";
import { ResourceListScreen } from "@/components/application/screens/resource-list-screen";
import { FlowsWorkspaceScreen } from "@/components/application/screens/flows-workspace-screen";
import { RunsScreen } from "@/components/application/screens/runs-screen";
import { SchemasScreen } from "@/components/application/screens/schemas-screen";
import { SkillsScreen } from "@/components/application/screens/skills-screen";
import { EnginesScreen } from "@/components/application/screens/engines-screen";
import { CredentialsScreen } from "@/components/application/screens/credentials-screen";
import { MembersScreen, OrganizationScreen } from "@/components/application/screens/settings-screens";

/**
 * Resolves a console route to its screen.
 *
 * One catch-all rather than twenty near-identical `page.tsx` files: the routes
 * are known and uniform, and duplicating boilerplate twenty times is twenty
 * chances for them to drift. Screens are registered below as they are built;
 * anything registered without a component renders a placeholder naming the
 * endpoint it will use, so it stays visible which screens are real.
 */

/**
 * Routes rendered by the shared list screen. Kept here as plain strings rather
 * than derived from RESOURCE_VIEWS: that lives in a client module, and a server
 * component reading it gets a client reference whose keys are not enumerable.
 * Adding a list screen means adding the route here and its columns there.
 */
const LIST_SCREENS = new Set([
    "tools",
    "phone-numbers",
    "files",
    "flows",
    "call-logs",
]);

type ScreenDefinition = {
    title: string;
    description?: string;
    /** API resource backing this screen, per docs/ROUTES.md. */
    resource?: string;
};

const SCREENS: Record<string, ScreenDefinition> = {
    composer: { title: "Calls", description: "What happens while somebody is on the line.", resource: "flows" },
    integrations: { title: "Integrations", description: "What happens after a call ends.", resource: "flows" },

    agents: {
        title: "Agents",
        description: "Configure the agents that answer your calls.",
        resource: "agents",
    },
    skills: { title: "Skills", description: "What an agent can do, and the tools each one grants.", resource: "skills" },
    tools: { title: "Tools", description: "Functions and integrations your agents can call.", resource: "tools" },
    "phone-numbers": {
        title: "Phone Numbers",
        description: "KooKoo/Ozonetel numbers and the agent each one routes to.",
        resource: "phone-numbers",
    },
    engines: { title: "Engines", description: "The models and services a call runs through.", resource: "engines" },
    files: {
        title: "Knowledge",
        description: "Documents an agent can draw on when a caller asks something the prompt does not answer.",
        resource: "files",
    },
    flows: { title: "Flows", description: "Visual call flows.", resource: "flows" },
    "structured-outputs": {
        title: "Schemas",
        description: "Named shapes — what a tool takes, and what a call gets read into.",
        resource: "structured-outputs",
    },
    runs: { title: "Runs", description: "Every tool a call ran, with what it was asked and what it gave back.", resource: "call-events" },
    "call-logs": { title: "Call Logs", description: "Every call, with transcript and recording.", resource: "call-logs" },
    metrics: { title: "Metrics", description: "Operational dashboard.", resource: "metrics" },

    "settings/organization": { title: "Organization", description: "Workspace identity and plan." },
    "settings/members": { title: "Members", description: "Who has access to this workspace." },
    "settings/credentials": {
        title: "Providers",
        description: "Accounts VoKoo uses on your behalf.",
    },
};

export default async function ConsoleScreen({
    params,
    searchParams,
}: {
    params: Promise<{ screen: string[] }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const { screen } = await params;
    const route = screen.join("/");

    // Before the lookup, because `evals` is no longer a screen and would 404
    // here. Every tool's page links to `/evals?tool=…`, so the query is carried
    // across — a redirect that dropped it would land on an unfiltered list and
    // look like the link was wrong.
    if (route === "evals") {
        const query = new URLSearchParams(
            Object.entries(await searchParams).flatMap(([key, value]) =>
                typeof value === "string" ? [[key, value] as [string, string]] : [],
            ),
        ).toString();
        redirect(query ? `/runs?${query}` : "/runs");
    }

    const definition = SCREENS[route];

    if (!definition) notFound();

    // Bespoke screens first, then anything with a column definition renders
    // through the shared list. Whatever is left falls back to a placeholder
    // naming the endpoint it will read.
    // Two workspaces over one table, split by what a flow responds to. Each
    // lists the flows of its kind and creates that kind, so the choice is made
    // by which screen you opened rather than by a question in a dialog.
    if (route === "composer") return <FlowsWorkspaceScreen family="call" />;
    if (route === "integrations") return <FlowsWorkspaceScreen family="post_call" />;
    if (route === "agents") return <AgentsScreen />;
    if (route === "runs") return <RunsScreen />;
    if (route === "structured-outputs") return <SchemasScreen />;
    if (route === "skills") return <SkillsScreen />;
    if (route === "engines") return <EnginesScreen />;
    if (route === "settings/credentials") return <CredentialsScreen />;
    if (route === "settings/organization") return <OrganizationScreen />;
    if (route === "settings/members") return <MembersScreen />;

    // Only the route name crosses into the client component; it resolves its own
    // column definitions there.
    if (LIST_SCREENS.has(route)) return <ResourceListScreen resourceKey={route} />;

    return <ScreenPlaceholder title={definition.title} description={definition.description} resource={definition.resource} />;
}

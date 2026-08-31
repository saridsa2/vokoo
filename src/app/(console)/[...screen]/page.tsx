import { notFound } from "next/navigation";
import { ScreenPlaceholder } from "@/components/application/screen/screen-placeholder";
import { AgentsScreen } from "@/components/application/screens/agents-screen";
import { ResourceListScreen } from "@/components/application/screens/resource-list-screen";
import { ComposerScreen } from "@/components/application/screens/composer-screen";
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
    "squads",
    "tools",
    "phone-numbers",
    "voice-library",
    "files",
    "flows",
    "test-suites",
    "evals",
    "issues",
    "monitors",
    "notifiers",
    "boards",
    "call-logs",
    "chat-logs",
    "structured-outputs",
]);

type ScreenDefinition = {
    title: string;
    description?: string;
    /** API resource backing this screen, per docs/ROUTES.md. */
    resource?: string;
};

const SCREENS: Record<string, ScreenDefinition> = {
    composer: { title: "Composer", description: "Describe an agent in plain language and generate its configuration." },

    agents: {
        title: "Agents",
        description: "Configure the agents that answer your calls.",
        resource: "agents",
    },
    squads: { title: "Squads", description: "Hand a call from one agent to another mid-conversation.", resource: "squads" },
    tools: { title: "Tools", description: "Functions and integrations your agents can call.", resource: "tools" },
    "phone-numbers": {
        title: "Phone Numbers",
        description: "KooKoo/Ozonetel numbers and the agent each one routes to.",
        resource: "phone-numbers",
    },
    "voice-library": { title: "Voice Library", description: "Voices available to your agents.", resource: "voice-library" },
    files: { title: "Files", description: "Knowledge assets and their ingestion status.", resource: "files" },
    flows: { title: "Flows", description: "Visual call flows.", resource: "flows" },

    "test-suites": { title: "Test Suites", description: "Scripted conversations run against an agent.", resource: "test-suites" },
    evals: { title: "Evals", description: "Rubrics scored automatically against real calls.", resource: "evals" },

    issues: { title: "Issues", description: "Problems detected in production calls.", resource: "issues" },
    monitors: { title: "Monitors", description: "Rules that watch call quality and reliability.", resource: "monitors" },
    notifiers: { title: "Notifiers", description: "Where alerts are delivered.", resource: "notifiers" },
    boards: { title: "Boards", description: "Saved analytics views.", resource: "boards" },
    "call-logs": { title: "Call Logs", description: "Every call, with transcript and recording.", resource: "call-logs" },
    "chat-logs": { title: "Chat Logs", description: "Text conversations.", resource: "chat-logs" },
    // No backing table: session activity is not modelled in the schema yet, and
    // pointing this at `chats` would show unrelated rows under the wrong name.
    "session-logs": { title: "Session Logs", description: "Raw session activity." },
    "structured-outputs": {
        title: "Structured Outputs",
        description: "JSON schemas extracted from conversations.",
        resource: "structured-outputs",
    },
    metrics: { title: "Metrics", description: "Operational dashboard.", resource: "metrics" },

    "settings/organization": { title: "Organization", description: "Workspace identity and plan." },
    "settings/members": { title: "Members", description: "Who has access to this workspace." },
    "settings/credentials": {
        title: "Provider Keys",
        description: "Accounts VoKoo uses on your behalf.",
    },
};

export default async function ConsoleScreen({ params }: { params: Promise<{ screen: string[] }> }) {
    const { screen } = await params;
    const route = screen.join("/");
    const definition = SCREENS[route];

    if (!definition) notFound();

    // Bespoke screens first, then anything with a column definition renders
    // through the shared list. Whatever is left falls back to a placeholder
    // naming the endpoint it will read.
    if (route === "composer") return <ComposerScreen />;
    if (route === "agents") return <AgentsScreen />;
    if (route === "settings/credentials") return <CredentialsScreen />;
    if (route === "settings/organization") return <OrganizationScreen />;
    if (route === "settings/members") return <MembersScreen />;

    // Only the route name crosses into the client component; it resolves its own
    // column definitions there.
    if (LIST_SCREENS.has(route)) return <ResourceListScreen resourceKey={route} />;

    return <ScreenPlaceholder title={definition.title} description={definition.description} resource={definition.resource} />;
}

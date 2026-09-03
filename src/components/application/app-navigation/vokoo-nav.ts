import {
    IconAgents,
    IconDashboard,
    IconCallFlows,
    IconCallLogs,
    IconEvals,
    IconFiles,
    IconIntegrations,
    IconLock,
    IconOrganization,
    IconPhoneNumbers,
    IconShapes,
    IconSquads,
    IconTeam,
    IconTools,
    IconVoiceLibrary,
} from "@/components/icons";
import type { NavItemType } from "./config";

/**
 * Sidebar structure, transcribed from the reference console.
 *
 * Group order and membership are deliberate, not alphabetical, and each heading
 * is a verb for what you do there:
 *
 *   COMPOSE    draw what happens — during a call, and after one
 *   BUILD      what the agent is: its prompt, skills, tools, documents
 *   CONFIGURE  what it runs on: a number, an engine, a provider key
 *   OBSERVE    what actually happened
 *   MANAGE     who can do any of it
 *
 * The line between BUILD and CONFIGURE is the one worth keeping: an agent and a
 * provider key used to sit side by side under one heading, and they are not the
 * same kind of thing at all — one is the product, the other is a credential.
 *
 * Routes match the Rust API's resource allowlist (`docs/ROUTES.md`), so a nav
 * entry and its endpoint cannot drift apart.
 */
export const NAV_SECTIONS: Array<{ label: string; items: NavItemType[] }> = [
    {
        // Its own section of one, above everything. What is happening now is
        // not a kind of work you do — it is where you start, and filing it
        // under a verb would put it behind one.
        label: "Overview",
        items: [{ label: "Dashboard", href: "/dashboard", icon: IconDashboard }],
    },
    {
        label: "Composer",
        // Two boards, not one list with a filter. A flow answered while
        // somebody is listening and a flow that runs after they have gone share
        // a canvas and almost nothing else: different palettes, different
        // triggers, different bindings. Separating them means the screen you
        // are on already answers "when does this run", so creating one never
        // has to ask.
        items: [
            { label: "Calls", href: "/composer", icon: IconCallFlows, badge: "Alpha" },
            { label: "Integrations", href: "/integrations", icon: IconIntegrations, badge: "Alpha" },
        ],
    },
    {
        // What the agent *is*. Everything here is authored: somebody writes a
        // prompt, grants a skill, publishes a tool, uploads a document.
        label: "Build",
        items: [
            { label: "Agents", href: "/agents", icon: IconAgents },
            { label: "Skills", href: "/skills", icon: IconSquads },
            { label: "Tools", href: "/tools", icon: IconTools },
            // Not only what a post-call flow extracts: a tool's declared input is a
            // named schema too, and seeing both together is how a schema pushed
            // from the CLI becomes visible without opening a repository.
            { label: "Schemas", href: "/structured-outputs", icon: IconShapes },
            // "Knowledge", not "Files": what goes here is what the agent can
            // draw on, and a file is only how it arrives. Naming it after the
            // upload describes the mechanism rather than the purpose.
            { label: "Knowledge", href: "/files", icon: IconFiles },
        ],
    },
    {
        // What it *runs on*. Nothing here is authored — a number is pointed at
        // something, an engine picks providers, a key is pasted in. Filing a
        // provider key beside an agent made one heading mean two things.
        label: "Configure",
        items: [
            { label: "Phone Numbers", href: "/phone-numbers", icon: IconPhoneNumbers },
            { label: "Engines", href: "/engines", icon: IconVoiceLibrary },
            // "Providers", not "Provider Keys": the screen is where you say
            // which vendors this organisation uses, and a key is how you say
            // it. Naming it after the credential describes the form field
            // rather than the decision.
            { label: "Providers", href: "/settings/credentials", icon: IconLock },
        ],
    },
    {
        label: "Observe",
        items: [
            { label: "Call Logs", href: "/call-logs", icon: IconCallLogs },
            // What the tools did, as opposed to what was said. Production, not
            // testing — which is why it sits here and not under a Test heading.
            { label: "Runs", href: "/runs", icon: IconEvals },
        ],
    },
    {
        label: "Manage",
        items: [
            { label: "Organization", href: "/settings/organization", icon: IconOrganization },
            // One entry, because there is one population. It was Team and
            // Members: two lists over the same staff, neither able to say
            // whether the other knew about somebody. A person's role is what
            // the console lets them do and their extension is whether they
            // answer the phone — two columns, not two screens.
            { label: "Team", href: "/team", icon: IconTeam },
        ],
    },
];

/** Flat lookup for page titles and breadcrumbs. */
export const NAV_TITLES: Record<string, string> = Object.fromEntries(
    NAV_SECTIONS.flatMap((section) => section.items).map((item) => [item.href ?? "", item.label]),
);

/**
 * Routes that render a list beside a detail pane.
 *
 * These already spend two columns before their content begins, so the
 * navigation collapses to an icon rail on them unless the reader has pinned it
 * open. Adding a split screen means adding it here — the shell cannot tell from
 * the route alone, and guessing from the rendered markup would make the
 * navigation depend on what a screen happens to draw.
 */
export const SPLIT_SCREEN_ROUTES = new Set(["/agents", "/composer", "/integrations"]);

/**
 * Routes that take the whole window, navigation included.
 *
 * Editing one flow is a place you go rather than a screen you are on: the
 * canvas wants the width, and it carries its own way out in the back button
 * beside the flow's name. A rail down the side would cost a column to show
 * where you already know you are.
 *
 * A predicate rather than a set, because the route names a record.
 */
/**
 * Routes that get the window rather than the shell.
 *
 * The canvas measures against `window.innerWidth` and `window.innerHeight` to
 * place nodes and to decide which side of a node its inspector opens on. Inside
 * the shell every one of those numbers is wrong by the width of the navigation:
 * the board draws offset, and the inspector opens past the right edge and is
 * clipped. Both boards need the window for the same reason.
 */
export function isFullScreenRoute(pathname: string) {
    return /^\/(flows|engines)\/[^/]+$/.test(pathname);
}

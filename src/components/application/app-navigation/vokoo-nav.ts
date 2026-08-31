import {
    IconAgents,
    IconBoards,
    IconCallLogs,
    IconChatLogs,
    IconEvals,
    IconFiles,
    IconIssues,
    IconLock,
    IconMembers,
    IconMonitors,
    IconNotifiers,
    IconOrganization,
    IconPhoneNumbers,
    IconSessionLogs,
    IconSquads,
    IconTestSuites,
    IconTools,
    IconVoiceLibrary,
    Stars02,
} from "@/components/icons";
import type { NavItemType } from "./config";

/**
 * Sidebar structure, transcribed from the reference console.
 *
 * Group order and membership are deliberate, not alphabetical: BUILD is what
 * you configure, TEST is what you check it against, OBSERVE is what actually
 * happened. Routes match the Rust API's resource allowlist (`docs/ROUTES.md`),
 * so a nav entry and its endpoint cannot drift apart.
 */
export const NAV_SECTIONS: Array<{ label: string; items: NavItemType[] }> = [
    {
        label: "VoKoo Labs",
        items: [{ label: "Composer", href: "/composer", icon: Stars02, badge: "Alpha" }],
    },
    {
        label: "Build",
        items: [
            { label: "Agents", href: "/agents", icon: IconAgents },
            { label: "Squads", href: "/squads", icon: IconSquads },
            { label: "Tools", href: "/tools", icon: IconTools },
            { label: "Phone Numbers", href: "/phone-numbers", icon: IconPhoneNumbers },
            { label: "Voice Library", href: "/voice-library", icon: IconVoiceLibrary },
            { label: "Files", href: "/files", icon: IconFiles },
            { label: "Provider Keys", href: "/settings/credentials", icon: IconLock },
        ],
    },
    {
        label: "Test",
        items: [
            { label: "Test Suites", href: "/test-suites", icon: IconTestSuites },
            { label: "Evals", href: "/evals", icon: IconEvals, badge: "Beta" },
        ],
    },
    {
        label: "Observe",
        items: [
            { label: "Issues", href: "/issues", icon: IconIssues, badge: "Alpha" },
            { label: "Monitors", href: "/monitors", icon: IconMonitors },
            { label: "Notifiers", href: "/notifiers", icon: IconNotifiers },
            { label: "Boards", href: "/boards", icon: IconBoards },
            { label: "Call Logs", href: "/call-logs", icon: IconCallLogs },
            { label: "Chat Logs", href: "/chat-logs", icon: IconChatLogs },
            { label: "Session Logs", href: "/session-logs", icon: IconSessionLogs },
        ],
    },
    {
        label: "Manage",
        items: [
            { label: "Organization", href: "/settings/organization", icon: IconOrganization },
            { label: "Members", href: "/settings/members", icon: IconMembers },
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
export const SPLIT_SCREEN_ROUTES = new Set(["/agents", "/composer"]);

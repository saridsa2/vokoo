/**
 * The colour a nav icon takes when it is the one you are on.
 *
 * Borrowed from Sarvam's console, which ships a separate `icon-*-active.svg`:
 * flat `#B3B3B3` at rest, and when selected a **two-colour** icon — a saturated
 * primary over a soft secondary. Warm and saturated: marigold, magenta, indigo,
 * leaf.
 *
 * We need no second set of files for it. Our icons are Font Awesome **duotone**
 * already — a primary path and a secondary one — so this is the same mechanism
 * rather than an imitation of it: set `--fa-primary-color` and
 * `--fa-secondary-color` and both layers follow.
 *
 * ## One colour per section, not per destination
 *
 * The first version gave every item its own pair, which made the colour say
 * *which page* — fourteen colours for fourteen destinations. The nav already
 * says which page, by highlighting the row and the label.
 *
 * A colour per **section** says something the nav does not otherwise say: what
 * kind of work this is. Composer, Build, Configure, Observe, Manage each take
 * one, so moving between Agents and Tools keeps the same colour and moving from
 * Build to Observe changes it. That is a signal; fourteen colours is decoration.
 */
export type NavAccent = { primary: string; secondary: string };

export const SECTION_ACCENTS: Record<string, NavAccent> = {
    // Authoring what answers the phone — the warm end, where the work starts.
    Composer: { primary: "#D5650F", secondary: "#FFCB79" },
    // What you build with.
    Build: { primary: "#B12060", secondary: "#EFABC5" },
    // What the calls run on.
    Configure: { primary: "#6EA335", secondary: "#E3F1D8" },
    // What happened. Cool, because it is a record rather than an action.
    Observe: { primary: "#1F6FB2", secondary: "#D3E5F4" },
    // The workspace itself.
    Manage: { primary: "#5052A8", secondary: "#D6D7EE" },
    // Where you land. Warm and closest to the brand's own ink, because this is
    // the console reporting on itself rather than a kind of work.
    Overview: { primary: "#B45309", secondary: "#FDE3C0" },
};

/**
 * Which section each destination belongs to.
 *
 * Keyed by href because that is what a nav item carries down to the leaf that
 * renders the icon; threading the section through every layer of the nav to
 * reach it would be more plumbing than the fact is worth. A destination with no
 * entry keeps the resting grey rather than borrowing a neighbour's colour.
 */
const SECTION_OF: Record<string, keyof typeof SECTION_ACCENTS> = {
    "/dashboard": "Overview",

    "/composer": "Composer",
    "/integrations": "Composer",

    "/agents": "Build",
    "/skills": "Build",
    "/tools": "Build",
    "/structured-outputs": "Build",
    "/files": "Build",

    "/phone-numbers": "Configure",
    "/engines": "Configure",
    "/settings/credentials": "Configure",

    "/call-logs": "Observe",
    "/runs": "Observe",

    "/settings/organization": "Manage",
    "/team": "Manage",
    "/settings/members": "Manage",
};

/** The pair for a destination, or nothing — which leaves it the resting grey. */
export function navAccent(href?: string): NavAccent | undefined {
    const section = href ? SECTION_OF[href] : undefined;
    return section ? SECTION_ACCENTS[section] : undefined;
}

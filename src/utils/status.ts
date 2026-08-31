/**
 * Status → badge colour, in one place.
 *
 * The API returns statuses as free text (`"Connected"`, `"Needs review"`,
 * `"draft"`), and they appear across fifteen list screens. Without a shared map
 * the same status ends up green on one screen and grey on another — the kind of
 * inconsistency that is invisible in review and obvious in use.
 *
 * Colours are Untitled UI Badge colours, so they follow the theme.
 */

export type BadgeColor = "gray" | "brand" | "error" | "warning" | "success" | "blue" | "indigo" | "purple" | "orange";

const STATUS_COLORS: Record<string, BadgeColor> = {
    // healthy / terminal-good
    active: "success",
    connected: "success",
    published: "success",
    ready: "success",
    passing: "success",
    synced: "success",
    completed: "success",
    answered: "success",
    resolved: "success",

    // neutral / not yet doing anything
    draft: "gray",
    unassigned: "gray",
    queued: "gray",
    private: "gray",
    inactive: "gray",
    archived: "gray",

    // in flight
    processing: "blue",
    "in progress": "blue",
    investigating: "blue",
    ringing: "blue",
    running: "blue",
    public: "blue",

    // needs a human
    warning: "warning",
    "needs review": "warning",
    degraded: "warning",
    pending: "warning",

    // bad
    failed: "error",
    error: "error",
    cancelled: "error",
    canceled: "error",
    busy: "error",
    "no answer": "error",
};

export function statusColor(status: string | null | undefined): BadgeColor {
    if (!status) return "gray";
    return STATUS_COLORS[status.trim().toLowerCase()] ?? "gray";
}

/** `in_progress` / `no-answer` → `In progress` / `No answer`. */
export function statusLabel(status: string | null | undefined): string {
    if (!status) return "—";
    const words = status.replace(/[_-]+/g, " ").trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

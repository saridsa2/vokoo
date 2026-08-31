/**
 * Display formatting shared across screens.
 *
 * Centralised because call durations, timestamps and phone numbers appear on
 * most list screens, and the console looks unfinished the moment one screen
 * says "2m 5s" and the next says "125 seconds".
 */

/** 125 → "2m 5s", 45 → "45s", null → "—" */
export function duration(seconds: number | null | undefined): string {
    if (seconds == null || Number.isNaN(seconds)) return "—";
    if (seconds < 60) return `${Math.round(seconds)}s`;

    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds % 60);
    if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;

    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
}

/** Relative for anything recent, absolute once it stops being useful. */
export function timeAgo(value: string | number | Date | null | undefined): string {
    if (!value) return "—";

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "—";

    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 45) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

    return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function dateTime(value: string | number | Date | null | undefined): string {
    if (!value) return "—";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "—";

    return date.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });
}

/**
 * "+918040802529" → "+91 80408 02529".
 *
 * KooKoo returns E.164 without separators. Only India is grouped specially
 * because that is the only country we route today; anything else is returned
 * unchanged rather than grouped wrongly, which is worse than not grouping.
 */
export function phoneNumber(value: string | null | undefined): string {
    if (!value) return "—";
    const trimmed = value.trim();

    const india = trimmed.match(/^\+?91(\d{5})(\d{5})$/);
    if (india) return `+91 ${india[1]} ${india[2]}`;

    return trimmed;
}

/** Long ids are unreadable in a table; keep enough to recognise and copy. */
export function shortId(id: string | null | undefined, keep = 8): string {
    if (!id) return "—";
    return id.length <= keep ? id : `${id.slice(0, keep)}…`;
}

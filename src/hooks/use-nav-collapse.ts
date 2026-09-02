"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Whether the navigation shows as an icon rail.
 *
 * Screens that are themselves a split — a list beside a detail pane — already
 * spend two columns before their content starts. On the Agents screen that
 * measured 556px of chrome on a 1728px display, and it would be 39% of a 1440px
 * laptop. Those screens get the rail unless asked otherwise.
 *
 * That default used to be the only way the rail appeared, and the control was a
 * *pin* that overrode it. Which meant the handle on the divider did nothing at
 * all on a screen that was not a split — it toggled a preference with no
 * visible effect, and read as broken. It is now a collapse toggle: a reader can
 * say "rail" or "labels" anywhere, and saying nothing leaves the split-screen
 * default in place.
 */

const STORAGE_KEY = "vokoo.nav.collapsed";

export type NavCollapseState = {
    /** Render the icon rail. */
    isCollapsed: boolean;
    setCollapsed: (collapsed: boolean) => void;
    /** False until storage has been read. */
    isReady: boolean;
};

/** `null` means nobody has said, so the screen decides. */
type Preference = boolean | null;

export function useNavCollapse(isSplitScreen: boolean): NavCollapseState {
    const [preference, setPreference] = useState<Preference>(null);
    const [isReady, setIsReady] = useState(false);

    // Read after mount, never during render: reading storage while rendering
    // makes the server and client passes disagree, which surfaces as a
    // hydration error rather than as a navigation bug.
    useEffect(() => {
        try {
            const stored = window.localStorage.getItem(STORAGE_KEY);
            setPreference(stored === null ? null : stored === "true");
        } catch {
            // Private windows and blocked site data throw on access. A reader
            // who cannot store a preference should still get a working nav.
        }
        setIsReady(true);
    }, []);

    const setCollapsed = useCallback((collapsed: boolean) => {
        setPreference(collapsed);
        try {
            window.localStorage.setItem(STORAGE_KEY, String(collapsed));
        } catch {
            // The choice holds for this session and is forgotten on reload.
        }
    }, []);

    return { isCollapsed: preference ?? isSplitScreen, setCollapsed, isReady };
}

"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Whether the navigation shows as an icon rail.
 *
 * Screens that are themselves a split — a list beside a detail pane — already
 * spend two columns before their content starts. On the Agents screen that
 * measured 556px of chrome on a 1728px display, and it would be 39% of a 1440px
 * laptop. Those screens get the rail by default.
 *
 * The default is not the whole answer, because someone navigating constantly
 * wants the labels more than the pixels. Pinning overrides it everywhere and is
 * remembered per browser.
 */

const STORAGE_KEY = "vokoo.nav.pinned";

export type NavCollapseState = {
    /** Render the icon rail. */
    isCollapsed: boolean;
    /** The reader has asked for the labelled nav regardless of the screen. */
    isPinned: boolean;
    setPinned: (pinned: boolean) => void;
    /** False until storage has been read. */
    isReady: boolean;
};

export function useNavCollapse(isSplitScreen: boolean): NavCollapseState {
    const [isPinned, setIsPinned] = useState(false);
    const [isReady, setIsReady] = useState(false);

    // Read after mount, never during render: reading storage while rendering
    // makes the server and client passes disagree, which surfaces as a
    // hydration error rather than as a navigation bug.
    useEffect(() => {
        try {
            setIsPinned(window.localStorage.getItem(STORAGE_KEY) === "true");
        } catch {
            // Private windows and blocked site data throw on access. A reader
            // who cannot store a preference should still get a working nav.
        }
        setIsReady(true);
    }, []);

    const setPinned = useCallback((pinned: boolean) => {
        setIsPinned(pinned);
        try {
            window.localStorage.setItem(STORAGE_KEY, String(pinned));
        } catch {
            // The preference holds for this session and is forgotten on reload.
        }
    }, []);

    return { isCollapsed: isSplitScreen && !isPinned, isPinned, setPinned, isReady };
}

"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { Moon01, Sun } from "@/components/icons";

/**
 * Light/dark switch for the console.
 *
 * `next-themes` resolves the active theme from localStorage, which the server
 * cannot know. Rendering the real icon before mount would therefore emit the
 * wrong one and trip a hydration mismatch, so the button renders a stable
 * placeholder until mounted — the usual, and unavoidable, next-themes dance.
 */
export function ThemeToggle() {
    const { resolvedTheme, setTheme } = useTheme();
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => setIsMounted(true), []);

    const isDark = resolvedTheme === "dark";

    return (
        <ButtonUtility
            size="xs"
            color="tertiary"
            tooltip={isMounted ? (isDark ? "Switch to light" : "Switch to dark") : "Toggle theme"}
            icon={isMounted && !isDark ? Moon01 : Sun}
            onClick={() => setTheme(isDark ? "light" : "dark")}
        />
    );
}

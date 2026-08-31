"use client";

import { ThemeProvider } from "next-themes";

export function Theme({ children }: { children: React.ReactNode }) {
    return (
        // The design system is light: a warm eggshell canvas is the whole point,
        // and its accent colours are defined only against it. `enableSystem` is
        // off deliberately — following a dark-mode OS would render a product the
        // system has no tokens for.
        <ThemeProvider attribute="class" value={{ light: "light-mode", dark: "dark-mode" }} defaultTheme="light" enableSystem={false}>
            {children}
        </ThemeProvider>
    );
}

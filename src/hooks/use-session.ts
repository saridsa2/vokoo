"use client";

import { useContext } from "react";
import { SessionContext } from "@/providers/session-provider";

/**
 * Access the signed-in session.
 *
 * Throws when used outside the provider rather than returning null: a silent
 * null propagates as "signed out", so a component mounted in the wrong place
 * would render the sign-in screen instead of reporting a wiring mistake.
 */
export function useSession() {
    const value = useContext(SessionContext);

    if (!value) {
        throw new Error("useSession must be used inside <SessionProvider>");
    }

    return value;
}

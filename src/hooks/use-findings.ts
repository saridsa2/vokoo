"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCatalogue } from "./use-catalogue";
import { blocking, byTab, evaluate, strongest, type EditorTab, type Finding, type Severity } from "@/utils/capability-rules";
import type { CapabilityScope } from "@/utils/capability-registry";

/**
 * Findings for one configuration, plus what the reader has already seen.
 *
 * Findings are computed; *seen* is remembered. That separation is what lets the
 * amber dot mean "there is something here you have not looked at" rather than
 * "there is something here", which would leave a permanent dot on the Compliance
 * tab of every Gemini agent and stop being a signal within a day.
 *
 * Seen state is per agent. Switching to another agent does not carry it
 * over — the findings are about that agent, and so is the reading of them.
 * It resets when the configuration changes in a way that produces a finding the
 * reader has not seen before, because the id is derived from the rule and the
 * fields it fired on.
 */

export type FindingsState = {
    findings: Finding[];
    /** Findings for a given tab, whether or not they have been seen. */
    forTab: (tab: EditorTab) => Finding[];
    /** Strongest unseen severity on a tab, or null. This is what draws the dot. */
    markerFor: (tab: EditorTab) => Severity | null;
    /** Publish must refuse while this is non-empty. */
    blockingFindings: Finding[];
    /** Call when a tab is opened. Its findings stop being unseen. */
    markSeen: (tab: EditorTab) => void;
    /** Call after a publish, so the next change is judged from a clean slate. */
    resetSeen: () => void;
    isCatalogueLoading: boolean;
};

export function useFindings(entityId: string | null, scope: CapabilityScope | null): FindingsState {
    const { catalogue, isLoading } = useCatalogue();
    const [seen, setSeen] = useState<Set<string>>(() => new Set());

    // Which agent the seen-set belongs to. Compared during render rather
    // than cleared in an effect: an effect would leave one paint showing the
    // previous agent's dots against this one's findings.
    const seenOwner = useRef<string | null>(entityId);
    if (seenOwner.current !== entityId) {
        seenOwner.current = entityId;
        if (seen.size) setSeen(new Set());
    }

    const findings = useMemo(() => (scope ? evaluate(catalogue, scope) : []), [catalogue, scope]);

    const grouped = useMemo(() => byTab(findings), [findings]);

    // An `info` finding is true and worth stating, and it is not news. Marking
    // a tab for one would put a dot on the Transcriber tab of every
    // native-audio agent from the moment it is created.
    const unseenByTab = useMemo(() => {
        const result: Partial<Record<EditorTab, Finding[]>> = {};
        for (const [tab, list] of Object.entries(grouped) as [EditorTab, Finding[]][]) {
            const unseen = list.filter((finding) => finding.severity !== "info" && !seen.has(finding.id));
            if (unseen.length) result[tab] = unseen;
        }
        return result;
    }, [grouped, seen]);

    const markSeen = useCallback(
        (tab: EditorTab) => {
            const list = grouped[tab];
            if (!list?.length) return;

            setSeen((current) => {
                const missing = list.filter((finding) => !current.has(finding.id));
                if (!missing.length) return current; // no state change, no re-render
                const next = new Set(current);
                for (const finding of missing) next.add(finding.id);
                return next;
            });
        },
        [grouped],
    );

    const resetSeen = useCallback(() => setSeen(new Set()), []);

    return {
        findings,
        forTab: useCallback((tab: EditorTab) => grouped[tab] ?? [], [grouped]),
        markerFor: useCallback((tab: EditorTab) => strongest(unseenByTab[tab]), [unseenByTab]),
        blockingFindings: useMemo(() => blocking(findings), [findings]),
        markSeen,
        resetSeen,
        isCatalogueLoading: isLoading,
    };
}

/**
 * Mark a tab seen while it is open.
 *
 * Kept here rather than inline in the screen so the "opening a tab clears its
 * dot" rule lives in one place — a screen that forgot to call it would show a
 * dot that never goes away, and the bug would look like a rules problem.
 */
export function useMarkTabSeen(state: FindingsState, tab: EditorTab) {
    const { markSeen } = state;
    useEffect(() => {
        markSeen(tab);
    }, [markSeen, tab]);
}

/**
 * What is wrong, or worth knowing, about a configuration.
 *
 * Pure functions over the catalogue. No React, no fetching, no screen
 * knowledge — a rule states a fact and says where it belongs, and the caller
 * decides how to draw it. The same finding renders as an amber dot on a tab, an
 * inline warning inside the panel, a column on a list screen, and a refusal at
 * publish. One evaluation, so those four can never disagree.
 *
 * Severity is about consequence, not about tone:
 *
 *   blocking   the call will not work. Publish must refuse it.
 *   attention  the call will work and something changed that deserves a look.
 *   info       true and worth stating; never blocks, never nags.
 *
 * The database enforces the blocking rules again at publish time. That is not
 * duplication for its own sake: this layer can only see what the console loaded,
 * and a rule that lives only in the client is a rule that a stale tab can walk
 * around.
 */

import {
    inferenceLocation,
    modelOf,
    providerOf,
    transcriberOf,
    voiceOf,
    type Catalogue,
    type CapabilityScope,
} from "./capability-registry";

/** Tabs of the agent editor. A finding names the one it belongs to. */
export type EditorTab = "Model" | "Voice" | "Transcriber" | "Tools" | "Analysis" | "Monitors" | "Compliance" | "Advanced";

export type Severity = "blocking" | "attention" | "info";

export type Finding = {
    /** Stable across evaluations, so "seen" can be remembered per finding. */
    id: string;
    severity: Severity;
    tab: EditorTab;
    title: string;
    detail: string;
    /** What to do about it, when there is a single obvious answer. */
    remedy?: string;
};

export function evaluate(catalogue: Catalogue, scope: CapabilityScope): Finding[] {
    // With no catalogue loaded every rule would fire on missing data and the
    // screen would fill with warnings about its own loading state.
    if (!catalogue.providers.length) return [];

    const findings: Finding[] = [];
    const provider = providerOf(catalogue, scope.provider);
    const model = modelOf(catalogue, scope.model);
    const voice = voiceOf(catalogue, scope.voice);
    const transcriber = transcriberOf(catalogue, scope.transcriber);

    if (!provider) {
        return [
            {
                id: "provider.unknown",
                severity: "blocking",
                tab: "Model",
                title: `Unknown provider "${scope.provider}"`,
                detail: "This agent names a provider the platform does not offer, so nothing can resolve where it should run.",
                remedy: "Choose a provider from the list.",
            },
        ];
    }

    /* ------------------------------------------------------------- Model */

    if (!model) {
        findings.push({
            id: "model.unknown",
            severity: "blocking",
            tab: "Model",
            title: `Unknown model "${scope.model}"`,
            detail: "This model is not in the catalogue, so its capabilities cannot be checked.",
            remedy: "Choose a model from the list.",
        });
    } else if (model.provider_id !== provider.id) {
        findings.push({
            id: "model.wrong-provider",
            severity: "blocking",
            tab: "Model",
            title: `${model.label} does not run on ${provider.label}`,
            detail: `${model.label} belongs to ${model.provider_id}. A call would have nothing to send audio to.`,
            remedy: `Pick a ${provider.label} model.`,
        });
    }

    /* ------------------------------------------------------------- Voice */

    if (!scope.voice) {
        // Not blocking: the bridge falls back to its own default so the call
        // still happens. It is worth saying, because "whatever the bridge
        // picked" is not a choice anyone made, and it will not be the voice
        // anyone expects.
        findings.push({
            id: "voice.unset",
            severity: "attention",
            tab: "Voice",
            title: "No voice chosen",
            detail: "Calls will use the bridge's fallback voice, which is not necessarily one you would have picked for these callers.",
            remedy: "Choose a voice.",
        });
    } else if (scope.voice && !voice) {
        findings.push({
            id: "voice.unknown",
            severity: "blocking",
            tab: "Voice",
            title: `Unknown voice "${scope.voice}"`,
            detail: "Nothing in the catalogue matches this voice, so the agent would have no way to speak.",
            remedy: "Choose a voice from the list.",
        });
    } else if (voice && voice.provider_id !== provider.id) {
        // Engine and voice are one decision, not two. A self-hosted engine
        // cannot be driven by a remote provider — the model would reply and
        // nothing would render it.
        findings.push({
            id: "voice.wrong-provider",
            severity: "blocking",
            tab: "Voice",
            title: `${voice.label} cannot speak on ${provider.label}`,
            detail: `${voice.label} runs on ${voice.engine}, which is part of the ${voice.provider_id} stack. ${provider.label} speaks with its own voices.`,
            remedy: `Choose a ${provider.label} voice.`,
        });
    }

    /* ------------------------------------------------------- Transcriber */

    if (model && !model.native_audio) {
        const isMissing = !transcriber || transcriber.is_passthrough;
        if (isMissing) {
            findings.push({
                id: "transcriber.required",
                severity: "blocking",
                tab: "Transcriber",
                title: `${model.label} needs a transcriber`,
                detail: "This model reads text, not audio. With nothing transcribing for it the call connects, the caller speaks, and the agent never answers.",
                remedy: "Choose a transcriber, or pick a model that hears audio directly.",
            });
        }
    }

    if (transcriber && transcriber.provider_id !== provider.id) {
        findings.push({
            id: "transcriber.wrong-provider",
            severity: "blocking",
            tab: "Transcriber",
            title: `${transcriber.label} is not available on ${provider.label}`,
            detail: `This transcriber belongs to the ${transcriber.provider_id} stack.`,
            remedy: `Choose a ${provider.label} option.`,
        });
    }

    if (model?.native_audio && transcriber && !transcriber.is_passthrough) {
        // Not an error — a transcript is worth having. But it costs the thing
        // native audio was chosen for, and that trade belongs at the point of
        // choosing rather than in documentation.
        findings.push({
            id: "transcriber.redundant",
            severity: "attention",
            tab: "Transcriber",
            title: `${model.label} already hears the caller directly`,
            detail: `Putting ${transcriber.label} in front of it flattens accent, tone and code-switching into a transcript before the model sees them. It does buy you language detection, which native audio gives up.`,
        });
    }

    if (model?.native_audio && (!transcriber || transcriber.is_passthrough)) {
        findings.push({
            id: "transcriber.no-language-detection",
            severity: "info",
            tab: "Transcriber",
            title: "Nothing detects the spoken language",
            detail: "With no transcriber the model hears accent and code-switching directly, which it understands better. Speech synthesis cannot switch language on its own, so the voice has to cover the languages your callers use.",
        });
    }

    /* -------------------------------------------------------- Compliance */

    const location = inferenceLocation(catalogue, provider.id);
    if (!location.isSovereign) {
        findings.push({
            id: "compliance.off-premise",
            severity: "attention",
            tab: "Compliance",
            title: `Caller audio is processed by ${provider.label}`,
            detail: provider.summary,
            remedy: "Move this agent to a local provider if callers discuss anything you cannot send to a third party.",
        });
    }

    /* ------------------------------------------------------------ Tools */

    if (model && !model.supports_tools) {
        findings.push({
            id: "tools.unsupported",
            severity: "info",
            tab: "Tools",
            title: `${model.label} cannot call tools`,
            detail: "Any tool attached to this agent stays inert. Nothing fails; the model never reaches for it.",
        });
    }

    /* --------------------------------------------------------- Monitors */

    if (model?.latency_class === "network" && scope.latencyThresholdMs !== null && scope.latencyThresholdMs < 1200) {
        findings.push({
            id: "monitors.threshold-unrealistic",
            severity: "attention",
            tab: "Monitors",
            title: "Latency threshold was set for a local model",
            detail: `${scope.latencyThresholdMs} ms is achievable on your own hardware. ${provider.label} adds a network round trip, so this threshold will alert on every call.`,
            remedy: "Raise the threshold, or move back to a local model.",
        });
    }

    return findings;
}

/** Findings that must be resolved before an agent can answer a call. */
export const blocking = (findings: Finding[]) => findings.filter((finding) => finding.severity === "blocking");

/** Findings grouped by the tab they belong to, for the tab strip. */
export function byTab(findings: Finding[]): Partial<Record<EditorTab, Finding[]>> {
    return findings.reduce<Partial<Record<EditorTab, Finding[]>>>((accumulator, finding) => {
        (accumulator[finding.tab] ??= []).push(finding);
        return accumulator;
    }, {});
}

/**
 * The strongest severity in a set, or null for an empty set.
 *
 * A tab carrying both a blocking and an info finding is a blocking tab; taking
 * the first or the last would make the marker depend on rule ordering.
 */
export function strongest(findings: Finding[] | undefined): Severity | null {
    if (!findings?.length) return null;
    if (findings.some((finding) => finding.severity === "blocking")) return "blocking";
    if (findings.some((finding) => finding.severity === "attention")) return "attention";
    return "info";
}

"use client";

/**
 * One engine, on the composer's board.
 *
 * Same canvas the flows use — `RecoveredEditorHost` — because two screens that
 * both draw a call as boxes and lines should not look like two products. What
 * differs is that an engine's shape cannot be authored: one step, or exactly
 * three in a fixed order. So the board runs with `shapeIsFixed`, which switches
 * off the palette, delete and edge drawing together rather than leaving them to
 * offer edits that cannot be saved.
 *
 * What a reader does here is select a step and configure it. The provider lists
 * come from `catalogue_engine_stages` — the same table the bridge trusts — so
 * the board can never offer a provider the binary does not contain. Whether the
 * step's key is connected, and whether its model can call the agent's tools, are
 * shown in the option itself: both decide whether the call works, and neither is
 * visible once the call has started.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

import "@/recovered-editor/styles.css";

import type { Diagram } from "@/lib/architecture-model";
import { diagramToEngineConfig, engineToDiagram, type EngineMode, type EngineRow } from "@/lib/engine-diagram";
import type { EngineOption } from "@/components/stackplane/recovered-editor-host";
import { api } from "@/utils/api-client";
import { useCatalogue } from "@/hooks/use-catalogue";
import { useSession } from "@/hooks/use-session";

/** Loaded rather than bundled: the editor pulls in the whole board. */
const RecoveredEditorHost = dynamic(
    () => import("@/components/stackplane/recovered-editor-host").then((module) => module.RecoveredEditorHost),
    { ssr: false },
);

/**
 * The board's node id for each of rustvani's stage names.
 *
 * Two vocabularies meet here and neither is renamed to match the other: the
 * board's names are what a reader sees, and the stage keys are what the bridge
 * indexes `engines.config` by.
 */
const NODE_FOR_STAGE: Record<string, string> = {
    realtime: "engine.realtime",
    stt: "engine.listening",
    llm: "engine.thinking",
    tts: "engine.speaking",
};

export const EngineDetailScreen = ({ engineId }: { engineId: string }) => {
    const { context, isReady } = useSession();
    const { catalogue } = useCatalogue();

    const [engine, setEngine] = useState<EngineRow | null>(null);
    const [diagram, setDiagram] = useState<Diagram | null>(null);
    const [connected, setConnected] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [checking, setChecking] = useState(false);
    const [verdict, setVerdict] = useState<string | null>(null);

    useEffect(() => {
        if (!isReady || !context) return;
        let live = true;
        (async () => {
            try {
                const [detail, keys] = await Promise.all([
                    api.get<EngineRow>("engines", engineId, context),
                    // The bridge resolves each step's key per call and refuses
                    // the call when one is missing. Knowing it here turns a
                    // failure the caller hears into a word in the list.
                    api.vendorKeys<{ vendor: string }>(context),
                ]);
                if (!live) return;
                setEngine(detail.data);
                setDiagram(engineToDiagram(detail.data));
                setConnected((keys.data ?? []).map((row) => row.vendor));
            } catch (problem) {
                if (live) setError((problem as Error).message);
            }
        })();
        return () => {
            live = false;
        };
    }, [engineId, context, isReady]);

    /**
     * What each step can be set to, in the board's vocabulary.
     *
     * A realtime step is the exception: it runs a model an agent runs on, which
     * is exactly what `catalogue_models` and `catalogue_voices` describe, so it
     * takes its lists from there rather than from its own row.
     */
    const engineOptions = useMemo<EngineOption[]>(
        () =>
            catalogue.engineStages.map((stage) => {
                const node = NODE_FOR_STAGE[stage.stage] ?? stage.stage;
                const isRealtime = node === "engine.realtime";
                return {
                    stage: node,
                    id: stage.provider_id,
                    label: stage.label,
                    tagline: stage.tagline,
                    vendorId: stage.vendor_id,
                    supportsTools: stage.supports_tools,
                    models: isRealtime
                        ? catalogue.models
                              .filter((model) => model.provider_id === stage.provider_id)
                              .map((model) => ({ id: model.id, label: model.label || model.id }))
                        : stage.models,
                    voices: isRealtime
                        ? catalogue.voices
                              .filter((voice) => voice.provider_id === stage.provider_id)
                              .map((voice) => ({ id: voice.label, label: voice.label }))
                        : stage.voices,
                };
            }),
        [catalogue.engineStages, catalogue.models, catalogue.voices],
    );

    /**
     * Change the shape.
     *
     * Not a node and not an edge, so it cannot live on the board: it decides how
     * many nodes there are, and there is nothing to click before it is chosen.
     * It sits in the toolbar, where the flow board puts the controls that act on
     * the whole diagram.
     *
     * Switching keeps nothing. A relay's three providers say nothing about which
     * single model should hear and speak, and carrying a stale half across would
     * produce a chain that reads as configured and is not. Saved immediately —
     * the board is about to be rebuilt around the new shape, and an unsaved
     * change would be lost in the rebuild.
     */
    const changeShape = useCallback(
        async (mode: EngineMode) => {
            if (!context || !engine || engine.mode === mode) return;
            const next: EngineRow = { ...engine, mode, config: {}, status: "draft" };
            setEngine(next);
            setDiagram(engineToDiagram(next));
            try {
                await api.update<EngineRow>(
                    "engines",
                    engineId,
                    // Back to a draft: the published chain no longer exists, and
                    // a call must not reach a shape nobody has configured.
                    { mode, config: {}, status: "draft" },
                    context,
                );
            } catch (problem) {
                setError((problem as Error).message);
            }
        },
        [context, engine, engineId],
    );

    /**
     * Try the engine without a caller on the line.
     *
     * The reason this button exists: a relay was published with a Sarvam model
     * Sarvam had retired, and every other step worked — the call connected,
     * transcribed and answered, and the caller heard silence. Nothing had asked
     * the one thing that failed.
     */
    const preflight = useCallback(async () => {
        if (!context) return;
        setChecking(true);
        setVerdict(null);
        setError(null);
        try {
            const { data } = await api.preflightEngine<{
                ok: boolean;
                steps: { stage: string; provider: string; ok: boolean; error: string | null }[];
            }>(engineId, context);
            setVerdict(
                data.ok
                    ? "Every step connected."
                    : data.steps
                          .filter((step) => !step.ok)
                          .map((step) => `${step.stage}: ${step.error ?? "did not connect"}`)
                          .join("  ·  "),
            );
        } catch (problem) {
            setError((problem as Error).message);
        } finally {
            setChecking(false);
        }
    }, [context, engineId]);

    const save = useCallback(
        async (edited: Diagram) => {
            if (!context || !engine) return false;
            try {
                const config = diagramToEngineConfig(edited, engine.mode);
                await api.update<EngineRow>(
                    "engines",
                    engineId,
                    { name: edited.name, description: edited.description, config },
                    context,
                );
                setEngine((current) => (current ? { ...current, config, name: edited.name } : current));
                return true;
            } catch {
                return false;
            }
        },
        [context, engine, engineId],
    );

    /**
     * Publish is what lets a call reach it.
     *
     * The bridge only reads an engine whose status is published and falls back
     * to its environment for anything else — silently, in a log line nobody is
     * watching. So publishing is the deliberate step, exactly as it is for a
     * flow. Returns the problem to show, or null when it worked.
     */
    const publish = useCallback(
        async (edited: Diagram): Promise<string | null> => {
            if (!context || !engine) return "Not signed in.";
            try {
                const config = diagramToEngineConfig(edited, engine.mode);

                // Refused here rather than at the phone: a step with no provider
                // cannot be built, and the bridge would drop the call.
                const empty = Object.entries(config)
                    .filter(([, stage]) => !stage.provider)
                    .map(([key]) => key);
                if (empty.length > 0) {
                    return `${empty.length === 1 ? "One step has" : `${empty.length} steps have`} no provider.`;
                }

                // Likewise a key: every step bills to a vendor, and a step whose
                // vendor has none connected ends the call before it is answered.
                const unpaid = [
                    ...new Set(
                        Object.values(config).flatMap((stage) => {
                            const option = engineOptions.find((candidate) => candidate.id === stage.provider);
                            return option?.vendorId && !connected.includes(option.vendorId) ? [option.vendorId] : [];
                        }),
                    ),
                ];
                if (unpaid.length > 0) return `No key connected for ${unpaid.join(", ")}.`;

                await api.update<EngineRow>(
                    "engines",
                    engineId,
                    { name: edited.name, description: edited.description, config, status: "published" },
                    context,
                );
                setEngine((current) => (current ? { ...current, config, status: "published" } : current));
                return null;
            } catch (problem) {
                return (problem as Error).message;
            }
        },
        [context, engine, engineId, engineOptions, connected],
    );

    if (error) {
        return (
            <div className="grid h-full place-items-center p-8">
                <div className="max-w-md text-center">
                    <p className="text-sm font-medium text-primary">Could not open this engine</p>
                    <p className="mt-1 text-sm text-tertiary">{error}</p>
                </div>
            </div>
        );
    }

    if (!diagram) {
        return (
            <div className="grid h-full place-items-center p-8">
                <p className="text-sm text-tertiary">Loading engine…</p>
            </div>
        );
    }

    return (
        <RecoveredEditorHost
            // Remounted when the shape changes: the host takes its diagram as an
            // initial value, so a new one arriving as a prop would not replace
            // the board it is already holding.
            key={engine?.mode ?? "realtime"}
            diagram={diagram}
            onSave={save}
            onPublish={publish}
            // An engine is a chain of processors, not a flow: nothing precedes
            // a step, so no field here can reference anything.
            board="engine"
            shapeIsFixed
            backHref="/engines"
            publishedMessage="Published. Agents on this engine use it from the next call."
            toolbarSlot={
                <>
                    <button
                        type="button"
                        className="toolbar-test"
                        disabled={checking}
                        title="Open the connections a call would open, and report what each provider says"
                        onClick={() => void preflight()}
                    >
                        {checking ? "Testing…" : "Test"}
                    </button>
                    <ShapeSwitch
                    mode={engine?.mode ?? "realtime"}
                    hasWork={Object.values(engine?.config ?? {}).some((step) => step.provider)}
                    onChange={(mode) => void changeShape(mode)}
                    />
                </>
            }
            notice={verdict ?? error ?? undefined}
            engineOptions={engineOptions}
            connectedVendors={connected}
        />
    );
};

/**
 * One model, or a relay.
 *
 * Two buttons rather than a select: there are exactly two, both are always
 * available, and the choice reads better as a pair you can see than as a list
 * you have to open.
 */
const ShapeSwitch = ({
    mode,
    hasWork,
    onChange,
}: {
    mode: EngineMode;
    /** True when switching would throw away steps somebody configured. */
    hasWork: boolean;
    onChange: (mode: EngineMode) => void;
}) => {
    const [armed, setArmed] = useState<EngineMode | null>(null);

    /**
     * Switching clears every step, and on a published engine drops it to a
     * draft — which means the next call falls back to the bridge environment.
     * One click is too little for that, so the button asks once.
     *
     * A second click rather than a dialog: the question is about the control
     * you just pressed, and the answer is the same press again.
     */
    const press = (next: EngineMode) => {
        if (next === mode) return;
        if (!hasWork || armed === next) {
            setArmed(null);
            onChange(next);
            return;
        }
        setArmed(next);
    };

    useEffect(() => {
        if (!armed) return;
        // Long enough to read the question and decide, short enough that a
        // control left armed does not stay armed for the next reader.
        const timer = window.setTimeout(() => setArmed(null), 8000);
        return () => window.clearTimeout(timer);
    }, [armed]);

    const button = (value: EngineMode, label: string, title: string) => (
        <button
            type="button"
            className={mode === value ? "selected" : armed === value ? "armed" : ""}
            aria-pressed={mode === value}
            title={armed === value ? "This clears every step. Click again to confirm." : title}
            onClick={() => press(value)}
        >
            {armed === value ? "Clear steps?" : label}
        </button>
    );

    return (
        <div className="engine-shape-switch" role="group" aria-label="Shape">
            {button("realtime", "One model", "One model hears and speaks. Lowest latency.")}
            {button("cascading", "Relay", "Listening, thinking and speaking as three services.")}
        </div>
    );
};

/**
 * An engine, as the board draws it — and back again.
 *
 * The same division `flow-diagram.ts` uses: the editor edits a `Diagram` and
 * knows nothing about engines, and everything that makes a diagram an engine the
 * bridge can run lives here. Which means the round trip is the thing to get
 * right, and the thing to test.
 *
 * An engine's shape is not authorable. The nodes and the lines between them are
 * derived from the mode, at fixed positions; what a reader changes is what each
 * node is set to. So `engineToDiagram` builds the board from scratch every time
 * rather than preserving a layout, and `diagramToEngineConfig` reads only the
 * node configuration back out. Nothing about position or wiring survives,
 * because nothing about them was ever a choice.
 */

import type { Diagram, DiagramEdge, DiagramNode, NodeType } from "./architecture-model";

export type EngineMode = "realtime" | "cascading";

export type StageConfig = {
    provider?: string;
    model?: string;
    voice?: string;
    language?: string;
    temperature?: number;
    max_tokens?: number;
};

export type EngineRow = {
    id: string;
    name: string;
    description: string;
    mode: EngineMode;
    config: Record<string, StageConfig>;
    status: string;
    updated_at?: string;
};

/**
 * Which node type draws which step, and which key it reads from `config`.
 *
 * Two vocabularies meet here: the board's node ids (`engine.listening`) and the
 * engine's own stage keys (`stt`), which are rustvani's. Neither is renamed to
 * match the other — the board's names are what a reader sees and the stage keys
 * are what the bridge indexes — so the mapping is written down once, here.
 */
const STEPS: Record<EngineMode, { stage: string; node: NodeType }[]> = {
    realtime: [{ stage: "realtime", node: "engine.realtime" }],
    cascading: [
        { stage: "stt", node: "engine.listening" },
        { stage: "llm", node: "engine.thinking" },
        { stage: "tts", node: "engine.speaking" },
    ],
};

/**
 * Laid out left to right, in the order a call passes through.
 *
 * Around the origin, because the board opens there: a diagram placed further out
 * loads with its nodes off the corner of the viewport and has to be found. The
 * horizontal step matches the flow importer's, so the two boards read at the
 * same rhythm.
 */
const STEP_X = 380;
const ROW_Y = 0;
/** The board's node width, so the chain can be centred on the origin. */
const NODE_W = 216;

/** Where the first step sits, so the whole chain straddles the origin. */
function firstX(steps: number): number {
    return -((steps - 1) * STEP_X + NODE_W) / 2;
}

export function engineToDiagram(engine: EngineRow): Diagram {
    const steps = STEPS[engine.mode] ?? STEPS.realtime;

    const nodes: DiagramNode[] = steps.map((step, index) => ({
        id: step.stage,
        type: step.node,
        name: LABELS[step.node] ?? step.stage,
        position: { x: firstX(steps.length) + index * STEP_X, y: ROW_Y },
        // The board keeps a node's configuration under its own type, which is
        // how the inspector finds the schema to render.
        config: { [step.node]: { ...(engine.config[step.stage] ?? {}) } },
    }));

    // One line per gap. There is no branching to express: each step feeds the
    // next, and the last one feeds the caller.
    const edges: DiagramEdge[] = steps.slice(0, -1).map((step, index) => ({
        id: `${step.stage}->${steps[index + 1].stage}`,
        sourceNodeId: step.stage,
        targetNodeId: steps[index + 1].stage,
        sourceHandle: "right",
        targetHandle: "left",
        outcome: "next",
        label: CARRIES[step.stage] ?? "audio",
    }));

    const now = new Date().toISOString();
    return {
        id: engine.id,
        ownerUserId: "",
        name: engine.name,
        description: engine.description,
        context: "engine",
        graph: { nodes, edges },
        isPublic: false,
        commentsEnabled: false,
        publishedAt: engine.status === "published" ? now : null,
        createdAt: now,
        updatedAt: engine.updated_at ?? now,
    };
}

/** What travels out of a step, written on the line leaving it. */
const CARRIES: Record<string, string> = {
    stt: "transcript",
    llm: "reply text",
    tts: "audio",
    realtime: "audio",
};

const LABELS: Partial<Record<NodeType, string>> = {
    "engine.realtime": "Hears and speaks",
    "engine.listening": "Listening",
    "engine.thinking": "Thinking",
    "engine.speaking": "Speaking",
};

/**
 * The configuration the board is holding, back in the engine's own shape.
 *
 * Reads by node id rather than by position, so a reordered or partially drawn
 * board still yields the right stage. Empty strings are dropped: the inspector
 * writes one when a select is cleared, and a stored `""` would look configured
 * to every reader while meaning nothing to the bridge.
 */
export function diagramToEngineConfig(diagram: Diagram, mode: EngineMode): Record<string, StageConfig> {
    const steps = STEPS[mode] ?? STEPS.realtime;
    const config: Record<string, StageConfig> = {};

    for (const step of steps) {
        const node = diagram.graph.nodes.find((candidate) => candidate.id === step.stage);
        const raw = (node?.config?.[step.node] ?? {}) as Record<string, unknown>;
        const stage: StageConfig = {};

        for (const key of ["provider", "model", "voice", "language"] as const) {
            const value = raw[key];
            if (typeof value === "string" && value.trim() !== "") stage[key] = value.trim();
        }
        for (const key of ["temperature", "max_tokens"] as const) {
            const value = raw[key];
            // A number field left empty arrives as "" or NaN, and either would
            // become `null` in the row — a value the bridge would read as a
            // choice rather than as "use the provider's default".
            const parsed = typeof value === "number" ? value : Number(value);
            if (value !== undefined && value !== null && value !== "" && Number.isFinite(parsed)) {
                stage[key] = parsed;
            }
        }

        config[step.stage] = stage;
    }

    return config;
}

/**
 * Undo and redo over whole graphs.
 *
 * The graph is one value, so history is a stack of graphs rather than a log of
 * operations to invert. At this size — tens of nodes — that costs nothing, and
 * it removes the whole class of bug where an undo reverses an operation
 * incorrectly.
 *
 * The interesting part is what counts as one step. A drag emits a position on
 * every frame and a text field emits one per keystroke; an entry each would make
 * undo useless within seconds. So those coalesce: a run of the same kind of
 * change to the same target collapses into one entry, and anything structural
 * closes the run first.
 *
 * Closing the run first matters. Without it, a pending drag on a node that is
 * then deleted would leave an entry describing a node that no longer exists, and
 * undoing twice would restore it to a position nobody chose.
 */

import type { FlowGraph } from "./flow-graph";

/** Coalescing key: same kind, same target, one entry. */
export type ChangeKind = "move" | "configure" | "rename" | "structural";

export type History = {
    past: FlowGraph[];
    future: FlowGraph[];
    /** The run currently open for coalescing, if any. */
    open: { kind: ChangeKind; target: string } | null;
};

/**
 * Fifty is a budget, not a guess: a graph is a few kilobytes and an editing
 * session should not grow without bound.
 */
const LIMIT = 50;

export const emptyHistory: History = { past: [], future: [], open: null };

const COALESCES: ReadonlySet<ChangeKind> = new Set<ChangeKind>(["move", "configure", "rename"]);

/**
 * Record that `previous` is about to be replaced.
 *
 * `kind` and `target` describe the change being made, not the state being
 * stored — they decide whether this extends the open run or starts a new entry.
 */
export function record(history: History, previous: FlowGraph, kind: ChangeKind, target: string): History {
    const extendsOpenRun =
        COALESCES.has(kind) && history.open !== null && history.open.kind === kind && history.open.target === target;

    // Already inside a run: the entry recorded when it opened is the one to
    // return to, so nothing new is pushed.
    if (extendsOpenRun) {
        return { ...history, future: [] };
    }

    return {
        past: [...history.past, previous].slice(-LIMIT),
        future: [],
        open: COALESCES.has(kind) ? { kind, target } : null,
    };
}

/**
 * End any open run.
 *
 * Called when a drag stops, a field loses focus, or the selection moves — the
 * moments after which the next change of the same kind is a separate intention.
 */
export function settle(history: History): History {
    return history.open === null ? history : { ...history, open: null };
}

export function canUndo(history: History): boolean {
    return history.past.length > 0;
}

export function canRedo(history: History): boolean {
    return history.future.length > 0;
}

export function undo(history: History, current: FlowGraph): { history: History; graph: FlowGraph } | null {
    const previous = history.past[history.past.length - 1];
    if (previous === undefined) return null;

    return {
        graph: previous,
        history: {
            past: history.past.slice(0, -1),
            future: [current, ...history.future].slice(0, LIMIT),
            // An undo always closes the run, or the next drag would coalesce
            // into an entry from before the undo.
            open: null,
        },
    };
}

export function redo(history: History, current: FlowGraph): { history: History; graph: FlowGraph } | null {
    const [next, ...rest] = history.future;
    if (next === undefined) return null;

    return {
        graph: next,
        history: { past: [...history.past, current].slice(-LIMIT), future: rest, open: null },
    };
}

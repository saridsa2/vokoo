import { AgentOperation } from "@/lib/agent/tools"
import {
  addVersionedNote,
  Diagram,
  DiagramEdge,
  DiagramNode,
  NODE_SIZES,
  NODE_TYPES,
  outcomeForNode,
  sizeForNode,
} from "@/lib/architecture-model"

// ─── Pure operation → diagram reducer ─────────────────────────────────────────

/**
 * Apply a single AgentOperation to a Diagram, returning a NEW Diagram.
 * The input diagram is never mutated.
 */
export function applyAgentOperation(diagram: Diagram, op: AgentOperation): Diagram {
  switch (op.type) {
    case "add_flow": {
      const source = diagram.graph.nodes.find((node) => node.id === op.sourceNodeId)
      const outcome = source ? outcomeForNode(source, op.outcome) : undefined
      if (!outcome) return diagram
      const newEdge: DiagramEdge = {
        id: `edge-${crypto.randomUUID()}`,
        sourceNodeId: op.sourceNodeId,
        targetNodeId: op.targetNodeId,
        outcome: outcome.id,
        label: outcome.label,
        style: op.style ?? "muted",
      }
      return {
        ...diagram,
        graph: {
          ...diagram.graph,
          edges: [...diagram.graph.edges, newEdge],
        },
      }
    }

    case "add_component": {
      const anchor = op.anchorNodeId
        ? diagram.graph.nodes.find((n) => n.id === op.anchorNodeId) ?? null
        : null

      const position = op.position ?? positionNearAnchor(anchor, op.componentType, diagram)

      const newNode: DiagramNode = {
        id: op.id,
        type: op.componentType,
        name: op.name.slice(0, 50),
        position,
      }

      return {
        ...diagram,
        graph: {
          nodes: [...diagram.graph.nodes, newNode],
          edges: diagram.graph.edges,
        },
      }
    }

    case "configure_component": {
      const nodes = diagram.graph.nodes.map((node) => {
        if (node.id !== op.nodeId) return node
        return {
          ...node,
          config: {
            ...(node.config ?? {}),
            [node.type]: {
              ...(node.config?.[node.type] ?? {}),
              ...op.configPatch,
            },
          },
        }
      })
      return {
        ...diagram,
        graph: { ...diagram.graph, nodes },
      }
    }

    case "save_note": {
      return addVersionedNote(diagram, op.body)
    }
  }
}

/** Backward-compatible name for existing API and test consumers. */
export const applyOperation = applyAgentOperation

// ─── Position helpers ──────────────────────────────────────────────────────────

function positionNearAnchor(
  anchor: DiagramNode | null,
  componentType: keyof typeof NODE_TYPES,
  diagram: Diagram,
): { x: number; y: number } {
  const size = NODE_SIZES[componentType] ?? { width: 240, height: 100 }
  const GAP = 40

  if (anchor) {
    // Place to the right of anchor
    const candidate = { x: anchor.position.x + (sizeForNode(anchor)?.width ?? 240) + GAP, y: anchor.position.y }
    return candidate
  }

  // No anchor: place below the bottom-most node, or at a sensible default
  if (diagram.graph.nodes.length === 0) {
    return { x: 100, y: 100 }
  }

  const maxY = Math.max(...diagram.graph.nodes.map((n) => n.position.y + (sizeForNode(n)?.height ?? 100)))
  // Centered horizontally among existing nodes
  const avgX = diagram.graph.nodes.reduce((s, n) => s + n.position.x, 0) / diagram.graph.nodes.length
  return { x: Math.round(avgX - size.width / 2), y: maxY + GAP }
}

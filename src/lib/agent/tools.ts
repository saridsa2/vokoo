import { CONFIG_SCHEMAS, defaultConfigForType, Diagram, NODE_TYPES, NodeType, outcomeForNode, outcomesForNode } from "@/lib/architecture-model"

// ─── Public types ──────────────────────────────────────────────────────────────

export type AgentToolDef = {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export type AgentOperation =
  | { type: "add_component"; id: string; componentType: NodeType; name: string; anchorNodeId?: string; position?: { x: number; y: number } }
  | { type: "add_flow"; sourceNodeId: string; targetNodeId: string; outcome: string; label: string; style?: "muted" | "flowing" | "broken" }
  | { type: "configure_component"; nodeId: string; configPatch: Record<string, unknown> }
  | { type: "save_note"; body: string }

// ─── Internal helpers ──────────────────────────────────────────────────────────

const NODE_TYPE_ENUM = Object.keys(NODE_TYPES) as NodeType[]

const EDGE_STYLES = ["muted", "flowing", "broken"] as const
type EdgeStyle = (typeof EDGE_STYLES)[number]

function isEdgeStyle(v: unknown): v is EdgeStyle {
  return (EDGE_STYLES as readonly string[]).includes(v as string)
}

function isKnownNodeType(v: unknown): v is NodeType {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(NODE_TYPES, v)
}

function nodeIdSet(diagram: Diagram): Set<string> {
  return new Set(diagram.graph.nodes.map((n) => n.id))
}

function configValueError(field: Record<string, unknown>, value: unknown): string | null {
  const control = field.control
  const options = Array.isArray(field.options)
    ? field.options.flatMap((option) => Array.isArray(option) && typeof option[0] === "string" ? [option[0]] : [])
    : []
  if (control === "choice" && (typeof value !== "string" || !options.includes(value))) return "must be a declared choice"
  if (control === "multi" && (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !options.includes(item)))) {
    return "must contain only declared choices"
  }
  if (control === "number" && (typeof value !== "number" || !Number.isFinite(value))) return "must be a finite number"
  if (control === "boolean" && typeof value !== "boolean") return "must be a boolean"
  return null
}

// ─── Tool registry ─────────────────────────────────────────────────────────────

export const AGENT_TOOLS: AgentToolDef[] = [
  {
    name: "add_component",
    description: "Add a call-flow node using one of the catalogue node type ids. The result returns the new node's id as nodeId for later add_flow calls.",
    input_schema: {
      type: "object",
      required: ["componentType", "name"],
      properties: {
        componentType: {
          type: "string",
          enum: NODE_TYPE_ENUM,
          description: "Canonical node type. Must be one of the listed enum values.",
        },
        name: {
          type: "string",
          description: "Display name for the new component.",
        },
        anchorNodeId: {
          type: "string",
          description: "Optional ID of an existing node to anchor placement near.",
        },
        position: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
          },
          required: ["x", "y"],
          description: "Optional explicit position for the new node.",
        },
      },
    },
  },
  {
    name: "add_flow",
    description: "Connect one declared outcome of a source call-flow node to the next node. The outcome must belong to the source node's catalogue type.",
    input_schema: {
      type: "object",
      required: ["sourceNodeId", "targetNodeId", "outcome"],
      properties: {
        sourceNodeId: {
          type: "string",
          description: "ID of the node whose outcome decides the next step.",
        },
        targetNodeId: {
          type: "string",
          description: "ID of the next node for this outcome.",
        },
        outcome: {
          type: "string",
          description: "A catalogue outcome id declared by the source node type.",
        },
        style: {
          type: "string",
          enum: ["muted", "flowing", "broken"],
          description: "Visual style of the edge.",
        },
      },
    },
  },
  {
    name: "configure_component",
    description: "Apply configuration values to an existing component. The keys in configPatch must match the valid config fields for the target component type (as defined in CONFIG_SCHEMAS).",
    input_schema: {
      type: "object",
      required: ["nodeId", "configPatch"],
      properties: {
        nodeId: {
          type: "string",
          description: "ID of the node to configure. Must exist in the diagram.",
        },
        configPatch: {
          type: "object",
          additionalProperties: true,
          description: "Key-value config pairs. Keys must match the valid fields for the component's type schema.",
        },
      },
    },
  },
  {
    name: "save_note",
    description: "Save a free-text annotation note for the diagram.",
    input_schema: {
      type: "object",
      required: ["body"],
      properties: {
        body: {
          type: "string",
          description: "The body text of the note. Must be non-empty.",
        },
      },
    },
  },
]

// ─── Agent modes (PRD §11) ──────────────────────────────────────────────────────
// Each mode deterministically controls which tools the agent may use, so its
// behavior is explicit and predictable — not guessed from prompt keywords.

export type AgentMode = "review" | "build" | "configure" | "refactor" | "explain"

type AgentModeDef = {
  id: AgentMode
  label: string
  hint: string
  tools: string[]
  directive: string
}

export const AGENT_MODES: AgentModeDef[] = [
  {
    id: "build",
    label: "Build",
    hint: "Create the architecture from the request",
    tools: ["add_component", "add_flow", "configure_component", "save_note"],
    directive:
      "MODE: Build. Construct the call flow from catalogue nodes. Connect each source outcome with add_flow using the exact outcome id declared for that source node type, then configure required fields.",
  },
  {
    id: "review",
    label: "Review",
    hint: "Find gaps, configure & connect — no new components",
    tools: ["configure_component", "add_flow", "save_note"],
    directive:
      "MODE: Review. Improve the existing call flow only. Configure nodes and connect declared outcomes that need a next node; use a note for a missing catalogue capability.",
  },
  {
    id: "configure",
    label: "Configure",
    hint: "Fill in configuration for existing components",
    tools: ["configure_component", "save_note"],
    directive:
      "MODE: Configure. Fill in configuration for existing unconfigured components only. Do not add or connect components.",
  },
  {
    id: "refactor",
    label: "Refactor",
    hint: "Restructure the existing topology",
    tools: ["add_component", "add_flow", "configure_component", "save_note"],
    directive:
      "MODE: Refactor. Restructure the existing topology to address the user's structural concern — prefer reworking and connecting what exists over piling on new components.",
  },
  {
    id: "explain",
    label: "Explain",
    hint: "Answer questions — no changes",
    tools: [],
    directive:
      "MODE: Explain. Answer the user's question about the diagram in plain language. Do not propose any changes.",
  },
]

export function modeDef(mode: AgentMode): AgentModeDef {
  return AGENT_MODES.find((m) => m.id === mode) ?? AGENT_MODES[0]
}

export function toolsForMode(mode: AgentMode): AgentToolDef[] {
  const allowed = new Set(modeDef(mode).tools)
  return AGENT_TOOLS.filter((tool) => allowed.has(tool.name))
}

// ─── Validator ─────────────────────────────────────────────────────────────────

export function validateToolCall(
  name: string,
  input: unknown,
  diagram: Diagram,
): { ok: true; operation: AgentOperation } | { ok: false; error: string } {
  const inp = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>

  // ── add_component ──────────────────────────────────────────────────────────
  if (name === "add_component") {
    const { componentType, name: nodeName, anchorNodeId, position } = inp

    if (!isKnownNodeType(componentType)) {
      return {
        ok: false,
        error: `Unknown componentType: "${componentType}". Must be one of: ${NODE_TYPE_ENUM.join(", ")}`,
      }
    }
    if (typeof nodeName !== "string" || !nodeName.trim()) {
      return { ok: false, error: 'add_component requires a non-empty "name"' }
    }
    // Reject an exact duplicate of an existing component (same type AND name) —
    // prefer configure_component / add_flow on the existing one instead.
    const trimmedName = nodeName.trim().toLowerCase()
    const duplicate = diagram.graph.nodes.find(
      (n) => n.type === componentType && n.name.trim().toLowerCase() === trimmedName,
    )
    if (duplicate) {
      return {
        ok: false,
        error: `A "${componentType}" component named "${nodeName.trim()}" already exists (id ${duplicate.id}). Configure or connect the existing one instead of adding a duplicate.`,
      }
    }
    if (anchorNodeId !== undefined) {
      if (typeof anchorNodeId !== "string" || !nodeIdSet(diagram).has(anchorNodeId)) {
        return { ok: false, error: `anchorNodeId "${anchorNodeId}" does not exist in the diagram` }
      }
    }

    return {
      ok: true,
      operation: {
        type: "add_component",
        id: `node-${crypto.randomUUID()}`,
        componentType,
        name: nodeName.trim(),
        anchorNodeId: typeof anchorNodeId === "string" ? anchorNodeId : undefined,
        position: typeof position === "object" && position !== null
          ? (position as { x: number; y: number })
          : undefined,
      },
    }
  }

  // ── add_flow ───────────────────────────────────────────────────────────────
  if (name === "add_flow") {
    const { sourceNodeId, targetNodeId, outcome, style } = inp

    if (typeof sourceNodeId !== "string") {
      return { ok: false, error: 'add_flow requires "sourceNodeId" (string)' }
    }
    if (typeof targetNodeId !== "string") {
      return { ok: false, error: 'add_flow requires "targetNodeId" (string)' }
    }

    const ids = nodeIdSet(diagram)
    if (!ids.has(sourceNodeId)) {
      return { ok: false, error: `Source node "${sourceNodeId}" does not exist in the diagram` }
    }
    if (!ids.has(targetNodeId)) {
      return { ok: false, error: `Target node "${targetNodeId}" does not exist in the diagram` }
    }

    const source = diagram.graph.nodes.find((node) => node.id === sourceNodeId)
    const declaredOutcome = source && typeof outcome === "string" ? outcomeForNode(source, outcome) : undefined
    if (!declaredOutcome) {
      const valid = source ? NODE_TYPES[source.type].outcomes.map((candidate) => candidate.id) : []
      return { ok: false, error: `add_flow requires a source outcome (${valid.join(", ") || "none"})` }
    }
    const duplicate = diagram.graph.edges.find(
      (edge) => edge.sourceNodeId === sourceNodeId
        && edge.outcome === declaredOutcome.id,
    )
    if (duplicate) {
      return {
        ok: false,
        error: `Outcome "${declaredOutcome.id}" already has a next node`,
      }
    }

    return {
      ok: true,
      operation: {
        type: "add_flow",
        sourceNodeId,
        targetNodeId,
        outcome: declaredOutcome.id,
        label: declaredOutcome.label,
        style: isEdgeStyle(style) ? style : undefined,
      },
    }
  }

  // ── configure_component ────────────────────────────────────────────────────
  if (name === "configure_component") {
    const { nodeId, configPatch } = inp

    if (typeof nodeId !== "string") {
      return { ok: false, error: 'configure_component requires "nodeId" (string)' }
    }

    const ids = nodeIdSet(diagram)
    if (!ids.has(nodeId)) {
      return { ok: false, error: `Node "${nodeId}" does not exist in the diagram` }
    }

    if (typeof configPatch !== "object" || configPatch === null || Array.isArray(configPatch)) {
      return { ok: false, error: 'configure_component requires "configPatch" (object)' }
    }

    const node = diagram.graph.nodes.find((n) => n.id === nodeId)!
    const schemaMap = CONFIG_SCHEMAS as Record<string, { fields: Array<{ field: string }> } | undefined>
    const schema = schemaMap[node.type]
    if (!schema) {
      if (Object.keys(configPatch as Record<string, unknown>).length > 0) {
        return {
          ok: false,
          error: `Node type "${node.type}" has no configurable fields`,
        }
      }
    } else {
      const fields = new Map(schema.fields.map((field) => [field.field, field as unknown as Record<string, unknown>]))
      for (const [key, value] of Object.entries(configPatch as Record<string, unknown>)) {
        const field = fields.get(key)
        if (!field) {
          return {
            ok: false,
            error: `Invalid configPatch key "${key}" for node type "${node.type}". Valid fields: ${[...fields.keys()].join(", ")}`,
          }
        }
        const valueError = configValueError(field, value)
        if (valueError) return { ok: false, error: `Invalid configPatch value for "${key}": ${valueError}` }
      }
    }

    // Fill sensible defaults for the type, then let the model's values override,
    // so a configure_component always lands a complete, useful config even when
    // the model sends an empty or partial patch.
    const filledPatch = schema
      ? { ...defaultConfigForType(node.type), ...(configPatch as Record<string, unknown>) }
      : (configPatch as Record<string, unknown>)

    return {
      ok: true,
      operation: {
        type: "configure_component",
        nodeId,
        configPatch: filledPatch,
      },
    }
  }

  // ── save_note ──────────────────────────────────────────────────────────────
  if (name === "save_note") {
    const { body } = inp

    if (typeof body !== "string" || !body.trim()) {
      return { ok: false, error: 'save_note requires a non-empty "body"' }
    }

    return {
      ok: true,
      operation: { type: "save_note", body: body.trim() },
    }
  }

  return { ok: false, error: `Unknown tool: "${name}"` }
}

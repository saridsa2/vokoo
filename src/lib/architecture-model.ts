import catalogue from "../../docs/flow-node-catalogue.json"

const NODE_VISUALS = {
  condition: { color: "#f5f3ff", stroke: "#7c6ee6", icon: "condition" },
  loop: { color: "#eef7ff", stroke: "#2376a6", icon: "loop" },
  var: { color: "#effaf6", stroke: "#1d8f68", icon: "variable" },
  code: { color: "#fff6eb", stroke: "#d38a32", icon: "code" },
  business_hours: { color: "#f4f7fb", stroke: "#65758a", icon: "businessHours" },
  agent: { color: "#f6f1ff", stroke: "#8b5bd6", icon: "agent" },
  "kookoo.conference": { color: "#eefaf4", stroke: "#2e9161", icon: "conference" },
  "kookoo.transfer": { color: "#eef9f7", stroke: "#0f8f7a", icon: "transfer" },
  "kookoo.hold": { color: "#fff7ed", stroke: "#c87524", icon: "hold" },
  "kookoo.hangup": { color: "#fff0f0", stroke: "#c85b5b", icon: "hangup" },
  "kookoo.release": { color: "#eef2ff", stroke: "#5b6fd6", icon: "release" },
  "agent.monitor": { color: "#f0f9ff", stroke: "#217ca3", icon: "monitor" },
} as const

export type NodeType = keyof typeof NODE_VISUALS
export type HandleSide = "top" | "right" | "bottom" | "left"

export type NodeOutcome = { id: string; label: string }

export type CatalogueField = {
  field: string
  control: "boolean" | "number" | "text"
  valueType: string
  label: string
  required: boolean
  hint?: string
  help?: string
  default?: unknown
}

export type ConfigSchema = { title: string; fields: CatalogueField[] }
export type ConfigField = CatalogueField

export type NodeTypeMetadata = {
  id: NodeType
  node_type: string
  label: string
  description: string
  provider_action: string | null
  outcomes: NodeOutcome[]
  fields: CatalogueField[]
  suspends: boolean
  default_timeout_seconds: number | null
  color: string
  stroke: string
  icon: (typeof NODE_VISUALS)[NodeType]["icon"]
}

function isNodeType(value: unknown): value is NodeType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(NODE_VISUALS, value)
}

function catalogueFields(value: unknown): CatalogueField[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate): CatalogueField[] => {
    if (!candidate || typeof candidate !== "object") return []
    const field = candidate as Record<string, unknown>
    const rawName = typeof field.key === "string" ? field.key : typeof field.name === "string" ? field.name : ""
    const name = rawName.trim()
    if (!name || typeof field.label !== "string" || typeof field.type !== "string") return []
    const control: CatalogueField["control"] = field.type === "boolean" ? "boolean" : field.type === "number" ? "number" : "text"
    return [{
      field: name,
      control,
      valueType: field.type,
      label: field.label,
      required: field.required === true,
      ...(typeof field.hint === "string" ? { hint: field.hint } : {}),
      ...(typeof field.help === "string" ? { help: field.help } : {}),
      ...(Object.prototype.hasOwnProperty.call(field, "default") ? { default: field.default } : {}),
    }]
  })
}

const catalogueEntries = catalogue.flatMap((entry): NodeTypeMetadata[] => {
  if (!isNodeType(entry.id)) return []
  const fields = catalogueFields(entry.fields)
  return [{
    id: entry.id,
    node_type: entry.node_type,
    label: entry.label,
    description: entry.description,
    provider_action: entry.provider_action,
    outcomes: entry.outcomes.map((outcome) => ({ id: outcome.id, label: outcome.label })),
    fields,
    suspends: entry.suspends,
    default_timeout_seconds: entry.default_timeout_seconds,
    ...NODE_VISUALS[entry.id],
  }]
})

// A missing catalogue row must not degrade into a different node identifier.
// Failing during module initialization keeps catalogue drift visible.
if (catalogueEntries.length !== Object.keys(NODE_VISUALS).length) {
  throw new Error("The flow node catalogue and editor node vocabulary are out of sync.")
}

export const NODE_TYPES = Object.fromEntries(catalogueEntries.map((entry) => [entry.id, entry])) as Record<NodeType, NodeTypeMetadata>
export const ADDABLE_NODE_TYPES = catalogueEntries.map((entry) => entry.id)
export const NODE_SIZES = Object.fromEntries(catalogueEntries.map((entry) => [
  entry.id,
  // 130 = 18px top padding + ~90px of header (icon, name, type, chips) + a
  // 12px gap + 10px bottom padding. Measured rather than guessed: at 108 the
  // header consumed its whole allowance, so the chips row sat flush against the
  // first outcome and the last outcome collided with the card's rounded corner.
  // This must stay in step with .board-node's padding — edge endpoints are
  // computed from these numbers, not from the rendered box.
  { width: 292, height: Math.max(164, 130 + entry.outcomes.length * 30) },
])) as Record<NodeType, { width: number; height: number }>
export const CONFIG_SCHEMAS = Object.fromEntries(catalogueEntries.map((entry) => [
  entry.id,
  { title: `${entry.label} details`, fields: entry.fields },
])) as Record<NodeType, ConfigSchema>
export const DEFAULT_CONFIG = Object.fromEntries(catalogueEntries.flatMap((entry) => {
  const defaults = Object.fromEntries(entry.fields.flatMap((field) => Object.prototype.hasOwnProperty.call(field, "default")
    ? [[field.field, field.default]]
    : []))
  return Object.keys(defaults).length ? [[entry.id, defaults]] : []
})) as Partial<Record<NodeType, Record<string, unknown>>>

export function defaultConfigForType(type: NodeType): Record<string, unknown> {
  return { ...(DEFAULT_CONFIG[type] ?? {}) }
}

export function outcomeForType(type: NodeType, outcomeId: string | undefined): NodeOutcome | undefined {
  return outcomeId ? NODE_TYPES[type].outcomes.find((outcome) => outcome.id === outcomeId) : undefined
}

export type DiagramNode = {
  id: string
  type: NodeType
  name: string
  description?: string
  position: { x: number; y: number }
  width?: number
  height?: number
  config?: Record<string, Record<string, unknown>>
  [key: string]: unknown
}

export type DiagramEdge = {
  id: string
  sourceNodeId: string
  targetNodeId: string
  sourceHandle?: HandleSide
  targetHandle?: HandleSide
  style?: "muted" | "flowing" | "broken"
  outcome?: string
  label?: string
  bidirectional?: boolean
}

export type DiagramNote = { id: string; diagramId: string; version: number; body: string; createdAt: string }
export type Diagram = {
  id: string
  ownerUserId: string
  name: string
  description: string
  context: string
  graph: { nodes: DiagramNode[]; edges: DiagramEdge[] }
  isPublic: boolean
  commentsEnabled: boolean
  publishedAt: string | null
  createdAt: string
  updatedAt: string
  notes?: DiagramNote[]
}
export type WorkspaceState = { workspaceName: string; diagrams: Diagram[] }
export type DiagramSummary = {
  name: string
  description: string
  nodeCount: number
  flowCount: number
  unconfigured: number
  terminalNodes: number
  suspendingNodes: number
}

export function isNodeConfigured(node: DiagramNode): boolean {
  const fields = CONFIG_SCHEMAS[node.type].fields
  if (fields.length === 0) return true
  const config = node.config?.[node.type] ?? {}
  return fields.filter((field) => field.required).every((field) => {
    const value = config[field.field]
    return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0)
  })
}

export function projectToSummary(diagram: Pick<Diagram, "name" | "description" | "graph">): DiagramSummary {
  return {
    name: diagram.name,
    description: diagram.description,
    nodeCount: diagram.graph.nodes.length,
    flowCount: diagram.graph.edges.length,
    unconfigured: diagram.graph.nodes.filter((node) => !isNodeConfigured(node)).length,
    terminalNodes: diagram.graph.nodes.filter((node) => NODE_TYPES[node.type].outcomes.length === 0).length,
    suspendingNodes: diagram.graph.nodes.filter((node) => NODE_TYPES[node.type].suspends).length,
  }
}

const SAMPLE_TS = "2026-08-31T00:00:00.000Z"
export const INITIAL_WORKSPACE: WorkspaceState = {
  workspaceName: "VoKoo call flows",
  diagrams: [{
    id: "reception-flow",
    ownerUserId: "local",
    name: "Reception call flow",
    description: "Routes callers by opening hours, lets an agent help, and brings in a person when requested.",
    context: "",
    isPublic: false,
    commentsEnabled: false,
    publishedAt: null,
    updatedAt: SAMPLE_TS,
    createdAt: SAMPLE_TS,
    graph: {
      nodes: [
        { id: "hours", type: "business_hours", name: "Are we open?", position: { x: -540, y: 20 } },
        { id: "agent", type: "agent", name: "Reception agent", position: { x: -130, y: -80 } },
        { id: "conference", type: "kookoo.conference", name: "Bring in reception", position: { x: 290, y: -160 } },
        { id: "monitor", type: "agent.monitor", name: "Listen after handoff", position: { x: 700, y: -160 } },
        { id: "closed", type: "kookoo.hangup", name: "Closed", position: { x: -130, y: 280 } },
        { id: "finished", type: "kookoo.hangup", name: "Finished", position: { x: 700, y: 180 } },
      ],
      edges: [
        { id: "open", sourceNodeId: "hours", targetNodeId: "agent", outcome: "open", label: "Open", sourceHandle: "right", targetHandle: "left", style: "muted" },
        { id: "closed", sourceNodeId: "hours", targetNodeId: "closed", outcome: "closed", label: "Closed", sourceHandle: "right", targetHandle: "left", style: "muted" },
        { id: "agent-human", sourceNodeId: "agent", targetNodeId: "conference", outcome: "wants_human", label: "Asked for a person", sourceHandle: "right", targetHandle: "left", style: "flowing" },
        { id: "agent-done", sourceNodeId: "agent", targetNodeId: "finished", outcome: "done", label: "Finished", sourceHandle: "right", targetHandle: "left", style: "muted" },
        { id: "joined", sourceNodeId: "conference", targetNodeId: "monitor", outcome: "ok", label: "They joined", sourceHandle: "right", targetHandle: "left", style: "flowing" },
        { id: "call-ended", sourceNodeId: "monitor", targetNodeId: "finished", outcome: "call_ended", label: "Call ended", sourceHandle: "right", targetHandle: "left", style: "muted" },
      ],
    },
  }],
}

export function cloneInitialWorkspace(): WorkspaceState {
  return structuredClone(INITIAL_WORKSPACE)
}

const EDGE_STYLES = ["muted", "flowing", "broken"] as const

function normalizeCanonical(value: Record<string, unknown>): Diagram {
  const timestamp = new Date().toISOString()
  const graph = value.graph && typeof value.graph === "object" ? value.graph as Record<string, unknown> : {}
  const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : []
  const nodes = rawNodes.flatMap((candidate): DiagramNode[] => {
    if (!candidate || typeof candidate !== "object") return []
    const node = candidate as Record<string, unknown>
    if (!isNodeType(node.type)) return []
    const position = node.position && typeof node.position === "object" ? node.position as Record<string, unknown> : {}
    return [{
      ...node,
      id: typeof node.id === "string" && node.id.trim() ? node.id : crypto.randomUUID(),
      type: node.type,
      name: typeof node.name === "string" && node.name.trim() ? node.name : NODE_TYPES[node.type].label,
      description: typeof node.description === "string" ? node.description : undefined,
      position: { x: Number.isFinite(Number(position.x)) ? Number(position.x) : 0, y: Number.isFinite(Number(position.y)) ? Number(position.y) : 0 },
      config: node.config && typeof node.config === "object" ? node.config as Record<string, Record<string, unknown>> : undefined,
    }]
  })
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const rawEdges = Array.isArray(graph.edges) ? graph.edges : []
  const edges = rawEdges.flatMap((candidate): DiagramEdge[] => {
    if (!candidate || typeof candidate !== "object") return []
    const edge = candidate as Record<string, unknown>
    const sourceNodeId = typeof edge.sourceNodeId === "string" ? edge.sourceNodeId : ""
    const targetNodeId = typeof edge.targetNodeId === "string" ? edge.targetNodeId : ""
    const source = nodeById.get(sourceNodeId)
    if (!source || !nodeById.has(targetNodeId)) return []
    const outcome = outcomeForType(source.type, typeof edge.outcome === "string" ? edge.outcome : undefined)
    if (!outcome) return []
    const style = EDGE_STYLES.includes(edge.style as (typeof EDGE_STYLES)[number]) ? edge.style as DiagramEdge["style"] : "muted"
    return [{
      id: typeof edge.id === "string" && edge.id.trim() ? edge.id : crypto.randomUUID(),
      sourceNodeId,
      targetNodeId,
      sourceHandle: edge.sourceHandle === "top" || edge.sourceHandle === "right" || edge.sourceHandle === "bottom" || edge.sourceHandle === "left" ? edge.sourceHandle : "right",
      targetHandle: edge.targetHandle === "top" || edge.targetHandle === "right" || edge.targetHandle === "bottom" || edge.targetHandle === "left" ? edge.targetHandle : "left",
      style,
      outcome: outcome.id,
      label: outcome.label,
    }]
  })
  const rawNotes = Array.isArray(value.notes) ? value.notes : []
  const notes = rawNotes.flatMap((candidate): DiagramNote[] => {
    if (!candidate || typeof candidate !== "object") return []
    const note = candidate as Record<string, unknown>
    return [{
      id: typeof note.id === "string" && note.id.trim() ? note.id : `note-${crypto.randomUUID()}`,
      diagramId: typeof note.diagramId === "string" ? note.diagramId : "",
      version: typeof note.version === "number" ? note.version : 0,
      body: typeof note.body === "string" ? note.body : "",
      createdAt: typeof note.createdAt === "string" ? note.createdAt : timestamp,
    }]
  })
  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id : crypto.randomUUID(),
    ownerUserId: typeof value.ownerUserId === "string" && value.ownerUserId.trim() ? value.ownerUserId : "local-user",
    name: typeof value.name === "string" && value.name.trim() ? value.name : "Untitled call flow",
    description: typeof value.description === "string" ? value.description : "",
    context: typeof value.context === "string" ? value.context : "",
    graph: { nodes, edges },
    isPublic: value.isPublic === true,
    commentsEnabled: value.commentsEnabled === true,
    publishedAt: typeof value.publishedAt === "string" ? value.publishedAt : null,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : timestamp,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : timestamp,
    notes,
  }
}

export function migrateDiagram(value: unknown): Diagram {
  return normalizeCanonical(value && typeof value === "object" ? value as Record<string, unknown> : {})
}

export function addVersionedNote(diagram: Diagram, body: string): Diagram {
  const notes = diagram.notes ?? []
  const version = Math.max(0, ...notes.map((note) => note.version)) + 1
  const note: DiagramNote = { id: `note-${crypto.randomUUID()}`, diagramId: diagram.id, version, body, createdAt: new Date().toISOString() }
  return { ...diagram, notes: [...notes, note] }
}

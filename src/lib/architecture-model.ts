import catalogue from "../../docs/flow-node-catalogue.json"

const NODE_VISUALS = {
  // Triggers read as the board's entry point rather than as work: a warm
  // neutral that does not compete with the coloured node it points at.
  "trigger.call_answered": { color: "#f7f5ef", stroke: "#8a7a52", icon: "triggerAnswered" },
  "trigger.call_ended": { color: "#f7f5ef", stroke: "#8a7a52", icon: "triggerEnded" },
  // A trigger, so it keeps the family's warm neutral — but the stroke is the
  // one warning colour on the board, because a reader glancing at a flow list
  // should be able to tell the escalation path from the ordinary one.
  "trigger.call_failed": { color: "#fdf4f0", stroke: "#b5623c", icon: "triggerFailed" },
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
  "tool.call": { color: "#f3f4ff", stroke: "#5a5fd6", icon: "tool" },
  "kookoo.pause_recording": { color: "#fff7ed", stroke: "#c87524", icon: "hold" },

  // After the call. A family of their own, because a reader glancing at a board
  // should be able to tell "this runs while somebody is listening" from "this
  // runs when nobody is".
  intelligence: { color: "#f2f7ff", stroke: "#2f6fb8", icon: "intelligence" },
  "http.request": { color: "#f2f7ff", stroke: "#2f6fb8", icon: "webhook" },
  // The one node whose branches the author writes rather than the type
  // declaring them, so it gets a hue of its own rather than joining a family.
  "kookoo.collect_digits": { color: "#fdf2fb", stroke: "#a3468f", icon: "keypad" },

  // Engine steps. They never appear on a flow board — `is_addable: false` keeps
  // them out of the palette, and the engine screen is the only thing that
  // builds a diagram containing them. One family, one hue, so a reader can see
  // at a glance that this board is not a flow.
  "engine.realtime": { color: "#eef4ff", stroke: "#3d6bb3", icon: "engineRealtime" },
  "engine.listening": { color: "#eef4ff", stroke: "#3d6bb3", icon: "engineListening" },
  "engine.thinking": { color: "#eef4ff", stroke: "#3d6bb3", icon: "engineThinking" },
  "engine.speaking": { color: "#eef4ff", stroke: "#3d6bb3", icon: "engineSpeaking" },
} as const

export type NodeType = keyof typeof NODE_VISUALS
export type HandleSide = "top" | "right" | "bottom" | "left"

export type NodeOutcome = { id: string; label: string }

export type NodeOutput = "none" | "call" | "schema" | "assignments" | "opaque"

/** What a board is for. Derived from its trigger, never stored on the flow. */
export type NodeFamily = "call" | "post_call" | "engine"

/**
 * Which canvas a board is, as the screen mounting it knows.
 *
 * Not sniffed from the graph. `familyOf` tried that and its `engine` branch
 * could never fire — it looked for a *trigger* node whose type began `engine.`,
 * and an engine board has no trigger at all, so every engine board reported
 * itself as a call board. The screen opening the canvas knows which one it is;
 * asking the graph is guessing at something already known.
 *
 * The config pane switches on this. What a field may hold is not a property of
 * the field — `language` is a string on an engine step and a string on a flow
 * node — it is a property of whether anything precedes it.
 */
export type BoardContext = "engine" | "call" | "integration" | "tool"

/**
 * Whether a field on this board may hold an expression.
 *
 * Only where something actually resolves one at runtime. An expression offered
 * on a board whose runner carries no scope saves, publishes and resolves to
 * empty on a real call — the same fault as offering a path that does not exist,
 * and it looks like it worked.
 *
 * `call` is false because `runner.rs` builds no `Scope` and records no node
 * output. It becomes true the day it does, and this is the one line to change.
 */
export function boardTakesExpressions(context: BoardContext): boolean {
  return context === "integration"
}

export type CatalogueField = {
  field: string
  control: "boolean" | "number" | "text"
  valueType: string
  label: string
  required: boolean
  hint?: string
  help?: string
  default?: unknown
  /**
   * The answers a `select` field accepts. Carried through from the catalogue
   * because a fixed set of answers typed into a text box is a typo nothing
   * catches: `webhook.rs` matches PUT and PATCH and falls through to POST, so
   * a method of "post " sends a POST and a method of "GET" also sends a POST.
   */
  options?: NodeOutcome[]
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
  /**
   * The config field holding branches the author writes, for a node whose
   * outcomes are not knowable from its type.
   *
   * A digit menu is the case that forced this: "press 1 for English, 2 for
   * Hindi" has three branches in one flow and five in the next, so the
   * catalogue cannot name them. n8n's Switch node solves it the same way — add
   * a rule, get an output — which is what settled the design.
   *
   * `null` on every node whose branches its type already knows, which is all of
   * them but the menus. Those keep taking their outcomes from the catalogue,
   * unchanged.
   */
  outcomesFrom: string | null
  /**
   * Which kind of flow this node may appear on.
   *
   * A post-call board must not offer `kookoo.transfer` — there is no caller
   * left to transfer — and a call board must not offer `http.request`, because
   * a blocking request mid-conversation is what tools are for. An array
   * because the generic ones belong to both.
   */
  families: NodeFamily[]
  fields: CatalogueField[]
  suspends: boolean
  default_timeout_seconds: number | null
  /** Whether the palette offers it. Triggers arrive with the flow instead. */
  isAddable: boolean
  /**
   * Where this node's output fields come from, for the expression picker.
   *
   * `none` produces nothing; `call` the call's facts; `schema` the schema it
   * names; `assignments` the rows it declares; `opaque` something whose shape
   * is not knowable until it runs. Declared here so the picker walks the graph
   * and asks, instead of the console knowing which node types matter.
   */
  output: NodeOutput
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
      ...(Array.isArray(field.options)
        ? {
            options: field.options.flatMap((option) =>
              option && typeof option === "object" && typeof (option as NodeOutcome).id === "string"
                ? [{ id: (option as NodeOutcome).id, label: String((option as NodeOutcome).label ?? (option as NodeOutcome).id) }]
                : [],
            ),
          }
        : {}),
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
    // Absent on every row today, and absent reads as "the type knows its own
    // branches" — which is the behaviour every existing node has.
    outcomesFrom: (entry as { outcomes_from?: string | null }).outcomes_from ?? null,
    // Absent reads as `call`, which is what every node was before post-call
    // boards existed.
    families: ((entry as { families?: string[] }).families ?? ["call"]) as NodeFamily[],
    fields,
    suspends: entry.suspends,
    default_timeout_seconds: entry.default_timeout_seconds,
    // Absent on a catalogue dumped before the column existed, and the safe
    // reading of absent is the behaviour every row had then: addable.
    // Two separate facts, and conflating them is why a withdrawn node was still
    // in the palette. `is_addable` is "the palette never offers this" — a
    // trigger, an engine stage. `is_active` is "this is withdrawn": it stays in
    // the vocabulary so a flow already drawn with it still renders, and stops
    // being offered.
    isAddable: (entry as { is_addable?: boolean }).is_addable !== false
      && (entry as { is_active?: boolean }).is_active !== false,
    // Absent reads as producing nothing, which is what every node was before
    // the picker needed to know.
    output: ((entry as { output?: string }).output ?? "none") as NodeOutput,
    ...NODE_VISUALS[entry.id],
  }]
})

// A missing catalogue row must not degrade into a different node identifier.
// Failing during module initialization keeps catalogue drift visible.
if (catalogueEntries.length !== Object.keys(NODE_VISUALS).length) {
  throw new Error("The flow node catalogue and editor node vocabulary are out of sync.")
}

export const NODE_TYPES = Object.fromEntries(catalogueEntries.map((entry) => [entry.id, entry])) as Record<NodeType, NodeTypeMetadata>
export const ADDABLE_NODE_TYPES = catalogueEntries.filter((entry) => entry.isAddable).map((entry) => entry.id)

/**
 * What the palette offers on a board of this kind.
 *
 * The filter is the point of the family: without it a post-call board offers to
 * transfer a caller who has already gone, and the author finds out when the
 * flow runs and does nothing.
 */
export function addableFor(family: NodeFamily): NodeType[] {
  return catalogueEntries
    .filter((entry) => entry.isAddable && entry.families.includes(family))
    .map((entry) => entry.id)
}

/**
 * Which kind of board this is, read from the trigger it opens with.
 *
 * Derived rather than stored: `flows.trigger_event` is already the authority on
 * when a flow runs, and a second field saying the same thing is a second field
 * that can disagree.
 */
export function familyOf(diagram: Pick<Diagram, "graph">): NodeFamily {
  // Engine boards first, and by their own nodes rather than by a trigger. This
  // read `trigger?.type.startsWith("engine.")`, which could never be true: an
  // engine board has no trigger node at all, so every one of them reported
  // itself as a call board.
  if (diagram.graph.nodes.some((node) => node.type.startsWith("engine."))) return "engine"
  const trigger = diagram.graph.nodes.find((node) => isTriggerType(node.type))
  if (trigger?.type === "trigger.call_ended") return "post_call"
  return "call"
}

/**
 * The trigger a flow handling this event opens with.
 *
 * The flow row's `trigger_event` stays the authority — `number_flows` and the
 * bridge's `resolve_for_event` both query it, and neither can read into graph
 * JSON. The node mirrors it so the board can show what started the flow and
 * branch on which cause fired.
 */
export const TRIGGER_NODE_FOR_EVENT: Record<string, NodeType> = {
  "call.answered": "trigger.call_answered",
  "call.ended": "trigger.call_ended",
  "call.failed": "trigger.call_failed",
}

/** A node the flow is entered at, rather than one it runs. */
export function isTriggerType(type: NodeType): boolean {
  return NODE_TYPES[type]?.node_type === "trigger"
}
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

/**
 * Every branch this node can leave by.
 *
 * The one place outcomes are decided. `NODE_TYPES[type].outcomes` is no longer
 * the answer on its own, because a menu's branches live in the node the author
 * configured rather than in its type — so reading the type directly would show
 * a digit menu no digits, and quietly drop every edge leaving it.
 *
 * Author-written branches come first and the type's own follow, which puts a
 * catalogue outcome like `timeout` after the digits in the same order the board
 * draws them: the fallbacks below the choices.
 */
export function outcomesForNode(node: Pick<DiagramNode, "type" | "config">): NodeOutcome[] {
  const meta = NODE_TYPES[node.type]
  if (!meta) return []
  if (!meta.outcomesFrom) return meta.outcomes

  const written = node.config?.[node.type]?.[meta.outcomesFrom]
  if (!Array.isArray(written)) return meta.outcomes

  const branches = written.flatMap((candidate): NodeOutcome[] => {
    if (!candidate || typeof candidate !== "object") return []
    const { id, label } = candidate as { id?: unknown; label?: unknown }
    // An unnamed branch cannot be drawn or connected to, and a half-written row
    // is the normal state of a node somebody is still filling in.
    if (typeof id !== "string" || !id.trim()) return []
    return [{ id, label: typeof label === "string" && label.trim() ? label : id }]
  })

  // A duplicate id would give two ports the same address, and an edge leaving
  // one would be indistinguishable from an edge leaving the other.
  const seen = new Set<string>()
  const unique = branches.filter((branch) => seen.size !== seen.add(branch.id).size)

  return [...unique, ...meta.outcomes]
}

export function outcomeForNode(
  node: Pick<DiagramNode, "type" | "config"> | undefined,
  outcomeId: string | undefined,
): NodeOutcome | undefined {
  if (!node || !outcomeId) return undefined
  return outcomesForNode(node).find((outcome) => outcome.id === outcomeId)
}

/**
 * How tall this node is drawn, which depends on how many branches it has.
 *
 * Edge endpoints are computed from this rather than measured from the DOM, so a
 * node whose outcome count comes from its config needs its size to come from
 * there too — otherwise the arrows leaving a five-digit menu are drawn for a
 * two-outcome box.
 */
export function sizeForNode(node: Pick<DiagramNode, "type" | "config">): { width: number; height: number } {
  const base = NODE_SIZES[node.type] ?? { width: 292, height: 164 }
  const meta = NODE_TYPES[node.type]
  if (!meta?.outcomesFrom) return base
  return { width: base.width, height: Math.max(164, 130 + outcomesForNode(node).length * 30) }
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
    terminalNodes: diagram.graph.nodes.filter((node) => outcomesForNode(node).length === 0).length,
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
    const outcome = outcomeForNode(source, typeof edge.outcome === "string" ? edge.outcome : undefined)
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

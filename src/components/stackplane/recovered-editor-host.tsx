"use client"

import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type * as React from "react"
import type { PointerEvent as ReactPointerEvent } from "react"
import {
  AlertCircle,
  IconGauge,
    ArrowRotateRight,
    ArrowRotateLeft,
    ArrowLeft,
  Check,
  CheckCircle as Save,
  ChevronDown,
  ChevronRight,
  Spinner,
  ChevronUp,
  Code02,
  Container as Box,
  Download01 as Download,
  Eye,
  IconAgents,
  IconBoards as Monitor,
  IconBroadcast as Zap,
  IconCallLogs,
  IconDocument,
  IconLanguage,
  IconFiles as Folder,
  IconGauge as Cpu,
  IconLock as Lock,
  IconMonitors as Activity,
  IconPhoneNumbers,
  IconSliders,
  IconSquads,
  IconStopwatch,
  IconTools,
  IconVoiceLibrary,
  LayersTwo01 as Layers,
  Menu02 as Menu,
  Minus,
  Plus,
  RefreshCcw02 as RotateCcw,
  Share04 as Share2,
  Stars02 as Sparkles,
  TerminalSquare as Keyboard,
  Trash01 as Trash2,
  User01 as User,
  X,
} from "@/components/icons"
import { AnimatedComposer } from "@/components/animated-composer"
import {
  addableFor,
  familyOf,
  type BoardContext,
  boardTakesExpressions,
  type NodeFamily,
  type NodeOutcome,
  isTriggerType,
  CONFIG_SCHEMAS,
  ConfigField,
  Diagram,
  DiagramEdge,
  DiagramNode,
  HandleSide,
  NODE_SIZES,
  NODE_TYPES,
  NodeType,
  addVersionedNote as appendNote,
  cloneInitialWorkspace,
  defaultConfigForType,
  migrateDiagram,
  outcomeForNode,
  outcomesForNode,
  sizeForNode,
} from "@/lib/architecture-model"
import { applyAgentOperation } from "@/lib/agent/apply"
import type { CodingRunDescriptor, CodingRunsByNodeId } from "@/lib/agent/coding-runs-core"
import { type AgentMode, type AgentOperation } from "@/lib/agent/tools"
import { CollabCursors, CollabPresence } from "@/components/stackplane/collab-overlay"
import { useCollab, type CollabGraph } from "@/components/stackplane/use-collab"
import { buildDesktopAttachUrl, buildEditorLaunchUrl } from "@/lib/editor-launch-url"

const STORAGE_KEY = "stackplane.diagrams.v1"
const CAMERA_KEY = "stackplane.diagramCamera.v1"
const MAX_DIAGRAM_NODES = 50
const BOARD_MIN_ZOOM = 0.42
const BOARD_MAX_ZOOM = 1.9
const HIGH_LEVEL_NODE_SIZE = { width: 176, height: 84 }

type ViewMode = "full" | "highLevel"

type InspectorDraft = {
  id: string
  type: NodeType
  name: string
  description: string
  config: Record<string, Record<string, unknown>>
  infraService?: string
}

type Viewport = { x: number; y: number; zoom: number }

type AgentMessage = {
  id: string
  role: "assistant" | "user"
  body: string
  actions?: { label: string; tool: AgentTool }[]
  proposals?: AgentProposal[]
  streaming?: boolean
}

// AgentOperation is imported from @/lib/agent/tools (new canonical shape)

type AgentProposal = {
  id: string
  title: string
  rationale: string
  operations: AgentOperation[]
}

type AgentSuggestion = {
  id: string
  title: string
  reason: string
  nodes: string[]
  action: string
  tool: AgentTool
}

type AgentMarkdownBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }

type AgentTool = NodeType | "reviewNote"

type StarterKind = "reception" | "handoff" | "afterHours" | "monitoredTransfer"

/**
 * The editor, over whatever supplies its diagrams.
 *
 * With no props it keeps its original behaviour: diagrams from localStorage,
 * saved back there. Given a diagram and a save handler it edits that instead,
 * which is how a real flow reaches the canvas — the flow is fetched and
 * converted outside this component, so it knows nothing about the API or about
 * transitions.
 */
/** One record a config field can point at, from outside this editor. */
export type Referenceable = {
  id: string
  name: string
  /**
   * The names a schema declares.
   *
   * A webhook body could always say `{{ $json.patient_name }}` — the bridge has
   * substituted paths since the resolver was written — but nothing told the
   * author that a reading lands in `$json`, or what is in it. Carrying the
   * names is what lets the board offer them.
   */
  fields?: string[]
}

/**
 * A real call, so the panel can show values and not only names.
 *
 * A name tells you a field exists. A value tells you whether it is the one you
 * meant — which is the difference between an expression that works and one that
 * silently resolves to empty.
 */
export type SampleCall = {
  call: Record<string, unknown>
  analysis?: Record<string, unknown>
  /** The carrier's id, which is what a dry run is run against. */
  ucid?: string
  /** For the header: which call the panes are showing. */
  label?: string
}

/** One node, as a dry run saw it. Mirrors `Step` in `postcall.rs`. */
export type DryRunStep = {
  node_id: string
  name: string
  implementation: string
  input: unknown
  output: unknown
  outcome: string
  ms: number
}

/**
 * What an engine step can be set to.
 *
 * The board has no idea which providers rustvani compiles in, and must not
 * guess: a step naming a provider the binary lacks saves, publishes, and fails
 * when the call connects. The caller passes the catalogue in, exactly as it
 * passes the agents a flow node may name.
 */
export type EngineOption = {
    /** The node type this belongs to, e.g. `engine.listening`. */
    stage: string
    id: string
    label: string
    /** Two or three words for the option row. Never a sentence. */
    tagline?: string
    /** Models this provider offers, when the field is a model. */
    models?: { id: string; label: string }[]
    /** Likewise voices. */
    voices?: { id: string; label: string }[]
    /**
     * Whether a model on this provider can be given the agent's tools.
     *
     * Carried for the record rather than for a warning: a provider that cannot
     * is withdrawn from the catalogue, so this is true for everything the board
     * ever sees.
     */
    supportsTools?: boolean
    /** The vendor to bill, and therefore the key to connect. Null runs locally. */
    vendorId?: string | null
}

/**
 * Records a node's config can name — today, the agents an `agent` node picks
 * from. The editor knows nothing about the API, so these are handed in and read
 * through a context rather than drilled through every component between.
 */
export type ExpressionPath = { path: string; label: string; sample?: string }
export type ExpressionGroup = { root: string; paths: ExpressionPath[] }

/**
 * What a flow actually sees in `$call`, and where each part comes from.
 *
 * `postcall.rs` does not hand the flow a row from `calls` — it assembles this,
 * renaming as it goes. A panel that listed the table's columns would offer
 * `$call.to_number` and `$call.duration_seconds`, neither of which exists at
 * runtime: the expression would save, publish, and resolve to empty on a real
 * call. Worse than offering nothing, because it looks like it worked.
 *
 * So this is the contract, written once: the left side is the name a flow uses,
 * the right side the column it is built from. It is a second copy of something
 * `postcall.rs` owns, which is the drift this project keeps finding — kept
 * honest by being one table rather than a list of names in one place and a
 * translation in another.
 */
const CALL_FACTS: Record<string, string> = {
  caller: "from_number",
  did: "to_number",
  started_at: "started_at",
  duration_secs: "duration_seconds",
  ended_reason: "ended_reason",
  transcript: "transcript",
  recording_url: "recording_url",
  call_id: "id",
  ucid: "provider_call_id",
}

/** A `calls` row, as the flow will see it. */
export function callFactsFrom(row: Record<string, unknown>): Record<string, unknown> {
  const facts: Record<string, unknown> = {}
  for (const [name, column] of Object.entries(CALL_FACTS)) facts[name] = row[column]
  // Derived rather than stored, so it has no column to come from.
  facts.ended_by = row.ended_reason === "user_disconnected" ? "caller_hung_up" : "we_ended"
  return facts
}

/** A value, short enough to sit beside the path it came from. */
function sampleOf(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  const text = typeof value === "string" ? value : JSON.stringify(value)
  if (!text) return undefined
  return text.length > 32 ? `${text.slice(0, 31)}…` : text
}

/**
 * Everything the node being edited can refer to.
 *
 * Walked backwards from that node, not filtered from the board. The first
 * version filtered for `intelligence` nodes, which got three things wrong at
 * once: a Set node produced the payload and was invisible; nodes on an
 * unrelated branch were offered as if they had run; and the single producing
 * node appeared twice, once as `$json` and once under its own name, because
 * nothing knew they were the same node.
 *
 * The immediate predecessor is `$json`. Everything further back is named. What
 * each one contributes comes from `meta.output`, so a node type added to the
 * catalogue appears here without the console being touched.
 */
function expressionPathsFor(
  diagram: Diagram | undefined,
  selectedId: string | null,
  shapes: Referenceable[],
  sample?: SampleCall,
): ExpressionGroup[] {
  const nodes = diagram?.graph.nodes ?? []
  const edges = diagram?.graph.edges ?? []
  if (!selectedId) return []

  // Backwards, breadth first, nearest first — and `seen` is what stops a loop
  // in the graph from walking forever.
  const upstream: DiagramNode[] = []
  const seen = new Set<string>([selectedId])
  let frontier = [selectedId]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const id of frontier) {
      for (const edge of edges) {
        if (edge.targetNodeId !== id || seen.has(edge.sourceNodeId)) continue
        seen.add(edge.sourceNodeId)
        const node = nodes.find((candidate) => candidate.id === edge.sourceNodeId)
        if (node) {
          upstream.push(node)
          next.push(node.id)
        }
      }
    }
    frontier = next
  }

  /** What one node offers, by name. */
  const fieldsOf = (node: DiagramNode): string[] => {
    const meta = NODE_TYPES[node.type]
    const config = nodeConfig(node, node.type)
    switch (meta?.output) {
      case "schema": {
        const shape = shapes.find((candidate) => candidate.id === config.shape_id)
        return shape?.fields ?? []
      }
      case "assignments":
        return Array.isArray(config.assignments)
          ? config.assignments
              .map((row: unknown) => (row && typeof row === "object" ? (row as { name?: unknown }).name : undefined))
              .filter((name: unknown): name is string => typeof name === "string" && name.length > 0)
          : []
      case "call":
        return [...Object.keys(CALL_FACTS), "ended_by"]
      // Produces something whose shape only exists once it has run. Offering a
      // guessed list would be offering paths that resolve to empty.
      case "opaque":
      default:
        return []
    }
  }

  const groups: ExpressionGroup[] = []
  const sampleFor = (node: DiagramNode, name: string): string | undefined => {
    const meta = NODE_TYPES[node.type]
    if (meta?.output === "call") return sampleOf(sample?.call?.[name])
    if (meta?.output === "schema") return sampleOf(sample?.analysis?.[name])
    return undefined
  }

  // The step immediately before this one. Named `$json` and not repeated under
  // its own name below.
  const previous = upstream[0]
  if (previous) {
    const fields = fieldsOf(previous)
    if (fields.length > 0) {
      groups.push({
        root: "$json",
        paths: fields.map((name) => ({
          path: `$json.${name}`,
          label: name,
          sample: sampleFor(previous, name),
        })),
      })
    }
  }

  for (const node of upstream.slice(1)) {
    // A trigger emits the call, and `$call` is below with exactly these
    // fields. Listing it under its name as well would be the same ten paths
    // twice, which is the duplication this walk was written to remove.
    if (NODE_TYPES[node.type]?.output === "call") continue
    const fields = fieldsOf(node)
    if (fields.length === 0) continue
    groups.push({
      root: `$('${node.name}')`,
      paths: fields.map((name) => ({
        path: `$('${node.name}').${name}`,
        label: name,
        sample: sampleFor(node, name),
      })),
    })
  }

  // The call is always in scope, whatever ran before. Last, because it is the
  // background rather than what the previous step just produced.
  groups.push({
    root: "$call",
    paths: [...Object.keys(CALL_FACTS), "ended_by"].map((name) => ({
      path: `$call.${name}`,
      label: name,
      sample: sampleOf(sample?.call?.[name]),
    })),
  })

  return groups.filter((group) => group.paths.length > 0)
}

/**
 * Where a value clicked in the Input pane goes.
 *
 * In n8n the Input pane *is* the picker — you take a field from the data on the
 * left and put it into a parameter in the middle. There is no second list under
 * the field, which is what this had: two pickers offering the same paths, one
 * of them pushing the parameters off screen.
 *
 * A mutable ref rather than state: the last field to take focus wins, and a
 * re-render on every focus change would fight the caret.
 */
const InsertTarget = createContext<{ current: ((path: string) => void) | null }>({ current: null })

const ReferenceData = createContext<{ agents: Referenceable[]; shapes: Referenceable[]; engineOptions: EngineOption[]; connectedVendors: string[]; shapeIsFixed: boolean; family: NodeFamily; board: BoardContext; expressionPaths: ExpressionGroup[] }>({ agents: [], shapes: [], engineOptions: [], connectedVendors: [], shapeIsFixed: false, family: "call", board: "call", expressionPaths: [] })

export function RecoveredEditorHost({
  diagram: providedDiagram,
  onSave,
  onPublish,
  agents = [],
  shapes = [],
  shapeIsFixed = false,
  backHref = "/composer",
  notice,
  publishedMessage = "Published. New calls will use this flow.",
  toolbarSlot,
  engineOptions = [],
  connectedVendors = [],
  sampleCall,
  board = "call",
  onDryRun,
}: {
  diagram?: Diagram
  onSave?: (diagram: Diagram) => Promise<boolean>
  /**
   * Release the flow. Separate from saving because they mean different things:
   * saving keeps a draft, publishing is what lets a call reach it —
   * `resolve_for_did` only ever loads a published flow.
   */
  onPublish?: (diagram: Diagram) => Promise<string | null>
  agents?: Referenceable[]
  /** Named JSON schemas an intelligence node can fill in. */
  shapes?: Referenceable[]
  /** A finished call, for the expression panel to show real values from. */
  sampleCall?: SampleCall
  /**
   * Which canvas this is. The config pane switches on it — an engine step has
   * nothing before it to reference, and the live-call runner carries no scope,
   * so neither board may offer an expression.
   */
  board?: BoardContext
  /**
   * Walk the flow against a finished call and report each step.
   *
   * What the node view's Input and Output panes show. Supplied by the screen
   * because the flow id and the call belong to it; the editor only knows it has
   * a way to ask.
   */
  onDryRun?: () => Promise<DryRunStep[]>
  /**
   * The graph cannot be authored — only its nodes configured.
   *
   * An engine is the case: one step, or exactly three in a fixed order, decided
   * by the engine's shape rather than by drawing. Offering a palette, a delete
   * and edge handles would be offering edits that cannot be saved, so the three
   * are switched off together rather than left to fail quietly.
   */
  shapeIsFixed?: boolean
  /** Where the first control goes. This canvas is always entered from a list. */
  backHref?: string
  /**
   * Something the owner wants said, shown in the board's own toast.
   *
   * A caller that rendered its own banner would put it outside the canvas,
   * which fills the window — there is nowhere outside for it to go.
   */
  notice?: string
  /**
   * What the toast says after a successful publish.
   *
   * The default names a flow, which is wrong on any other board: an engine is
   * not a flow, and telling somebody their new flows will use it describes
   * something that did not happen.
   */
  publishedMessage?: string
  /**
   * A control only this board has.
   *
   * An engine's shape decides how many nodes there are, so it cannot live on
   * the board — there is nothing to click before it has been chosen. It sits in
   * the toolbar beside the name, and the host stays ignorant of what it is.
   */
  toolbarSlot?: React.ReactNode
  engineOptions?: EngineOption[]
  connectedVendors?: string[]
} = {}) {
  const initialDiagrams = useMemo(
    () => (providedDiagram ? [providedDiagram] : loadInitialDiagrams()),
    [providedDiagram],
  )
  const [diagrams, setDiagrams] = useState<Diagram[]>(initialDiagrams)
  // localStorage is this editor's own store. A diagram handed in belongs to the
  // caller, and a second copy here would be one the next reader has no reason
  // to prefer and no way to tell is stale.
  const ownsStorage = !providedDiagram
  const [routeDiagramId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null
    return readRouteDiagramId()
  })
  const [activeId] = useState<string>(() => {
    if (typeof window === "undefined") return initialDiagrams[0]?.id ?? ""
    return routeDiagramId ?? initialDiagrams[0]?.id ?? ""
  })
  // One dry run per board, not one per dialog.
  //
  // Opening a node view fires it so the panes are populated the moment they
  // appear — which is most of what makes n8n's node view feel the way it does.
  // Held here rather than in the dialog because a walk reads a transcript with
  // a model: doing it again for every node opened would be several seconds and
  // a bill each time, for the same answer.
  const [dryRun, setDryRun] = useState<{ steps: DryRunStep[] | null; running: boolean; problem: string | null }>({
    steps: null,
    running: false,
    problem: null,
  })

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [inspectorNodeId, setInspectorNodeId] = useState<string | null>(null)
  const [inspectorDraft, setInspectorDraft] = useState<InspectorDraft | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [edgeSource, setEdgeSource] = useState<{ nodeId: string; handle: HandleSide; outcome: string } | null>(null)
  const [connectionPreview, setConnectionPreview] = useState<{ source: Point; target: Point } | null>(null)
  const [palette, setPalette] = useState<{ x: number; y: number; world: Point } | null>(null)
  const [starterMenu, setStarterMenu] = useState<{ x: number; y: number } | null>(null)
  const [agentOpen, setAgentOpen] = useState(false)
  const [viewport, setViewport] = useState<Viewport>(() => (typeof window === "undefined" ? { x: 0, y: 0, zoom: 0.78 } : loadCamera()))
  const [viewMode, setViewMode] = useState<ViewMode>("full")
  const [hydrated] = useState(() => typeof window !== "undefined")
  const [backendLoaded, setBackendLoaded] = useState(false)
  const [toast, setToast] = useState("")
  const [creatingRepo, setCreatingRepo] = useState(false)
  const [scaffolding, setScaffolding] = useState(false)
  const [routingRequirements, setRoutingRequirements] = useState(false)
  const [requirementRoutingStatus, setRequirementRoutingStatus] = useState<{
    diagramId: string
    unassigned: number
  } | null>(null)
  // E16: role-scoped inspector. PMs see the delivery card instead of config.
  const [delivery, setDelivery] = useState<{ viewerRole: string | null; runs: import("@/app/d/agent-actions").ComponentDeliveryRun[] } | null>(null)
  const [codingRunsByNodeId, setCodingRunsByNodeId] = useState<Record<string, CodingRunDescriptor>>({})
  // The workspace supervisor's recent decisions (slice 3), streamed with activity.
  const [supervisorFeed, setSupervisorFeed] = useState<import("@/lib/agent/run-activity").SupervisorFeedItem[]>([])
  const dragRef = useRef<{ nodeId: string; dx: number; dy: number } | null>(null)
  const panRef = useRef<{ x: number; y: number; viewport: Viewport } | null>(null)
  const pulseTimerRef = useRef<number | null>(null)
  const [pulseNodeIds, setPulseNodeIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!hydrated) return
    if (!backendLoaded) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(diagrams))
  }, [backendLoaded, diagrams, hydrated])

  useEffect(() => {
    if (!hydrated) return
    localStorage.setItem(CAMERA_KEY, JSON.stringify({ version: 1, viewport }))
  }, [viewport, hydrated])

  // The backend (workspace.json) is authoritative. Hydrate from it on load so
  // resets/edits made elsewhere are reflected, and the localStorage copy is
  // only a fallback when the backend is unreachable.
  useEffect(() => {
    if (!hydrated) return
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch("/api/workspace", { cache: "no-store" })
        if (!response.ok) return
        const payload = (await response.json()) as { workspace?: { diagrams?: Diagram[] } }
        const backendDiagrams = payload.workspace?.diagrams
        // Same reason: the caller's diagram is the subject, and the workspace
        // endpoint knows nothing about it.
        if (cancelled || !ownsStorage || !Array.isArray(backendDiagrams)) return
        const normalized = backendDiagrams.map(normalizeDiagram).filter((item) => item.graph.nodes.length > 0)
        if (normalized.length === 0) {
          setBackendLoaded(true)
          return
        }
        setDiagrams(normalized)
        if (ownsStorage) writeJSON(STORAGE_KEY, normalized)
        setBackendLoaded(true)
      } catch {
        // Offline: keep the localStorage copy already loaded into state.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hydrated])

  useEffect(() => {
    if (!toast) return
    // 5s, not 2.2s: the shorter window was too brief to read (and too brief for
    // automated test agents to capture), so action results like the
    // "Generate infrastructure" precondition toast looked like they never fired.
    const timer = window.setTimeout(() => setToast(""), 5000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const diagram = useMemo(() => {
    const exact = diagrams.find((item) => item.id === activeId) ?? null
    if (exact) return exact
    return routeDiagramId ? null : diagrams[0] ?? null
  }, [activeId, diagrams, routeDiagramId])

  const runDryRun = useCallback(async () => {
    if (!onDryRun) return
    setDryRun((held) => ({ ...held, running: true, problem: null }))
    try {
      setDryRun({ steps: await onDryRun(), running: false, problem: null })
    } catch (cause) {
      setDryRun({ steps: null, running: false, problem: cause instanceof Error ? cause.message : String(cause) })
    }
  }, [onDryRun])

  // Recomputed as the board changes, because what an expression may refer to
  // changes with it: adding an intelligence node adds its schema's fields.
  const expressionPaths = useMemo(
    // Scoped to the node whose inspector is open, because what may be
    // referenced is a question about that node's position in the graph.
    () => expressionPathsFor(diagram ?? undefined, inspectorNodeId, shapes, sampleCall),
    [diagram, inspectorNodeId, shapes, sampleCall],
  )

  // --- realtime multiplayer (Yjs) ------------------------------------------
  const cursorTickRef = useRef(0)

  const getLocalGraph = useCallback(
    (): CollabGraph | null =>
      diagram
        ? {
            nodes: diagram.graph.nodes,
            edges: diagram.graph.edges,
            name: diagram.name,
            description: diagram.description,
            context: diagram.context,
          }
        : null,
    [diagram],
  )

  // Apply a peer's merged graph to local state. Does NOT route through
  // updateActive, so it never echoes back to the shared doc.
  const applyRemoteGraph = useCallback(
    (graph: CollabGraph) => {
      setDiagrams((prev) => {
        const next = prev.map((item) =>
          item.id === activeId
            ? normalizeDiagram({
                ...item,
                name: graph.name || item.name,
                description: graph.description ?? item.description,
                context: graph.context ?? item.context,
                graph: { nodes: graph.nodes, edges: graph.edges },
                updatedAt: now(),
              })
            : item,
        )
        if (ownsStorage) writeJSON(STORAGE_KEY, next)
        return next
      })
    },
    [activeId],
  )

  const collab = useCollab({ activeId, getLocalGraph, onRemote: applyRemoteGraph })

  // Tell the room which node you're editing, so the ambient agent stays off it.
  useEffect(() => {
    collab.setSelection(inspectorNodeId ?? selectedNodeId ?? null)
  }, [inspectorNodeId, selectedNodeId, collab.setSelection])

  const activeImplementationCount = useMemo(
    () => Object.values(codingRunsByNodeId).filter((run) => run.active).length,
    [codingRunsByNodeId],
  )

  // Load + poll the diagram's implementation status. A component is locked when
  // its latest run is active, and the inspector uses the same map for the status
  // chip. Poll only while at least one implementation is still in flight.
  useEffect(() => {
    if (!diagram) {
      // Clearing the previous diagram's run map is a deliberate scope reset;
      // deferring it would briefly expose stale locks/status in the next view.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCodingRunsByNodeId({})
      return
    }
    let cancelled = false
    async function load() {
      const { codingRunsForDiagramAction } = await import("@/app/d/agent-actions")
      const result = await codingRunsForDiagramAction({ diagramId: activeId })
      if (!cancelled && result.ok) setCodingRunsByNodeId(result.runsByNodeId)
    }
    void load()

    // Realtime observability: the SSE stream pushes per-node activity (run
    // status, agent working/idle pulse, human presence) on every run event.
    // If the stream errors, fall back to the 3s poll while runs are active.
    let fallbackTimer: number | null = null
    const source = new EventSource(`/api/diagrams/${encodeURIComponent(activeId)}/activity/stream`)
    source.onmessage = (message) => {
      if (cancelled) return
      try {
        const data = JSON.parse(message.data) as { runsByNodeId?: CodingRunsByNodeId; supervisor?: import("@/lib/agent/run-activity").SupervisorFeedItem[] }
        if (data.runsByNodeId) setCodingRunsByNodeId(data.runsByNodeId)
        if (data.supervisor) setSupervisorFeed(data.supervisor)
      } catch {
        // Malformed frame — the next emit corrects.
      }
    }
    source.onerror = () => {
      source.close()
      if (!cancelled && fallbackTimer === null && activeImplementationCount > 0) {
        fallbackTimer = window.setInterval(() => void load(), 3000)
      }
    }
    return () => {
      cancelled = true
      source.close()
      if (fallbackTimer) window.clearInterval(fallbackTimer)
    }
  }, [diagram?.id, activeId, activeImplementationCount])

  const requirementRoutingDiagramId = diagram?.id
  useEffect(() => {
    if (!requirementRoutingDiagramId) return
    let cancelled = false
    void (async () => {
      try {
        const { listUnassignedDiagramRequirements } = await import("@/app/d/routing-actions")
        const unassigned = await listUnassignedDiagramRequirements(requirementRoutingDiagramId)
        if (!cancelled) {
          setRequirementRoutingStatus({
            diagramId: requirementRoutingDiagramId,
            unassigned: unassigned.length,
          })
        }
      } catch {
        // A diagram without an approved discovery has no corpus to surface.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [requirementRoutingDiagramId])

  useEffect(() => {
    if (!inspectorNodeId) {
      // Inspector closure must synchronously remove the prior node's delivery.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDelivery(null)
      return
    }
    let cancelled = false
    void (async () => {
      const { componentDeliveryAction } = await import("@/app/d/agent-actions")
      const result = await componentDeliveryAction({ diagramId: activeId, nodeId: inspectorNodeId })
      if (!cancelled && result.ok) setDelivery({ viewerRole: result.viewerRole, runs: result.runs })
    })()
    return () => {
      cancelled = true
    }
  }, [inspectorNodeId, activeId])

  // Persist every edit to the backend (debounced), so the authoritative store
  // stays complete and a reload reflects work beyond sync-flagged edits.
  useEffect(() => {
    if (!hydrated || !backendLoaded || !diagram) return
    const handle = window.setTimeout(() => {
      void syncBackendFromRecoveredDiagram(diagram)
    }, 800)
    return () => window.clearTimeout(handle)
  }, [diagram, hydrated, backendLoaded])
  const selectedNode = diagram?.graph.nodes.find((node) => node.id === (inspectorNodeId ?? selectedNodeId)) ?? null
  const codingRun = selectedNode ? codingRunsByNodeId[selectedNode.id] ?? null : null
  type GraphSnapshot = Diagram["graph"]
  type GraphHistory = { diagramId: string | null; past: GraphSnapshot[]; future: GraphSnapshot[] }
  const [history, setHistory] = useState<GraphHistory>({ diagramId: null, past: [], future: [] })

  const canUndo = Boolean(diagram && history.diagramId === diagram.id && history.past.length > 0)
  const canRedo = Boolean(diagram && history.diagramId === diagram.id && history.future.length > 0)

  function undo() {
    if (!diagram || !canUndo) return
    const previous = history.past[history.past.length - 1]
    if (!previous) return
    const current = structuredClone(diagram.graph)
    setHistory({ diagramId: diagram.id, past: history.past.slice(0, -1), future: [current, ...history.future] })
    updateActive((draft) => { draft.graph = structuredClone(previous) }, { history: false })
    clearTransientSelection()
  }

  function redo() {
    if (!diagram || !canRedo) return
    const next = history.future[0]
    if (!next) return
    const current = structuredClone(diagram.graph)
    setHistory({ diagramId: diagram.id, past: [...history.past, current], future: history.future.slice(1) })
    updateActive((draft) => { draft.graph = structuredClone(next) }, { history: false })
    clearTransientSelection()
  }

  function clearTransientSelection() {
    setSelectedNodeId(null)
    closeInspector()
    clearEdgeMode()
  }

  // Every graph edit funnels through updateActive, so history is recorded here
  // rather than at each call site — a caller that forgets is a caller whose
  // change cannot be undone. `history: false` is for the undo and redo paths
  // themselves, which move between stacks instead of pushing onto them.
  function updateActive(mutator: (draft: Diagram) => void, options: { syncBackend?: boolean; history?: boolean } = {}) {
    if (!diagram) return
    if (options.history !== false) {
      const before = structuredClone(diagram.graph)
      setHistory((current) => ({
        diagramId: diagram.id,
        // A different diagram means the old stacks describe a graph that is no
        // longer on screen; undoing into it would be a surprise.
        past: [...(current.diagramId === diagram.id ? current.past : []), before],
        future: [],
      }))
    }
    setDiagrams((current) => {
      const next = current.map((item) => {
        if (item.id !== diagram.id) return item
        const draft = structuredClone(item)
        mutator(draft)
        draft.updatedAt = now()
        return draft
      })
      if (ownsStorage) writeJSON(STORAGE_KEY, next)
      const nextActive = next.find((item) => item.id === diagram.id)
      if (nextActive) {
        if (options.syncBackend) void syncBackendFromRecoveredDiagram(nextActive)
        // Broadcast the edit to collaborators (diff-based, idempotent).
        collab.pushLocal({
          nodes: nextActive.graph.nodes,
          edges: nextActive.graph.edges,
          name: nextActive.name,
          description: nextActive.description,
          context: nextActive.context,
        })
      }
      return next
    })
  }

  function renameDiagram(name: string) {
    updateActive((draft) => {
      draft.name = name.slice(0, 50)
    })
  }

  function deleteSelectedNode() {
    if (shapeIsFixed) return
    const nodeId = inspectorNodeId ?? selectedNodeId
    if (!nodeId) return
    // The trigger is how the flow is entered. Deleting it would leave a graph
    // the runner starts nowhere in, and there is no way to draw a replacement
    // — the palette does not offer triggers, because a flow gets exactly the
    // one its event calls for.
    const target = diagram?.graph.nodes.find((node) => node.id === nodeId)
    if (target && isTriggerType(target.type)) {
      setToast("The trigger is where this flow starts, so it stays.")
      return
    }
    updateActive((draft) => {
      draft.graph.nodes = draft.graph.nodes.filter((node) => node.id !== nodeId)
      draft.graph.edges = draft.graph.edges.filter((edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId)
    })
    setSelectedNodeId(null)
    closeInspector()
  }

  function openPalette(clientX = 24, clientY = 96) {
    if (shapeIsFixed) return
    setPalette({ x: clientX, y: clientY, world: screenToWorld(clientX, clientY, viewport) })
  }

  function addNode(type: NodeType, atWorld = palette?.world) {
    if (!diagram || diagram.graph.nodes.length >= MAX_DIAGRAM_NODES) {
      setToast("This diagram has too many nodes.")
      return
    }
    const size = getNodeSize(type, viewMode)
    const position = atWorld ?? screenToWorld(window.innerWidth / 2, window.innerHeight / 2, viewport)
    const node: DiagramNode = {
      id: uid("node"),
      type,
      name: NODE_TYPES[type].label,
      description: NODE_TYPES[type].description,
      position: { x: Math.round(position.x - size.width / 2), y: Math.round(position.y - size.height / 2) },
      config: { [type]: defaultConfigForType(type) },
    }
    updateActive((draft) => {
      draft.graph.nodes.push(node)
    })
    setSelectedNodeId(node.id)
    setPalette(null)
  }

  function addVersionedNote(body: string) {
    if (!diagram) return
    const updated = appendNote(diagram, body)
    const note = updated.notes!.at(-1)!
    updateActive((draft) => {
      draft.notes = updated.notes
    }, { syncBackend: true })
    setToast(`Added note v${note.version}.`)
  }

  function runAgentTool(tool: AgentTool) {
    if (!diagram) return
    if (tool === "reviewNote") {
      addVersionedNote(
        `${diagram.name}: ${diagram.graph.nodes.length} nodes and ${diagram.graph.edges.length} outcome paths. Next review should verify required fields and unconnected outcomes.`,
      )
      return
    }
    const spec = agentToolSpec(tool)
    const nodeId = uid("node")
    const anchor = selectedNode ?? suggestAgentAnchor(diagram, spec.type)
    const position = placeAgentNode(diagram, anchor, spec.type)
    const node: DiagramNode = {
      id: nodeId,
      type: spec.type,
      name: spec.name,
      description: spec.description,
      position,
      config: { [spec.type]: defaultConfigForType(spec.type) },
    }
    updateActive((draft) => {
      draft.graph.nodes.push(node)
    }, { syncBackend: true })
    setSelectedNodeId(nodeId)
    setToast(`${spec.name} added.`)
  }

  function applyAgentProposal(proposal: AgentProposal) {
    if (!diagram) return

    // Fold all operations through the pure reducer
    const nextDiagram = proposal.operations.reduce(
      (current, op) => applyAgentOperation(current, op),
      diagram,
    )

    // Determine new node ids so we can highlight them
    const prevNodeIds = new Set(diagram.graph.nodes.map((n) => n.id))
    const addedNodeIds = nextDiagram.graph.nodes
      .map((n) => n.id)
      .filter((id) => !prevNodeIds.has(id))

    // When the proposal adds components, auto-run the layout (same as "Clean
    // up") so new nodes land in a tidy connected arrangement instead of stacked.
    const finalGraph = addedNodeIds.length
      ? { ...nextDiagram.graph, nodes: layoutGraphNodes(nextDiagram.graph.nodes, nextDiagram.graph.edges) }
      : nextDiagram.graph

    // Commit to state + persist via updateActive (pure updater; persistence/sync outside)
    updateActive((draft) => {
      draft.graph = finalGraph
      if (nextDiagram.notes !== undefined) draft.notes = nextDiagram.notes
    }, { syncBackend: true })

    // Highlight newly added nodes
    if (addedNodeIds.length) {
      setViewport({ x: 0, y: 0, zoom: 0.78 })
      setSelectedNodeId(addedNodeIds[addedNodeIds.length - 1] ?? null)
      if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current)
      setPulseNodeIds(new Set(addedNodeIds))
      pulseTimerRef.current = window.setTimeout(() => setPulseNodeIds(new Set()), 900)
    }

    setToast(`Applied: ${proposal.title}.`)
  }

  async function saveActiveDiagram() {
    if (!diagram) return
    // A provided diagram belongs to whoever provided it. Writing it to
    // localStorage as well would leave a second copy that the next reader has
    // no reason to prefer, and no way to tell is stale.
    if (onSave) {
      const saved = await onSave(diagram)
      setToast(saved ? "Saved." : "Could not save.")
      return
    }
    writeJSON(STORAGE_KEY, diagrams)
    const synced = await syncBackendFromRecoveredDiagram(diagram)
    setToast(synced ? "Saved to backend." : "Saved locally. Backend sync failed.")
  }

  async function publishActiveDiagram() {
    if (!diagram || !onPublish) return
    setToast("Publishing…")
    // The message comes back from the caller: publishing validates the flow in
    // the database, and a refusal names the node that caused it.
    const problem = await onPublish(diagram)
    setToast(problem ?? publishedMessage)
  }

  function openInspector(nodeId = selectedNodeId) {
    if (!diagram || !nodeId) return
    const node = diagram.graph.nodes.find((item) => item.id === nodeId)
    if (!node) return
    setSelectedNodeId(node.id)
    setInspectorNodeId(node.id)
    setInspectorDraft(createInspectorDraft(node))
  }

  function closeInspector() {
    setInspectorNodeId(null)
    setInspectorDraft(null)
  }

  function saveInspector(event?: React.FormEvent) {
    event?.preventDefault()
    if (!inspectorDraft) return
    updateActive((draft) => {
      const node = draft.graph.nodes.find((item) => item.id === inspectorDraft.id)
      if (!node) return
      node.name = inspectorDraft.name.slice(0, 50)
      node.description = inspectorDraft.description.slice(0, 250)
      node.config = structuredClone(inspectorDraft.config)
      Object.entries(inspectorDraft.config[node.type] ?? {}).forEach(([key, value]) => {
        node[key] = value
      })
      if (inspectorDraft.infraService) node.infraService = inspectorDraft.infraService
    })
    closeInspector()
  }

  // Turn the inspected node into a real GitHub repo (slice 6). Outward-facing +
  // irreversible — only runs on this explicit click. Uses the current draft so a
  // freshly typed name/config is reflected in the scaffold without a prior save.
  async function createRepoForInspectorNode() {
    if (!inspectorDraft || creatingRepo) return
    setCreatingRepo(true)
    setToast("Creating repository…")
    try {
      const { createNodeRepoAction } = await import("@/app/d/repo-actions")
      const result = await createNodeRepoAction({
        diagramId: activeId,
        node: {
          id: inspectorDraft.id,
          name: inspectorDraft.name,
          type: inspectorDraft.type,
          description: inspectorDraft.description,
          config: inspectorDraft.config,
        },
      })
      if (!result.ok) {
        setToast(result.error)
        return
      }
      updateActive((draft) => {
        const node = draft.graph.nodes.find((item) => item.id === inspectorDraft.id)
        if (!node) return
        node.repoFullName = result.repoFullName
        node.repoUrl = result.repoUrl
      })
      setToast(`Repo created: ${result.repoFullName}`)
    } finally {
      setCreatingRepo(false)
    }
  }

  // Re-open the editor surface for an in-flight run (deployments with a
  // configured editor gateway only — elsewhere the status strip is the surface).
  async function openImplementationForNode(run: CodingRunDescriptor | null) {
    const gatewayUrl = process.env.NEXT_PUBLIC_STACKPLANE_EDITOR_URL
    if (!run?.runId) return
    if (!gatewayUrl) {
      setToast("Watch this run in the Stackplane editor.")
      return
    }
    const gateway = new URL(gatewayUrl)
    if (gateway.hostname.startsWith("editor.")) {
      // Gated deployments launch via opaque tokens — same as Build.
      const editorWindow = window.open("", "_blank")
      const { mintEditorSessionAction } = await import("@/app/d/agent-actions")
      const result = await mintEditorSessionAction({ runId: run.runId })
      if (!result.ok) {
        editorWindow?.close()
        setToast(result.error)
        return
      }
      const url = `${gateway.origin}/s/${result.token}`
      if (editorWindow) {
        editorWindow.location.href = url
      } else {
        window.open(url, "_blank", "noopener,noreferrer")
      }
      return
    }
    const launchUrl = buildEditorLaunchUrl({
      gatewayUrl,
      stackplaneUrl: window.location.href,
      runId: run.runId,
      workspacePath: run.workspacePath ?? undefined,
    })
    window.open(launchUrl, "_blank", "noopener,noreferrer")
  }

  // Breakglass: stop the active run cleanly; the failed state that follows
  // offers Continue implementation (resume from the last pushed commit).
  async function stopImplementationForNode(nodeId: string, run: CodingRunDescriptor | null) {
    if (!run?.runId) return
    const { stopCodingRunAction } = await import("@/app/d/agent-actions")
    const result = await stopCodingRunAction({ runId: run.runId })
    if (!result.ok) {
      setToast(result.error)
      return
    }
    setToast("Run stopped — Continue implementation resumes from the last commit.")
    setCodingRunsByNodeId((current) => ({
      ...current,
      [nodeId]: { ...run, state: "failed", label: "Stopped", prUrl: null, error: "Stopped by the user.", active: false },
    }))
  }

  async function routeRequirementsForDiagram() {
    if (!diagram || routingRequirements) return
    setRoutingRequirements(true)
    setToast("Routing requirements to components...")
    try {
      const { routeDiagramRequirements } = await import("@/app/d/routing-actions")
      const result = await routeDiagramRequirements(diagram.id)
      setRequirementRoutingStatus({
        diagramId: diagram.id,
        unassigned: result.unassigned,
      })
      setToast(
        `Routed ${result.routed} requirement ${result.routed === 1 ? "assignment" : "assignments"}; ${result.unassigned} unassigned.`,
      )
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Couldn't route requirements.")
    } finally {
      setRoutingRequirements(false)
    }
  }

  // Hand the inspected node's repo to the workspace implementation runtime: it
  // clones the repo, writes real code for this component, and opens a PR.
  async function scaffoldInspectorNode() {
    const nodeId = inspectorNodeId
    if (!nodeId || scaffolding) return
    // Only deployments with an editor configured get a tab (popup blockers
    // require opening it synchronously in the click). Without one — prod today
    // — the canvas status strip is the observability surface and no dead tab
    // ever opens.
    const editorGatewayUrl = process.env.NEXT_PUBLIC_STACKPLANE_EDITOR_URL
    const editorWindow = editorGatewayUrl ? window.open("", "_blank") : null
    setScaffolding(true)
    setToast("Starting implementation builder...")
    try {
      const { runCodingAgentAction } = await import("@/app/d/agent-actions")
      const result = await runCodingAgentAction({ diagramId: activeId, nodeId })
      if (!result.ok) {
        editorWindow?.close()
        setToast(result.error)
        return
      }
      setToast("Opening the Stackplane editor…")
      // Optimistically flip the chip to queued; the poll effect takes over from here.
      setCodingRunsByNodeId((current) => ({
        ...current,
        [nodeId]: { state: "queued", label: "Queued...", prUrl: null, error: null, active: true },
      }))
      if (editorGatewayUrl) {
        // Gated deployments (editor.<domain>) use opaque session URLs; local
        // direct code-server keeps the explicit query form.
        const gatewayHost = new URL(editorGatewayUrl).hostname
        const launchUrl = gatewayHost.startsWith("editor.") && result.editorSessionToken
          ? `${new URL(editorGatewayUrl).origin}/s/${result.editorSessionToken}`
          : buildEditorLaunchUrl({
              gatewayUrl: editorGatewayUrl,
              stackplaneUrl: window.location.href,
              runId: result.runId,
              workspacePath: result.editorWorkspacePath,
            })
        if (editorWindow) {
          editorWindow.opener = null
          editorWindow.location.href = launchUrl
        } else {
          window.open(launchUrl, "_blank", "noopener,noreferrer")
        }
      } else {
        setToast("Implementation started — watch it build in the Stackplane editor.")
      }
    } catch {
      editorWindow?.close()
      setToast("Couldn't start the implementation workspace — please try again.")
    } finally {
      setScaffolding(false)
    }
  }

  function startEdge(nodeId: string, outcome: string, handle: HandleSide = "right") {
    if (shapeIsFixed) return
    const source = diagram?.graph.nodes.find((node) => node.id === nodeId)
    if (!source || !outcomeForNode(source, outcome)) return

    // `__end__` is the flow finishing, not an outcome with somewhere to go.
    // `runner.rs` returns `Finished` on it *before* it consults the
    // transitions, so a line drawn from here would sit in the graph looking
    // like a route the call never takes — the same silent dead edge the
    // published flow already carries once.
    if (outcome === "__end__") {
      setToast("This is where the flow finishes, so nothing follows it.")
      return
    }

    // An outcome leads to one node. If it already does, there is nothing to
    // draw, and offering to draw it costs two clicks to reach a refusal:
    // finishEdge rejected the duplicate only after the whole canvas had entered
    // edge mode. Show the line that is already there instead — from there it
    // can be deleted and redrawn, which is what someone clicking a wired
    // outcome usually wants.
    const existing = diagram?.graph.edges.find(
      (edge) => edge.sourceNodeId === nodeId && edge.outcome === outcome,
    )
    if (existing) {
      setSelectedEdgeId(existing.id)
      setSelectedNodeId(nodeId)
      return
    }

    setEdgeSource({ nodeId, handle, outcome })
    const sourcePoint = outcomeHandlePoint(source, outcome, viewMode)
    setConnectionPreview({ source: sourcePoint, target: sourcePoint })
  }

  function finishEdge(targetNodeId: string, targetHandle: HandleSide = "left") {
    if (shapeIsFixed) return
    if (!edgeSource || !diagram) return
    if (edgeSource.nodeId === targetNodeId) {
      setToast("A node cannot connect to itself.")
      clearEdgeMode()
      return
    }
    if (diagram.graph.edges.some((edge) => edge.sourceNodeId === edgeSource.nodeId && edge.outcome === edgeSource.outcome)) {
      setToast("That outcome already has a next node.")
      clearEdgeMode()
      return
    }
    const source = diagram.graph.nodes.find((node) => node.id === edgeSource.nodeId)
    const outcome = source ? outcomeForNode(source, edgeSource.outcome) : undefined
    if (!outcome) {
      clearEdgeMode()
      return
    }
    updateActive((draft) => {
      draft.graph.edges.push({
        id: uid("edge"),
        sourceNodeId: edgeSource.nodeId,
        targetNodeId,
        sourceHandle: edgeSource.handle,
        targetHandle,
        style: "muted",
        outcome: outcome.id,
        label: outcome.label,
      })
    })
    pulseConnectedNodes(edgeSource.nodeId, targetNodeId)
    clearEdgeMode()
  }

  // Escape is the way out of anything modal on the board. Edge mode had no exit
  // except completing an edge: the toolbar button lights up to show the state
  // but only explains it, and the bottom bar's clear-selection button was
  // removed when the toolbar was consolidated. Leaving a canvas in a mode with
  // no cancel is worse than the mode being easy to enter.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      if (edgeSource) {
        clearEdgeMode()
        return
      }
      if (inspectorNodeId) closeInspector()
      else setSelectedNodeId(null)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  })

  function clearEdgeMode() {
    setEdgeSource(null)
    setConnectionPreview(null)
  }

  function pulseConnectedNodes(sourceNodeId: string, targetNodeId: string) {
    if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current)
    setPulseNodeIds(new Set([sourceNodeId, targetNodeId]))
    pulseTimerRef.current = window.setTimeout(() => setPulseNodeIds(new Set()), 620)
  }

  function handleNodePointerDown(event: ReactPointerEvent<HTMLElement>, nodeId: string) {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest("[data-board-nodrag]")) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const node = diagram?.graph.nodes.find((item) => item.id === nodeId)
    if (!node) return
    const point = screenToWorld(event.clientX, event.clientY, viewport)
    dragRef.current = { nodeId, dx: point.x - node.position.x, dy: point.y - node.position.y }
    setSelectedNodeId(nodeId)
    setSelectedEdgeId(null)
  }

  function handleBoardPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // `dialog` matters as much as the rest: the inspector renders inside the
    // board, so without it every click on the panel's own padding closed the
    // panel. Harmless while the panel was small and mostly inputs; a
    // full-screen node view is almost all padding, and was unusable.
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-board-node], button, input, textarea, select, dialog")) return
    panRef.current = { x: event.clientX, y: event.clientY, viewport }
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    closeInspector()
  }

  function handleBoardPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    // Throttle live-cursor broadcasts to ~30/s.
    const tick = performance.now()
    if (tick - cursorTickRef.current > 33) {
      cursorTickRef.current = tick
      collab.setCursor(screenToWorld(event.clientX, event.clientY, viewport))
    }
    if (dragRef.current) {
      const point = screenToWorld(event.clientX, event.clientY, viewport)
      const { nodeId, dx, dy } = dragRef.current
      updateActive((draft) => {
        const node = draft.graph.nodes.find((item) => item.id === nodeId)
        if (!node) return
        node.position.x = Math.round(point.x - dx)
        node.position.y = Math.round(point.y - dy)
      })
    }
    if (panRef.current) {
      setViewport({
        ...viewport,
        x: panRef.current.viewport.x + event.clientX - panRef.current.x,
        y: panRef.current.viewport.y + event.clientY - panRef.current.y,
      })
    }
    if (edgeSource && diagram) {
      const source = diagram.graph.nodes.find((node) => node.id === edgeSource.nodeId)
      if (source) {
        setConnectionPreview({
          source: outcomeHandlePoint(source, edgeSource.outcome, viewMode),
          target: screenToWorld(event.clientX, event.clientY, viewport),
        })
      }
    }
  }

  function handleBoardPointerUp() {
    dragRef.current = null
    panRef.current = null
  }

  // Zoom on the wheel, keeping whatever is under the pointer under the pointer.
  //
  // The +/- buttons worked; nothing listened for the wheel, which is how anyone
  // expects to zoom a canvas. Zooming about the viewport centre instead would
  // walk the thing you are looking at off the screen.
  function zoomAt(clientX: number, clientY: number, delta: number) {
    setViewport((current) => {
      const next = clamp(current.zoom + delta, BOARD_MIN_ZOOM, BOARD_MAX_ZOOM)
      if (next === current.zoom) return current
      // The world point under the cursor, which must not move.
      const world = screenToWorld(clientX, clientY, current)
      return {
        zoom: next,
        x: clientX - window.innerWidth / 2 - world.x * next,
        y: clientY - window.innerHeight / 2 - world.y * next,
      }
    })
  }

  function zoomBy(delta: number) {
    setViewport((current) => ({ ...current, zoom: clamp(current.zoom + delta, BOARD_MIN_ZOOM, BOARD_MAX_ZOOM) }))
  }

  // The owner's message, shown when it changes. Not on every render: the toast
  // dismisses itself, and re-raising it would make it unclosable.
  useEffect(() => {
    if (notice) setToast(notice)
  }, [notice])

  function fit() {
    setViewport({ x: 0, y: 0, zoom: 0.78 })
  }

  useEffect(() => {
    if (shapeIsFixed) setViewport({ x: 0, y: 0, zoom: 0.78 })
  }, [shapeIsFixed, providedDiagram?.id])

  function cleanupLayout() {
    updateActive((draft) => {
      draft.graph.nodes = layoutGraphNodes(draft.graph.nodes, draft.graph.edges)
    }, { syncBackend: true })
    setViewport({ x: 0, y: 0, zoom: 0.78 })
    setToast("Canvas cleaned up.")
  }

  function applyStarter(kind: StarterKind) {
    const graph = buildStarterGraph(kind)
    const starter = STARTER_ARCHITECTURES.find((item) => item.kind === kind)
    updateActive((draft) => {
      const shouldReplace = draft.graph.edges.length === 0 && (
        draft.graph.nodes.length === 0 ||
        (draft.graph.nodes.length === 1 && /^(user|node)$/i.test(draft.graph.nodes[0]?.name ?? ""))
      )
      if (shouldReplace) {
        draft.name = starter?.label ?? draft.name
        draft.description = starter?.description ?? draft.description
        draft.graph = graph
        return
      }

      const maxX = Math.max(...draft.graph.nodes.map((node) => node.position.x), 0)
      const minStarterX = Math.min(...graph.nodes.map((node) => node.position.x), 0)
      const idMap = new Map<string, string>()
      graph.nodes.forEach((node) => idMap.set(node.id, uid("node")))
      draft.graph.nodes.push(...graph.nodes.map((node) => ({
        ...structuredClone(node),
        id: idMap.get(node.id) ?? uid("node"),
        position: {
          x: Math.round(node.position.x + maxX - minStarterX + 420),
          y: node.position.y,
        },
      })))
      draft.graph.edges.push(...graph.edges.flatMap((edge) => {
        const sourceNodeId = idMap.get(edge.sourceNodeId)
        const targetNodeId = idMap.get(edge.targetNodeId)
        if (!sourceNodeId || !targetNodeId) return []
        return [{ ...structuredClone(edge), id: uid("edge"), sourceNodeId, targetNodeId }]
      }))
    }, { syncBackend: true })
    setSelectedNodeId(null)
    closeInspector()
    setStarterMenu(null)
    setViewport({ x: 0, y: 0, zoom: 0.78 })
    setToast("Starter call flow added.")
  }

  if (!diagram) {
    return <main className="app"><p className="empty">{routeDiagramId && !backendLoaded ? "Loading diagram..." : "No diagram found."}</p></main>
  }

  const deleteTarget = diagram?.graph.nodes.find((node) => node.id === (inspectorNodeId ?? selectedNodeId))
  const canDelete = Boolean(deleteTarget && !isTriggerType(deleteTarget.type))

  // Which outcomes have somewhere to go. An outcome without one is not an
  // unfinished drawing — it is an exit: `runner.rs` logs "nothing wired to
  // from/outcome" and ends the call there. The board has to say so, because
  // otherwise a flow looks complete while three of its six ways out are
  // decisions nobody made.
  const wiredOutcomes = useMemo(() => {
    const byNode = new Map<string, Set<string>>()
    for (const edge of diagram?.graph.edges ?? []) {
      if (!edge.outcome) continue
      const wired = byNode.get(edge.sourceNodeId) ?? new Set<string>()
      wired.add(edge.outcome)
      byNode.set(edge.sourceNodeId, wired)
    }
    return byNode
  }, [diagram?.graph.edges])

  return (
    <ReferenceData.Provider value={{ agents, shapes, engineOptions, connectedVendors, shapeIsFixed, family: familyOf(diagram), board, expressionPaths }}>
    <main className="app editor-shell">
      <section className="stage">
        <div
          className="board"
          // Passive listeners cannot preventDefault, and without that the page
          // scrolls while the canvas zooms.
          onWheel={(event) => {
            if (event.ctrlKey || event.metaKey || Math.abs(event.deltaY) > 0) {
              event.preventDefault()
              // Trackpads report small continuous deltas and mice report large
              // stepped ones; scaling by a fraction keeps both usable without
              // reading the device.
              zoomAt(event.clientX, event.clientY, -event.deltaY * 0.0015)
            }
          }}
          data-readonly="false"
          role="application"
          aria-label="Diagram canvas"
          onPointerDown={handleBoardPointerDown}
          onPointerMove={handleBoardPointerMove}
          onPointerLeave={() => collab.setCursor(null)}
          onPointerUp={handleBoardPointerUp}
          onContextMenu={(event) => {
            event.preventDefault()
            const node = (event.target as HTMLElement).closest("[data-node-id]") as HTMLElement | null
            if (node?.dataset.nodeId) {
              setSelectedNodeId(node.dataset.nodeId)
              openInspector(node.dataset.nodeId)
              return
            }
            openPalette(event.clientX, event.clientY)
          }}
        >
          <div
            className="board-world"
            style={{ transform: `translate(calc(50% + ${viewport.x}px), calc(50% + ${viewport.y}px)) scale(${viewport.zoom})` }}
          >
            <EdgeLayer
              diagram={diagram}
              selectedEdgeId={selectedEdgeId}
              selectedNodeId={inspectorNodeId ?? selectedNodeId}
              viewMode={viewMode}
              connectionPreview={connectionPreview}
              onCycleEdgeStyle={(edgeId) => updateEdgeStyle(edgeId, updateActive)}
              onDeleteEdge={(edgeId) => {
                updateActive((draft) => {
                  draft.graph.edges = draft.graph.edges.filter((edge) => edge.id !== edgeId)
                })
                setSelectedEdgeId(null)
              }}
              onSelectEdge={setSelectedEdgeId}
            />
            <div className="node-layer">
              {diagram.graph.nodes.map((node) => (
                <BoardNode
                  wiredOutcomes={wiredOutcomes.get(node.id)}
                  edgeSource={edgeSource}
                  key={node.id}
                  node={node}
                  pulseNodeIds={pulseNodeIds}
                  selected={node.id === selectedNodeId || node.id === inspectorNodeId}
                  viewMode={viewMode}
                  onDelete={deleteSelectedNode}
                  onFinishEdge={finishEdge}
                  onOpenInspector={() => openInspector(node.id)}
                  onPointerDown={handleNodePointerDown}
                  onSelect={() => {
                    if (edgeSource && edgeSource.nodeId !== node.id) finishEdge(node.id)
                    else setSelectedNodeId(node.id)
                  }}
                  onStartEdge={startEdge}
                />
              ))}
            </div>
            <CollabCursors remote={collab.remote} zoom={viewport.zoom} />
          </div>
        </div>

        <CollabPresence remote={collab.remote} self={collab.self} connected={collab.connected} />

        <header className="canvas-toolbar">
          {/* Back to the flow list. This canvas is entered from there, so the
              first control is the way out of it. */}
          <button className="round-button menu-button" aria-label="Back" title="Back" onClick={() => (window.location.href = backHref)}><Icon name="back" /></button>
          <div className="title-pill">
            <input className="diagram-name" value={diagram.name} aria-label="Name" onChange={(event) => renameDiagram(event.target.value)} />
          </div>
          {toolbarSlot ? (
            <>
              <div className="toolbar-divider" />
              {toolbarSlot}
            </>
          ) : null}
          {/* Adding, wiring and tidying all change the shape. On a board whose
              shape is fixed they are three buttons that cannot do anything. */}
          {shapeIsFixed ? null : (
            <>
              <div className="toolbar-divider" />
              <button className="icon-button" aria-label="Add node" title="Add node" onClick={() => openPalette(window.innerWidth / 2, window.innerHeight / 2)}><Icon name="plus" /></button>
              <button
                className={`icon-button ${edgeSource ? "active" : ""}`}
                aria-label={edgeSource ? "Cancel drawing" : "Draw edge"}
                title={edgeSource ? "Cancel drawing (Esc)" : "Draw edge"}
                onClick={() =>
                  edgeSource
                    ? clearEdgeMode()
                    : setToast("Click the dot beside an outcome to draw from it.")
                }
              >
                <Icon name="route" />
              </button>
              <button className="icon-button" aria-label="Tidy layout" title="Tidy layout" onClick={cleanupLayout}><Icon name="layers" /></button>
            </>
          )}
          <div className="toolbar-divider" />
          <button className="icon-button" aria-label="Undo" title="Undo" disabled={!canUndo} onClick={undo}><Icon name="undo" /></button>
          <button className="icon-button" aria-label="Redo" title="Redo" disabled={!canRedo} onClick={redo}><Icon name="redo" /></button>
          <div className="toolbar-divider" />
          <button className="icon-button" aria-label="Save" title="Save" onClick={() => void saveActiveDiagram()}><Icon name="save" /></button>
          {onPublish ? (
            <button className="toolbar-publish" onClick={() => void publishActiveDiagram()}>Publish</button>
          ) : null}
          {shapeIsFixed ? null : (
            <button className="icon-button danger-icon" disabled={!canDelete} aria-label="Delete selected node" title="Delete selected node" onClick={deleteSelectedNode}><Icon name="trash" /></button>
          )}
        </header>

        {palette ? (
          <ComponentPalette
            palette={palette}
            family={familyOf(diagram)}
            onAdd={(type) => addNode(type, palette.world)}
            onClose={() => setPalette(null)}
          />
        ) : null}
        {starterMenu ? <StarterArchitectureMenu anchor={starterMenu} onApply={applyStarter} onClose={() => setStarterMenu(null)} /> : null}
        {agentOpen ? <AgentPanel key={diagram.id} diagram={diagram} supervisor={supervisorFeed} runs={codingRunsByNodeId} onApplyProposal={applyAgentProposal} onClose={() => setAgentOpen(false)} onRunTool={runAgentTool} /> : null}



        <div className="zoom-controls">
          <button className="icon-button" aria-label="Zoom in" onClick={() => zoomBy(0.08)}><Icon name="plus" /></button>
          <button className="icon-button" aria-label="Recenter" onClick={fit}><Icon name="target" /></button>
          <button className="icon-button" aria-label="Zoom out" onClick={() => zoomBy(-0.08)}><Icon name="minus" /></button>
        </div>

        <button className="keyboard-button" aria-label="Keyboard shortcuts" onClick={() => setToast("Keyboard shortcuts will be ported next.")}><Icon name="keyboard" /></button>

        <div data-diagram-inspector-layer="true" className="diagram-inspector-layer">
          {inspectorNodeId && selectedNode && inspectorDraft ? (
            board === "integration" ? (
              // The node view, not the small panel. A step that transforms data
              // cannot be configured blind — what came in and what went out are
              // half the question, and the other boards have neither.
              <NodeDetailView
                draft={inspectorDraft}
                node={selectedNode}
                onCancel={closeInspector}
                onChange={setInspectorDraft}
                onSave={saveInspector}
                dryRun={dryRun}
                onRun={() => void runDryRun()}
                sampleCall={sampleCall}
              />
            ) : (
            <NodeInspector
              draft={inspectorDraft}
              node={selectedNode}
              placement={getInspectorPlacement(selectedNode, viewport, viewMode)}
              linkedRepoUrl={(typeof selectedNode.repoUrl === "string" ? selectedNode.repoUrl : undefined) ?? codingRun?.repoUrl ?? undefined}
              linkedRepoFullName={(typeof selectedNode.repoFullName === "string" ? selectedNode.repoFullName : undefined) ?? codingRun?.repoFullName ?? undefined}
              creatingRepo={creatingRepo}
              onCreateRepo={() => void createRepoForInspectorNode()}
              scaffolding={scaffolding}
              codingRun={codingRun}
              onScaffold={() => void scaffoldInspectorNode()}
              onOpenImplementation={() => void openImplementationForNode(codingRun)}
              onStopRun={() => void stopImplementationForNode(selectedNode.id, codingRun)}
              onCancel={closeInspector}
              onChange={setInspectorDraft}
              onSave={saveInspector}
              delivery={delivery}
            />
            )
          ) : null}
        </div>
      </section>
      {toast ? <div className="toast">{toast}</div> : null}
    </main>
    </ReferenceData.Provider>
  )
}

function BoardNode({
  node,
  selected,
  viewMode,
  edgeSource,
  pulseNodeIds,
  wiredOutcomes,
  onDelete,
  onFinishEdge,
  onOpenInspector,
  onPointerDown,
  onSelect,
  onStartEdge,
}: {
  node: DiagramNode
  selected: boolean
  viewMode: ViewMode
  edgeSource: { nodeId: string; handle: HandleSide; outcome: string } | null
  pulseNodeIds: Set<string>
  /** Outcomes with a next node. The rest end the call where they are. */
  wiredOutcomes: Set<string> | undefined
  onDelete: () => void
  onFinishEdge: (nodeId: string, handle?: HandleSide) => void
  onOpenInspector: () => void
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, nodeId: string) => void
  onSelect: () => void
  onStartEdge: (nodeId: string, outcome: string, handle?: HandleSide) => void
}) {
  const { shapeIsFixed, agents, shapes, family } = useContext(ReferenceData)
  const meta = NODE_TYPES[node.type]
  const size = getNodeSize(node, viewMode)
  const configured = isNodeConfigured(node)
  // A chip that reads "Schema to fill: 5a000000-0000-4000-8000-000000000001"
  // names the row and tells the reader nothing. The card has the lists the
  // inspector's dropdown uses, so it can say which one.
  const configSummary = nodeConfigSummary(node, { agent: agents, structured_output: shapes }).slice(0, 3)
  const isBrushSource = edgeSource?.nodeId === node.id
  const isBrushConnected = pulseNodeIds.has(node.id)
  // A flow is entered at its trigger and run from everything else. That is the
  // whole difference, and it is why this one node has no delete control.
  const isTrigger = isTriggerType(node.type)

  return (
    <article
      className={`board-node ${selected ? "selected" : ""}`}
      data-board-node="true"
      data-node-id={node.id}
      data-node-kind={node.type}
      data-node-type={node.type}
      data-diagram-edge-brush-source={isBrushSource ? "true" : undefined}
      data-diagram-edge-brush-connected={isBrushConnected ? "true" : undefined}
      style={{
        "--node-x": `${node.position.x}px`,
        "--node-y": `${node.position.y}px`,
        "--node-w": `${size.width}px`,
        "--node-h": `${size.height}px`,
        "--node-color": meta.stroke,
        "--node-bg": meta.color,
      } as React.CSSProperties}
      onClick={(event) => {
        event.stopPropagation()
        onSelect()
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        onOpenInspector()
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onOpenInspector()
      }}
      onPointerDown={(event) => onPointerDown(event, node.id)}
    >
      <div className="node-icon"><NodeIcon icon={meta.icon} /></div>
      <div className="node-copy">
        <h3>{truncate(node.name, 28)}</h3>
        <p className="node-type-label">{meta.label}</p>
        <span className="node-type-id">{node.type}</span>
        {configured ? null : <span>Unconfigured</span>}
        {configSummary.length === 0 ? null : (
          <div className="node-config-chips">
            {configSummary.map((item) => <em key={item}>{item}</em>)}
          </div>
        )}
      </div>
      <div className="node-outcomes" aria-label={`${meta.label} outcomes`}>
        {outcomesForNode(node).map((outcome) => {
          const wired = wiredOutcomes?.has(outcome.id) ?? false
          return (
          <button
            type="button"
            className={`node-outcome ${wired ? "" : "node-outcome-open"}`}
            data-board-nodrag="true"
            data-outcome-id={outcome.id}
            data-outcome-open={wired ? undefined : "true"}
            key={outcome.id}
            // The same sentence the row shows, rather than a different one. The
            // visible text already said "to the caller" on a fixed shape while
            // these two still said the call ends here — a claim about a flow,
            // on a canvas that is not one.
            aria-label={wired
              ? `${outcome.label} outcome, connected`
              : shapeIsFixed
                ? `${outcome.label}, handed to the caller`
                : `${outcome.label} outcome, nothing connected — the ${family === "post_call" ? "flow" : "call"} ends here`}
            title={wired || shapeIsFixed
              ? undefined
              : `Nothing is wired to “${outcome.label}”, so the ${family === "post_call" ? "flow" : "call"} ends here.`}
            onClick={(event) => {
              event.stopPropagation()
              // Finishing an edge accepts the whole row: the target is the node,
              // so anywhere on it is an unambiguous answer to "which node".
              if (edgeSource && edgeSource.nodeId !== node.id) {
                onFinishEdge(node.id, "left")
                return
              }
              // Starting one does not. The dot is what looks like a connector,
              // and the row is mostly words — clicking "Finished" to read it
              // should not begin drawing a line.
              if ((event.target as HTMLElement).closest(".node-outcome-point")) {
                onStartEdge(node.id, outcome.id, "right")
                return
              }
              onSelect()
            }}
          >
            {/* The dot is what says "you can draw from here". `startEdge`
                refuses on a fixed shape, so on an engine board it was an
                affordance for something that cannot happen — the canvas there
                exists to configure a chain, not to author one. */}
            {shapeIsFixed ? null : <span className="node-outcome-point" aria-hidden />}
            <b>{outcome.label}</b>
            {/* An unwired outcome on a flow is where a call stops, and the
                runner logs exactly that. On a fixed shape it is the end of the
                chain — the last step hands audio back to the caller — so the
                flow's wording would be a false claim about what happens. */}
            {/* What an unwired outcome means depends on the board. On a
                post-call flow the call is already over — saying "ends the
                call" there describes something that happened before this node
                ran. */}
            <small>{wired ? outcome.id : shapeIsFixed ? "to the caller" : family === "post_call" ? "ends the flow" : "ends the call"}</small>
          </button>
          )
        })}
      </div>
      {selected ? (
        <>
          {node.description ? <div className="node-tooltip">{node.description}</div> : null}
          <div className="selection-ring" />
          {isTrigger ? null : (
            <button className="node-action node-action-delete" data-board-nodrag="true" aria-label="Delete node" onClick={(event) => { event.stopPropagation(); onDelete() }}><Icon name="trash" /></button>
          )}
        </>
      ) : null}
    </article>
  )
}

function ComponentPalette({
  palette,
  onAdd,
  onClose,
  family,
}: {
  palette: { x: number; y: number; world: Point }
  onAdd: (type: NodeType) => void
  onClose: () => void
  /** What this board is for. Decides what the palette may offer. */
  family: NodeFamily
}) {
  const left = clamp(palette.x, 12, typeof window === "undefined" ? palette.x : window.innerWidth - 270)
  const top = clamp(palette.y, 12, typeof window === "undefined" ? palette.y : window.innerHeight - 430)
  return (
    <>
      <div className="context-menu-backdrop" onClick={onClose} />
      <aside className="context-menu" style={{ left, top }}>
        <div className="context-title">Add node</div>
        <div className="context-grid">
          {addableFor(family).map((type) => {
            const meta = NODE_TYPES[type]
            return (
              <button type="button" key={type} onClick={() => onAdd(type)}>
                <span className="mini-icon" style={{ "--node-color": meta.stroke, "--node-bg": meta.color } as React.CSSProperties}>
                  <NodeIcon icon={meta.icon} />
                </span>
                <span>{meta.label}</span>
              </button>
            )
          })}
        </div>
      </aside>
    </>
  )
}

function StarterArchitectureMenu({
  anchor,
  onApply,
  onClose,
}: {
  anchor: { x: number; y: number }
  onApply: (kind: StarterKind) => void
  onClose: () => void
}) {
  const left = clamp(anchor.x, 12, typeof window === "undefined" ? anchor.x : window.innerWidth - 330)
  const top = clamp(anchor.y, 12, typeof window === "undefined" ? anchor.y : window.innerHeight - 310)
  return (
    <>
      <div className="context-menu-backdrop" onClick={onClose} />
      <aside className="context-menu starter-menu" style={{ left, top }}>
        <div className="context-title">Starter call flow</div>
        <div className="starter-menu-list">
          {STARTER_ARCHITECTURES.map((starter) => (
            <button type="button" key={starter.kind} onClick={() => onApply(starter.kind)}>
              <span className="mini-icon" aria-hidden="true">
                <Icon name="layers" />
              </span>
              <span>
                <b>{starter.label}</b>
                <small>{starter.description}</small>
              </span>
            </button>
          ))}
        </div>
      </aside>
    </>
  )
}

function AgentPanel({
  diagram,
  supervisor = [],
  runs = {},
  onApplyProposal,
  onClose,
  onRunTool,
}: {
  diagram: Diagram
  supervisor?: import("@/lib/agent/run-activity").SupervisorFeedItem[]
  runs?: Record<string, CodingRunDescriptor>
  onApplyProposal: (proposal: AgentProposal) => void
  onClose: () => void
  onRunTool: (tool: AgentTool) => void
}) {
  const [prompt, setPrompt] = useState("")
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [appliedProposalIds, setAppliedProposalIds] = useState<Set<string>>(new Set())
  // PRD §11 agent modes. Default: an empty/sparse canvas is for building, a
  // populated one for reviewing. The user can switch explicitly.
  // One conversation with the supervisor — no mode picker. Intent is inferred
  // from the message; the initial lean uses a sparse canvas as a build signal.
  const [mode] = useState<AgentMode>(() => (diagram.graph.nodes.length <= 2 ? "build" : "review"))

  async function submitPrompt(value = prompt) {
    const trimmed = value.trim()
    if (!trimmed) return
    const assistantId = uid("agent-assistant")
    setMessages((current) => [
      ...current,
      { id: uid("agent-user"), role: "user", body: trimmed },
      { id: assistantId, role: "assistant", body: "", streaming: true },
    ])
    setPrompt("")
    try {
      await streamAgentResponse({
        diagram,
        prompt: trimmed,
        mode,
        onDelta: (text) => {
          setMessages((current) => current.map((message) => (
            message.id === assistantId ? { ...message, body: `${message.body}${text}`, streaming: true } : message
          )))
        },
        onActions: (actions) => {
          setMessages((current) => current.map((message) => (
            message.id === assistantId ? { ...message, actions } : message
          )))
        },
        onProposal: (proposal) => {
          setMessages((current) => current.map((message) => (
            message.id === assistantId
              ? { ...message, proposals: [...(message.proposals ?? []).filter((item) => item.id !== proposal.id), proposal] }
              : message
          )))
        },
      })
      setMessages((current) => current.map((message) => (
        message.id === assistantId ? { ...message, streaming: false } : message
      )))
    } catch {
      const response = agentMessageForPrompt(diagram, trimmed)
      setMessages((current) => current.map((message) => (
        message.id === assistantId ? { ...response, id: assistantId, body: `${response.body} (Local fallback: server stream unavailable.)`, streaming: false } : message
      )))
    }
  }

  function runMessageAction(tool: AgentTool) {
    onRunTool(tool)
    const body = tool === "reviewNote"
      ? "Saved a versioned review note for this diagram. I will keep future recommendations tied to this canvas."
      : `${agentToolSpec(tool).name} added to the canvas. Review its placement and configure it when ready.`
    setMessages((current) => [
      ...current,
      {
        id: uid("agent-assistant"),
        role: "assistant",
        body,
      },
    ])
  }

  function applyProposal(proposal: AgentProposal) {
    onApplyProposal(proposal)
    setAppliedProposalIds((current) => new Set([...current, proposal.id]))
    setMessages((current) => [
      ...current,
      {
        id: uid("agent-assistant"),
        role: "assistant",
        body: `Applied **${proposal.title}** to the canvas.`,
      },
    ])
  }

  return (
    <aside className="floating-panel agent-workbench editor-agent-panel" aria-label="Call-flow agent">
      <button type="button" className="agent-close" aria-label="Close agent" onClick={onClose}><Icon name="x" /></button>
      <div className="agent-conversation">
        {messages.length ? (
          <div className="agent-chat">
            {messages.map((message) => (
              <article className={`agent-message ${message.role}`} key={message.id}>
                <span>{message.role === "assistant" ? "Stackplane agent" : "You"}</span>
                {message.body ? (
                  <>
                    <AgentMarkdown body={message.body} />
                    {message.streaming ? <AgentThinking label="Stackplane is writing" /> : null}
                  </>
                ) : message.streaming ? (
                  <AgentThinking label="Stackplane is thinking" />
                ) : null}
                {message.actions?.length ? (
                  <div className="agent-message-actions">
                    {message.actions.map((action) => (
                      <button type="button" key={`${message.id}-${action.tool}`} onClick={() => runMessageAction(action.tool)}>{action.label}</button>
                    ))}
                  </div>
                ) : null}
                {message.proposals?.length ? (
                  <div className="agent-proposal-list">
                    {message.proposals.map((proposal) => (
                      <AgentProposalCard
                        applied={appliedProposalIds.has(proposal.id)}
                        key={proposal.id}
                        proposal={proposal}
                        nodeName={(id) => diagram.graph.nodes.find((node) => node.id === id)?.name ?? id}
                        onApply={() => applyProposal(proposal)}
                      />
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
        <AnimatedComposer
          className="agent-cult-composer"
          value={prompt}
          rows={1}
          compact
          showAvatar={false}
          maxAutoGrowPx={120}
          placeholder="Ask about this call flow…"
          onChange={(event) => setPrompt(event.target.value)}
          onSend={() => submitPrompt()}
        />
      </div>
    </aside>
  )
}

function AgentThinking({ label }: { label: string }) {
  return (
    <div className="agent-thinking" aria-live="polite">
      <i />
      <i />
      <i />
      <b>{label}</b>
    </div>
  )
}

function AgentProposalCard({
  applied,
  onApply,
  proposal,
  nodeName,
}: {
  applied: boolean
  onApply: () => void
  proposal: AgentProposal
  nodeName: (id: string) => string
}) {
  // Resolve names for nodes added in THIS proposal too (a build can configure
  // or connect a newly added node before that node appears on the canvas).
  const stagedNames = new Map<string, string>()
  for (const operation of proposal.operations) {
    if (operation.type === "add_component") stagedNames.set(operation.id, operation.name)
  }
  const resolveName = (id: string) => stagedNames.get(id) ?? nodeName(id)
  return (
    <section className="agent-proposal-card">
      <div>
        <span>Proposal</span>
        <strong>{proposal.title}</strong>
      </div>
      <ul>
        {proposal.operations.map((operation, index) => {
          const op = describeAgentOperation(operation, resolveName)
          return (
            <li key={`${operation.type}-${index}`}>
              <code>{op.verb}</code>
              <span>{op.text}</span>
            </li>
          )
        })}
      </ul>
      <button type="button" disabled={applied} onClick={onApply}>
        {applied ? "Applied" : "Apply to canvas"}
      </button>
    </section>
  )
}

function describeAgentOperation(operation: AgentOperation, nodeName: (id: string) => string): { verb: string; text: string } {
  if (operation.type === "save_note") return { verb: "Note", text: "Save a review note" }
  if (operation.type === "configure_component") return { verb: "Configure", text: nodeName(operation.nodeId) }
  if (operation.type === "add_flow") return { verb: "Connect", text: `${nodeName(operation.sourceNodeId)} → ${nodeName(operation.targetNodeId)}` }
  return { verb: "Add", text: `${operation.name} · ${NODE_TYPES[operation.componentType]?.label ?? operation.componentType}` }
}


function AgentMarkdown({ body }: { body: string }) {
  const blocks = markdownBlocks(body)
  return (
    <div className="agent-markdown">
      {blocks.map((block, index) => {
        if (block.type === "heading") return <h4 key={`${block.type}-${index}`}>{renderInlineMarkdown(block.text)}</h4>
        if (block.type === "list") {
          return (
            <ul key={`${block.type}-${index}`}>
              {block.items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>)}
            </ul>
          )
        }
        return <p key={`${block.type}-${index}`}>{renderInlineMarkdown(block.text)}</p>
      })}
    </div>
  )
}

function markdownBlocks(body: string): AgentMarkdownBlock[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n")
  const blocks: AgentMarkdownBlock[] = []
  let paragraph: string[] = []
  let list: string[] = []

  function flushParagraph() {
    if (!paragraph.length) return
    blocks.push({ type: "paragraph", text: paragraph.join(" ").trim() })
    paragraph = []
  }

  function flushList() {
    if (!list.length) return
    blocks.push({ type: "list", items: list })
    list = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      flushList()
      continue
    }
    const heading = line.match(/^#{1,4}\s+(.+)$/)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push({ type: "heading", text: heading[1] })
      continue
    }
    const bullet = line.match(/^(?:[-*]|\d+\.)\s+(.+)$/)
    if (bullet) {
      flushParagraph()
      list.push(bullet[1])
      continue
    }
    flushList()
    paragraph.push(line)
  }

  flushParagraph()
  flushList()
  return blocks.length ? blocks : [{ type: "paragraph", text: body }]
}

function renderInlineMarkdown(value: string) {
  const parts = value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean)
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>
    if (part.startsWith("`") && part.endsWith("`")) return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>
    return <Fragment key={`${part}-${index}`}>{part}</Fragment>
  })
}

async function streamAgentResponse({
  diagram,
  prompt,
  mode,
  onActions,
  onDelta,
  onProposal,
}: {
  diagram: Diagram
  prompt: string
  mode: AgentMode
  onActions: (actions: AgentMessage["actions"]) => void
  onDelta: (text: string) => void
  onProposal: (proposal: AgentProposal) => void
}) {
  const response = await fetch("/api/agent/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ diagram, prompt, mode }),
  })
  if (!response.ok || !response.body) throw new Error("Agent stream failed")

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split("\n\n")
    buffer = events.pop() ?? ""
    for (const eventText of events) {
      const event = parseSseEvent(eventText)
      if (event.event === "delta" && typeof event.data?.text === "string") onDelta(event.data.text)
      if (event.event === "actions" && Array.isArray(event.data?.actions)) onActions(event.data.actions)
      if (event.event === "proposal" && isAgentProposal(event.data?.proposal)) onProposal(event.data.proposal)
    }
  }
}

function isAgentProposal(value: unknown): value is AgentProposal {
  if (!value || typeof value !== "object") return false
  const proposal = value as AgentProposal
  return typeof proposal.id === "string"
    && typeof proposal.title === "string"
    && typeof proposal.rationale === "string"
    && Array.isArray(proposal.operations)
}

function parseSseEvent(value: string): { event: string; data: Record<string, unknown> | null } {
  const event = value.match(/^event:\s*(.+)$/m)?.[1]?.trim() ?? "message"
  const dataLine = value.match(/^data:\s*(.+)$/m)?.[1]
  if (!dataLine) return { event, data: null }
  try {
    return { event, data: JSON.parse(dataLine) }
  } catch {
    return { event, data: null }
  }
}

function EdgeLayer({
  diagram,
  selectedEdgeId,
  selectedNodeId,
  viewMode,
  connectionPreview,
  onCycleEdgeStyle,
  onDeleteEdge,
  onSelectEdge,
}: {
  diagram: Diagram
  selectedEdgeId: string | null
  selectedNodeId: string | null
  viewMode: ViewMode
  connectionPreview: { source: Point; target: Point } | null
  onCycleEdgeStyle: (edgeId: string) => void
  onDeleteEdge: (edgeId: string) => void
  onSelectEdge: (edgeId: string) => void
}) {
  const nodeById = new Map(diagram.graph.nodes.map((node) => [node.id, node]))
  return (
    <>
      <svg className="edge-layer" aria-hidden="true">
        <defs>
          {/* 16 rather than 8. The edge uses a non-scaling stroke, so the line
              holds 3.2px at every zoom while the marker scales with the world —
              at the default zoom an 8-unit head rendered about 5px and read as a
              slightly thicker line end rather than an arrow. */}
          <marker id="arrow" viewBox="0 0 20 20" refX="20" refY="10" markerWidth="16" markerHeight="16" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
            <path d="M 0 0 L 20 10 L 0 20 z" />
          </marker>
          <marker id="arrow-active" viewBox="0 0 20 20" refX="20" refY="10" markerWidth="16" markerHeight="16" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
            <path d="M 0 0 L 20 10 L 0 20 z" />
          </marker>
        </defs>
        <g>
          {diagram.graph.edges.map((edge) => {
            const source = nodeById.get(edge.sourceNodeId)
            const target = nodeById.get(edge.targetNodeId)
            if (!source || !target) return null
            const endpoints = edgeEndpoints(edge, source, target, viewMode)
            const rope = ropePath(endpoints.source, endpoints.target)
            const highlighted = selectedNodeId && (edge.sourceNodeId === selectedNodeId || edge.targetNodeId === selectedNodeId)
            const flowing = edge.style === "flowing" || highlighted
            const marker = highlighted ? "arrow-active" : "arrow"
            return (
              <g className={`edge-group ${highlighted ? "highlighted" : ""}`} data-board-edge="true" data-edge-id={edge.id} key={edge.id}>
                <path className={`edge-base ${edge.style ?? "muted"}`} vectorEffect="non-scaling-stroke" markerStart={edge.bidirectional ? `url(#${marker})` : undefined} markerEnd={`url(#${marker})`} d={rope.d} />
                <path className={`edge-flow ${flowing ? "is-visible" : ""}`} vectorEffect="non-scaling-stroke" markerStart={flowing && edge.bidirectional ? "url(#arrow-active)" : undefined} markerEnd={flowing ? "url(#arrow-active)" : undefined} d={rope.d} />
                <path className="edge-hit" data-edge-hit="true" data-edge-id={edge.id} vectorEffect="non-scaling-stroke" d={rope.d} onClick={() => onSelectEdge(edge.id)} />
              </g>
            )
          })}
          {connectionPreview ? <ConnectionPreview source={connectionPreview.source} target={connectionPreview.target} /> : null}
        </g>
      </svg>
      <div className="edge-ui-layer">
        {diagram.graph.edges.map((edge) => {
          const source = nodeById.get(edge.sourceNodeId)
          const target = nodeById.get(edge.targetNodeId)
          if (!source || !target) return null
          const outcome = outcomeForNode(source, edge.outcome)
          if (!outcome) return null
          const endpoints = edgeEndpoints(edge, source, target, viewMode)
          const rope = ropePath(endpoints.source, endpoints.target)
          return (
            <EdgeControls
              edge={{ ...edge, label: outcome.label }}
              key={edge.id}
              selected={selectedEdgeId === edge.id}
              x={rope.labelX}
              y={rope.labelY - 28}
              onCycle={() => onCycleEdgeStyle(edge.id)}
              onDelete={() => onDeleteEdge(edge.id)}
              onSelect={() => onSelectEdge(edge.id)}
            />
          )
        })}
      </div>
    </>
  )
}

function EdgeControls({
  edge,
  selected,
  x,
  y,
  onCycle,
  onDelete,
  onSelect,
}: {
  edge: DiagramEdge
  selected: boolean
  x: number
  y: number
  onCycle: () => void
  onDelete: () => void
  onSelect: () => void
}) {
  const { shapeIsFixed } = useContext(ReferenceData)
  const hasLabel = Boolean(edge.label?.trim())
  const edgeStyle = edge.style ?? "muted"
  const styleLabel = edgeStyle.charAt(0).toUpperCase() + edgeStyle.slice(1)
  return (
    <div
      className={`edge-ui ${hasLabel ? "has-label" : "empty"} ${selected ? "selected" : ""}`}
      data-edge-id={edge.id}
      style={{ "--edge-label-x": `${Math.round(x)}px`, "--edge-label-y": `${Math.round(y)}px` } as React.CSSProperties}
      onClick={onSelect}
    >
      {/* On a fixed shape the line cannot be restyled or removed, so the pill
          carries only what it says. Showing the controls would offer two edits
          that silently do nothing. */}
      {shapeIsFixed ? (
        hasLabel ? <div className="edge-label-pill"><span className="edge-label-text">{edge.label}</span></div> : null
      ) : hasLabel ? (
        <div className="edge-label-pill">
          <button type="button" className={`edge-style-button ${edgeStyle}`} aria-label="Cycle edge style" title="Cycle edge style" onClick={onCycle}><Icon name={edgeStyle === "flowing" ? "route" : edgeStyle === "broken" ? "x" : "minus"} /><span>{styleLabel}</span></button>
          <span className="edge-label-text">{edge.label}</span>
          <button type="button" className="edge-delete-button" aria-label="Delete edge" title="Delete edge" onClick={onDelete}><Icon name="trash" /></button>
        </div>
      ) : (
        <div className="edge-label-toolbar">
          <button type="button" className={`edge-style-button ${edgeStyle}`} aria-label="Cycle edge style" title="Cycle edge style" onClick={onCycle}><Icon name={edgeStyle === "flowing" ? "route" : edgeStyle === "broken" ? "x" : "minus"} /><span>{styleLabel}</span></button>
          <button type="button" className="edge-delete-button" aria-label="Delete edge" title="Delete edge" onClick={onDelete}><Icon name="trash" /></button>
        </div>
      )}
    </div>
  )
}

function ConnectionPreview({ source, target }: { source: Point; target: Point }) {
  const rope = ropePath(source, target)
  return (
    <g className="connection-preview" data-diagram-connection-preview="true">
      <path className="connection-preview-base" vectorEffect="non-scaling-stroke" markerEnd="url(#arrow-active)" d={rope.d} />
      <path className="connection-preview-flow" vectorEffect="non-scaling-stroke" markerEnd="url(#arrow-active)" d={rope.d} />
    </g>
  )
}

/**
 * The node view for an integration: what came in, what this node is set to, and
 * what it produced.
 *
 * n8n's shape, and the reason for it: configuring a step that transforms data
 * is impossible to do blind. The middle pane is the same `ConfigEditor` the
 * small panel uses — the panes around it are what is new, not the fields.
 *
 * Both sides are filled by a dry run, which walks the flow against a finished
 * call with the write to the call and the outgoing request withheld. Testing a
 * flow must not POST a lead into somebody's CRM.
 */
function NodeDetailView({
  draft,
  node,
  onCancel,
  onChange,
  onSave,
  dryRun,
  onRun,
  sampleCall,
}: {
  draft: InspectorDraft
  node: DiagramNode
  onCancel: () => void
  onChange: (draft: InspectorDraft) => void
  onSave: (event: React.FormEvent) => void
  dryRun: { steps: DryRunStep[] | null; running: boolean; problem: string | null }
  onRun: () => void
  sampleCall?: SampleCall
}) {
  const meta = NODE_TYPES[node.type]
  const target = useRef<((path: string) => void) | null>(null)

  // A trigger has no Input pane, because nothing precedes it. Two panes rather
  // than three with one of them permanently empty — an empty pane reads as
  // something that failed to load.
  const isTrigger = node.type.startsWith("trigger.")

  const { steps, running, problem } = dryRun
  const mine = steps?.find((step) => step.node_id === node.id)
  const index = mine && steps ? steps.indexOf(mine) : -1
  const before = index > 0 ? steps![index - 1] : undefined

  // Populated the moment the view opens, not on a button. Held on the board, so
  // opening a second node reuses the same walk rather than reading the
  // transcript with a model all over again.
  useEffect(() => {
    if (!steps && !running && !problem) onRun()
  }, [steps, running, problem, onRun])

  const insert = (path: string) => target.current?.(path)

  const view = (
    <InsertTarget.Provider value={target}>
      <dialog open className="ndv" onPointerDown={(event) => event.stopPropagation()}>
        {/* The node's own colour, set once on the frame: the header tints with
            it and the whole dialog carries it down its left edge, so a Set
            node's dialog does not look like a webhook's. */}
        <div
          className="ndv-frame"
          style={{ "--node-color": meta.stroke, "--node-bg": meta.color } as React.CSSProperties}
        >
          <header className="ndv-header">
            <div className="ndv-node-icon">
              <NodeIcon icon={meta.icon} />
            </div>
            <div className="ndv-titles">
              <div className="ndv-title-row">
                <input
                  className="ndv-name"
                  value={draft.name}
                  maxLength={50}
                  aria-label="Node name"
                  onChange={(event) => onChange({ ...draft, name: event.target.value })}
                />
                {/* The kind of node — and only when that adds something. A node
                    left with its type's default name showed "Process call" as
                    the name and "PROCESS CALL" beside it, which is the same
                    word twice. */}
                {meta.label.toLowerCase() === draft.name.trim().toLowerCase() ? null : (
                  <span className="ndv-type">{meta.label}</span>
                )}
              </div>
              {/* Borderless until touched, so the header reads as a title and
                  not as a form. It was a field in Parameters, competing for the
                  width the node's actual settings need. */}
              <input
                className="ndv-description"
                value={draft.description}
                maxLength={250}
                placeholder="Add a note about this step"
                aria-label="Description"
                onChange={(event) => onChange({ ...draft, description: event.target.value })}
              />
            </div>
            <button type="button" className="ndv-close" aria-label="Close" onClick={onCancel}><Icon name="x" /></button>
          </header>

          <form className="ndv-body" data-panes={isTrigger ? "2" : "3"} onSubmit={onSave}>
            {isTrigger ? null : (
              <section className="ndv-pane ndv-input">
                <div className="ndv-pane-head">
                  <b>Input</b>
                  {before ? <span>{before.name}</span> : null}
                </div>
                <div className="ndv-pane-body">
                  <DataBrowser
                    running={running}
                    value={before ? before.output : mine?.input}
                    onPick={insert}
                    root="$json"
                    from={before?.name}
                    waiting={
                      sampleCall?.label
                        ? `Reading the call from ${sampleCall.label}…`
                        : "No finished call to test against yet."
                    }
                  />
                  {/* Always in scope, whatever ran before — so it is offered
                      whether or not the walk reached this node. */}
                  <DataBrowser
                    running={false}
                    value={sampleCall?.call}
                    onPick={insert}
                    root="$call"
                    from="The call"
                    open={false}
                    waiting="Nothing known about the call yet."
                  />
                </div>
              </section>
            )}

            <section className="ndv-pane ndv-params">
              <div className="ndv-pane-head"><b>Parameters</b></div>
              <div className="ndv-params-body">
                <ConfigEditor draft={draft} onChange={onChange} />
              </div>
            </section>

            <section className="ndv-pane ndv-output">
              <div className="ndv-pane-head">
                <b>Output</b>
                <button type="button" className="ndv-test" onClick={onRun} disabled={running}>
                  {/* A walk reads the transcript with a model and takes eight
                      seconds or more. A button that only greys out looks like a
                      button that did not take the click. */}
                  {/* `fa-spin` is Font Awesome's own, and since v6 every one of
                      its animations honours `prefers-reduced-motion` — which is
                      what the hand-written keyframes here were reimplementing,
                      media query and all. */}
                  {running ? <Icon name="spinner" className="fa-spin" /> : null}
                  {running ? "Running" : steps ? "Run again" : "Test step"}
                </button>
              </div>
              <div className="ndv-pane-body">
                {problem ? <p className="ndv-problem">{problem}</p> : null}
                {running ? (
                  <p className="ndv-hint">Walking the flow. Nothing is sent — a test never leaves the machine.</p>
                ) : mine ? (
                  <>
                    <div className="ndv-result">
                      <span className={mine.outcome === "ok" ? "ok" : "not-ok"}>{mine.outcome}</span>
                      <span>{mine.ms} ms</span>
                    </div>
                    <JsonTree value={mine.output} empty="This node produced nothing." />
                  </>
                ) : steps ? (
                  // The walk ran and never arrived here — a branch above went
                  // the other way. Saying so is more use than an empty pane.
                  <p className="ndv-hint">The flow did not reach this node.</p>
                ) : (
                  <p className="ndv-hint">Nothing has run yet.</p>
                )}
              </div>
            </section>
          </form>

          <footer className="ndv-footer">
            <button type="button" onClick={onCancel}>Cancel</button>
            <button type="button" className="primary" onClick={(event) => onSave(event)}>Done</button>
          </footer>
        </div>
      </dialog>
    </InsertTarget.Provider>
  )

  // Through a portal to `document.body`, not into the board.
  //
  // The board is pannable and zoomable, so `.board-world` carries a
  // `transform` — and a transformed ancestor becomes the containing block for
  // `position: fixed`. Rendered inside it the dialog looked centred while its
  // hit area was somewhere else, so every click fell through to the board and
  // closed the panel being clicked.
  return typeof document === "undefined" ? view : createPortal(view, document.body)
}

/** What a dragged value carries, and how a field recognises one. */
const DRAG_TYPE = "application/x-vokoo-path"

function beginDrag(event: React.DragEvent, path: string) {
  event.dataTransfer.setData(DRAG_TYPE, path)
  // `text/plain` as well, so dropping into something that is not a parameter
  // still produces the expression rather than nothing.
  event.dataTransfer.setData("text/plain", `{{ ${path} }}`)
  event.dataTransfer.effectAllowed = "copy"
  // A field cannot know a drag is happening from its own props, and every
  // field that could accept one should say so while it is in flight.
  document.body.dataset.draggingValue = "true"
}

function endDrag() {
  delete document.body.dataset.draggingValue
}

/** The path a drop is carrying, if it is carrying one. */
function droppedPath(event: React.DragEvent): string | null {
  const path = event.dataTransfer.getData(DRAG_TYPE)
  return path || null
}

/**
 * The data on the left, and the only place a value comes from.
 *
 * Clicking a row puts `{{ $json.name }}` into whichever parameter last had
 * focus. That is n8n's arrangement, and the reason it needs no picker under the
 * field: there is one list of what exists, and it is the same list you read to
 * understand what arrived.
 */
function DataBrowser({
  value,
  onPick,
  root,
  from,
  running,
  waiting,
  open,
}: {
  value: unknown
  onPick: (path: string) => void
  root: string
  /** Which node produced this. n8n names the node on the data itself. */
  from?: string
  running: boolean
  waiting: string
  open?: boolean
}) {
  // Collapsible, because `$call` alone is ten rows and pushes the previous
  // step's output — the thing actually being wired — off the top of the pane.
  const [expanded, setExpanded] = useState(open !== false)

  const entries =
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>)
      : []

  if (running || entries.length === 0) return <p className="ndv-hint">{waiting}</p>

  return (
    <div className="ndv-browser">
      <div className="ndv-browser-head">
        <button
          type="button"
          className="ndv-browser-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((held) => !held)}
        >
          <span className="ndv-caret" aria-hidden><Icon name={expanded ? "chevronDown" : "chevronRight"} /></span>
          {/* The node's name first, the root second: "Set lead" is what you
              look for, `$json` is how you write it. */}
          {from ? <b>{from}</b> : null}
          <code>{root}</code>
        </button>
        {/* The root, taken whole. "Send everything the previous step produced"
            is the common case — it is what a Set node is for — and a list of
            only the leaves made it look impossible. */}
        <button
          type="button"
          className="ndv-browser-root"
          title={`Drag into a field, or click to insert {{ ${root} }}`}
          draggable
          onDragStart={(event) => beginDrag(event, root)}
          onDragEnd={endDrag}
          onClick={() => onPick(root)}
        >
          all {entries.length}
        </button>
      </div>

      {expanded ? (
        <dl>
          {entries.map(([name, held]) => (
            <div key={name}>
              <button
                type="button"
                title={`Drag into a field, or click to insert {{ ${root}.${name} }}`}
                draggable
                onDragStart={(event) => beginDrag(event, `${root}.${name}`)}
                onDragEnd={endDrag}
                // No `preventDefault` on mousedown, however tempting: it holds
                // the field's focus for a click, and it also cancels the
                // browser's native drag before it starts. Clicking still works,
                // because the target survives the blur.
                onClick={() => onPick(`${root}.${name}`)}
              >
                {name}
              </button>
              <span>{held === null || held === undefined ? "\u2014" : typeof held === "string" ? held : JSON.stringify(held)}</span>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}

/** JSON, as names and values rather than a wall of braces. */
function JsonTree({ value, empty }: { value: unknown; empty: string }) {
  if (value === null || value === undefined) return <p className="ndv-hint">{empty}</p>
  if (typeof value !== "object" || Array.isArray(value)) {
    return <pre className="ndv-json">{JSON.stringify(value, null, 2)}</pre>
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return <p className="ndv-hint">{empty}</p>
  return (
    <dl className="ndv-fields">
      {entries.map(([name, held]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{typeof held === "string" ? held : JSON.stringify(held)}</dd>
        </div>
      ))}
    </dl>
  )
}

function NodeInspector({
  draft,
  node,
  placement,
  linkedRepoUrl,
  linkedRepoFullName,
  creatingRepo,
  onCreateRepo,
  scaffolding,
  codingRun,
  onScaffold,
  onOpenImplementation,
  onStopRun,
  onCancel,
  onChange,
  onSave,
  delivery,
}: {
  draft: InspectorDraft
  node: DiagramNode
  placement: ReturnType<typeof getInspectorPlacement>
  linkedRepoUrl?: string
  linkedRepoFullName?: string
  creatingRepo: boolean
  onCreateRepo: () => void
  scaffolding: boolean
  codingRun: CodingRunDescriptor | null
  onScaffold: () => void
  onOpenImplementation: () => void
  onStopRun: () => void
  onCancel: () => void
  onChange: (draft: InspectorDraft) => void
  onSave: (event?: React.FormEvent) => void
  delivery: { viewerRole: string | null; runs: import("@/app/d/agent-actions").ComponentDeliveryRun[] } | null
}) {
  const meta = NODE_TYPES[node.type]
  const dirty = JSON.stringify(draft) !== JSON.stringify(createInspectorDraft(node))
  const bodyMaxHeight = Math.max(120, placement.maxHeight - 230)
  return (
    <dialog
      open
      className="inspector-node-dialog"
      data-inspector-side={placement.side}
      data-inspector-anchor={placement.anchor}
      style={
        {
          left: placement.left,
          top: placement.anchor === "top" ? placement.top : undefined,
          bottom: placement.anchor === "bottom" ? placement.bottom : undefined,
          "--inspector-connector-y": `${placement.connectorY}px`,
          "--inspector-connector-bottom": `${placement.connectorBottom}px`,
        } as React.CSSProperties
      }
    >
      <div aria-hidden="true" className="inspector-node-caret" />
      <aside
        className="inspector-node-panel"
        style={{
          width: placement.width,
          maxHeight: placement.maxHeight,
          "--inspector-panel-height": `${placement.maxHeight}px`,
          "--inspector-body-height": `${bodyMaxHeight}px`,
          "--inspector-connector-y": `${placement.connectorY}px`,
        } as React.CSSProperties}
      >
        <button type="button" className="inspector-close" aria-label="Close inspector" onClick={onCancel}><Icon name="x" /></button>
        <form className="inspector-form" onSubmit={onSave}>
          <div className="inspector-static">
            <header className="inspector-header">
              <div className="inspector-node-icon" style={{ "--node-color": meta.stroke, "--node-bg": meta.color } as React.CSSProperties}><NodeIcon icon={meta.icon} /></div>
              <div>
                <div className="inspector-eyebrow">Inspector</div>
                <div className="inspector-title-row">
                  <h2>{draft.name || "Untitled"}</h2>
                  {codingRun?.label ? (
                    codingRun.prUrl ? (
                      <a
                        className={`inspector-coding-status ${codingRun.state}`}
                        href={codingRun.prUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={codingRun.error ?? undefined}
                      >
                        {codingRun.label} ↗
                      </a>
                    ) : (
                      <span className={`inspector-coding-status ${codingRun.state}`} title={codingRun.error ?? undefined}>
                        {codingRun.label}
                      </span>
                    )
                  ) : null}
                </div>
              </div>
            </header>
            <div className="inspector-grid">
              <label className="inspector-field">
                <span><b>Name</b><output>{draft.name.length}/50</output></span>
                <input value={draft.name} maxLength={50} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
              </label>
              <label className="inspector-field">
                <span><b>Description</b><output>{draft.description.length}/250</output></span>
                <input value={draft.description} maxLength={250} onChange={(event) => onChange({ ...draft, description: event.target.value })} />
              </label>
            </div>
          </div>
          {delivery?.viewerRole === "Project Manager" ? (
            <DeliveryCard runs={delivery.runs} />
          ) : (
            <ConfigEditor draft={draft} onChange={onChange} />
          )}
          <footer className="inspector-footer">
            <button type="button" className="inspector-cancel" onClick={onCancel}>Cancel</button>
            <button type="submit" className="inspector-done" disabled={!dirty}>Done</button>
          </footer>
        </form>
      </aside>
    </dialog>
  )
}

// The component's run actions (Create repo / View repo / Build implementation)
// folded into one footer menu so the inspector footer stays Cancel/Done.
function InspectorActionsMenu({
  linkedRepoUrl,
  linkedRepoFullName,
  creatingRepo,
  onCreateRepo,
  scaffolding,
  codingRun,
  onScaffold,
  onOpenImplementation,
  onStopRun,
}: {
  linkedRepoUrl?: string
  linkedRepoFullName?: string
  creatingRepo: boolean
  onCreateRepo: () => void
  scaffolding: boolean
  codingRun: CodingRunDescriptor | null
  onScaffold: () => void
  onOpenImplementation: () => void
  onStopRun: () => void
}) {
  const [open, setOpen] = useState(false)
  const runActive = Boolean(codingRun?.active)
  const activeRunId = codingRun?.runId
  return (
    <div className="inspector-actions">
      <button
        type="button"
        className="inspector-cancel inspector-repo-action inspector-actions-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Actions <Icon name="chevronUp" />
      </button>
      {open ? (
        <>
          <div className="inspector-actions-backdrop" onClick={() => setOpen(false)} />
          <div className="inspector-actions-menu" role="menu">
            {linkedRepoUrl ? (
              <>
                <a role="menuitem" href={linkedRepoUrl} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
                  <Icon name="github" />
                  <span>
                    <b>View repo</b>
                    {linkedRepoFullName ? <small>{linkedRepoFullName}</small> : null}
                  </span>
                </a>
                {runActive || codingRun?.state === "succeeded" ? (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { setOpen(false); onOpenImplementation() }}
                    >
                      <Icon name="bolt" />
                      <span>
                        <b>Open implementation</b>
                        <small>
                          {codingRun?.state === "succeeded"
                            ? "PR opened — reopen the workspace and continue with the agent"
                            : codingRun?.agentState === "working" ? "Agent working — open the live run" : "A run is in progress — open it"}
                        </small>
                      </span>
                    </button>
                    {activeRunId ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOpen(false)
                          const to = buildDesktopAttachUrl({ stackplaneUrl: window.location.origin, runId: activeRunId })
                          window.open(`/fleet/authorize/opening?to=${encodeURIComponent(to)}`, "_blank", "noopener,noreferrer")
                        }}
                      >
                        <Icon name="download" />
                        <span>
                          <b>Open in desktop editor</b>
                          <small>Attach the local Stackplane editor to this run — no secret in the link</small>
                        </span>
                      </button>
                    ) : null}
                    {runActive ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { setOpen(false); onStopRun() }}
                      >
                        <Icon name="stop" />
                        <span>
                          <b>Stop run</b>
                          <small>Breakglass — halt the agent; Continue resumes from the last pushed commit</small>
                        </span>
                      </button>
                    ) : null}
                  </>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={scaffolding}
                    onClick={() => { setOpen(false); onScaffold() }}
                  >
                    <Icon name="bolt" />
                    <span>
                      <b>{scaffolding ? "Starting..." : codingRun?.state === "failed" ? "Continue implementation" : "Build implementation"}</b>
                      <small>{codingRun?.state === "failed" ? "Resume from the salvaged branch and finish" : "Write code for this component and open a PR"}</small>
                    </span>
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                role="menuitem"
                disabled={creatingRepo}
                onClick={() => { setOpen(false); onCreateRepo() }}
              >
                <Icon name="github" />
                <span>
                  <b>{creatingRepo ? "Creating…" : "Create repo"}</b>
                  <small>Create a GitHub repo for this component</small>
                </span>
              </button>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}

// E16: the PM's view of a component — delivery status and the true cost of
// each change (agent runtime, human attention, interventions, tokens). The
// unit of account is the change, never the person.
function DeliveryCard({ runs }: { runs: import("@/app/d/agent-actions").ComponentDeliveryRun[] }) {
  if (!runs.length) {
    return (
      <div className="inspector-scroll">
        <section className="inspector-config-section">
          <h3>Delivery</h3>
          <p className="delivery-empty">No implementation runs yet for this component.</p>
        </section>
      </div>
    )
  }
  return (
    <div className="inspector-scroll">
      <section className="inspector-config-section">
        <h3>Delivery</h3>
        <div className="delivery-runs">
          {runs.map((run) => (
            <article className="delivery-run" key={run.id} data-status={run.status}>
              <header>
                <span className={`inspector-coding-status ${run.status === "succeeded" ? "succeeded" : run.status === "failed" ? "failed" : "running"}`}>
                  {run.status}
                </span>
                <time>{new Date(run.queuedAt).toLocaleString()}</time>
                {run.prUrl ? (
                  <a href={run.prUrl} target="_blank" rel="noreferrer">PR ↗</a>
                ) : null}
              </header>
              <dl>
                <div><dt>Agent</dt><dd>{run.agentMinutes} min</dd></div>
                <div><dt>Human</dt><dd>{run.humanMinutes} min</dd></div>
                <div><dt>Steering</dt><dd>{run.interventions}</dd></div>
                <div><dt>Tokens</dt><dd>{(run.inputTokens + run.outputTokens).toLocaleString()}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function ConfigEditor({ draft, onChange }: { draft: InspectorDraft; onChange: (draft: InspectorDraft) => void }) {
  const schema = CONFIG_SCHEMAS[draft.type as keyof typeof CONFIG_SCHEMAS]
  if (!schema) return null
  // A trigger takes no settings. A heading over nothing reads as a section that
  // failed to load rather than one that has nothing in it.
  if (schema.fields.length === 0) {
    return <p className="config-help">This step has nothing to configure. It starts the flow and passes the call on.</p>
  }
  const values = draft.config[draft.type] ?? {}
  function setValue(field: string, value: unknown) {
    onChange({
      ...draft,
      config: {
        ...draft.config,
        [draft.type]: {
          ...values,
          [field]: value,
        },
      },
    })
  }
  return (
    <div className="inspector-scroll">
      <section className="inspector-config-section">
        {/* No heading. It was `${label} details` — a third or fourth printing of
            the node's own type, directly under the name and the type badge that
            already say it. */}
        <div className="inspector-config-grid">
          {schema.fields.map((field) => (
            <ConfigFieldEditor
              field={field}
              key={field.field}
              nodeType={draft.type}
              siblings={values}
              value={values[field.field]}
              onChange={(value) => setValue(field.field, value)}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

/**
 * Whether this field can hold an expression instead of a literal.
 *
 * Most can. The exceptions are the fields whose value must be a real row for
 * something else to work: an agent id, a schema id, an engine's provider or
 * model are read by pre-flight and by the palette, and an expression there
 * would be a reference that cannot be checked until a call reaches it. Branches
 * are the node's ports, drawn on the canvas — not a value at all.
 */
function expressionCapable(field: ConfigField, board: BoardContext): boolean {
  // First the board, then the field. A board whose runner resolves nothing must
  // not offer an expression on any field, however ordinary the field looks.
  if (!boardTakesExpressions(board)) return false
  // Not a value at all: a list of rows, each of which carries its own switch.
  if (field.valueType === "branches" || field.valueType === "assignments") return false
  if (field.valueType === "agent" || field.valueType === "structured_output") return false
  return !field.valueType?.startsWith("engine_")
}

/**
 * A field, in whichever of its two modes it is in.
 *
 * n8n puts a fixed|expression switch on every parameter, and that switch is the
 * whole of the encoding: an expression is a value beginning with `=`. Flipping
 * to expression prepends it, flipping back strips it — so a field that was
 * never touched is a literal by construction, and no config written before
 * expressions existed changes meaning.
 */
function ConfigFieldEditor(props: {
  field: ConfigField
  value: unknown
  onChange: (value: unknown) => void
  nodeType?: string
  siblings?: Record<string, unknown>
}) {
  const { field, value, onChange } = props
  const { board } = useContext(ReferenceData)
  const raw = typeof value === "string" ? value : ""
  const isExpression = raw.startsWith("=")

  // An `=` already stored is still shown as an expression even where the board
  // no longer offers them: hiding it would present a value as a literal that
  // the runner will not read as one.
  if (!expressionCapable(field, board) && !isExpression) return <ConfigFieldControl {...props} />

  // A value dropped on a field that is still Fixed switches it to Expression
  // and keeps what was typed. Requiring the switch first would make the drop
  // fail for the reason least likely to be guessed.
  const accept = (event: React.DragEvent) => {
    const path = droppedPath(event)
    if (!path) return
    event.preventDefault()
    event.stopPropagation()
    endDrag()
    const carried = isExpression ? raw.slice(1) : typeof value === "string" || typeof value === "number" ? String(value) : ""
    onChange(`=${carried}{{ ${path} }}`)
  }

  return (
    <div
      className="config-field"
      onDragOver={(event) => {
        if (!droppedPath(event) && !event.dataTransfer.types.includes(DRAG_TYPE)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = "copy"
      }}
      onDrop={accept}
    >
      <div className="config-field-mode">
        <button
          type="button"
          className={isExpression ? "" : "selected"}
          onClick={() => onChange(isExpression ? raw.slice(1) : value)}
        >
          Fixed
        </button>
        <button
          type="button"
          className={isExpression ? "selected" : ""}
          onClick={() => {
            if (isExpression) return
            // What was typed becomes the start of the expression rather than
            // being thrown away: somebody who wrote a URL and then wants a path
            // segment in it should not have to retype the URL.
            const carried = typeof value === "string" || typeof value === "number" ? String(value) : ""
            onChange(`=${carried}`)
          }}
        >
          Expression
        </button>
      </div>
      {isExpression ? (
        <ExpressionInput field={field} value={raw} onChange={onChange} />
      ) : (
        <ConfigFieldControl {...props} />
      )}
    </div>
  )
}

function ConfigFieldControl({
  field,
  value,
  onChange,
  nodeType,
  siblings = {},
}: {
  field: ConfigField
  value: unknown
  onChange: (value: unknown) => void
  nodeType?: string
  /** The other values on this node, so one field can scope another's list. */
  siblings?: Record<string, unknown>
}) {
  // Engine steps choose from a catalogue rather than typing a name. Handled
  // before the control switch because the control is "text" for all three —
  // what makes them a list is the value type, not the widget.
  if (field.valueType?.startsWith("engine_")) {
    return <EngineSelect field={field} value={value} onChange={onChange} nodeType={nodeType} siblings={siblings} />
  }

  if (field.control === "boolean") {
    return (
      <fieldset className="config-group">
        <legend>{field.label}{field.required ? " *" : ""}</legend>
        <div className="config-options">
          <button type="button" className={value === true ? "selected" : ""} onClick={() => onChange(true)}>{getBooleanLabel(field, "checked")}</button>
          <button type="button" className={value === false ? "selected" : ""} onClick={() => onChange(false)}>{getBooleanLabel(field, "unchecked")}</button>
        </div>
      </fieldset>
    )
  }
  // A node that names an agent should offer the agents, not a box to paste a
  // UUID into. Getting that wrong is invisible until a call reaches the node.
  if (field.valueType === "agent") {
    return <ReferenceSelect field={field} value={value} onChange={onChange} kind="agent" />
  }

  // The shape an intelligence node fills in. Same reasoning as the agent
  // above: a UUID typed into a box is wrong in a way nothing notices until a
  // call has already ended and the reading failed.
  if (field.valueType === "structured_output") {
    return <ReferenceSelect field={field} value={value} onChange={onChange} kind="shape" />
  }

  // The field that decides how many paths leave the node.
  if (field.valueType === "branches") {
    return <BranchListEditor field={field} value={value} onChange={onChange} />
  }

  // The rows a Set node holds. Like branches, how many there are is the
  // author's decision, so the catalogue cannot name them.
  if (field.valueType === "assignments") {
    return <AssignmentListEditor field={field} value={value} onChange={onChange} />
  }

  // A fixed set of answers, named by the catalogue. A text box here is a place
  // to make a typo that nothing catches: an HTTP method of "post " or "GET"
  // both reach `webhook.rs`, which matches PUT and PATCH and falls through to
  // POST — so the flow says one thing and the request does another.
  if (field.valueType === "select") {
    return <OptionSelect field={field} value={value} onChange={onChange} />
  }

  // Which connected provider's key to send. Never a key typed into a flow —
  // the value is a vendor id and the bridge resolves it from the vault per
  // call, so what belongs in this box is a name from a list.
  if (field.valueType === "vendor") {
    return <VendorSelect field={field} value={value} onChange={onChange} />
  }

  const multiline = field.valueType === "textarea"
  // Shown under the field, or in it, never both — which is what happened when
  // the placeholder fell back to `help` and `help` was also printed below.
  const described = Boolean(field.help)
  const placeholder = field.hint ?? (described ? undefined : field.help)

  return (
    <label className="config-input">
      <span>{field.label}{field.required ? " *" : ""}</span>
      {multiline ? (
        <textarea
          rows={4}
          placeholder={placeholder}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          type={field.control === "number" ? "number" : field.valueType === "time" ? "time" : field.valueType === "phone" ? "tel" : "text"}
          placeholder={placeholder}
          value={typeof value === "string" || typeof value === "number" ? value : ""}
          onChange={(event) => onChange(field.control === "number" ? Number(event.target.value) : event.target.value)}
        />
      )}
      {/* A placeholder disappears the moment anything is typed, which is when
          a sentence explaining what to type is still worth reading. */}
      {described ? <small className="config-help">{field.help}</small> : null}
    </label>
  )
}

/**
 * An expression, and what there is to put in it.
 *
 * The panel is the point, not the box. n8n's is the reason its expressions are
 * usable at all: a field that accepts `{{ … }}` and does not say what `…` may
 * be is a field you write by reading source. Clicking a path inserts it at the
 * cursor.
 */
function ExpressionInput({
  field,
  value,
  onChange,
}: {
  field: ConfigField
  value: string
  onChange: (value: unknown) => void
}) {
  const target = useContext(InsertTarget)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const body = value.slice(1)

  // Registered on focus so the Input pane knows where a clicked value goes, and
  // deliberately *not* cleared on blur: clicking a value in the pane blurs this
  // field, and a target cleared by that blur would be gone before the click
  // landed.
  const claim = () => {
    target.current = (path: string) => {
      const element = inputRef.current
      if (!element) return
      // Read at insert time, never captured. Closing over `body` from the
      // render that registered this meant a field cleared afterwards still
      // held its old text here — so deleting a value and picking another put
      // the deleted text back, which looked like the insert duplicating.
      const current = element.value
      const segment = `{{ ${path} }}`
      const at = element.selectionStart ?? current.length
      const to = element.selectionEnd ?? at
      onChange(`=${current.slice(0, at)}${segment}${current.slice(to)}`)
      requestAnimationFrame(() => {
        element.focus()
        const caret = at + segment.length
        element.setSelectionRange(caret, caret)
      })
    }
  }

  return (
    <label className="config-input">
      <span>{field.label}{field.required ? " *" : ""}</span>
      <textarea
        ref={inputRef}
        className="config-expression"
        rows={field.valueType === "textarea" || field.valueType === "template" ? 5 : 2}
        spellCheck={false}
        placeholder="{{ $json.field }} — or click a value on the left"
        value={body}
        onFocus={claim}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = "copy"
        }}
        onDrop={(event) => {
          const path = droppedPath(event)
          if (!path) return
          // Stopped here rather than left to the wrapper: a textarea knows
          // where in the text the pointer was, and appending to the end of a
          // JSON body somebody is halfway through writing is not what they
          // meant by dropping it there.
          event.preventDefault()
          event.stopPropagation()
          endDrag()
          const element = event.currentTarget
          const at = element.selectionStart ?? body.length
          const to = element.selectionEnd ?? at
          onChange(`=${body.slice(0, at)}{{ ${path} }}${body.slice(to)}`)
        }}
        onChange={(event) => { claim(); onChange(`=${event.target.value}`) }}
      />
      {field.help ? <small className="config-help">{field.help}</small> : null}
    </label>
  )
}

/** A field whose answers the catalogue names. */
function OptionSelect({
  field,
  value,
  onChange,
}: {
  field: ConfigField
  value: unknown
  onChange: (value: unknown) => void
}) {
  const options = field.options ?? []
  const current = typeof value === "string" ? value : ""
  const fallback = typeof field.default === "string" ? field.default : ""
  const unknown = current && !options.some((option) => option.id === current)
  // A default that is itself one of the answers needs no row of its own: the
  // list offered "POST (default)" and "POST", which is the same answer twice
  // and leaves the reader deciding whether they differ.
  const needsEmpty = !field.required && !options.some((option) => option.id === fallback)

  return (
    <label className="config-input">
      <span>{field.label}{field.required ? " *" : ""}</span>
      <select value={current || fallback} onChange={(event) => onChange(event.target.value)}>
        {needsEmpty ? <option value="">Not set</option> : null}
        {options.map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
        {/* Kept visible rather than silently reset: a value the catalogue no
            longer offers is something the author chose, and swapping it for a
            default would change what the flow does without saying so. */}
        {unknown ? <option value={current}>{current} (no longer offered)</option> : null}
      </select>
      {field.help ? <small className="config-help">{field.help}</small> : null}
    </label>
  )
}

/** One of the organisation's connected providers, by id. */
function VendorSelect({
  field,
  value,
  onChange,
}: {
  field: ConfigField
  value: unknown
  onChange: (value: unknown) => void
}) {
  const { connectedVendors } = useContext(ReferenceData)
  const current = typeof value === "string" ? value : ""
  // The id is the value the bridge looks up, so the id is what is shown. A
  // display name here would be a second vocabulary for the same thing.
  const missing = current && !connectedVendors.includes(current)

  return (
    <label className="config-input">
      <span>{field.label}{field.required ? " *" : ""}</span>
      <select value={current} onChange={(event) => onChange(event.target.value)}>
        <option value="">{connectedVendors.length === 0 ? "No providers connected" : "None — send unauthenticated"}</option>
        {connectedVendors.map((vendor) => (
          <option key={vendor} value={vendor}>{vendor}</option>
        ))}
        {/* A key that was connected when this flow was drawn and has since been
            removed. The bridge sends nothing rather than sending it
            unauthenticated, so this must not read as "None". */}
        {missing ? <option value={current}>{current} (no key connected)</option> : null}
      </select>
      {field.help ? <small className="config-help">{field.help}</small> : null}
    </label>
  )
}


/** Keys a caller may press, and what each one means. */
type Branch = { id: string; label: string }

/**
 * The branches a menu leaves by.
 *
 * Editing this field changes the node's shape: `outcomesForNode` reads it, so
 * adding a row grows the card and gives it another port to draw an edge from.
 * That is the point of it, and it is also why removing a row is destructive —
 * an edge leaving a branch that no longer exists stops resolving and is dropped
 * on the next load. The remove button says so rather than finding out later.
 */
/**
 * The rows a Set node holds: a name, and where its value comes from.
 *
 * The name is the one whatever receives this expects — a reading calls it
 * `patient_name` and a CRM calls it `contactName`, and this is where the two
 * meet. The value reuses the ordinary field editor, so it gets the same
 * Fixed | Expression switch and the same picker as every other field rather
 * than a second, lesser version of both.
 */
function AssignmentListEditor({
  field,
  value,
  onChange,
}: {
  field: ConfigField
  value: unknown
  onChange: (value: unknown) => void
}) {
  const rows: { name: string; value: unknown }[] = Array.isArray(value)
    ? value.flatMap((row) => {
        if (!row || typeof row !== "object") return []
        const { name, value: held } = row as { name?: unknown; value?: unknown }
        return [{ name: typeof name === "string" ? name : "", value: held }]
      })
    : []

  const write = (next: { name: string; value: unknown }[]) => onChange(next)

  return (
    <fieldset className="config-group">
      <legend>{field.label}{field.required ? " *" : ""}</legend>
      {field.help ? <p className="config-help">{field.help}</p> : null}

      <div className="assignment-rows">
        {rows.map((row, index) => {
          // Two rows with one name would mean the later silently wins, and the
          // author would be looking at a payload missing a field they can see
          // on screen.
          const duplicate = rows.some((other, otherIndex) => otherIndex < index && other.name === row.name && row.name !== "")
          return (
            <div key={index} className={duplicate ? "assignment-row duplicate" : "assignment-row"}>
              <div className="assignment-head">
                <input
                  aria-label="Name"
                  placeholder="name"
                  value={row.name}
                  onChange={(event) =>
                    write(rows.map((held, heldIndex) => (heldIndex === index ? { ...held, name: event.target.value } : held)))
                  }
                />
                <button
                  type="button"
                  aria-label={`Remove ${row.name || "row"}`}
                  onClick={() => write(rows.filter((_, heldIndex) => heldIndex !== index))}
                >
                  Remove
                </button>
              </div>
              <ConfigFieldEditor
                field={{ field: `value-${index}`, control: "text", valueType: "text", label: "Value", required: false }}
                value={row.value}
                onChange={(next) =>
                  write(rows.map((held, heldIndex) => (heldIndex === index ? { ...held, value: next } : held)))
                }
              />
              {duplicate ? <small className="config-help">Another row already sets this name.</small> : null}
            </div>
          )
        })}
      </div>

      <button type="button" className="config-add-row" onClick={() => write([...rows, { name: "", value: "" }])}>
        Add value
      </button>
    </fieldset>
  )
}

function BranchListEditor({
  field,
  value,
  onChange,
}: {
  field: ConfigField
  value: unknown
  onChange: (value: unknown) => void
}) {
  const branches: Branch[] = Array.isArray(value)
    ? value.flatMap((row) => {
        if (!row || typeof row !== "object") return []
        const { id, label } = row as { id?: unknown; label?: unknown }
        return [{ id: typeof id === "string" ? id : "", label: typeof label === "string" ? label : "" }]
      })
    : []

  const write = (next: Branch[]) => onChange(next)

  // The keypad has twelve keys and no more, so the choice is a fixed list
  // rather than a text box that accepts "A" and fails on a live call.
  const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "*", "#"]
  const taken = new Set(branches.map((branch) => branch.id))
  const nextFree = KEYS.find((key) => !taken.has(key))

  return (
    <fieldset className="config-group">
      <legend>{field.label}{field.required ? " *" : ""}</legend>
      {field.help ? <p className="config-help">{field.help}</p> : null}

      <div className="branch-rows">
        {branches.map((branch, index) => {
          // Two rows on the same key would give two ports one address, and an
          // edge from either would be indistinguishable from the other.
          const duplicate = branches.some((other, otherIndex) => otherIndex < index && other.id === branch.id)
          return (
            <div key={index} className={duplicate ? "branch-row duplicate" : "branch-row"}>
              <select
                aria-label="Key"
                value={branch.id}
                onChange={(event) => write(branches.map((row, rowIndex) =>
                  rowIndex === index ? { ...row, id: event.target.value } : row))}
              >
                {/* A key already used elsewhere stays listed but unselectable,
                    so the row shows why it cannot be chosen. */}
                {KEYS.map((key) => (
                  <option key={key} value={key} disabled={key !== branch.id && taken.has(key)}>{key}</option>
                ))}
              </select>
              <input
                type="text"
                aria-label="What this key means"
                placeholder="What this key means"
                value={branch.label}
                onChange={(event) => write(branches.map((row, rowIndex) =>
                  rowIndex === index ? { ...row, label: event.target.value } : row))}
              />
              <button
                type="button"
                title="Remove this key. Any path leaving it is removed with it."
                onClick={() => write(branches.filter((_, rowIndex) => rowIndex !== index))}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </div>
          )
        })}
      </div>

      <button
        type="button"
        className="branch-add"
        disabled={!nextFree}
        onClick={() => nextFree && write([...branches, { id: nextFree, label: "" }])}
      >
        {nextFree ? "Add a key" : "Every key is used"}
      </button>
    </fieldset>
  )
}

/**
 * A field an engine step chooses from the catalogue.
 *
 * Three kinds, and the last two depend on the first: which models and voices
 * exist is a property of the provider, so choosing a provider is what fills
 * them. A step whose provider offers no models hides the field rather than
 * showing an empty disabled box, because a transcriber that takes a language
 * has no model to choose and an empty select reads as a failed load.
 */
function EngineSelect({
  field,
  value,
  onChange,
  nodeType,
  siblings,
}: {
  field: ConfigField
  value: unknown
  onChange: (value: unknown) => void
  nodeType?: string
  siblings: Record<string, unknown>
}) {
  const { engineOptions, connectedVendors } = useContext(ReferenceData)
  const current = typeof value === "string" ? value : ""
  const forStage = engineOptions.filter((option) => option.stage === nodeType)
  const provider = forStage.find((option) => option.id === siblings.provider)

  const choices: { id: string; label: string; note?: string }[] =
    field.valueType === "engine_provider"
      ? forStage.map((option) => ({
          id: option.id,
          label: option.label,
          // The two things that decide whether this step will work at all,
          // said in the list rather than after the call fails.
          // Only what stops this step working. The tagline was here too and
          // overflowed the trigger, hiding the provider's own name behind a
          // description of it.
          //
          // Tool support is not among these: a provider that cannot call tools
          // is withdrawn from the catalogue rather than offered with a warning,
          // so nothing reaching this list can lack it.
          note: option.vendorId && !connectedVendors.includes(option.vendorId) ? "no key" : "",
        }))
      : field.valueType === "engine_model"
        ? (provider?.models ?? []).map((model) => ({ id: model.id, label: model.label }))
        : (provider?.voices ?? []).map((voice) => ({ id: voice.id, label: voice.label }))

  // Nothing to choose and nothing chosen: the step does not take this field.
  if (choices.length === 0 && !current) return null

  const missing = current && !choices.some((choice) => choice.id === current)

  return (
    <label className="config-input">
      <span>{field.label}{field.required ? " *" : ""}</span>
      <select value={current} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose</option>
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.note ? `${choice.label} — ${choice.note}` : choice.label}
          </option>
        ))}
        {/* A value pointing at something gone must stay visible: silently
            showing "Choose" would look like nothing was ever set. */}
        {missing ? <option value={current}>{current} (not available)</option> : null}
      </select>
    </label>
  )
}

function ReferenceSelect({
  field,
  value,
  onChange,
  kind,
}: {
  field: ConfigField
  value: unknown
  onChange: (value: unknown) => void
  /** Which list to offer. Both are rows chosen by name, not ids to paste. */
  kind: "agent" | "shape"
}) {
  const { agents, shapes } = useContext(ReferenceData)
  const options = kind === "agent" ? agents : shapes
  const noun = kind === "agent" ? "agent" : "shape"
  const current = typeof value === "string" ? value : ""
  // A value pointing at something that is gone must stay visible: silently
  // showing "Choose" would look like nothing was ever set.
  const missing = current && !options.some((option) => option.id === current)

  return (
    <label className="config-input">
      <span>{field.label}{field.required ? " *" : ""}</span>
      <select value={current} onChange={(event) => onChange(event.target.value)}>
        <option value="">{options.length === 0 ? `No ${noun}s yet` : `Choose a ${noun}`}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>{option.name}</option>
        ))}
        {missing ? <option value={current}>Unknown {noun} ({current.slice(0, 8)})</option> : null}
      </select>
    </label>
  )
}

function HintItem({ button, action }: { button: "left" | "right"; action: { label: string; opacity: number } }) {
  return (
    <span className={`hint-item ${action.label ? "" : "is-muted"}`} style={{ "--hint-opacity": action.opacity } as React.CSSProperties}>
      <span className={`mouse-icon ${button}`} aria-hidden="true"><MouseIcon button={button} /></span>
      <b>{action.label}</b>
    </span>
  )
}

function MouseIcon({ button }: { button: "left" | "right" }) {
  const fill = button === "left" ? "M6.2 7.1C7.5 5.3 9.4 4.4 12 4.4V11H3.2a8.8 8.8 0 0 1 3-3.9Z" : "M17.8 7.1C16.5 5.3 14.6 4.4 12 4.4V11h8.8a8.8 8.8 0 0 0-3-3.9Z"
  return (
    <svg viewBox="0 0 24 30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="miter">
      <path d="M12 1.5c5 0 9 4 9 9v9.5a9 9 0 0 1-18 0v-9.5c0-5 4-9 9-9Z" fill="var(--canvas)" stroke="none" />
      <g>
        <path d="M12 1.5c5 0 9 4 9 9v9.5a9 9 0 0 1-18 0v-9.5c0-5 4-9 9-9Z" />
        <path d="M12 2v9" />
        <path d="M3 11h18" />
        <path d={fill} fill="currentColor" />
      </g>
    </svg>
  )
}

type Point = { x: number; y: number }

const STARTER_ARCHITECTURES: { kind: StarterKind; label: string; description: string }[] = [
  { kind: "reception", label: "Reception flow", description: "Route by opening hours, let an agent help, then finish the call." },
  { kind: "handoff", label: "Human handoff", description: "An agent can bring a person into the live call." },
  { kind: "afterHours", label: "After-hours flow", description: "Choose an open or closed path and record why the call ended." },
  { kind: "monitoredTransfer", label: "Monitored handoff", description: "Bring in a person, then keep listening until the call ends." },
]

type StarterSeedNode = {
  name: string
  type: NodeType
  description: string
  position: Point
  config?: Record<string, unknown>
}

type StarterSeed = {
  id: string
  nodes: StarterSeedNode[]
  edges: [number, number, string, DiagramEdge["style"]?][]
}

function buildStarterGraph(kind: StarterKind): Diagram["graph"] {
  const seeds: Record<StarterKind, StarterSeed> = {
    reception: {
      id: "reception",
      nodes: [
        { name: "Are we open?", type: "business_hours", description: NODE_TYPES.business_hours.description, position: { x: -360, y: 0 } },
        { name: "Reception agent", type: "agent", description: NODE_TYPES.agent.description, position: { x: 40, y: -120 } },
        { name: "Closed", type: "kookoo.hangup", description: NODE_TYPES["kookoo.hangup"].description, position: { x: 40, y: 220 } },
        { name: "Finished", type: "kookoo.hangup", description: NODE_TYPES["kookoo.hangup"].description, position: { x: 450, y: -80 } },
      ],
      edges: [[0, 1, "open"], [0, 2, "closed"], [1, 3, "done"]],
    },
    handoff: {
      id: "handoff",
      nodes: [
        { name: "Agent", type: "agent", description: NODE_TYPES.agent.description, position: { x: -300, y: 0 } },
        { name: "Bring in a person", type: "kookoo.conference", description: NODE_TYPES["kookoo.conference"].description, position: { x: 100, y: -80 } },
        { name: "Finished", type: "kookoo.hangup", description: NODE_TYPES["kookoo.hangup"].description, position: { x: 510, y: 120 } },
      ],
      edges: [[0, 1, "wants_human", "flowing"], [1, 2, "failed"]],
    },
    afterHours: {
      id: "after-hours",
      nodes: [
        { name: "Opening hours", type: "business_hours", description: NODE_TYPES.business_hours.description, position: { x: -300, y: 0 } },
        { name: "Open path", type: "agent", description: NODE_TYPES.agent.description, position: { x: 100, y: -120 } },
        { name: "After hours", type: "kookoo.hangup", description: NODE_TYPES["kookoo.hangup"].description, position: { x: 100, y: 220 } },
      ],
      edges: [[0, 1, "open"], [0, 2, "closed"]],
    },
    monitoredTransfer: {
      id: "monitored-transfer",
      nodes: [
        { name: "Bring in a person", type: "kookoo.conference", description: NODE_TYPES["kookoo.conference"].description, position: { x: -300, y: 0 } },
        { name: "Listen in", type: "agent.monitor", description: NODE_TYPES["agent.monitor"].description, position: { x: 100, y: -80 } },
        { name: "Call ended", type: "kookoo.hangup", description: NODE_TYPES["kookoo.hangup"].description, position: { x: 500, y: -80 } },
        { name: "No answer", type: "kookoo.hangup", description: NODE_TYPES["kookoo.hangup"].description, position: { x: 100, y: 220 } },
      ],
      edges: [[0, 1, "ok", "flowing"], [0, 3, "failed"], [1, 2, "call_ended"]],
    },
  }
  return starterGraphFromSeed(seeds[kind])
}

function starterGraphFromSeed(seed: StarterSeed): Diagram["graph"] {
  const ids = seed.nodes.map((node, index) => `${seed.id}-${slug(node.name) || index}`)
  return {
    nodes: seed.nodes.map((node, index) => ({
      id: ids[index],
      type: node.type,
      name: node.name,
      description: node.description,
      position: node.position,
      ...(node.config ?? {}),
      ...(node.config ? { config: { [node.type]: structuredClone(node.config) } } : {}),
    })),
    edges: seed.edges.map(([sourceIndex, targetIndex, outcomeId, style], index) => {
      const source = seed.nodes[sourceIndex]
      // A seed holds its config flat and the node builder above nests it under
      // the type. Outcomes are read from the nested shape, so the lookup has to
      // see what the built node will have — otherwise a starter seeding a menu
      // would resolve against no branches and throw on its own edges.
      const outcome = source
        ? outcomeForNode(
            { type: source.type, config: source.config ? { [source.type]: source.config } : undefined },
            outcomeId,
          )
        : undefined
      if (!source || !outcome) throw new Error(`Starter ${seed.id} uses an unknown catalogue outcome.`)
      return {
      id: `${seed.id}-edge-${index + 1}`,
      sourceNodeId: ids[sourceIndex],
      targetNodeId: ids[targetIndex],
      sourceHandle: "right",
      targetHandle: "left",
      outcome: outcome.id,
      label: outcome.label,
      style: style ?? "muted",
      }
    }),
  }
}

function updateEdgeStyle(edgeId: string, updateActive: (mutator: (draft: Diagram) => void) => void) {
  const order: DiagramEdge["style"][] = ["muted", "flowing", "broken"]
  updateActive((draft) => {
    const edge = draft.graph.edges.find((item) => item.id === edgeId)
    if (!edge) return
    const current = order.includes(edge.style) ? edge.style : "muted"
    edge.style = order[(order.indexOf(current) + 1) % order.length]
  })
}

function agentMessageForPrompt(diagram: Diagram, prompt: string): AgentMessage {
  const lowerPrompt = prompt.toLowerCase()
  const suggestions = agentSuggestions(diagram)
  const wantsConfig = /config|configure|configuration|field|setting|setup/.test(lowerPrompt)
  const wantsNext = /missing|add|node|outcome|next/.test(lowerPrompt)
  const wantsIssueReview = /issue|problem|audit|review|check|gap/.test(lowerPrompt)
  const body = wantsConfig
    ? buildConfigurationResponse(diagram)
    : wantsNext && suggestions.length
      ? buildNextMoveResponse(diagram, suggestions)
      : wantsIssueReview
        ? buildIssueReviewResponse(diagram)
        : buildAgentResponse(diagram, prompt)
  return {
    id: uid("agent-assistant"),
    role: "assistant",
    body,
    actions: wantsConfig
      ? [{ label: "Save note", tool: "reviewNote" }]
      : wantsNext
      ? suggestions.slice(0, 3).map((suggestion) => ({ label: suggestion.action, tool: suggestion.tool }))
      : suggestions.slice(0, 2).map((suggestion) => ({ label: suggestion.action, tool: suggestion.tool })),
  }
}

function agentToolSpec(tool: AgentTool): { type: NodeType; name: string; description: string } {
  const type = tool === "reviewNote" ? "agent" : tool
  const metadata = NODE_TYPES[type]
  return { type, name: metadata.label, description: metadata.description }
}

function agentSuggestions(diagram: Diagram): AgentSuggestion[] {
  const nodes = diagram.graph.nodes
  const unconfigured = nodes.filter((node) => !isNodeConfigured(node))
  const connectedOutcomes = new Set(diagram.graph.edges.map((edge) => `${edge.sourceNodeId}:${edge.outcome}`))
  const unconnected = nodes.flatMap((node) => outcomesForNode(node)
    .filter((outcome) => !connectedOutcomes.has(`${node.id}:${outcome.id}`))
    .map((outcome) => ({ node, outcome })))
  const suggestions: AgentSuggestion[] = []

  if (nodes.length === 0) {
    suggestions.push({
      id: "start-with-agent",
      title: "Add an agent",
      reason: NODE_TYPES.agent.description,
      nodes: [],
      action: "Add agent",
      tool: "agent",
    })
  }
  if (unconnected.length) {
    const first = unconnected[0]
    suggestions.push({
      id: "unconnected-outcomes",
      title: "Connect an outcome",
      reason: `${first.node.name} has no next node for ${first.outcome.label}.`,
      nodes: [first.node.name],
      action: "Save review note",
      tool: "reviewNote",
    })
  }
  if (unconfigured.length) {
    suggestions.push({
      id: "configuration-gaps",
      title: "Resolve configuration gaps",
      reason: `${unconfigured.length} nodes still have required catalogue fields to fill.`,
      nodes: unconfigured.slice(0, 3).map((node) => node.name),
      action: "Save note",
      tool: "reviewNote",
    })
  }

  return suggestions.slice(0, 5)
}

function buildNextMoveResponse(diagram: Diagram, suggestions: AgentSuggestion[]) {
  const first = suggestions[0]
  if (!first) return `${diagram.name} has no unconfigured nodes or unconnected catalogue outcomes.`
  return [
    `The strongest next move is "${first.title}" because ${first.reason.toLowerCase()}`,
    first.nodes.length ? `Relevant nodes: ${first.nodes.join(", ")}.` : "This applies to the call flow.",
  ].join(" ")
}

function buildIssueReviewResponse(diagram: Diagram) {
  const nodes = diagram.graph.nodes
  const unconfigured = nodes.filter((node) => !isNodeConfigured(node))
  const connectedOutcomes = new Set(diagram.graph.edges.map((edge) => `${edge.sourceNodeId}:${edge.outcome}`))
  const unconnected = nodes.flatMap((node) => outcomesForNode(node).filter((outcome) => !connectedOutcomes.has(`${node.id}:${outcome.id}`)))
  const invalidEdges = diagram.graph.edges.filter((edge) => {
    const source = nodes.find((node) => node.id === edge.sourceNodeId)
    return !source || !outcomeForNode(source, edge.outcome)
  })
  const findings = [
    unconfigured.length ? `${unconfigured.length} nodes need required fields: ${unconfigured.slice(0, 4).map((node) => node.name).join(", ")}.` : "All required catalogue fields are populated.",
    unconnected.length ? `${unconnected.length} declared outcomes do not have a next node.` : "Every declared outcome has a next node.",
    invalidEdges.length ? `${invalidEdges.length} edges do not match a source outcome.` : "Every edge matches a source outcome.",
  ]
  return `Call-flow review for ${diagram.name}: ${findings.join(" ")}`
}

function buildConfigurationResponse(diagram: Diagram) {
  const target = diagram.graph.nodes.find((node) => !isNodeConfigured(node)) ?? diagram.graph.nodes[0]
  if (!target) return "There is no node on the canvas to configure yet."
  const schema = CONFIG_SCHEMAS[target.type as keyof typeof CONFIG_SCHEMAS]
  const existingValues = target.config?.[target.type] ?? {}
  const missingFields = schema.fields
    .filter((field) => {
      const value = existingValues[field.field]
      return value === undefined || value === "" || (Array.isArray(value) && value.length === 0)
    })
    .slice(0, 4)
    .map((field) => field.label)
  return [
    `Configure ${target.name} as ${NODE_TYPES[target.type].label}.`,
    missingFields.length ? `Start with ${missingFields.join(", ")}.` : "The catalogue fields are populated.",
  ].join(" ")
}

function suggestAgentAnchor(diagram: Diagram, _type: NodeType) {
  const nodes = diagram.graph.nodes
  if (!nodes.length) return null
  return rightmostNode(nodes)
}

function placeAgentNode(diagram: Diagram, anchor: DiagramNode | null, type: NodeType) {
  if (!anchor) return { x: 0, y: 0 }
  const siblings = diagram.graph.nodes.filter((node) => Math.abs(node.position.x - anchor.position.x) < 80).length
  void type
  const xOffset = 320
  const yOffset = (siblings % 3 - 1) * 150
  return { x: Math.round(anchor.position.x + xOffset), y: Math.round(anchor.position.y + yOffset) }
}


function rightmostNode(nodes: DiagramNode[]) {
  return [...nodes].sort((a, b) => b.position.x - a.position.x)[0] ?? null
}

function buildAgentResponse(diagram: Diagram, prompt: string) {
  const unconfigured = diagram.graph.nodes.filter((node) => !isNodeConfigured(node))
  void prompt
  return [
    `${diagram.name} has ${diagram.graph.nodes.length} nodes and ${diagram.graph.edges.length} outcome paths.`,
    `${unconfigured.length ? `${unconfigured.length} nodes still need required catalogue fields; start with ${unconfigured[0]?.name}.` : "All required catalogue fields are populated."}`,
  ].join(" ")
}

function edgeEndpoints(edge: DiagramEdge, source: DiagramNode, target: DiagramNode, viewMode: ViewMode) {
  const sourceSide = edge.sourceHandle || "right"
  const targetSide = edge.targetHandle || "left"
  return {
    source: edge.outcome ? outcomeHandlePoint(source, edge.outcome, viewMode) : handlePoint(source, sourceSide, viewMode),
    target: handlePoint(target, targetSide, viewMode),
    sourceSide,
    targetSide,
  }
}

function outcomeHandlePoint(node: DiagramNode, outcomeId: string, viewMode: ViewMode) {
  const size = getNodeSize(node, viewMode)
  const outcomes = outcomesForNode(node)
  const index = Math.max(0, outcomes.findIndex((outcome) => outcome.id === outcomeId))
  const outcomesTop = size.height - outcomes.length * 30 + 15
  return { x: node.position.x + size.width, y: node.position.y + outcomesTop + index * 30 }
}

function handlePoint(node: DiagramNode, side: HandleSide, viewMode: ViewMode, offset = { x: 0, y: 0 }) {
  const size = getNodeSize(node, viewMode)
  const x = node.position.x + offset.x
  const y = node.position.y + offset.y
  if (side === "top") return { x: x + size.width / 2, y }
  if (side === "bottom") return { x: x + size.width / 2, y: y + size.height }
  if (side === "left") return { x, y: y + size.height / 2 }
  return { x: x + size.width, y: y + size.height / 2 }
}

function ropePoints(source: Point, target: Point, sagScale = 1) {
  const distance = Math.hypot(target.x - source.x, target.y - source.y)
  const sag = Math.min(90, Math.max(18, distance * 0.12)) * sagScale
  return Array.from({ length: 16 }, (_, index) => {
    const progress = index / 15
    return {
      x: source.x + (target.x - source.x) * progress,
      y: source.y + (target.y - source.y) * progress + Math.sin(Math.PI * progress) * sag,
    }
  })
}

function smoothThrough(points: Point[]) {
  const first = points[0]
  if (!first) return ""
  let path = `M ${first.x} ${first.y}`
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index]
    const next = points[index + 1]
    if (current && next) path += ` Q ${current.x} ${current.y} ${(current.x + next.x) / 2} ${(current.y + next.y) / 2}`
  }
  const last = points[points.length - 1]
  if (last) path += ` T ${last.x} ${last.y}`
  return path
}

function ropePath(source: Point, target: Point, sagScale = 1) {
  const points = ropePoints(source, target, sagScale)
  const mid = points[Math.floor(points.length / 2)] ?? source
  return { d: smoothThrough(points), labelX: mid.x, labelY: mid.y }
}

function getNodeSize(nodeOrType: DiagramNode | NodeType, viewMode: ViewMode) {
  void viewMode
  return typeof nodeOrType === "string" ? NODE_SIZES[nodeOrType] : sizeForNode(nodeOrType)
}

function screenToWorld(clientX: number, clientY: number, viewport: Viewport) {
  return {
    x: (clientX - window.innerWidth / 2 - viewport.x) / viewport.zoom,
    y: (clientY - window.innerHeight / 2 - viewport.y) / viewport.zoom,
  }
}

function layoutGraphNodes(nodes: DiagramNode[], edges: DiagramEdge[]) {
  const rankById = rankNodes(nodes.map((node) => node.id), edges.map((edge) => ({ source: edge.sourceNodeId, target: edge.targetNodeId })))
  const buckets = new Map<number, DiagramNode[]>()
  nodes.forEach((node) => {
    const rank = rankById.get(node.id) ?? 0
    buckets.set(rank, [...(buckets.get(rank) ?? []), node])
  })
  const orderedRanks = [...buckets.keys()].sort((a, b) => a - b)
  const columnGap = 360
  const rowGap = 178
  const left = -Math.max(1, orderedRanks.length - 1) * columnGap * 0.5
  return nodes.map((node) => {
    const rank = rankById.get(node.id) ?? 0
    const column = orderedRanks.indexOf(rank)
    const bucket = buckets.get(rank) ?? []
    const row = bucket.findIndex((item) => item.id === node.id)
    const y = (row - (bucket.length - 1) / 2) * rowGap
    return {
      ...node,
      position: {
        x: Math.round(left + column * columnGap),
        y: Math.round(y),
      },
    }
  })
}

function rankNodes(ids: string[], edges: { source: string; target: string }[]) {
  const ranks = new Map(ids.map((id) => [id, 0]))
  for (let pass = 0; pass < ids.length; pass += 1) {
    let changed = false
    edges.forEach((edge) => {
      if (!ranks.has(edge.source) || !ranks.has(edge.target)) return
      const nextRank = (ranks.get(edge.source) ?? 0) + 1
      if (nextRank > (ranks.get(edge.target) ?? 0)) {
        ranks.set(edge.target, nextRank)
        changed = true
      }
    })
    if (!changed) break
  }
  return ranks
}

function normalizeDiagram(diagram: Diagram): Diagram {
  return migrateDiagram(diagram)
}

function loadInitialDiagrams() {
  if (typeof window === "undefined") return []
  const saved = readJSON<Diagram[]>(STORAGE_KEY, [])
  const normalized = saved.map(normalizeDiagram).filter((item) => item.graph.nodes.length > 0)
  return normalized.length ? normalized : cloneInitialWorkspace().diagrams
}

function createInspectorDraft(node: DiagramNode): InspectorDraft {
  const schema = CONFIG_SCHEMAS[node.type as keyof typeof CONFIG_SCHEMAS]
  return {
    id: node.id,
    name: node.name ?? "",
    description: node.description ?? "",
    type: node.type,
    config: {
      ...(structuredClone(node.config ?? {})),
      ...(schema ? { [node.type]: structuredClone(nodeConfig(node, node.type)) } : {}),
    },
    infraService: typeof node.infraService === "string" ? node.infraService : undefined,
  }
}

function nodeConfig(node: DiagramNode, kind = node.type) {
  const schema = CONFIG_SCHEMAS[kind as keyof typeof CONFIG_SCHEMAS]
  return {
    ...(schema ? Object.fromEntries(schema.fields.map((field) => [field.field, node[field.field]]).filter(([, value]) => hasStoredValue(value))) : {}),
    ...(node.config?.[kind] ?? {}),
  }
}

function nodeConfigSummary(
  node: DiagramNode,
  /** Named rows a field may point at, by the field's value type. */
  named: Partial<Record<string, Referenceable[]>> = {},
) {
  const schema = CONFIG_SCHEMAS[node.type as keyof typeof CONFIG_SCHEMAS]
  if (!schema) return []
  const config = nodeConfig(node, node.type)
  return schema.fields.flatMap((field) => {
    const value = config[field.field]
    if (!hasValue(value)) return []
    // A reference is stored as an id and read as a name. Falling back to the
    // id is deliberate for the case the row is gone: the chip then shows
    // something wrong rather than showing nothing, which is the difference
    // between noticing and not.
    const rows = named[field.valueType]
    if (rows) {
      const match = rows.find((row) => row.id === value)
      return [`${field.label}: ${match ? match.name : `unknown (${String(value).slice(0, 8)})`}`]
    }
    // Branches are drawn as the node's ports, immediately below these chips. A
    // chip repeating them says the same thing twice — and said it as
    // "[object Object]", because a branch is a row and not a word.
    if (field.valueType === "branches") return []
    // Assignments are rows too, and printed the same way for the same reason.
    // Unlike branches they are not drawn anywhere else, and the names are the
    // whole point of the node — what it is called is "Set lead", what it does
    // is decided by these.
    if (field.valueType === "assignments") {
      if (!Array.isArray(value)) return []
      const names = value
        .map((row) => (row && typeof row === "object" ? (row as { name?: unknown }).name : undefined))
        .filter((name): name is string => typeof name === "string" && name.length > 0)
      return names.length === 0 ? [] : [names.join(", ")]
    }
    if (field.control === "boolean") return value === true ? [getBooleanLabel(field, "checked") || field.label] : []
    if (Array.isArray(value)) return value.filter((item) => item !== "none" && hasValue(item)).map((item) => optionLabel(getFieldOptions(field), String(item)))
    if (field.control === "number") return [`${field.label}: ${value}`]
    return [`${field.label}: ${value}`]
  }).filter(hasValue)
}

function isNodeConfigured(node: DiagramNode) {
  const required = CONFIG_SCHEMAS[node.type].fields.filter((field) => field.required)
  if (required.length === 0) return true
  const config = nodeConfig(node, node.type)
  return required.every((field) => hasStoredValue(config[field.field]))
}

function getInspectorPlacement(node: DiagramNode, viewport: Viewport, viewMode: ViewMode) {
  const size = getNodeSize(node, viewMode)
  const zoom = viewport.zoom
  const nodeLeft = window.innerWidth / 2 + viewport.x + node.position.x * zoom
  const nodeTop = window.innerHeight / 2 + viewport.y + node.position.y * zoom
  const nodeWidth = size.width * zoom
  const nodeHeight = size.height * zoom
  const viewportPadding = 16
  const gap = 28
  const width = Math.min(650, Math.max(320, window.innerWidth - 32))
  const side = nodeLeft + nodeWidth + gap + width <= window.innerWidth - viewportPadding ? "right" : "left"
  const rawLeft = side === "right" ? nodeLeft + nodeWidth + gap : nodeLeft - width - gap
  // Reserve what the panel needs at minimum, not what it could grow to.
  // Reserving the full 640 pinned `top` to about 65px on a 720px window — so
  // the panel sat at the top of the screen whatever the node's position, and a
  // node near the bottom was edited by a dialog nowhere near it. The body
  // already scrolls, so a panel that follows the node down and gets shorter is
  // the better trade.
  // The panel's chrome — header, name and description, footer — is about 230px
  // and does not shrink, and the body is floored at 120. So a panel shorter
  // than roughly 350 cannot contain its own contents: it overflows and the body
  // is what gets clipped, which is why a low node opened a dialog whose fields
  // were not there at all. Reserve enough for the chrome plus a body worth
  // scrolling.
  const chromeHeight = 230
  const minBodyHeight = 200
  const minPanelHeight = chromeHeight + minBodyHeight
  const left = Math.round(
    clamp(rawLeft, viewportPadding, Math.max(viewportPadding, window.innerWidth - width - viewportPadding)),
  )
  const nodeBottom = nodeTop + nodeHeight
  const nodeMiddle = nodeTop + nodeHeight / 2

  // A node in the bottom third opens upward. Anchoring by the top and letting
  // the panel grow down means a node near the floor gets a dialog running off
  // the screen, or shoved up so far it no longer reads as belonging to that
  // node. Anchoring by the bottom also lets the browser use the panel's real
  // height rather than the reservation, which is usually smaller.
  if (nodeTop > window.innerHeight * 0.7) {
    const bottom = clamp(
      window.innerHeight - nodeBottom,
      viewportPadding,
      Math.max(viewportPadding, window.innerHeight - minPanelHeight - viewportPadding),
    )
    const maxHeight = Math.min(
      window.innerHeight - viewportPadding * 2,
      Math.max(minPanelHeight, window.innerHeight - bottom - viewportPadding),
    )
    const panelBottom = window.innerHeight - bottom
    return {
      anchor: "bottom" as const,
      side,
      width,
      maxHeight,
      left,
      top: 0,
      bottom: Math.round(bottom),
      // Measured from the panel's bottom, since that is the edge we pinned.
      connectorY: 0,
      connectorBottom: Math.round(clamp(panelBottom - nodeMiddle, 28, Math.max(28, maxHeight - 28))),
    }
  }

  const top = clamp(
    nodeTop,
    viewportPadding,
    Math.max(viewportPadding, window.innerHeight - minPanelHeight - viewportPadding),
  )
  // Never taller than the window it sits in: on a short viewport the minimum
  // above would otherwise win and hang the panel off both ends.
  const maxHeight = Math.min(
    window.innerHeight - viewportPadding * 2,
    Math.max(minPanelHeight, window.innerHeight - top - viewportPadding),
  )
  return {
    anchor: "top" as const,
    side,
    width,
    maxHeight,
    left,
    top: Math.round(top),
    bottom: 0,
    connectorY: Math.round(clamp(nodeMiddle - top, 28, Math.max(28, maxHeight - 28))),
    connectorBottom: 0,
  }
}

function defaultDescription(type: NodeType) {
  return NODE_TYPES[type]?.label ?? "General component"
}

function optionLabel(options: readonly NodeOutcome[], value: string) {
  return options.find((option) => option.id === value)?.label ?? value
}

/**
 * The answers a `select` field offers.
 *
 * This read `[id, label]` pairs until 2 September and returned `[]` on every
 * field in the catalogue, because no row has ever carried that shape — it was
 * written against an imagined one. Options are `{ id, label }`, the same shape
 * an outcome uses, so the chip on a card and the dropdown in the inspector
 * agree about what a value is called.
 */
function getFieldOptions(field: ConfigField): NodeOutcome[] {
  return field.options ?? []
}

function getBooleanLabel(field: ConfigField, kind: "checked" | "unchecked") {
  if (kind === "checked") return "checkedLabel" in field && typeof field.checkedLabel === "string" ? field.checkedLabel : "Enabled"
  return "uncheckedLabel" in field && typeof field.uncheckedLabel === "string" ? field.uncheckedLabel : "Disabled"
}

function hasValue(value: unknown) {
  if (typeof value === "boolean") return value === true
  return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0)
}

function hasStoredValue(value: unknown) {
  return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0)
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1))}…`
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

function now() {
  return new Date().toISOString()
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

function writeJSON(key: string, value: unknown) {
  if (typeof window === "undefined") return
  localStorage.setItem(key, JSON.stringify(value))
}

async function syncBackendFromRecoveredDiagram(diagram: Diagram) {
  try {
    const response = await fetch(`/api/diagrams/${encodeURIComponent(diagram.id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ diagram }),
    })
    return response.ok
  } catch {
    return false
  }
}

function loadCamera() {
  const saved = readJSON<{ version?: number; viewport?: Partial<Viewport> } | null>(CAMERA_KEY, null)
  if (!saved || saved.version !== 1 || typeof saved.viewport !== "object") return { x: 0, y: 0, zoom: 0.78 }
  return {
    x: Number.isFinite(saved.viewport.x) ? Number(saved.viewport.x) : 0,
    y: Number.isFinite(saved.viewport.y) ? Number(saved.viewport.y) : 0,
    zoom: clamp(Number.isFinite(saved.viewport.zoom) ? Number(saved.viewport.zoom) : 0.78, BOARD_MIN_ZOOM, BOARD_MAX_ZOOM),
  }
}

function readRouteDiagramId() {
  const parts = window.location.pathname.replace(/\/+$/, "").split("/").filter(Boolean)
  if (parts[0] === "d" && parts[1]) return parts[1]
  return null
}

function Icon({ name, className }: { name: string; className?: string }) {
  // Passed through to the `<svg>`, because that is where Font Awesome's own
  // animation classes have to land — `fa-spin` on a wrapper would rotate the
  // wrapper.
  const iconClass = className ? `size-[1em] ${className}` : "size-[1em]"
  const props = { className: iconClass, strokeWidth: 2.2 }
  const icons: Record<string, React.ReactNode> = {
    bolt: <Sparkles {...props} />,
    check: <Check {...props} />,
    chevronDown: <ChevronDown {...props} />,
    spinner: <Spinner {...props} />,
    chevronRight: <ChevronRight {...props} />,
    chevronUp: <ChevronUp {...props} />,
    database: <IconDocument {...props} />,
    download: <Download {...props} />,
    folder: <Folder {...props} />,
    github: (
      <svg className={iconClass} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
      </svg>
    ),
    keyboard: <Keyboard {...props} />,
    list: <Layers {...props} />,
    lock: <Lock {...props} />,
    menu: <Menu {...props} />,
    back: <ArrowLeft {...props} />,
    minus: <Minus {...props} />,
    plus: <Plus {...props} />,
    rotate: <RotateCcw {...props} />,
    route: <IconSquads {...props} />,
    save: <Save {...props} />,
    stop: <Box {...props} />,
    share: <Share2 {...props} />,
    spark: <Sparkles {...props} />,
    stackplane: (
      <svg className={iconClass} viewBox="43 49 168 168" aria-hidden>
        <path
          fill="#F59E0B"
          fillRule="evenodd"
          d="M98.96 209.86 C99.52 209.43 101.99 207.51 104.45 205.61 C122.96 191.26 123.95 190.51 124.36 190.51 L124.77 190.51 L124.80 199.14 L124.83 207.77 L128.31 204.45 C134.09 198.96 140.85 192.55 143.16 190.40 C144.36 189.28 145.54 188.15 145.80 187.89 L146.26 187.42 L146.27 138.98 C146.27 112.33 146.23 89.43 146.19 88.08 L146.11 85.62 L135.44 85.62 L124.77 85.62 L124.77 124.44 C124.77 161.54 124.76 163.27 124.55 163.32 C124.43 163.35 122.76 164.58 120.85 166.05 C116.20 169.61 107.77 176.10 101.22 181.15 C98.78 183.03 98.03 183.54 97.74 183.54 C97.46 183.55 97.04 183.29 96.06 182.53 C94.80 181.54 89.23 177.16 84.01 173.05 C78.32 168.57 74.59 165.67 74.15 165.39 L73.70 165.10 L73.66 156.24 L73.63 147.39 L70.52 150.15 C64.60 155.42 53.74 165.01 53.03 165.60 L52.32 166.21 L52.32 170.62 C52.32 173.05 52.35 175.15 52.39 175.29 C52.43 175.42 53.81 176.56 55.45 177.82 C57.09 179.08 59.51 180.96 60.83 182.01 C62.15 183.05 64.51 184.90 66.09 186.12 C72.69 191.22 75.76 193.62 84.57 200.52 C86.48 202.02 89.22 204.16 90.66 205.26 C92.09 206.37 94.22 208.03 95.38 208.95 C96.54 209.87 97.59 210.63 97.72 210.63 C97.85 210.64 98.41 210.29 98.96 209.86 Z M116.04 151.66 L116.01 138.88 L114.02 137.34 C112.93 136.50 109.51 133.87 106.44 131.51 C97.83 124.88 92.36 120.66 89.97 118.80 C88.78 117.87 86.34 115.99 84.57 114.63 C82.79 113.26 79.74 110.91 77.79 109.40 C75.85 107.90 74.13 106.59 73.97 106.49 L73.69 106.32 L73.70 102.09 L73.70 97.86 L74.28 97.43 C74.60 97.19 76.35 95.85 78.16 94.44 C79.98 93.04 83.17 90.58 85.25 88.98 C87.34 87.38 90.02 85.31 91.22 84.38 C92.41 83.45 95.10 81.37 97.20 79.75 L101.01 76.80 L108.51 76.77 L116.01 76.74 L116.01 65.93 L116.01 55.11 L105.12 55.11 L94.23 55.11 L93.25 55.87 C86.24 61.26 80.79 65.47 78.35 67.35 C76.71 68.63 74.00 70.73 72.33 72.02 C70.65 73.31 66.82 76.26 63.81 78.59 C60.81 80.91 57.09 83.79 55.55 84.98 C54.01 86.17 52.66 87.25 52.54 87.39 C52.33 87.62 52.32 88.50 52.32 102.07 L52.32 116.49 L52.85 116.96 C53.14 117.22 56.11 119.55 59.46 122.13 C62.81 124.71 67.65 128.45 70.21 130.43 C72.78 132.42 76.97 135.65 79.53 137.63 C82.10 139.61 85.90 142.54 87.98 144.15 C90.07 145.76 92.53 147.65 93.45 148.35 C94.38 149.05 97.42 151.39 100.23 153.54 C103.03 155.70 106.63 158.46 108.24 159.68 C109.85 160.90 112.22 162.71 113.52 163.72 L115.88 165.54 L115.98 164.99 C116.03 164.69 116.06 158.69 116.04 151.66 Z"
        />
        <path
          fill="#38BDF8"
          fillRule="evenodd"
          d="M183.37 145.08 C184.67 143.85 186.62 142.00 187.71 140.98 C188.81 139.96 192.30 136.69 195.48 133.71 C198.66 130.74 201.51 128.07 201.82 127.79 L202.38 127.27 L202.38 101.32 L202.38 75.37 L201.32 74.37 C200.23 73.33 193.47 66.96 187.90 61.71 C186.16 60.07 183.93 57.95 182.96 57.01 C181.99 56.07 181.11 55.30 181.00 55.30 C180.90 55.30 180.82 55.25 180.82 55.18 C180.82 55.09 171.39 55.05 152.79 55.05 L124.77 55.05 L124.80 65.90 L124.83 76.74 L148.94 76.77 L173.05 76.80 L174.48 78.21 C175.26 78.98 177.04 80.69 178.42 82.01 L180.94 84.41 L180.94 101.40 L180.94 118.39 L177.37 121.69 C175.40 123.51 173.63 125.17 173.43 125.38 L173.06 125.76 L164.02 125.76 L154.97 125.76 L154.97 136.49 C154.97 142.39 155.01 147.26 155.05 147.31 C155.10 147.35 160.96 147.38 168.08 147.36 L181.02 147.32 L183.37 145.08 Z"
        />
      </svg>
    ),
    target: <Activity {...props} />,
    trash: <Trash2 {...props} />,
    undo: <ArrowRotateLeft {...props} />,
    redo: <ArrowRotateRight {...props} />,
    x: <X {...props} />,
  }
  return <i aria-hidden="true">{icons[name] ?? <Box {...props} />}</i>
}

function NodeIcon({ icon }: { icon: string }) {
  const iconClass = "size-5"
  const props = { className: iconClass, strokeWidth: 2.1 }
  const icons: Record<string, React.ReactNode> = {
    triggerAnswered: <IconPhoneNumbers {...props} />,
    triggerEnded: <IconCallLogs {...props} />,
    triggerFailed: <AlertCircle {...props} />,
    tool: <IconTools {...props} />,
    condition: <IconSquads {...props} />,
    loop: <RotateCcw {...props} />,
    variable: <IconSliders {...props} />,
    code: <Code02 {...props} />,
    businessHours: <IconCallLogs {...props} />,
    agent: <IconAgents {...props} />,
    conference: <IconAgents {...props} />,
    transfer: <IconPhoneNumbers {...props} />,
    hold: <IconStopwatch {...props} />,
    hangup: <IconPhoneNumbers {...props} />,
    release: <IconDocument {...props} />,
    monitor: <Eye {...props} />,
    keypad: <Keyboard {...props} />,
    intelligence: <IconGauge {...props} />,
    webhook: <IconTools {...props} />,
    // Engine steps.
    engineRealtime: <Zap {...props} />,
    engineListening: <IconDocument {...props} />,
    engineThinking: <IconLanguage {...props} />,
    engineSpeaking: <IconVoiceLibrary {...props} />,
  }
  return <i aria-hidden="true">{icons[icon] ?? <Box {...props} />}</i>
}

import {
  COMPONENT_BUILDER_RUNTIME_ID,
  DEFAULT_COMPONENT_BUILDER_RUNTIME,
  type AgentRuntimeSelection,
} from "./runtime-registry-core"
import type { Diagram, DiagramEdge, DiagramNode } from "../architecture-model"
import {
  buildResolvedImplementationContext,
  type ResolvedImplementationContext,
} from "./component-implementation-profiles"
import type { NodeRequirementSlice } from "./requirement-routing-core"

export const DEFAULT_CODING_MODEL = "workspace:default"
export const LEGACY_CODING_RUNTIME = "coding"
export const CODING_RUNTIME = COMPONENT_BUILDER_RUNTIME_ID
export const CODING_RUNTIME_IDS = [LEGACY_CODING_RUNTIME, CODING_RUNTIME] as const
export const ACTIVE_CODING_RUN_STATUSES = [
  "queued", "assigned", "preparing", "ready", "executing", "built", "finalizing", "running", "blocked",
] as const

export type CodingRunView = {
  id: string
  status: string
  prUrl?: string | null
  repoFullName?: string | null
  errorMessage?: string | null
}

export type CodingRunDescriptor = {
  state: "queued" | "running" | "succeeded" | "failed" | "built" | "unknown"
  runId?: string
  label: string
  prUrl: string | null
  error: string | null
  // queued/running runs are still in flight — the UI keeps polling while active.
  active: boolean
  // Live observability (filled by run-activity for active runs).
  agentState?: "working" | "idle" | "stalled" | null
  humanOnline?: boolean
  // An editor workspace has recent presence on this component's latest run,
  // regardless of whether the run itself is still active.
  workspaceActive?: boolean
  // Server-truth repo link + workspace path (client stores can go stale).
  repoFullName?: string | null
  repoUrl?: string | null
  workspacePath?: string | null
}

export type CodingRunsByNodeId = Record<string, CodingRunDescriptor>

export function isActiveCodingRunStatus(status: string | null | undefined): boolean {
  return ACTIVE_CODING_RUN_STATUSES.includes(status as (typeof ACTIVE_CODING_RUN_STATUSES)[number])
}

// Pure view-model for a coding run's status chip. Keeps the label/polling logic
// out of the React component so it can be unit-tested.
export function describeCodingRun(
  run: CodingRunView | null | undefined,
): CodingRunDescriptor | null {
  if (!run) return null
  const descriptor = describeStatus(run)
  return descriptor ? { runId: run.id, ...descriptor } : null
}

function describeStatus(run: CodingRunView): CodingRunDescriptor | null {
  switch (run.status) {
    case "queued":
      return { state: "queued", label: "Queued...", prUrl: null, error: null, active: true }
    case "running":
      return { state: "running", label: "Building...", prUrl: null, error: null, active: true }
    case "assigned":
    case "preparing":
    case "ready":
    case "executing":
    case "finalizing":
      return { state: "running", label: "Building...", prUrl: null, error: null, active: true }
    case "built":
      return { state: "built", label: "Built locally", prUrl: null, error: null, active: false }
    case "succeeded":
      return {
        state: "succeeded",
        label: run.prUrl ? "PR opened" : "Done",
        prUrl: run.prUrl ?? null,
        error: null,
        active: false,
      }
    case "failed":
      return {
        state: "failed",
        label: "Failed",
        prUrl: null,
        error: run.errorMessage?.trim() || "Run failed",
        active: false,
      }
    case "changes_requested":
      return {
        state: "failed",
        label: "Changes requested",
        prUrl: run.prUrl ?? null,
        error: null,
        active: false,
      }
    default:
      return { state: "unknown", label: run.status, prUrl: run.prUrl ?? null, error: null, active: false }
  }
}

export type CodingNodeSnapshot = {
  type: DiagramNode["type"]
  name: string
  description?: string
  config?: Record<string, Record<string, unknown>>
}

export type CodingRunNodeContext = CodingNodeSnapshot & {
  id: string
  position: DiagramNode["position"]
}

export type CodingRunEdgeContext = Pick<DiagramEdge, "id" | "sourceNodeId" | "targetNodeId" | "sourceHandle" | "targetHandle" | "style" | "outcome" | "label" | "bidirectional">

export type CodingRunContextSnapshot = CodingNodeSnapshot & {
  version: 1
  implementationContext: ResolvedImplementationContext
  run: {
    id: string
    organizationId: string
    diagramId: string
    nodeId: string
    repoFullName: string
    branch: string
    triggeredByUserId: string
  }
  workspace: {
    id: string
    name: string
  }
  diagram: {
    id: string
    name: string
    description: string
    context: string
    notes: Array<{ version: number; body: string; createdAt: string }>
  }
  target: {
    node: CodingRunNodeContext
    incoming: CodingRunEdgeContext[]
    outgoing: CodingRunEdgeContext[]
    upstreamNodes: CodingRunNodeContext[]
    downstreamNodes: CodingRunNodeContext[]
  }
  graph: {
    nodes: CodingRunNodeContext[]
    edges: CodingRunEdgeContext[]
  }
  workspaceAgent?: {
    source: "stackplane-workspace-agent"
    generatedAt: string
    summary: string
    artifacts: string[]
    visualArtifactPath?: string
    model?: string
    fileAgents?: Array<{
      artifactPath: "CLAUDE.md" | "AGENTS.md" | "IMPLEMENTATION_PLAN.md"
      role: string
      generatedAt: string
      model: string
      summary: string
    }>
  }
  editorWorkspace?: {
    repoPath: string
    workspacePath: string
    diagramPath: string
    componentPath: string
  }
  // The target's typed dependencies that HAVE a repo — cloned into the workspace
  // alongside this component so the agent reads their actual code/contracts, not
  // a paraphrase. This is what makes an "A → B" edge concrete: B's code is right
  // there. Populated at run creation (where the nodeRepos table is reachable).
  dependencyRepos?: Array<{ nodeId: string; name: string; repoFullName: string }>
  // The requirement slice the routing step bound to this node, injected into the
  // workspace-agent briefs so the component agent builds to its requirement
  // mandate. Populated at run creation (where node_requirement_binding is
  // reachable), not by the pure snapshot builder.
  requirements?: NodeRequirementSlice[]
}

export type CodingAgentProfile = {
  id?: string | null
  model?: string | null
}

export function snapshotCodingNode(node: DiagramNode): CodingNodeSnapshot {
  return {
    type: node.type,
    name: node.name,
    description: node.description,
    config: node.config,
  }
}

function snapshotContextNode(node: DiagramNode): CodingRunNodeContext {
  return {
    id: node.id,
    position: node.position,
    ...snapshotCodingNode(node),
  }
}

function snapshotEdge(edge: DiagramEdge): CodingRunEdgeContext {
  return {
    id: edge.id,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    style: edge.style,
    outcome: edge.outcome,
    label: edge.label,
    bidirectional: edge.bidirectional,
  }
}

export function branchForCodingRun(runId: string): string {
  return `stackplane/agent-${runId}`
}

export function buildCodingRunContextSnapshot(input: {
  runId: string
  organizationId: string
  workspaceName: string
  diagram: Diagram
  node: DiagramNode
  repoFullName: string
  triggeredByUserId: string
}): CodingRunContextSnapshot {
  const branch = branchForCodingRun(input.runId)
  const edges = input.diagram.graph.edges.map(snapshotEdge)
  const nodes = input.diagram.graph.nodes.map(snapshotContextNode)
  const incoming = edges.filter((edge) => edge.targetNodeId === input.node.id)
  const outgoing = edges.filter((edge) => edge.sourceNodeId === input.node.id)
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const targetNode = snapshotContextNode(input.node)

  return {
    ...snapshotCodingNode(input.node),
    version: 1,
    implementationContext: buildResolvedImplementationContext(input.diagram.graph, input.node.id),
    run: {
      id: input.runId,
      organizationId: input.organizationId,
      diagramId: input.diagram.id,
      nodeId: input.node.id,
      repoFullName: input.repoFullName,
      branch,
      triggeredByUserId: input.triggeredByUserId,
    },
    workspace: {
      id: input.organizationId,
      name: input.workspaceName,
    },
    diagram: {
      id: input.diagram.id,
      name: input.diagram.name,
      description: input.diagram.description,
      context: input.diagram.context,
      notes: (input.diagram.notes ?? []).map((note) => ({
        version: note.version,
        body: note.body,
        createdAt: note.createdAt,
      })),
    },
    target: {
      node: targetNode,
      incoming,
      outgoing,
      upstreamNodes: incoming.map((edge) => nodeById.get(edge.sourceNodeId)).filter((node): node is CodingRunNodeContext => Boolean(node)),
      downstreamNodes: outgoing.map((edge) => nodeById.get(edge.targetNodeId)).filter((node): node is CodingRunNodeContext => Boolean(node)),
    },
    graph: {
      nodes,
      edges,
    },
  }
}

export function buildCodingRunInsert(input: {
  runId: string
  organizationId: string
  workspaceName: string
  diagram: Diagram
  nodeId: string
  node: DiagramNode
  repoFullName: string
  triggeredByUserId: string
  profile?: CodingAgentProfile | null
  runtime?: AgentRuntimeSelection | null
  now?: Date
}) {
  const now = input.now ?? new Date()
  const runtime = input.runtime ?? DEFAULT_COMPONENT_BUILDER_RUNTIME
  const model = runtime.defaultModel?.trim() || DEFAULT_CODING_MODEL
  const nodeSnapshot = buildCodingRunContextSnapshot({
    runId: input.runId,
    organizationId: input.organizationId,
    workspaceName: input.workspaceName,
    diagram: input.diagram,
    node: input.node,
    repoFullName: input.repoFullName,
    triggeredByUserId: input.triggeredByUserId,
  })

  return {
    id: input.runId,
    organizationId: input.organizationId,
    profileId: input.profile?.id ?? null,
    diagramId: input.diagram.id,
    trigger: "manual",
    runtime: runtime.id,
    status: "queued",
    mode: "build",
    model,
    branch: nodeSnapshot.run.branch,
    repoFullName: input.repoFullName,
    nodeId: input.nodeId,
    nodeSnapshot,
    triggeredByUserId: input.triggeredByUserId,
    queuedAt: now,
    startedAt: now,
  }
}

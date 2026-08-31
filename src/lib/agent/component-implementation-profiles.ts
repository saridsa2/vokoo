import { NODE_TYPES, type Diagram, type DiagramNode, type NodeType } from "../architecture-model"

export const IMPLEMENTATION_CONTEXT_SCHEMA_VERSION = 2 as const
export type ImplementationKind = "generic"
export type ResolvedRepositoryArtifact = { path: string; purpose: string }
export type ResolvedRepositoryContract = {
  requiredArtifacts: ResolvedRepositoryArtifact[]
  verificationCommands: string[]
  forbiddenPathPatterns: string[]
  allowAdditionalPaths: boolean
}
export type ResolvedComponentProfile = {
  id: string
  nodeType: NodeType
  implementationKind: ImplementationKind
  summary: string
  deliverables: string[]
  verification: string[]
  forbiddenResponsibilities: string[]
  repositoryContract: ResolvedRepositoryContract
}
type HandoffViolationRule = { responsibility: string; pattern: RegExp }
export type ComponentImplementationProfile = ResolvedComponentProfile & {
  implementationGuidance: string[]
  invalidHandoffRules: HandoffViolationRule[]
}
export type WorkspaceComponentCatalogEntry = {
  nodeId: string
  name: string
  nodeType: NodeType
  scope: "target" | "adjacent" | "context"
  profile: ResolvedComponentProfile
  config: Record<string, unknown>
  incomingOutcomes: string[]
  outgoingOutcomes: string[]
}
export type ResolvedImplementationContext = {
  schemaVersion: typeof IMPLEMENTATION_CONTEXT_SCHEMA_VERSION
  target: WorkspaceComponentCatalogEntry & { scope: "target" }
  components: WorkspaceComponentCatalogEntry[]
}

function repositoryContract(): ResolvedRepositoryContract {
  return { requiredArtifacts: [], verificationCommands: [], forbiddenPathPatterns: [], allowAdditionalPaths: true }
}

export function resolveComponentImplementationProfile(nodeType: NodeType): ComponentImplementationProfile {
  const metadata = NODE_TYPES[nodeType]
  return {
    id: nodeType,
    nodeType,
    implementationKind: "generic",
    summary: metadata.description,
    deliverables: [],
    verification: [],
    forbiddenResponsibilities: [],
    repositoryContract: repositoryContract(),
    implementationGuidance: [],
    invalidHandoffRules: [],
  }
}

export function resolveComponentProfileDto(nodeType: NodeType): ResolvedComponentProfile {
  const profile = resolveComponentImplementationProfile(nodeType)
  return {
    id: profile.id,
    nodeType: profile.nodeType,
    implementationKind: profile.implementationKind,
    summary: profile.summary,
    deliverables: [...profile.deliverables],
    verification: [...profile.verification],
    forbiddenResponsibilities: [...profile.forbiddenResponsibilities],
    repositoryContract: repositoryContract(),
  }
}

function isResolvedProfile(value: unknown): value is ResolvedComponentProfile {
  if (!value || typeof value !== "object") return false
  const profile = value as Partial<ResolvedComponentProfile>
  return typeof profile.id === "string" && typeof profile.nodeType === "string" && profile.implementationKind === "generic"
}

export function readResolvedImplementationContext(snapshot: unknown): ResolvedImplementationContext | null {
  if (!snapshot || typeof snapshot !== "object") return null
  const context = (snapshot as { implementationContext?: unknown }).implementationContext
  if (!context || typeof context !== "object") return null
  const candidate = context as Partial<ResolvedImplementationContext>
  if (candidate.schemaVersion !== IMPLEMENTATION_CONTEXT_SCHEMA_VERSION || !candidate.target || candidate.target.scope !== "target") return null
  if (!isResolvedProfile(candidate.target.profile) || !Array.isArray(candidate.components)) return null
  return candidate as ResolvedImplementationContext
}

function configFor(node: DiagramNode): Record<string, unknown> {
  const section = node.config?.[node.type]
  return section && typeof section === "object" ? { ...section } : {}
}

export function buildResolvedImplementationContext(graph: Diagram["graph"], targetId: string): ResolvedImplementationContext {
  const targetNode = graph.nodes.find((node) => node.id === targetId)
  if (!targetNode) throw new Error(`Target ${targetId} is not present in the call flow.`)
  const adjacentIds = new Set<string>()
  graph.edges.forEach((edge) => {
    if (edge.sourceNodeId === targetId) adjacentIds.add(edge.targetNodeId)
    if (edge.targetNodeId === targetId) adjacentIds.add(edge.sourceNodeId)
  })
  const components = graph.nodes.map((node): WorkspaceComponentCatalogEntry => ({
    nodeId: node.id,
    name: node.name,
    nodeType: node.type,
    scope: node.id === targetId ? "target" : adjacentIds.has(node.id) ? "adjacent" : "context",
    profile: resolveComponentProfileDto(node.type),
    config: configFor(node),
    incomingOutcomes: graph.edges.filter((edge) => edge.targetNodeId === node.id).flatMap((edge) => edge.outcome ? [edge.outcome] : []),
    outgoingOutcomes: graph.edges.filter((edge) => edge.sourceNodeId === node.id).flatMap((edge) => edge.outcome ? [edge.outcome] : []),
  }))
  const target = components.find((component) => component.nodeId === targetId)
  if (!target || target.scope !== "target") throw new Error(`Target ${targetId} could not be resolved.`)
  return { schemaVersion: IMPLEMENTATION_CONTEXT_SCHEMA_VERSION, target: target as WorkspaceComponentCatalogEntry & { scope: "target" }, components }
}

export function renderTargetProfilePrompt(context: ResolvedImplementationContext): string {
  return [
    `Flow node: ${context.target.profile.id}.`,
    context.target.profile.summary,
    `Incoming outcomes: ${context.target.incomingOutcomes.join(", ") || "none"}.`,
    `Outgoing outcomes: ${context.target.outgoingOutcomes.join(", ") || "none"}.`,
  ].join("\n")
}

export function validateGeneratedHandoff(
  _context: ResolvedImplementationContext,
  _artifactPath: "CLAUDE.md" | "AGENTS.md" | "IMPLEMENTATION_PLAN.md",
  _content: string,
): string | null {
  return null
}

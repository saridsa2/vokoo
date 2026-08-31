// Deterministic core of requirement routing: validate the (possibly agentic)
// raw assignments against the real node/requirement sets and compute coverage.
// No model call lives here — this is the auditable layer every routing result
// passes through, so a hallucinated node id or a dropped requirement can never
// reach persistence unnoticed.

export type RoutableRequirement = {
  sourceItemRevisionId: string
  externalId: string
  title: string
  body: string
  url?: string
}

export type RoutableNode = {
  nodeId: string
  name: string
  type: string
  description?: string
}

export type RequirementAssignment = {
  nodeId: string
  sourceItemRevisionId: string
  rationale: string
}

export type UnassignedRequirement = {
  sourceItemRevisionId: string
  reason: string
}

export type RequirementRouting = {
  assignments: RequirementAssignment[]
  unassigned: UnassignedRequirement[]
}

// A requirement bound to a node, resolved for injection into that component's
// build brief. Owned here so both the persistence layer and the brief/snapshot
// consumers share one definition.
export type NodeRequirementSlice = {
  sourceItemRevisionId: string
  externalId: string
  title: string
  body: string
  url?: string
  rationale: string
}

export function reconcileRouting(input: {
  nodes: RoutableNode[]
  requirements: RoutableRequirement[]
  raw: { assignments: RequirementAssignment[] }
}): RequirementRouting {
  const nodeIds = new Set(input.nodes.map((node) => node.nodeId))
  const requirementIds = new Set(input.requirements.map((requirement) => requirement.sourceItemRevisionId))
  const seen = new Set<string>()
  const assignments: RequirementAssignment[] = []

  for (const assignment of input.raw.assignments) {
    // Drop anything the model invented: an unknown component or a requirement
    // that isn't in the corpus.
    if (!nodeIds.has(assignment.nodeId) || !requirementIds.has(assignment.sourceItemRevisionId)) continue
    // A requirement may legitimately be claimed by several components, but not
    // twice by the same one.
    const key = `${assignment.nodeId}::${assignment.sourceItemRevisionId}`
    if (seen.has(key)) continue
    seen.add(key)
    assignments.push({
      nodeId: assignment.nodeId,
      sourceItemRevisionId: assignment.sourceItemRevisionId,
      rationale: assignment.rationale,
    })
  }

  const covered = new Set(assignments.map((assignment) => assignment.sourceItemRevisionId))
  const unassigned = input.requirements
    .filter((requirement) => !covered.has(requirement.sourceItemRevisionId))
    .map((requirement) => ({
      sourceItemRevisionId: requirement.sourceItemRevisionId,
      reason: "no component claimed this requirement",
    }))

  return { assignments, unassigned }
}

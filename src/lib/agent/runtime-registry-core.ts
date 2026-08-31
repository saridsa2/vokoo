export const COMPONENT_IMPLEMENTATION_CAPABILITY = "component.implementation"
export const COMPONENT_BUILDER_RUNTIME_ID = "stackplane.component-builder"
export const FRONTEND_IMPLEMENTATION_CAPABILITY = "frontend.implementation"
export const FRONTEND_BUILDER_RUNTIME_ID = "stackplane.frontend-builder"

export type AgentRuntimeKind = "docker-sandbox" | "http" | "local-command"
export type AgentRuntimeStatus = "active" | "disabled"

export type AgentRuntimeManifest = {
  id: string
  name: string
  capability: string
  kind: AgentRuntimeKind
  status: AgentRuntimeStatus
  defaultModel: string
  config: Record<string, unknown>
}

export type AgentRuntimeSelection = Pick<AgentRuntimeManifest, "id" | "defaultModel">

export const DEFAULT_COMPONENT_BUILDER_RUNTIME: AgentRuntimeManifest = {
  id: COMPONENT_BUILDER_RUNTIME_ID,
  name: "Component Builder",
  capability: COMPONENT_IMPLEMENTATION_CAPABILITY,
  kind: "docker-sandbox",
  status: "active",
  defaultModel: "workspace:default",
  config: {
    sandboxImage: "stackplane-agent-sandbox:latest",
    worker: "stackplane-agent-worker",
  },
}

export const DEFAULT_FRONTEND_BUILDER_RUNTIME: AgentRuntimeManifest = {
  id: FRONTEND_BUILDER_RUNTIME_ID,
  name: "Frontend Builder",
  capability: FRONTEND_IMPLEMENTATION_CAPABILITY,
  kind: "docker-sandbox",
  status: "active",
  defaultModel: "workspace:default",
  config: {
    sandboxImage: "stackplane-agent-sandbox:latest",
    worker: "stackplane-agent-worker",
  },
}

function cleanId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim()
}

function normalizeKind(value: unknown): AgentRuntimeKind {
  if (value === "http" || value === "local-command" || value === "docker-sandbox") return value
  return "docker-sandbox"
}

function normalizeStatus(value: unknown): AgentRuntimeStatus {
  return value === "disabled" ? "disabled" : "active"
}

function normalizeConfig(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export function normalizeRuntimeManifest(input: Record<string, unknown>): AgentRuntimeManifest {
  const id = cleanId(input.id)
  const name = cleanText(input.name)
  const capability = cleanText(input.capability)
  const defaultModel = cleanText(input.defaultModel) || DEFAULT_COMPONENT_BUILDER_RUNTIME.defaultModel

  if (!id) throw new Error("Runtime id is required.")
  if (!name) throw new Error("Runtime name is required.")
  if (!capability) throw new Error("Runtime capability is required.")

  return {
    id,
    name,
    capability,
    kind: normalizeKind(input.kind),
    status: normalizeStatus(input.status),
    defaultModel,
    config: normalizeConfig(input.config),
  }
}

export function selectRuntimeForCapability(
  runtimes: AgentRuntimeManifest[],
  capability: string,
): AgentRuntimeManifest {
  const selected = runtimes.find((runtime) => (
    runtime.status === "active" && runtime.capability === capability
  ))
  if (selected) return selected

  if (capability === COMPONENT_IMPLEMENTATION_CAPABILITY) return DEFAULT_COMPONENT_BUILDER_RUNTIME

  throw new Error(`No active runtime registered for capability: ${capability}`)
}

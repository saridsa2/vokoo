export function buildEditorLaunchUrl(input: {
  gatewayUrl: string
  stackplaneUrl: string
  runId: string
  workspacePath?: string | null
}): string {
  const gateway = new URL(input.gatewayUrl)
  const stackplane = new URL(input.stackplaneUrl)

  if (input.workspacePath?.trim()) {
    gateway.searchParams.set("folder", input.workspacePath)
  }
  gateway.searchParams.set("stackplaneRunId", input.runId)
  gateway.searchParams.set("stackplaneUrl", stackplane.origin)

  return gateway.toString()
}

// Desktop deep-link: launches the local Stackplane editor (a VS Code fork) and
// attaches it to a run. The link carries ONLY non-secret pointers — runId and
// the control-plane origin. The editor supplies its own stored fleet credential
// (never in the URL). Default scheme matches the editor build's urlProtocol.
export function buildDesktopAttachUrl(input: {
  stackplaneUrl: string
  runId: string
  scheme?: string
}): string {
  const stackplane = new URL(input.stackplaneUrl)
  // A Stackplane-only scheme so macOS routes the deep-link to Stackplane, not a
  // VS Code / Code-OSS install that also claims code-oss. Must match the
  // editor's product.json urlProtocol.
  const scheme = (input.scheme ?? "stackplane").replace(/:$/, "")
  const query = new URLSearchParams({
    runId: input.runId,
    url: stackplane.origin,
  })
  return `${scheme}:stackplane/attach?${query.toString()}`
}

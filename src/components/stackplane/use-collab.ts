"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type { DiagramEdge, DiagramNode } from "@/lib/architecture-model"

/** The slice of a diagram we keep in sync across collaborators. */
export type CollabGraph = {
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  name: string
  description: string
  context: string
}

export type RemoteCursor = {
  clientId: number
  name: string
  color: string
  cursor: { x: number; y: number } | null
  /** True for the AI agent participant (rendered distinctly, no cursor). */
  agent?: boolean
  /** Agent activity: "thinking" | "editing" | "idle" (only set for the agent). */
  status?: string
}

export type CollabApi = {
  /** True once the realtime socket is connected. */
  connected: boolean
  /** Other people currently in this room (excludes you). */
  remote: RemoteCursor[]
  /** Your identity in the room (null until the token resolves). */
  self: { name: string; color: string } | null
  /** Reconcile the local graph into the shared doc (call after every edit). */
  pushLocal: (graph: CollabGraph) => void
  /** Broadcast your cursor position (world coordinates) to peers. */
  setCursor: (point: { x: number; y: number } | null) => void
  /** Broadcast the node you're editing so the agent stays off it. */
  setSelection: (nodeId: string | null) => void
}

// Marks Yjs transactions that originate locally so our own observers ignore them.
const LOCAL_ORIGIN = Symbol("stackplane-local")

function wsBaseUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws"
  return `${proto}://${window.location.host}/collab`
}

type YMapLike = {
  get: (k: string) => unknown
  set: (k: string, v: unknown) => void
  delete: (k: string) => void
  has: (k: string) => boolean
  keys: () => IterableIterator<string>
  toJSON: () => Record<string, unknown>
}

/**
 * Realtime multiplayer binding for the diagram editor.
 *
 * The open diagram's graph lives in a per-diagram Y.Doc (room
 * `${orgId}:${diagramId}`) as Y.Maps of nodes/edges so concurrent edits to
 * different elements merge conflict-free. We keep React state as the source the
 * editor renders and reconcile both directions:
 *   - local edit  → diff the graph into the Y.Doc (LOCAL_ORIGIN transaction)
 *   - remote edit → rebuild the graph from the Y.Doc and hand it to `onRemote`
 * Awareness carries presence + live cursors.
 */
export function useCollab({
  activeId,
  enabled = true,
  getLocalGraph,
  onRemote,
}: {
  activeId: string | null
  enabled?: boolean
  /** Snapshot of the current local graph, used to seed an empty room. */
  getLocalGraph: () => CollabGraph | null
  /** Apply a graph received from peers to local state. */
  onRemote: (graph: CollabGraph) => void
}): CollabApi {
  const [connected, setConnected] = useState(false)
  const [remote, setRemote] = useState<RemoteCursor[]>([])
  const [self, setSelf] = useState<{ name: string; color: string } | null>(null)

  // Keep the latest callbacks in refs so the connection effect (keyed only on
  // activeId/enabled) never tears down the socket when the parent re-renders.
  const getLocalGraphRef = useRef(getLocalGraph)
  const onRemoteRef = useRef(onRemote)
  useEffect(() => {
    getLocalGraphRef.current = getLocalGraph
    onRemoteRef.current = onRemote
  }, [getLocalGraph, onRemote])

  // Imperative controls wired up once the doc exists.
  const controlsRef = useRef<{
    pushLocal: (graph: CollabGraph) => void
    setCursor: (point: { x: number; y: number } | null) => void
    setSelection: (nodeId: string | null) => void
  } | null>(null)

  useEffect(() => {
    if (!enabled || !activeId) return
    let disposed = false
    let cleanup: (() => void) | null = null

    void (async () => {
      // 1. Authenticate: get a room token + our identity.
      let auth: { token: string; orgId: string; user: { name: string; color: string } }
      try {
        const res = await fetch("/api/collab/token", { cache: "no-store" })
        if (!res.ok) return
        auth = await res.json()
      } catch {
        return
      }
      if (disposed) return

      // 2. Load the CRDT libs lazily (keeps them out of the initial bundle / SSR).
      const Y = await import("yjs")
      const { WebsocketProvider } = await import("y-websocket")
      if (disposed) return

      const doc = new Y.Doc()
      const ynodes = doc.getMap("nodes")
      const yedges = doc.getMap("edges")
      const ymeta = doc.getMap("meta")
      const room = `${auth.orgId}:${activeId}`
      const provider = new WebsocketProvider(wsBaseUrl(), room, doc, {
        params: { token: auth.token },
      })
      const awareness = provider.awareness
      awareness.setLocalStateField("user", auth.user)
      setSelf(auth.user)

      // --- reconcile helpers -------------------------------------------------
      const reconcileMap = (
        ymap: typeof ynodes,
        items: Array<Record<string, unknown> & { id: string }>,
      ) => {
        const ids = new Set<string>()
        for (const item of items) {
          ids.add(item.id)
          let entry = ymap.get(item.id) as unknown as YMapLike | undefined
          if (!entry) {
            entry = new Y.Map() as unknown as YMapLike
            ymap.set(item.id, entry as never)
          }
          const { id: _omit, ...fields } = item
          void _omit
          for (const [k, v] of Object.entries(fields)) {
            if (JSON.stringify(entry.get(k)) !== JSON.stringify(v)) entry.set(k, v)
          }
          for (const k of [...entry.keys()]) {
            if (!(k in fields)) entry.delete(k)
          }
        }
        for (const id of [...ymap.keys()]) {
          if (!ids.has(id)) ymap.delete(id)
        }
      }

      const pushLocal = (graph: CollabGraph) => {
        doc.transact(() => {
          reconcileMap(ynodes, graph.nodes as Array<DiagramNode & { id: string }>)
          reconcileMap(yedges, graph.edges as Array<DiagramEdge & { id: string }>)
          if (ymeta.get("name") !== graph.name) ymeta.set("name", graph.name)
          if (ymeta.get("description") !== graph.description) ymeta.set("description", graph.description)
          if (ymeta.get("context") !== graph.context) ymeta.set("context", graph.context)
        }, LOCAL_ORIGIN)
      }

      const readGraph = (): CollabGraph => {
        const nodesObj = ynodes.toJSON() as Record<string, Record<string, unknown>>
        const edgesObj = yedges.toJSON() as Record<string, Record<string, unknown>>
        return {
          nodes: Object.entries(nodesObj).map(([id, f]) => ({ id, ...f })) as DiagramNode[],
          edges: Object.entries(edgesObj).map(([id, f]) => ({ id, ...f })) as DiagramEdge[],
          name: (ymeta.get("name") as string) ?? "",
          description: (ymeta.get("description") as string) ?? "",
          context: (ymeta.get("context") as string) ?? "",
        }
      }

      controlsRef.current = {
        pushLocal,
        setCursor: (point) => awareness.setLocalStateField("cursor", point),
        setSelection: (nodeId) => awareness.setLocalStateField("selection", nodeId),
      }

      // --- remote → local ----------------------------------------------------
      let rebuildQueued = false
      const scheduleRebuild = () => {
        if (rebuildQueued) return
        rebuildQueued = true
        queueMicrotask(() => {
          rebuildQueued = false
          if (!disposed) onRemoteRef.current(readGraph())
        })
      }
      const onUpdate = (_u: Uint8Array, origin: unknown) => {
        if (origin !== LOCAL_ORIGIN) scheduleRebuild()
      }
      doc.on("update", onUpdate)

      // --- seed vs. adopt on first sync -------------------------------------
      const onSync = (isSynced: boolean) => {
        if (!isSynced || disposed) return
        if (ynodes.size === 0 && yedges.size === 0) {
          const local = getLocalGraphRef.current()
          if (local) pushLocal(local)
        } else {
          onRemoteRef.current(readGraph())
        }
      }
      provider.on("sync", onSync)
      provider.on("status", (e: { status: string }) => setConnected(e.status === "connected"))

      // --- awareness (presence + cursors) -----------------------------------
      const updateRemote = () => {
        if (disposed) return
        const states = awareness.getStates() as Map<
          number,
          {
            user?: { name: string; color: string; agent?: boolean }
            cursor?: { x: number; y: number } | null
            status?: string
          }
        >
        const list: RemoteCursor[] = []
        states.forEach((state, clientId) => {
          if (clientId === awareness.clientID) return
          const user = state.user
          if (!user) return
          list.push({
            clientId,
            name: user.name,
            color: user.color,
            cursor: state.cursor ?? null,
            agent: user.agent ?? false,
            status: state.status,
          })
        })
        setRemote(list)
      }
      awareness.on("change", updateRemote)

      cleanup = () => {
        doc.off("update", onUpdate)
        awareness.off("change", updateRemote)
        provider.off("sync", onSync)
        controlsRef.current = null
        provider.destroy()
        doc.destroy()
        setConnected(false)
        setRemote([])
      }
    })()

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [activeId, enabled])

  const pushLocal = useCallback((graph: CollabGraph) => controlsRef.current?.pushLocal(graph), [])
  const setCursor = useCallback(
    (point: { x: number; y: number } | null) => controlsRef.current?.setCursor(point),
    [],
  )
  const setSelection = useCallback(
    (nodeId: string | null) => controlsRef.current?.setSelection(nodeId),
    [],
  )

  return { connected, remote, self, pushLocal, setCursor, setSelection }
}

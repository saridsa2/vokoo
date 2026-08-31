"use client"

import type { RemoteCursor } from "@/components/stackplane/use-collab"

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  )
}

/**
 * Live cursors of other collaborators, rendered inside the transformed
 * `.board-world` layer so positions are in diagram (world) coordinates. The
 * inner content is counter-scaled by 1/zoom so the cursor stays a constant
 * on-screen size regardless of canvas zoom.
 */
export function CollabCursors({ remote, zoom }: { remote: RemoteCursor[]; zoom: number }) {
  return (
    <>
      {remote.map((r) =>
        r.cursor ? (
          <div key={r.clientId} className="collab-cursor" style={{ left: r.cursor.x, top: r.cursor.y }}>
            <div style={{ transform: `scale(${1 / zoom})`, transformOrigin: "0 0" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill={r.color} stroke="#fff" strokeWidth="1.5" aria-hidden>
                <path d="M5 2.5l13.5 6.8-5.7 1.9-2 5.9L5 2.5z" />
              </svg>
              <span className="collab-cursor-label" style={{ background: r.color }}>
                {r.name}
              </span>
            </div>
          </div>
        ) : null,
      )}
    </>
  )
}

/** Avatar stack of who's in the room (the AI agent included), with live status. */
export function CollabPresence({
  remote,
  self,
  connected,
}: {
  remote: RemoteCursor[]
  self: { name: string; color: string } | null
  connected: boolean
}) {
  if (!self) return null
  const agent = remote.find((r) => r.agent)
  const humans = remote.filter((r) => !r.agent)
  const agentBusy = agent && (agent.status === "thinking" || agent.status === "editing")

  return (
    <div className="collab-presence" data-connected={connected}>
      <span className="collab-presence-dot" aria-hidden />
      <div className="collab-avatars">
        <span className="collab-avatar" style={{ background: self.color }} title={`${self.name} (you)`}>
          {initials(self.name)}
        </span>
        {humans.map((r) => (
          <span key={r.clientId} className="collab-avatar" style={{ background: r.color }} title={r.name}>
            {initials(r.name)}
          </span>
        ))}
        {agent && (
          <span
            className="collab-avatar collab-avatar-agent"
            style={{ background: agent.color }}
            data-busy={agentBusy || undefined}
            title="Design Agent (AI)"
            aria-label="Design Agent"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="#fff" aria-hidden>
              <path d="M12 2l1.6 4.8L18 8l-4.4 1.2L12 14l-1.6-4.8L6 8l4.4-1.2L12 2zM5 14l.9 2.6L9 17l-3.1.4L5 20l-.9-2.6L1 17l3.1-.4L5 14zm14-2l.9 2.6L23 15l-3.1.4L19 18l-.9-2.6L15 15l3.1-.4L19 12z" />
            </svg>
          </span>
        )}
      </div>
      <span className="collab-presence-label">
        {agentBusy
          ? `Design Agent ${agent?.status === "editing" ? "editing" : "thinking"}…`
          : humans.length === 0
            ? agent
              ? "You + agent"
              : "Only you"
            : `${humans.length + 1} editing`}
      </span>
    </div>
  )
}

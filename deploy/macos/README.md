# Sarvathra on macOS

These launch daemons run the console, control plane, document worker, and a
restricted Supabase SSH tunnel as the
unprivileged `satyasumansaridae` account on loopback. Cloudflare Tunnel is the only
intended public ingress. The document worker deliberately starts with
compilation disabled so it cannot compete with the live VPS compiler worker
during staging.

The host layout is:

```text
~/Sarvathra/
  current -> releases/<git-sha>
  releases/<git-sha>/
  runtime/console/
  shared/controlplane.env
  shared/document-worker.env
  shared/mini-to-vps
  logs/
```

The tunnel key on the VPS must be restricted to forwarding
`127.0.0.1:8000`. The Mini then uses `http://127.0.0.1:18000` as its Supabase
URL; the service-role key never crosses the network outside the encrypted SSH
connection.

Install the plists root-owned in `/Library/LaunchDaemons`, validate them with
`plutil`, and use `sudo launchctl bootstrap system <plist>` to start each
service. A public DNS or tunnel-route change is a separate cutover after private
health checks pass.

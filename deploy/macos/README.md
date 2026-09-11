# Sarvathra on macOS

These launch daemons run Colima/Supabase, the console, control plane, document
worker, and a restricted SSH tunnel as the unprivileged `satyasumansaridae`
account on loopback. The VPS reverse proxy is the only intended public ingress.
The Mini document worker runs both indexing and compilation; the VPS worker
must remain stopped so only one consumer claims jobs.

The host layout is:

```text
~/Sarvathra/
  current -> releases/<git-sha>
  releases/<git-sha>/
  runtime/console/
  shared/controlplane.env
  shared/document-worker.env
  shared/docker-config/
  shared/mini-to-vps
  supabase/docker/
  logs/
```

The Supabase directory is copied from the pinned self-hosted deployment with
its `.env` kept outside Git. Bind the `api-gw` published port to
`127.0.0.1:8000`; do not expose PostgreSQL or the gateway on the LAN. Use
`supabase-stack.sh` for operations so the CLI always selects Colima's socket
and Sarvathra's credential-free Docker configuration.

Database migration requires two artifacts: an ownership-preserving PostgreSQL
custom-format dump and the `supabase_db-config` volume. The latter carries the
Vault/pgsodium root key; restoring database rows without it makes operator
credentials unreadable even though every table and row count appears correct.

The tunnel key on the VPS must be restricted to forwarding VPS loopback ports
`8000` (rollback Supabase) and `8080` (the media bridge). Mini application
services use local Supabase at `http://127.0.0.1:8000`; local port `18000`
retains a rollback path to VPS Supabase, while `http://127.0.0.1:18080` reaches
the co-located VPS bridge/Asterisk telephony edge. Service credentials never
cross the network outside the encrypted SSH connection.

The same restricted SSH connection exposes the Mini back to VPS loopback:
`127.0.0.1:13000` reaches the console, `127.0.0.1:18081` reaches the control
plane, and `127.0.0.1:18000` reaches the Mini Supabase gateway for public auth
verification links. The VPS reverse proxy remains the stable public ingress,
and Hostinger's existing A records do not need to change. The authorized key
must permit only those three listen addresses in addition to opening VPS ports
8000 and 8080.

Install the plists root-owned in `/Library/LaunchDaemons`, validate them with
`plutil`, and use `sudo launchctl bootstrap system <plist>` to start each
service. A public DNS or tunnel-route change is a separate cutover after private
health checks pass.

`ai.sarvathra.colima` replaces Homebrew's per-login Colima LaunchAgent. Its
boot-time supervisor keeps the existing default profile running without a user
login; Supabase containers use `restart: unless-stopped`, so they return with
the VM before the application daemons connect to `127.0.0.1:8000`.

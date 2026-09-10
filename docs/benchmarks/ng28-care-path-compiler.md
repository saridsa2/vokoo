# NG28 care-path compiler acceptance

Date: 2026-09-09
Branch: `console-and-canvas`
Document: uploaded `ng28.pdf`, Version 1 (`0f563df6-a20d-4849-a2fa-4aed2d38560a`)
Workspace: `d6e07acf-05ad-4936-a7cb-f4a9ec2f5e4c`

## Frozen inputs

- Provider: `minimax`
- Model: `MiniMax-M2`
- Compiler: `care-path-v1`
- Prompt: `care-path-prompt-v1`
- Extraction: 188 stored chunks with 1,144 layout links
- Catalogue and workspace resources: frozen in each run snapshot
- Provider credential: resolved from operator-managed Vault configuration; no compiler provider key environment variable was added

## Compiler boundary corrections

The initial MiniMax runs were unable to reliably reproduce deeply nested citation objects. The worker contract now asks the model to select only a task-scoped `chunk_id` and evidence role. The compiler hydrates the exact stored chunk text and recommendation ID before validation. Unknown chunk IDs remain a hard `evidence_out_of_scope` failure.

Select-valued fields are constrained to the frozen component catalogue in the provider-facing schema. Flattened trigger and action variants directly require their evidence field. Repeated gaps are merged by the database materialization identity `(code, recommendation_id)` while retaining distinct evidence.

## Measured runs

| Run | Result | Input tokens | Output tokens | Model duration | Steps | Drafts | Gaps |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `eb78343c-2be7-48c9-9e11-3c4c1d32bfe1` | `completed_with_gaps` | 59,174 | 10,674 | 65,229 ms | 9 | 0 | 1 |
| `c4e7b89d-1aac-48fe-9035-38912baf89a4` | repository rejection | 59,746 | 10,362 | 49,669 ms | 7 | 0 | 0 persisted |
| `8429f5b3-5198-40ea-81a8-6d6e5a99a86e` | `completed_with_gaps` | 45,662 | 4,452 | 30,298 ms | 7 | 0 | 1 |
| `5ea3cfad-27ac-4c1a-985c-4a494f95f80c` | `cancelled` | 0 | 0 | 0 ms | 0 | 0 | 0 |

The two completed runs produced the blocking gap `missing_failure_policy`. The selected NICE recommendation defined clinical work but did not define an operational destination for request failure. The compiler therefore did not materialize an unsafe flow.

Run `c4e7b89d-1aac-48fe-9035-38912baf89a4` lowered and validated five flows with two threshold gaps. PostgreSQL rejected materialization because both gaps shared the same unique identity. A transaction-only replay identified the exact unique-constraint failure and rolled back. The compiler now merges those gaps; the regression test passes. A later stochastic NG28 run did not select the same five-flow slice, so non-zero artifact materialization remains unverified live.

## Verification

- Document workspace tests: 12 passed.
- Server tests: 12 passed.
- Compiler core tests: 5 passed.
- Compiler harness tests: 9 passed.
- Compiler worker tests: 6 passed.
- Document worker tests: 9 passed.
- Local and VPS release worker builds: passed with pre-existing warnings.
- Cancellation: queued run became `cancelled` with zero artifacts while the worker was stopped; the worker was restarted immediately.
- VPS services: `vokoo-cp-api`, `vokoo-document-worker`, and `vokoo-console` active.
- Health: API 200, console `/files` 200, worker healthy with `compiler_enabled: true` and one process.
- Migrations and transactional SQL tests through `0130`: passed before compiler enablement.
- Backup: `/opt/vokoo/backups/compiler-pre-0130-20260908.dump` exists and its archive was verified before migration.

## Open acceptance items

- No NG28 run has yet materialized a non-zero draft flow or agent. Current successful runs stop on the source-grounded `missing_failure_policy` safety gap.
- Non-zero artifact idempotency replay is therefore not yet verifiable.
- Signed-in browser review, artifact navigation, and PDF-coordinate highlighting were not run because no controllable signed-in browser session was available.
- Root `tsc --noEmit` and `npm run build:deploy` are currently blocked by an unrelated untracked `patient-app/` tree being included in the root TypeScript project. The document workspace test suite itself passes.

The next product decision is how a reviewer supplies a workspace-approved operational failure policy. It should not be invented from the NICE source by the compiler.

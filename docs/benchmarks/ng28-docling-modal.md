# NG28 Docling Modal benchmark

**Date:** 2026-09-08

**Document:** NICE NG28, 131 pages, non-live test data

**Docling:** 1.37.0
**Modal image:** `ghcr.io/docling-project/docling-rs@sha256:54306282a126ded59707f0854e0b7da51c8d2fd779f0a9354202188ddfab2e25`

## Result

The Hostinger VPS was the extraction bottleneck. Its two-core, one-container-per-document
run spent 168,052 ms in extraction. The same immutable source completed extraction in
23,677 ms on a Modal function with 16 reserved CPU cores, a 7.1x improvement.

| Stage | VPS baseline | Modal |
| --- | ---: | ---: |
| Docling extraction | 168,052 ms | 23,677 ms |
| Chunking | 3 ms | 3 ms |
| Workspace Intelligence classification | 14,789 ms | 15,736 ms |
| Complete worker run | not reliably reset in the first run | 40,336 ms |

The Modal run completed on its first accepted attempt, persisted 188 chunks, retained
Docling provider version 1.37.0, and stored a 235,527-byte raw artifact. Existing
embeddings were reused, so this run does not measure embedding latency.

## Provider validation

- An authenticated two-page fixture returned HTTP 200 and a 2,106-byte Docling JSON artifact.
- The worker verified the request SHA-256, response SHA-256, Docling version, content type,
  HTTPS endpoint, timeout, and bounded response size before normalizing the artifact.
- The Modal bearer token is held as the platform-level `modal` credential in Supabase Vault
  and is resolved only through the existing service-role RPC. It is not stored in the VPS
  environment, systemd unit, browser, or repository.
- The function scales to zero and retains an idle container for up to five minutes to reduce
  repeated image cold starts without keeping compute permanently warm.

## CUDA finding

The official Docling.rs 1.37.0 CUDA CLI and server images were tested first. Both expose
ONNX provider-library symlinks whose cache targets are absent when Modal imports the image;
even the harmless two-page fixture failed before inference. The pinned CPU image therefore
remains the accepted Modal runtime. GPU execution should be enabled only after a new immutable
upstream CUDA artifact passes the fixture and NG28 acceptance corpus.

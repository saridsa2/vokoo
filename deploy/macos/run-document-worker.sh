#!/bin/zsh
set -euo pipefail

SARVATHRA_ROOT="${SARVATHRA_ROOT:-/Users/satyasumansaridae/Sarvathra}"

set -a
source "$SARVATHRA_ROOT/shared/document-worker.env"
set +a

# Keep the Mini consumer passive until the VPS compiler worker is stopped as
# part of a separately reviewed cutover.
export VOKOO_COMPILER_ENABLED=false
export VOKOO_DOCUMENT_EXTRACTION_PROVIDER=docling-modal
export VOKOO_DOCLING_VERSION=1.37.0
export VOKOO_DOCLING_TIMEOUT_SECONDS=600
export VOKOO_DOCLING_MAX_OUTPUT_BYTES=67108864

cd "$SARVATHRA_ROOT/current/bridge"
exec "$SARVATHRA_ROOT/current/bridge/target/release/vokoo_document_worker"

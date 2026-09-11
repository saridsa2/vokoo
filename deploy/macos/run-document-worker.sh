#!/bin/zsh
set -euo pipefail

SARVATHRA_ROOT="${SARVATHRA_ROOT:-/Users/satyasumansaridae/Sarvathra}"

set -a
source "$SARVATHRA_ROOT/shared/document-worker.env"
set +a

# The Mini is the production document and compiler worker. Only one host may
# run this consumer at a time; the VPS unit is stopped during cutover.
export VOKOO_COMPILER_ENABLED=true
export VOKOO_DOCUMENT_EXTRACTION_PROVIDER=docling-modal
export VOKOO_DOCLING_VERSION=1.37.0
export VOKOO_DOCLING_TIMEOUT_SECONDS=600
export VOKOO_DOCLING_MAX_OUTPUT_BYTES=67108864

cd "$SARVATHRA_ROOT/current/bridge"
exec "$SARVATHRA_ROOT/current/bridge/target/release/vokoo_document_worker"

import os
import pathlib
import secrets
import subprocess
import tempfile

import modal

from modal_contract import safe_diagnostic, verify_source


APP_NAME = "vokoo-document-extractor"
DOCLING_VERSION = "1.37.0"
DOCLING_IMAGE = (
    "ghcr.io/docling-project/docling-rs@"
    "sha256:54306282a126ded59707f0854e0b7da51c8d2fd779f0a9354202188ddfab2e25"
)
MAX_SOURCE_BYTES = 64 * 1024 * 1024
MAX_ARTIFACT_BYTES = 64 * 1024 * 1024

image = (
    modal.Image.from_registry(DOCLING_IMAGE, add_python="3.12")
    .entrypoint([])
    .uv_pip_install("fastapi[standard]==0.116.1")
    .env({"DOCLING_RS_EP": "cpu"})
    .add_local_file(
        pathlib.Path(__file__).with_name("modal_contract.py"),
        "/root/modal_contract.py",
        copy=True,
    )
)
app = modal.App(APP_NAME)


@app.function(
    image=image,
    cpu=16,
    memory=16384,
    timeout=600,
    scaledown_window=300,
    max_containers=4,
    secrets=[modal.Secret.from_name("vokoo-document-extractor-auth")],
)
@modal.asgi_app()
def extractor_api():
    from fastapi import FastAPI, Header, HTTPException, Request, status
    from fastapi.responses import Response

    web = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @web.post("/extract")
    async def extract(
        request: Request,
        authorization: str | None = Header(default=None),
        x_vokoo_source_sha256: str | None = Header(default=None),
    ):
        expected_token = os.environ["AUTH_TOKEN"]
        supplied_token = authorization.removeprefix("Bearer ") if authorization else ""
        if not secrets.compare_digest(supplied_token, expected_token):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="unauthorized",
            )
        if request.headers.get("content-type") != "application/pdf":
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="only application/pdf is supported",
            )
        payload = await request.body()
        try:
            source_sha256 = verify_source(
                payload,
                x_vokoo_source_sha256 or "",
                MAX_SOURCE_BYTES,
            )
        except ValueError as problem:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(problem),
            ) from problem

        with tempfile.TemporaryDirectory(prefix="vokoo-docling-") as directory:
            source_path = pathlib.Path(directory) / "source.pdf"
            artifact_path = pathlib.Path(directory) / "artifact.json"
            stderr_path = pathlib.Path(directory) / "stderr.log"
            source_path.write_bytes(payload)
            with artifact_path.open("wb") as artifact_file, stderr_path.open("wb") as stderr_file:
                try:
                    result = subprocess.run(
                        [
                            "docling-rs",
                            "--to",
                            "json",
                            "--heading-hierarchy",
                            "--skip-ocr",
                            str(source_path),
                        ],
                        stdin=subprocess.DEVNULL,
                        stdout=artifact_file,
                        stderr=stderr_file,
                        cwd="/usr/local/lib",
                        timeout=540,
                        check=False,
                    )
                except subprocess.TimeoutExpired as problem:
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="Docling timed out",
                        headers={"Retry-After": "30"},
                    ) from problem
            if result.returncode != 0:
                diagnostic = safe_diagnostic(
                    stderr_path.read_bytes()[:8192].decode("utf-8", errors="replace"),
                    directory,
                )
                print(f"docling-rs exited {result.returncode}: {diagnostic}", flush=True)
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Docling rejected the PDF",
                )
            if artifact_path.stat().st_size > MAX_ARTIFACT_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail="Docling artifact exceeded its size limit",
                )
            artifact = artifact_path.read_bytes()

        return Response(
            content=artifact,
            media_type="application/json",
            headers={
                "X-Vokoo-Source-Sha256": source_sha256,
                "X-Vokoo-Docling-Version": DOCLING_VERSION,
            },
        )

    return web

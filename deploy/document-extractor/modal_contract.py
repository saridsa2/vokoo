import hashlib


def verify_source(payload: bytes, claimed_sha256: str, max_bytes: int) -> str:
    if len(payload) > max_bytes:
        raise ValueError("the PDF exceeds the source size limit")
    actual_sha256 = hashlib.sha256(payload).hexdigest()
    if actual_sha256 != claimed_sha256:
        raise ValueError("the PDF does not match its claimed SHA-256")
    return actual_sha256


def safe_diagnostic(stderr: str, staging_directory: str, max_bytes: int = 2048) -> str:
    redacted = stderr.replace(staging_directory, "[staged]")
    printable = "".join(
        character
        for character in redacted
        if character in "\n\r\t" or character.isprintable()
    )
    return printable.encode("utf-8")[:max_bytes].decode("utf-8", errors="ignore")

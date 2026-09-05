#!/usr/bin/env python3
"""Validate all examples against their module schemas."""
from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    from jsonschema import Draft202012Validator
    from referencing import Registry, Resource
except ImportError:  # pragma: no cover - env dependent
    print("jsonschema is required. Install with: pip install jsonschema", file=sys.stderr)
    sys.exit(2)


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def validate_schema_examples(
    schema_path: Path,
    examples_dir: Path,
    registry: Registry,
) -> list[str]:
    schema = load_json(schema_path)
    validator = Draft202012Validator(schema, registry=registry)

    errors: list[str] = []
    for example_path in sorted(examples_dir.glob("*.json")):
        instance = load_json(example_path)
        for error in sorted(validator.iter_errors(instance), key=str):
            location = "/".join(str(part) for part in error.path)
            errors.append(
                f"{schema_path} -> {example_path} :: {location or '$'} :: {error.message}"
            )
    return errors


def main() -> int:
    base_dir = Path(__file__).resolve().parents[1]
    schema_root = base_dir / "schemas"

    # Register every owned schema by its canonical URN. This keeps validation
    # offline and lets local fragment references resolve against a schema's
    # own $id instead of falling through to a network resolver.
    resources: list[tuple[str, Resource]] = []
    schema_paths = [schema_root / "_common" / "defs.json"]
    schema_paths.extend(sorted(schema_root.glob("*/schema/*.json")))
    for schema_path in schema_paths:
        if not schema_path.exists():
            continue
        schema = load_json(schema_path)
        schema_id = schema.get("$id", schema_path.resolve().as_uri())
        resources.append((schema_id, Resource.from_contents(schema)))
    registry = Registry().with_resources(resources)

    all_errors: list[str] = []
    for module in sorted(schema_root.iterdir()):
        if not module.is_dir() or module.name.startswith("_"):
            continue
        schema_dir = module / "schema"
        examples_dir = module / "examples"
        if not schema_dir.exists() or not examples_dir.exists():
            continue
        for schema_path in sorted(schema_dir.glob("*.json")):
            all_errors.extend(validate_schema_examples(schema_path, examples_dir, registry))

    if all_errors:
        print("Validation errors:\n" + "\n".join(all_errors), file=sys.stderr)
        return 1

    print("All examples validated successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

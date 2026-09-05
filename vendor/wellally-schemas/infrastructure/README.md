# WellAll Infrastructure Modules

[![中文](https://img.shields.io/badge/Language-中文-red)](README.zh.md)

This directory aggregates every Layer-1 (infra) submodule and defines shared guardrails for schema evolution.

## Submodules
- `schemas/health` — master personal health schema (top-level resources and core types).
- `schemas/lab-report` — lab/biochemistry report schema.
- `schemas/imaging-report` — structured imaging report schema (CT/ultrasound/MRI/X-ray/PET-CT).
- `schemas/medication` — medication records and regimens.
- `schemas/family-health` — family relationship tree and health history.
- `specs/health-json-spec` — JSON format and naming spec whitepaper.

## Conventions
- Apache 2.0 license across all submodules.
- Naming, data types, and validation rules defer to `specs/health-json-spec` as the top contract.
- Each schema should ship `schema/*.json`, `examples/*.json`, and a `CHANGELOG.md` as it matures.

## Suggested Next Steps
- Validate examples: `python infrastructure/scripts/validate_examples.py`.
- Enrich `_common/defs.json` with common code sets (LOINC/SNOMED/RxNorm/UCUM) and expand `examples/` coverage.
- Keep `CHANGELOG.md` per module to document compatibility and breaking changes cadence.

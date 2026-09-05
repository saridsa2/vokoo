# WellAll FHIR Lite

[![中文](https://img.shields.io/badge/Language-中文-red)](README.zh.md)

L2 utility that provides a lightweight mapping from HL7 FHIR resources into WellAll’s canonical schemas.

## Capabilities
- Parse common FHIR resources.
- Map fields into WellAll schema shapes.
- Transform formats and normalize codes where possible.
- Run validation checks on output payloads.

## Supported Resources (Initial)
- `Patient`
- `Observation`
- `Medication`
- `DiagnosticReport`

## Use Cases
- Integrating FHIR-based EHR exports into WellAll schemas with minimal overhead.
- Bridging third-party FHIR APIs to internal data lakes.
- Rapid proof-of-concept mappings before committing to full ETL builds.

## Status
Planned.

## Contributing
Issues/PRs welcome.

## License
Apache 2.0.

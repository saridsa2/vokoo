# WellAll 基础设施子模块

[![English](https://img.shields.io/badge/Language-English-blue)](README.md)

此目录聚合全部 L1 基础设施子模块，并约定 Schema 演进的共性规则。

## 子模块
- `schemas/health` — 个人健康数据总 Schema（顶层资源与基础类型）。
- `schemas/lab-report` — 生化/检验报告 Schema。
- `schemas/imaging-report` — 影像报告结构化 Schema（CT/超声/MRI/X 光/PET-CT）。
- `schemas/medication` — 药物记录与用药方案。
- `schemas/family-health` — 家庭关系树与家族健康史。
- `specs/health-json-spec` — JSON 格式与命名规范白皮书。

## 约定
- 全部子模块使用 Apache 2.0 许可证。
- 命名、数据类型与验证规则以 `specs/health-json-spec` 为最高约束。
- 随着成熟度提升，建议补齐 `schema/*.json`、`examples/*.json` 与 `CHANGELOG.md`。

## 下一步建议
- 运行示例校验：`python infrastructure/scripts/validate_examples.py`。
- 扩充 `_common/defs.json` 的常用代码集（LOINC/SNOMED/RxNorm/UCUM），并同步丰富 `examples/`。
- 为各模块维护 `CHANGELOG.md`，记录兼容性策略与节奏。

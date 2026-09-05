# Archive 存档区

[![English](https://img.shields.io/badge/Language-English-blue)](README.md)

此处存放历史的 L2/L3/L4/L5 工具、AI 辅助项目及合规模型，暂未纳入当前 L1 契约。需要时可按需迁移或拆分为独立仓库供参考与复用。

## 项目一览与应用场景
- **wellally-lab-parser** — OCR 化验单 → 结构化 JSON；实验室数据入仓前处理。
- **wellally-healthkit-mapper** — HealthKit → WellAll 映射；C 端/BYOD 数据同步。
- **wellally-pdf-medical-parser** — 医疗 PDF 结构化；历史文档迁移。
- **wellally-medical-timeline** — 医疗事件时间线；患者/医护纵向视图。
- **wellally-unit-normalizer** — 医疗单位归一化；分析前标准化。
- **wellally-anomaly-flagger** — 数据质量异常检测；ETL 质量闸口与监控。
- **wellally-trend-detector** — 非诊断趋势分析；健康监测与看板。
- **wellally-data-correlation** — 指标与行为相关性探索；生成研究假设。
- **wellally-report-structurer-ai** — 非结构化文本字段抽取；登记/报送自动化。
- **wellally-fhir-lite** — FHIR → WellAll 轻量映射；FHIR API PoC 对接。
- **wellally-consent-model** — 授权生命周期模型；细粒度数据治理。
- **wellally-health-audit-log** — 访问审计与防篡改日志；合规取证。
- **wellally-health-data-anonymizer** — 数据脱敏与匿名化；隐私安全共享。
- **wellally-radiation-dose-calc** — CT 辐射累计计算；安全阈值跟踪。

## 复用建议
- 将其视为参考实现，生产前需加固、补测试并版本化。
- 拆分/迁移时对齐当前 L1 规范的字段与校验规则。
- 同步更新许可证与依赖基线，确保合规与安全。

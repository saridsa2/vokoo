# WellAll FHIR Lite

[![English](https://img.shields.io/badge/Language-English-blue)](README.md)

L2 工具，为 HL7 FHIR 资源到 WellAll 标准 Schema 提供轻量映射。

## 功能
- 解析常见 FHIR 资源。
- 将字段映射为 WellAll 规范结构。
- 尽可能进行格式转换与编码规范化。
- 对输出负载执行校验。

## 初始支持的资源
- `Patient`
- `Observation`
- `Medication`
- `DiagnosticReport`

## 应用场景
- 将基于 FHIR 的 EHR 导出快速映射到 WellAll Schema。
- 连接第三方 FHIR API 与内部数据湖/仓。
- 在完整 ETL 搭建前的快速 PoC 映射验证。

## 状态
规划中。

## 贡献
欢迎提交 Issue / PR。

## 许可证
Apache 2.0。

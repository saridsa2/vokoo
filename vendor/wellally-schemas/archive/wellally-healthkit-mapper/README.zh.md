# WellAll HealthKit 映射器

[![English](https://img.shields.io/badge/Language-English-blue)](README.md)

L2 工具，将 Apple Health（HealthKit）数据映射为 WellAll 的标准 Schema。

## 功能
- 读取 HealthKit 数据与元数据。
- 将 HealthKit 类型映射到 WellAll 字段。
- 单位与时间戳标准化。
- 支持增量同步与历史回填。

## 覆盖示例
- 生命体征与测量
- 运动与活动
- 睡眠
- 营养（若可用）

## 应用场景
- C 端应用将 HealthKit 数据同步到统一健康数据湖。
- 患者导出自有数据用于就诊前填报/导入。
- 研究项目收集 BYOD（自带设备）数据流。

## 状态
规划中。

## 贡献
欢迎提交 Issue / PR。

## 许可证
Apache 2.0。

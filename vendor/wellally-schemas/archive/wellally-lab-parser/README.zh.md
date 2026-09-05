# WellAll 化验单解析器

[![English](https://img.shields.io/badge/Language-English-blue)](README.md)

L2 工具，将 OCR 后的化验单文本解析为结构化 JSON。

## 功能
- 解析化验报告文本，提取指标。
- 数值与单位标准化。
- 参考区间异常标记。
- 输出符合 WellAll 实验室 Schema 的 JSON。

## 应用场景
- 医院 OCR 流水线，将扫描化验单转为结构化数据。
- 体检中心批量数字化历史 PDF/图片报告。
- 作为入仓前的预处理步骤，对接 L1 lab-report Schema 进行分析。

## 输入
- 化验报告
- 体检报告
- 检验结果单
- 原始 OCR 文本

## 状态
规划中。

## 贡献
欢迎提交 Issue / PR。

## 许可证
Apache 2.0。

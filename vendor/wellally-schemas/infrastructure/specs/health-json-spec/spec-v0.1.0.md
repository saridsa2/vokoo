# Health JSON Spec v0.1.0

本规范用于统一 WellAll L1 基础设施的字段命名、格式校验与编码体系。

## 版本
- 当前版本：v0.1.0
- 兼容性原则：
  - 新增字段 → 向后兼容
  - 修改字段语义/类型 → 需提升主版本

## 字段命名
- 使用 **lowerCamelCase**。
- 数组字段使用复数形式（例如 `results`, `members`）。
- 时间相关字段使用后缀：`At`（时间戳）、`Date`（日期）。

## 时间与日期格式
- `date`: ISO 8601 日期，例如 `2024-12-01`
- `date-time`: ISO 8601 时间戳，例如 `2024-12-01T08:30:00Z`

## 标识与引用
- 所有资源需具备 `id`（字符串，建议 UUID/ULID）。
- 跨资源引用统一用 `xxxId` 字段（例如 `patientId`）。

## 代码体系
- **SNOMED CT**：疾病、解剖部位、给药途径
- **LOINC**：检验指标代码
- **RxNorm**：药物编码
- **UCUM**：单位规范

## 通用结构（建议）
- `Coding`: { system, code, display }
- `CodeableConcept`: { coding[], text }
- `Quantity`: { value, unit }

## 校验规则（最小集合）
- 必填字段必须存在且非空
- `code`/`system` 组合必须同时出现
- `unit` 必须为 UCUM 合法单位：
  - 默认：允许 UCUM 样式字符串（无空格）+ 常用单位子集
  - 严格：仅允许常用单位子集（见 `UCUMUnitStrict`）

## 共享枚举
- 影像模式（Modality）：`CT`, `MR`, `US`, `XR`, `PT`
- 给药途径（Route）：常用缩写 + SNOMED CT 途径代码子集（口服/静脉/肌注/皮下/吸入/舌下/直肠）
- 常用标本类型：`BLD`, `SER`, `PLAS`, `UR`
- UCUM 常用单位子集：`mg`, `g`, `g/dL`, `mg/dL`, `mg/L`, `mmol/L`, `nmol/L`, `umol/L`, `pmol/L`, `%`, `U/L`, `U/mL`, `IU/L`, `IU/mL`, `kU/L`, `mIU/L`, `mIU/mL`, `uIU/mL`, `pg/mL`, `ng/mL`, `ng/dL`, `ug/dL`, `mmol/mol`, `mmHg`, `mEq/L`, `mm/h`, `10*3/uL`, `10*6/uL`, `10*9/L`, `10*12/L`, `cells/uL`, `mL`, `uL`, `L`, `kat/L` 等
- 常用 LOINC 检验子集：CBC（Hb、WBC、血小板）、葡萄糖（质量/摩尔）、血脂（总/HDL/LDL/甘油三酯）、肝功能（ALT/AST/总胆红素/白蛋白/ALP）、肾功能（BUN/肌酐）、电解质（钠/钾）、甲状腺（TSH/FT4/FT3/TPOAb/TgAb）、炎症免疫（CRP/hsCRP/ESR/IgE/ANA pattern/补体 C3/C4/CH50-AH50）、抗 dsDNA（多方法学编码）、内分泌（胰岛素/皮质醇/催乳素/睾酮/雌二醇/LH/FSH/维生素D）、肿瘤标志物（PSA/CEA/AFP/CA125/CA19-9/CA15-3/β-hCG/NSE/CYFRA21-1/β2-MG）
- 常用 RxNorm 用药子集：atorvastatin 20mg、metformin 500mg 缓释、lisinopril 10mg、amoxicillin 500mg 胶囊
- 常用 SNOMED 部位子集：胸部、心血管系统、肝脏、肾脏、大脑
- ANA pattern SNOMED 编码子集：speckled、homogeneous（其余模式建议用 LOINC/ICAP 编码）

# 可导入题库与课程

本目录放可直接导入知习的 JSON 文件。题库（QBank 1.0）从「我的题库」导入，课程（LearnPack 1.0）从「学习」页导入。

## Verilog 时序逻辑 200 题

`Verilog时序逻辑200题.qbank.json` 是完整 QBank 1.0 题库：20 个专题，共 100 单选、40 多选、40 判断和 20 道 RTL 编程题。

在知习「我的题库」中导入此 JSON。代码模板、参考解和 testbench 均内联，无需额外附件。

RTL 使用 `iverilog-verilog-1` 环境，需要 Icarus Verilog 的 `iverilog` 和 `vvp`，语言标准为 Verilog-2005。该题库曾通过 Icarus 13.0 的 20 个参考解、2232 个检查点及 20 个针对性错误实现检查；这不表示覆盖所有可能实现或物理时序。

## SystemVerilog 系统学习（课程）与精读 100 题

两份文件内容同源，按需要选一个导入：

| 文件 | 格式 | 导入入口 |
| --- | --- | --- |
| `systemverilog-course.json` | LearnPack 1.0，13 章讲义 + 内嵌题库 | 「学习」→ 导入学习包 |
| `systemverilog-qbank.json` | QBank 1.0，100 题 | 「我的题库」→ 导入 |

课程 13 章：版本与工具链、数据类型与四值语义、字面量与类型转换、定长数组、动态/队列/关联数组、struct 与 package、`always_comb`/`always_ff`、interface 与 clocking、task/function/ref、类与多态、约束随机、SVA、功能覆盖率。每章含学习目标、原理、例子、常见误区、理解检查，末尾附本章题号，导入后可从章节直接跳到练习。

题库 100 题全部是单选（54）、多选（20）、判断（26），难度 1–5 分布为 8/22/38/24/8（锥形，中间难度为主）。**没有代码题**：知习当前唯一可用的 HDL 环境是 `iverilog-verilog-1`（Verilog-2005，`-g2005`），无法评测 SystemVerilog 语法，出 RTL 题会看得见却判不了。

两份文件都通过 `skills/qbank-generator/scripts/validate_qbank.cjs`（`valid: true`，0 error / 0 warning），课程另用真实导入链路（Store + QBankValidator + learning 插件）验证过：13 章 100 条题目引用全部解析。技术内容经 ModelSim 与 Icarus 实测复核，修订了字面量符号规则、移位、队列与关联数组语义、`new` 表达式、真空成功与覆盖率命中次数等问题。

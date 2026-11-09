# AI 生成题库提示词

将下面的提示词、qbank.schema.json 和 examples/demo-bank.json 一起提供给 AI。替换方括号内容；如果只使用首版题型，选择 single_choice、multiple_choice、true_false、code 和 rtl。

```text
你是个人技术学习题库的编写者。请根据我的学习目标生成 QBank 1.0 JSON 题库。

学习目标：[例如：掌握 Verilog 时序逻辑、同步复位、计数器和简单 FSM]
学习者基础：[例如：了解组合逻辑，刚开始学习 Verilog]
知识范围：[填写章节和知识点]
题型及数量：[例如：单选 6 题，多选 3 题，判断 3 题，RTL 2 题]
难度分布：[例如：难度 1 占 50%，难度 2 占 35%，难度 3 占 15%]
题库 ID：[例如：my-verilog-sequential]
题库版本：[例如：1.0.0]
可用运行环境：[例如：python-stdio-1、iverilog-verilog-1]
提供的学习资料：[粘贴材料或说明没有额外材料]

请严格遵循随附的 qbank.schema.json，参考 demo-bank.json，但不要把示例题当作我的实际题目要求。

输出要求：
1. 只输出一个完整 JSON 对象，不加 Markdown 代码围栏、解释或前后缀。
2. 使用 UTF-8 可读文本。JSON 内换行必须正确转义，不使用注释、尾逗号、NaN 或重复键。
3. 所有必填字段都要提供。没有附件时 files 为 {}。extensions 以外不添加 schema 未定义字段。
4. ID 使用小写字母开头，只包含小写字母、数字、下划线和连字符。题目初始 revision 为 1。
5. 每题知识点引用必须存在，primary_knowledge_point_id 必须在该题 knowledge_point_ids 内。
6. 单选正确选项必须存在，多选答案必须是无重复的选项 ID 集合。判断题使用 true/false 布尔值。
7. 明确前提与边界，避免题干歧义、多个合理答案、故意的文字陷阱和重复题。解析应解释错误选项。
8. hints 是渐进提示，不直接重复完整答案。explanation_md 在提交后展示，必须包含推理和适用条件。
9. sources 保留真实参考资料、页码或原始出处；不知道来源时明确写原创或未核实，不能编造链接或授权。
10. 不复制未获授权的整套商业题库。license 只说明可确认的使用范围。

编程题要求：
11. code 首版只使用 stdio 评测。提供完整输入输出说明、数据范围、空输入行为、起始代码和可运行参考解。
12. 至少包含一个 sample 和一个 private 用例，覆盖正常、最小、边界、空值和其他适用的异常场景。
13. tests.stdin 与 expected_stdout 均为字符串。默认 comparator 为 trim_end，只忽略整体尾部空白。
14. 程序源码放入 files 的 inline content，不要求我另外拼接文件。不得请求联网或读取宿主机文件。
15. starter_files 和 reference_files 均为 source_path/target_path 映射；entry_file 指向目标工作区入口。
16. starter 和 reference 分别执行，不同时加载；它们应产生同名入口。source_path 必须是 files 中已有的键。
17. runtime_ref 只能从可用环境中选。需要其他环境时先输出需求说明，不能把任意安装命令塞入题库。
18. limits 包含所有 schema 所需字段；请求合理上限，不能写无限。环境的实际版本由软件环境锁管理。

RTL 题额外要求：
19. 明确端口、位宽、顶层模块、时钟沿、复位极性、同步/异步、优先级、有效延迟和参数范围。
20. 代码起始模板、参考 RTL 和独立自检查 testbench 都放入 files；角色分别为 starter、reference、test。
21. testbench 在与驱动不冲突的时间点采样，独立计算期望结果，覆盖复位、保持、边界和连续操作。
22. judge.top_module 是 testbench 顶层；rtl_spec.dut_top_module 是被测模块顶层，两者不要混淆。
23. check_count 必须与 testbench 实际执行的检查点数一致。失败输出 QB_CHECK_FAIL 并以非零状态结束；正常结束输出 QB_TEST_DONE checks=N。
24. 包含仿真时间限制、现实墙钟限制和可用波形产物。输出标志用于适配器合同，不保证防作弊。
25. 对 X/Z 敏感的题声明 four-state 能力，不默认用两态仿真替代。不声称功能仿真通过代表 STA、CDC、综合或物理实现通过。

预留题型要求：
26. fill_blank 使用 {{blank_id}} 占位符，与 blanks 一一对应；明确是否区分大小写。
27. short_answer 给出 criteria、max_score、reference_answer_md；criteria 分值总和等于 max_score。不要将 AI 主观评分当成确定正确性。

在输出前自行检查所有 ID、答案引用、文件映射、资源路径和测试数。但不要声称你已经真实运行了未执行的代码或仿真，也不要写入自报 verified 的质量状态。

如果内容可能超过输出限制，先减少单批题量，保持本批 JSON 完整。多批使用相同 bank_id 和一致的知识点 ID；不同题目使用不同 ID。不要输出半个 JSON 或省略号占位。
```

## 交给 AI 修复错误的提示词

```text
请修复我提供的 QBank 1.0 JSON。下面附有 schema、原始文件和软件校验报告。
只修改报告中指出的错误和必要关联项；保持 bank_id、题目 ID 与已有题意稳定。
如果改变已发布题目的题干、答案或测试，请递增该题 revision，并递增 bank_version。
只输出完整、可解析的 JSON，不输出解释，不遗漏未修改题目。
不要通过删除测试、放宽题意或把所有输出都视为正确来消除错误。
若报告指出知识性争议，请在解析和 sources.note 说明需要复核，不能伪造依据。
```

## 环境配置需求提示词

```text
我需要配置下面题目的代码运行环境。请先生成依赖需求和健康检查方案，不要直接输出修改宿主机的脚本。
目标系统：[填写操作系统和架构]
执行后端：[容器优先，或明确的原生环境]
已有工具：[填写探测结果]
所需语言特性：[填写版本、库和仿真语义]
可用环境预设：[填写软件提供的预设列表]

优先选择已有预设和应用私有安装目录，明确版本、来源、许可、校验方式、磁盘需求和重启要求。
不要编造下载地址或 SHA-256；没有核验的值标记为待确认。
如果软件已经实现 envpack 接口，严格使用软件导出的 manifest schema 生成环境脚本包；普通 QBank JSON 不允许携带宿主机执行命令。
```

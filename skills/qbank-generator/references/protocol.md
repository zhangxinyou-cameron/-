# QBank 1.0 协议约定

以同目录 qbank.schema.json 为结构依据。本说明补充 schema 不能直接表达的语义与知习的导入行为，不代替 schema。

## 外层对象

必填字段为 schema_version、bank_id、bank_version、title、description、locale、authors、license、knowledge_points、questions、files。schema_version 固定 "1.0"；bank_version 使用 x.y.z 数字版本。

bank_id、题目 ID、知识点 ID、选项 ID、测试 ID 等遵循小写字母开头，仅小写字母、数字、下划线、连字符，长度不超过 96。ID 用于稳定引用，不应因标题润色而改变。

没有附件时 files 为 {}。只有明确的 extensions 对象允许自由扩展；不能在普通对象中添加 schema 未声明字段，如 verified、quality、language、answer_text 等。

## 题目共同字段

每题包含 id、revision、type、title、domain、knowledge_point_ids、primary_knowledge_point_id、difficulty、estimated_minutes、stem_md、explanation_md、hints、sources。

- revision 为正整数，新题从 1 开始。
- difficulty 为 1–5 整数；estimated_minutes 为正整数。
- domain 可用 digital_ic、programming、computer_architecture、embedded 或明确的新领域 ID。
- 知识点对象为 id、name，可选 parent_id；引用必须存在，不允许形成循环。
- 主知识点必须属于本题 knowledge_point_ids。
- hints 无提示时填 []；sources 至少一条，包含 title、locator、note。locator 可是实际网址、教材页码或明确的原创说明。
- Markdown 中不嵌入可执行 HTML；图片优先使用题库包内资源。

## 题型记录

| type | 专有内容 |
| --- | --- |
| single_choice | answer.options 至少两项，每项 id、text_md；answer.correct_option_id 指向其中一项 |
| multiple_choice | answer.options；answer.correct_option_ids 是非空、无重复的选项 ID 集合 |
| true_false | answer.correct 必须为 JSON 布尔值，不用字符串 "false" |
| code | execution；不放静态 answer，执行合同见 runtime-profiles.md |
| rtl | execution，包含 rtl_spec 与 hdl_testbench 评测配置 |
| fill_blank | answer.blanks：id、accepted_answers、case_sensitive；stem_md 的 {{blank_id}} 与各空一一对应 |
| short_answer | rubric.max_score、criteria、reference_answer_md；criteria 中 id、description、points，总分等于 max_score |

单选按 ID 相等，多选按集合完全相等判分，不依赖选项显示序号。判断 false 是合法已答值，不能与未作答混淆。填空与简答虽有协议，当前软件未实现自动评分。

## 文件与映射

files 的键是逻辑相对路径，记录二选一：

```json
{"kind":"inline","role":"starter","content":"完整的源码文本\n"}
```

```json
{"kind":"asset","role":"asset","package_path":"assets/circuit.png","sha256":"实际文件的64位小写SHA256"}
```

第二段只说明字段，摘要占位说明不能直接用于最终题库。role 为 starter、reference、test 或 asset。文本源码优先内联；二进制附件使用 asset 记录，实际摘要由本地文件计算。

starter_files、reference_files、testbench_files 均是映射数组，每项为 {source_path, target_path}。source_path 指 files 的键，target_path 指运行任务工作区路径。

用户代码执行加载 starter 映射，参考解检查加载 reference 映射，两者分别执行；entry_file 必须出现在两组映射的目标路径中。RTL 在两种执行中都加载 testbench 映射，不能与正在加载的代码目标路径冲突。例：starter/main.py 与 reference/main.py 分别映射到同一入口 main.py，这是合法的。

路径只用 /，拒绝绝对路径、盘符、反斜杠、空段、. 和 .. 段、Windows 设备名和尾部空格/点。逻辑文件名、每次实际加载的目标路径都要检查大小写及 Unicode 规范化碰撞。

.qbank.zip 必须在根目录放 bank.json，附件均在包内，禁止符号链接和重复 ZIP 路径。内联 JSON 不需要额外目录。生成给知习初版的图片优先 PNG/JPEG，远程图片和 SVG 不作为可正常显示的保证。

## 增量更新与修复

题目稳定身份是 bank_id + question.id，作答记录绑定 revision。

- 未发布草稿的格式修复可保持初始版本；不要无意义地每修一个逗号就升版。
- 已发布题目任何业务字段或引用文件的内容改变，都递增 revision，包括标题、解析、提示和来源。软件比较的是完整题目内容与引用文件快照，不限于答案变化。
- 同身份、同 revision、相同内容可以重复导入；同 revision、不同内容会冲突。
- 更新题库名称等元数据不必改每题 revision，但应提高 bank_version。
- 同名文件若被多道现行题引用，修改时要更新所有受影响题的版本，或者换用新 source_path。当前实现会把公共 asset 附件纳入题目文件快照。
- 未在新批次出现的旧题不会自动删除。修复完整文件时保留无关题目；定向增量可以只交付变化题，但明确其为增量。
- 不在题库中携带笔记、收藏、学习记录或安装命令。

校验器的 --previous 适用于与已发布版本比较。它拒绝同 revision 改内容、回退版本和已发布内容变更却不升 bank_version；不会连接软件读取数据库。

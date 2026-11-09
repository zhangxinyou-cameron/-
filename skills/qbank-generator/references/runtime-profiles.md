# 知习初版运行环境与评测合同

本配置依据知习 0.1.0 的实际适配器，协议为 QBank 1.0。环境 ID 表示适配能力，不证明机器已经安装或已经获得本机运行的题库信任。

## 软件编程题

| runtime_ref | 代码与标准 | 入口示例 |
| --- | --- | --- |
| python-stdio-1 | 完整 Python 程序，只依赖既有环境的库；默认标准库 | main.py |
| c11-stdio-1 | 完整 C11 程序，以 gcc/clang 兼容方式编译 | main.c |
| cpp17-stdio-1 | 完整 C++17 程序，以 g++/clang++ 兼容方式编译 | main.cpp |

code.execution 包含 runtime_ref、entry_file、starter_files、reference_files、limits 和 judge。当前不是力扣式函数签名协议，不要求软件自动包裹 Solution 类或注入调用器。题目要求函数式写法时，自己在完整源码中提供输入输出驱动，并明确可编辑区域，或说明需后续运行器支持。

judge = {kind: "stdio", comparator: "trim_end" 或 "exact", tests: [...] }。每条测试包含 id、visibility、stdin、expected_stdout。至少一个 sample 和一个 private；输入与期望输出均为字符串，空输入用 ""。

运行器逐用例启动程序并关闭 stdin。样例只用于调试，正式提交执行全部测试。private 表示提交前不在普通界面展示，并不加密。输出不要包含交互提示、解释文字或临时调试日志。

exact 仅统一 CRLF 换行；trim_end 还去除整个输出末尾空白，不忽略中间空格、不排序、不提供浮点容差。需要数值容差、交互或特殊 checker 的题，不可假称当前已支持；优先改为题意允许的确定输出，或说明扩展需求。

输入范围、溢出边界、字符编码、空输入是否允许都由题干决定。C/C++ 不依赖未定义行为或平台未约定的 int/long 宽度；必要时明确类型与数值范围。

## RTL 题

rtl.execution 在共同字段外包含 rtl_spec。judge.kind 为 hdl_testbench，带 testbench_files、top_module、check_count。judge.top_module 是测试顶层；rtl_spec.dut_top_module 是 DUT 顶层，二者通常不同。

rtl_spec 必填：dut_top_module、ports、timescale、clock_reset_md、latency_md、required_capabilities、simulation_limit_ns、parameters_md。每个端口有 name、direction、width。使用基础 Verilog-2005 可表达的模块接口；当前适配器固定传入 -g2005，不能只把 SystemVerilog 文件后缀改成 .v 就视为兼容。

当前能力可声明 verilog-2005、four-state、vcd。明确时钟沿、复位极性、同步/异步、复位与使能优先级、位宽、符号、参数及有效延迟。不要对首次复位前没有定义的寄存器状态提出未声明的约束。

自检查 testbench：

- 独立计算期望结果；覆盖正常输入、边界、复位、保持及适用的连续操作。
- 分开驱动与采样事件，时钟沿后等待非阻塞更新完成，避免测试竞态。
- 每完成一个真实检查点才计数，check_count 与实际执行数一致，不只数循环次数。
- 失败输出包含 QB_CHECK_FAIL，并以非零状态结束；正常结束独立输出一行 QB_TEST_DONE checks=N，N 为实际检查总数。
- 设置仿真保护超时；simulation_limit_ns 是题目声明，**当前运行器不会自动将该字段转成仿真器超时参数**，因此必须在 testbench 中实现对应保护，并由 limits.job_wall_ms 提供现实墙钟保护。
- 生成波形时使用固定文件名 wave.vcd；初版运行器只收集该名字的 VCD，不会自动识别其他 VCD/FST 文件。可使用 $dumpfile("wave.vcd") 与适量 $dumpvars。
- 用 %t 输出时间时设置明确的 $timeformat 或带上单位，避免把 ps 的数字误标为 ns。

涉及 X/Z 的题按四态逻辑判定，不用两态工具替代。对 CDC、STA、复位架构或亚稳态的知识题，解析需说明适用假设；RTL 功能仿真通过不证明芯片级正确性。生成学生 testbench 的验证题还需要另一个可信评测器，当前不要仅按学生输出标志判分。

## 默认 limits

所有字段必须齐全，可根据题目调整，但不能要求无限资源：

```json
{
  "per_case_wall_ms": 2000,
  "compile_wall_ms": 30000,
  "job_wall_ms": 60000,
  "memory_mib": 256,
  "compile_memory_mib": 1024,
  "output_kib": 1024,
  "artifact_mib": 20,
  "processes": 64
}
```

实际还取软件全局上限的较小值。测试量过大时注意整任务时间包含工具调用与编译开销；不要把资源不足解释成学习者答案错误。原生后端未强制隔离内存和进程，严格限制依赖容器。

## 仅在用户需要配置环境时

先生成依赖需求与检查方案，可使用 prompt-templates.md 的环境模板。当前软件提供路径选择和可信的容器预设，没有实现任意 envpack 安装脚本接口。生成题库不自动授予安装工具链或修改系统环境的权限；不把未核验下载链接、摘要和命令藏进题库。用户另行要求环境脚本时，按真实实现能力单独处理。

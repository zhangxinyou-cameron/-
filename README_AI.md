# 给 AI 的项目阅读与开发指南

本文件是知习的 AI 入口。先读取 [AGENTS.md](AGENTS.md) 中的仓库协作约定，再根据当前任务选择下面的阅读路线。用户当次要求优先；不要把示例主题、题量或历史需求当成新任务的默认范围。

## 先识别任务

| 用户目标 | 先读 | 主要交付 |
| --- | --- | --- |
| 新增功能、开发或维护插件 | [wisdom-plugin-developer](skills/wisdom-plugin-developer/SKILL.md) + [插件协议](docs/插件开发协议.md) | 独立后端模块、前端页面、注册、测试与说明 |
| 生成、修复或更新题库 | [qbank-generator](skills/qbank-generator/SKILL.md) | 可导入的 QBank JSON/ZIP、校验结果及实际验证范围 |
| 整理阅读资料并配套章节测试 | [学习资料协议](docs/学习资料协议.md) + [课程示例](examples/learnpack-demo.json)；生成新题目时再读 qbank-generator | LearnPack JSON，章节引用已有题目或内嵌 QBank |
| 修复核心界面、判分或环境问题 | 对应代码与测试；涉及插件时再读插件 Skill | 最小修复、相关回归与说明 |

两个 Skill 的完整项目副本统一放在 [skills/](skills/README.md)。支持 Skill 的 AI 可以按名称调用；没有 Skill 自动加载能力的 AI，直接读取对应 SKILL.md，再按其中链接按需读取资源即可。只读一个 SKILL.md 而忽略它引用的协议或校验脚本，不能替代完整工作流程。

## 代码阅读路线

应用源码根为 `tech-practice/`。先看 [项目 README](README.md) 与 [package.json](tech-practice/package.json)，确认实际版本、依赖和脚本；设计文档描述的计划能力不代表已经实现。

一次界面调用的路径是：React 页面 → [src/api.ts](tech-practice/src/api.ts) → [desktop/preload.cjs](tech-practice/desktop/preload.cjs) 暴露的白名单桥接 → [desktop/main.mjs](tech-practice/desktop/main.mjs) 的 methods 与 IPC 校验 → service / 插件 → SQLite 或运行器 → 返回界面。

| 想了解什么 | 阅读位置 |
| --- | --- |
| 启动、窗口、单实例、IPC、导入导出入口 | [desktop/main.mjs](tech-practice/desktop/main.mjs)、[startup.mjs](tech-practice/desktop/startup.mjs)、desktop/startup/ |
| 服务创建及客观题判分 | [desktop/service.mjs](tech-practice/desktop/service.mjs) |
| 数据表、题库版本、作答、会话和事务 | [desktop/store.mjs](tech-practice/desktop/store.mjs) |
| QBank Schema 与语义校验、题库文件处理 | [desktop/qbank.mjs](tech-practice/desktop/qbank.mjs)、[题库协议](题库协议与示例/qbank.schema.json) |
| 代码运行、RTL 评测、环境检测 | [desktop/runner.mjs](tech-practice/desktop/runner.mjs)、[environment.mjs](tech-practice/desktop/environment.mjs) |
| 备份与恢复 | [desktop/backup.mjs](tech-practice/desktop/backup.mjs) |
| 导航、应用上下文、动态插件页面 | [src/main.tsx](tech-practice/src/main.tsx)、[src/components.tsx](tech-practice/src/components.tsx) |
| 题库、刷题、代码编辑、设置 | src/Library.tsx、src/Practice.tsx、src/Editor.tsx、src/Settings.tsx |
| 原有错题、收藏、统计与专题 | [src/Learning.tsx](tech-practice/src/Learning.tsx) |
| 插件宿主与开关管理界面 | [desktop/plugins/index.mjs](tech-practice/desktop/plugins/index.mjs)、[src/Plugins.tsx](tech-practice/src/Plugins.tsx) |
| 学习中心插件的完整实现 | [desktop/plugins/learning.mjs](tech-practice/desktop/plugins/learning.mjs)、[src/plugins/Learning.tsx](tech-practice/src/plugins/Learning.tsx) |
| 前端插件注册 | [src/plugins/index.ts](tech-practice/src/plugins/index.ts) |

注意 `src/Learning.tsx` 与 `src/plugins/Learning.tsx` 的职责不同。Windows 下 `Plugins.tsx` 与 `plugins/` 名称接近，导入注册表请沿用 `./plugins/index`，避免目录解析歧义。

优先用 `rg` 定位目标接口，再顺着调用链读相关函数和测试。不要先遍历 node_modules、build、dist、release 或打包后的校验器；它们不是日常修改的源码入口。

## 用 Skill 编写插件

读取 [插件 Skill](skills/wisdom-plugin-developer/SKILL.md) 与 [API 1 契约](docs/插件开发协议.md)，以学习插件为可运行参考。当前为随应用构建注册的可信模块；没有动态下载第三方 JS/ZIP 插件的安装入口。

1. 将新功能拆成 `desktop/plugins/<id>.mjs`。导出 manifest 和同步 activate(context)，返回 handlers 与 dispose。后端默认模块数组在 desktop/plugins/index.mjs；当前 context 提供 store、validator。
2. 页面放在 `src/plugins/`，加入 src/plugins/index.ts 的 pluginViews。前后端使用同一插件 ID，导航和开关复用宿主；不要为每个插件重新写一套核心路由。
3. 界面通过 `api('plugin', {id, action, payload})` 调用后端。输入校验放在后端；插件关闭后必须拦截接口调用，不能只隐藏按钮。
4. 数据使用独立命名空间并通过同步 store.transaction 写入；嵌套事务由最外层提交。关闭释放监听和计时器、保留数据，检查重启、升级及备份恢复。
5. Markdown 复用现有清洗组件；编辑状态接入 pluginDirty / confirmNavigation。按变动补充后端和真实界面验证，修改契约时同步协议与 Skill。

可直接给支持 Skill 的 AI 以下任务：

```text
使用 $wisdom-plugin-developer 为知习增加“我的学习计划”插件。
先读 README_AI.md 和插件契约，明确本次需求后沿用现有注册与开关机制。
实现目标清单、完成状态和持久化；验证关闭、重启及备份恢复。
按实际执行情况报告测试结果，仓库操作遵循本次授权与 AGENTS.md。
```

## 用 Skill 生成题库和课程

读取 [题库 Skill](skills/qbank-generator/SKILL.md)，按其中指引读取协议、Schema、运行环境合同和相应示例。生成文件不需要修改应用代码或直接写入个人数据库。

题目使用稳定 bank_id / question id。更新已发布题目时，按协议增加 revision 与 bank_version；不要为绕开冲突更换已有题目身份。参考解与测试必须符合题干的输入范围、RTL 接口和时序约定。

从仓库根目录验证已有最小示例，不需要 npm install：

```powershell
node skills/qbank-generator/scripts/validate_qbank.cjs skills/qbank-generator/assets/minimal-bank.json
```

将最后的文件参数换为生成的题库即可校验；可添加 `--report <报告.json>`，更新题库时添加 `--previous <原题库.json>`。报告和临时文件写入任务工作目录，避免将个人数据或临时校验输出混入提交。

随 Skill 附带的校验器是版本化快照，基线记录在 [validator-profile.json](skills/qbank-generator/references/validator-profile.json)。该基线的软件版本号与当前应用版本可以不同；不要仅为了改版本号重写打包脚本、Schema 或指纹。若应用协议确有变化，应一起评估快照兼容性。

结构校验不执行代码，也不证明答案正确。存在适用环境时，再验证参考解及能识别错误实现的测试；没有执行的检查要明确说明。当前语言环境和题型以 Skill 与实际运行器为准，不能虚构环境 ID 或声称工具链已经安装。

示例任务：

```text
使用 $qbank-generator 为知习生成 30 道 Verilog 同步时序逻辑题，
覆盖使能、同步复位、计数器和有限状态机，包含选择、判断和 RTL 编程题。
交付完整 UTF-8 QBank JSON，运行项目自带校验器；
分开说明结构校验、内容审查和参考解实际仿真的结果。
```

需要“资料 + 练习”时，再按 [LearnPack 协议](docs/学习资料协议.md) 将 Markdown 章节、知识点和 question_refs 组织成课程；新题可放在根 qbank 内。QBank 与 LearnPack 是两种导入格式，不能把章节字段直接加进 QBank 未定义位置。课程用学习中心导入；纯题库用题库入口导入。

## 构建、验证与交付

应用开发需要 Node.js 24、npm 和 Windows；独立题库校验器需要 Node.js 18+。新克隆工作区的开发命令从 `tech-practice/` 执行：

```powershell
npm ci
npm run prepare:assets
npm test
npm run build
```

已有依赖时按需运行，`npm start` 启动源码构建，`npm run package` 生成 Windows 便携程序。仓库不携带下载的工具链，安装依赖不等于具备 Python、C/C++ 或 Verilog 执行环境。

| 变动 | 选择的验证入口 |
| --- | --- |
| 后端、持久化、插件开关及导入 | npm test，相关测试在 tests/core.test.mjs 与 tests/plugins.test.mjs |
| 学习中心页面与闭环 | npm run test:learning |
| 原题库、刷题、环境或核心页面 | npm run test:ui |
| 启动、单实例、EXE 或启动过场 | npm run test:startup |
| TypeScript、资源及打包依赖 | npm run build；需要交付程序时再打包验证 |
| 纯文档与 Skill 收录 | 检查链接、路径、资源完整性及文中命令；不要求为文字变更启动全部桌面回归 |

桌面测试需 Electron 可运行的 Windows 环境，现有脚本使用独立数据目录与 Chromium profile。验证打包程序时，先打包，再在 tech-practice/ 中设置 `$env:TECH_PACKAGED_EXE=(Resolve-Path 'release/TechPractice-win32-x64/TechPractice.exe').Path` 后运行对应桌面测试；完成后 `Remove-Item Env:TECH_PACKAGED_EXE`。不要将调试过程连接到用户日常学习数据库。

提交前核对差异与实际测试范围，更新相关说明。个人 SQLite、node_modules、工具链、测试缓存和构建产物不入库。获得提交/推送授权后，依 [AGENTS.md](AGENTS.md) 与 [同步脚本](scripts/Sync-Repositories.ps1) 更新双仓库并核验远程提交；Skill 本身不扩大外部操作授权。

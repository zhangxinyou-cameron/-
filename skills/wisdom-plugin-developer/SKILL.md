---
name: wisdom-plugin-developer
description: 为知习技术练习室编写或修改模块化插件，包括注册、生命周期、开关、页面、数据持久化与测试。用于新增软件功能及插件维护，不用于单纯生成题库或学习资料。
---

# 知习插件开发

将用户需要的新功能实现为可独立管理的插件。先定位仓库根目录，读取 AGENTS.md、docs/插件开发协议.md，并检查现有 desktop/plugins 与 src/plugins 的实现。源码根在 tech-practice/，不要误改仓库外的旧副本。

## 实现

- 新插件在 desktop/plugins/ 导出 manifest 与同步 activate(context)，按 API 1 契约返回 handlers 和 dispose。加入后端默认模块数组，在 src/plugins/index.ts 注册对应 React 页面；导航与开关复用核心宿主。
- 这是随软件构建的可信插件机制。不要把用户提供的 JSON 当作插件脚本执行，不宣称支持动态 ZIP 安装或隔离沙箱。新增系统、网络或代码执行能力需按用户实际授权设计明确接口。
- 数据使用插件自己的命名空间；只通过 store.transaction 同步写入。不删除核心或其他插件数据，关闭插件保留学习数据。嵌套事务由最外层提交，不能 await 或吞掉错误后继续提交。
- 清洗资料与笔记的 Markdown，复用现有 Markdown 组件。编辑器明确显示未保存与保存状态，并使用 pluginDirty/confirmNavigation 配合宿主防止误丢正文和笔记。
- 保持已发布数据兼容：稳定 ID、不回退版本、旧笔记保留。实现持久化或导入时检查备份恢复、冲突拒绝和部分失败回滚。
- 插件发起练习时，在后端会话 pluginContext 中保留来源，通过 pluginPracticeViews 提供返回入口和进度反馈；导航前保存草稿并遵守运行中禁用状态。按需读插件协议的练习扩展约定，验证重启续做及完成后返回原模块。
- 以学习插件为例了解完整注册、数据、页面和测试，但按用户需求选择最小实现；不要照搬学习领域的字段或增加不相关功能。

## 验证与交付

分轮验证：先做后端开关/生命周期/输入校验/持久化，再做真实界面与重启，最后回归受影响核心流程。修复失败后重跑相关检查，不以静态阅读冒充运行结果。

已有测试入口：npm test、npm run test:learning、npm run test:ui、npm run test:startup；构建为 npm run build，Windows 打包 npm run package。所有运行测试使用独立数据目录与 Chromium profile，避免占用当前个人工作区实例。

更新 docs/插件开发协议.md（若契约变化）、相关使用说明及测试报告。交付可运行软件、源码和检查范围；仓库推送遵循用户授权及 AGENTS.md，不由本 Skill 自行扩大外部操作权限。

课程内容或 LearnPack 格式的任务，先读 docs/学习资料协议.md；单纯出题应使用题库生成流程，而不是修改插件代码。

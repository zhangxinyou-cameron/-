# 知习项目 Skills

本目录统一收录两个 Skill 的完整项目副本，与应用代码一起版本管理和同步到 Gitee、GitHub。AI 总入口见 [README_AI.md](../README_AI.md)。

| Skill | 用途 | 入口 |
| --- | --- | --- |
| qbank-generator | 生成、修复、增量更新可导入的 QBank 1.0 题库 | [SKILL.md](qbank-generator/SKILL.md) |
| wisdom-plugin-developer | 开发模块化功能，接入生命周期、开关、页面、存储与测试 | [SKILL.md](wisdom-plugin-developer/SKILL.md) |

```text
skills/
├─ README.md
├─ qbank-generator/
│  ├─ SKILL.md
│  ├─ agents/openai.yaml
│  ├─ references/      协议、Schema、运行环境、提示词和版本指纹
│  ├─ assets/          最小与完整示例题库
│  └─ scripts/         已打包校验器及第三方许可证
└─ wisdom-plugin-developer/
   ├─ SKILL.md
   └─ agents/openai.yaml
```

## 给 AI 使用

支持 Skill 调用的环境可使用 `$qbank-generator` 或 `$wisdom-plugin-developer`。没有安装或自动发现能力时，向 AI 指定本仓库中的 SKILL.md 路径，让其读取后按指引工作。

需要在个人 Codex 环境安装时，将所需 Skill 的整个目录复制到 Codex 的 skills 目录（默认 `~/.codex/skills/`，显式设置 CODEX_HOME 时为其下的 skills/），保留名称及子目录。已存在同名 Skill 时先比较版本与本地修改；不要只复制入口文件或无检查覆盖。项目内 skills/ 是随仓库交付的版本，个人安装副本后续更新需另行同步。

题库生成 Skill 自带资料和校验器，可独立生成 QBank。插件 Skill 需要配合本仓库源码及 [插件开发协议](../docs/插件开发协议.md) 使用。阅读课程及章节测试的格式见 [学习资料协议](../docs/学习资料协议.md)。

## 维护

修改对应 Skill 的源目录并保留必需资源；更新题库校验器或 Schema 时同步版本指纹，不为文字整理改写快照。新增插件 API 时同步协议与插件 Skill。两者的 Skill 结构可使用 skill-creator 提供的 quick_validate.py 校验；生成题库再运行 qbank-generator/scripts/validate_qbank.cjs，校验不代替内容与运行测试。

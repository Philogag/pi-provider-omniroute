---
description: 实现 OpenSpec 变更中的任务 (SuperPower)
argument-hint: "<用户输入>"
---

使用 SuperPower 的 subagent-driven-development 技能实现 OpenSpec 变更中的任务。

**输入**：可选择指定变更名称（例如，`/opsx-sp-apply add-auth`）。如果省略，检查是否可以从对话上下文中推断出来。如果模糊或不明确，你必须提示可用的变更。

**步骤**

1. **选择变更**

   如果提供了名称，使用它。否则：
   - 如果用户提到了某个变更，从对话上下文中推断
   - 如果只存在一个活动变更，自动选择
   - 如果不明确，运行 `openspec-cn list --json` 获取可用变更，并使用 **AskUserQuestion tool** 让用户选择

   始终宣布："正在使用变更：<name>"以及如何覆盖（例如，`/opsx-apply <other>`）。

2. **检查状态以了解 Schema**
   ```bash
   openspec-cn status --change "<name>" --json
   ```
   解析 JSON 以了解：
   - `schemaName`：正在使用的工作流（例如："spec-driven"）
   - 哪个产出物包含任务（对于 spec-driven 通常是 "tasks"，检查其他产出物的状态）

3. **开始实现任务**

使用 /subagent-driven-development

逐任务实现，每完成一个任务：
1. 在 tasks.md 中勾选（[ ] → [x]）
2. 提交代码，commit message 体现设计意图

实现中发现 spec 不完整时的处理：
- 缺少验收场景/边界条件 → 直接编辑 delta spec + design.md，追加 tasks.md 任务
- 接口变更/新组件/数据流变化 → 重新  superpowers brainstorming 更新 Design Doc
- 全新能力需求 → /opsx:new 创建新的 OpenSpec change
- 新增任务超过初始任务数的 50% → 考虑拆分为新 change

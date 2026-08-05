---
description: 实现规划细化 (SuperPower)
argument-hint: "<用户输入>"
---

对 Spec 需求进行更细致的计划拆解

**输入**：可选择指定变更名称（例如，`/opsx-sp-plan add-auth`）。如果省略，检查是否可以从对话上下文中推断出来。如果模糊或不明确，你必须提示可用的变更。

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

3. **进行更细致的实现规划**

使用 /writing-plans 技能，基于 Design Doc 创建实现计划。

计划要求：
- 保存至 openspec/changes/<change-name>/superpower-plan.md
- 引用设计文档 openspec/changes/<change-name> 下的内容，拆分为可执行任务
- Plan 文件头必须包含：
  ---
  change: <openspec-change-name>
  design-doc: openspec/changes/<change-name>/superpower-design.md
  base-ref: <先运行 git rev-parse HEAD 记录当前提交>
  ---

同时额外更新 openspec/changes/<change-name>/task.md

计划创建后，提示使用 /opsx-sp-apply 开始进入开发

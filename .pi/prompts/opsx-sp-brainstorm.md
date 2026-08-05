---
description: 需求细化 (SuperPower)
---

对 Spec 需求进行 Brainstorm 并细化需求

**输入**：可选择指定变更名称（例如，`/opsx-sp-brainstorm add-auth`）。如果省略，检查是否可以从对话上下文中推断出来。如果模糊或不明确，你必须提示可用的变更。

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

3. **调起 /brainstorming 技能 并传入以下上下文**

读取以下 OpenSpec change 文件（必须完整读取，不要摘要）：
- openspec/changes/<change-name>/proposal.md
- openspec/changes/<change-name>/design.md
- openspec/changes/<change-name>/tasks.md
- openspec/changes/<change-name>/specs/ 下所有 spec.md（如有）

然后使用 /brainstorming 技能头脑风暴，深度技术设计，并传入以下上下文：

---
Change: <change-name>
上游需求（来自 OpenSpec，不要重写）：
- 目标：<从 proposal.md 提取>
- 架构约束：<从 design.md 提取>
- 任务边界：<从 tasks.md 提取>

约束：
1. 输出文件为 openspec/changes/<change-name>/superpower-design.md
2. OpenSpec 是需求的事实源，不要重新定义需求，不要重写 proposal/spec
3. 你的任务是基于已有需求做深度技术设计：实现方案、技术风险、测试策略、边界条件
4. 如发现 delta spec 缺少验收场景，只能回写 OpenSpec delta spec，不要在 Design Doc 中创建第二份需求 spec
5. 跳过上下文探索，直接进入设计提问
6. 使用 /opsx-sp-plan 替代最终的 writing-plans
---

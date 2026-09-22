# 会话 token 用量面板

## 背景

客户端今天能看到的 token 数字只有两处，且都不覆盖"这个会话一共用了多少"：

- 输入框上方的上下文容量计（`chat-input-toolbar/contextUsage.tsx`），数据来自 v4 快照 `snapshot.usage.contextWindow`，只描述**当前上下文占用**。
- 设置 → 用量（`settings/usage-stats/AppUsagePanel.tsx`），数据来自 `v4/usage/stats`，只描述**全应用**维度。

会话级的累计用量查询其实早就存在（`v4/conversation/usage` → `queryTaskUsage`），但在渲染端**零消费者**。同时 `snapshot.usage.cumulative` 看着像会话总量，实际是**进程级**计数（`projection-state.ts` 从 0 起，`v4-bridge.ts` 的 seed 只回填 `contextWindow`，只有 `product-projection.ts` 在 ModelComplete 时累加），冷恢复后归零，不能当会话总量用。

本 spec 定义把这些数字放进会话右侧卡片（精简区）与右侧侧栏（明细 tab）的行为、口径与边界。

## 规则

### 一、口径：显示值一律是计费口径

**计费口径 = `sum(computed_total_tokens)`，且只统计 `status='completed'` 的行**，与 `queryAppUsage`（设置 → 用量）完全同源。`input_tokens` 已含 cache read，不得再加一次。

明确否决两种替代口径：

- **不用增量口径做展示值。** `queryTaskUsage` 按 `query_source` 维护 `inputBaselineBySource`，重复的 prompt 前缀只计一次，得到的是"新增上下文"而非"用量"。同一段对话两种口径能差数倍（共享 100k 前缀的三轮请求：增量 109k vs 计费 315k）。面板显示它会让用户拿不到可解释的数字，也和设置 → 用量对不上。
- **不用 `snapshot.usage.cumulative` 做会话总量。** 它是进程级计数，重启/冷恢复后归零；只允许驱动"是否需要重新拉取"，不得作为展示值。

`queryTaskUsage` 及其增量语义**保持不变**（缓存字段对 baseline 来源恒为 0 是其既有行为），不在本次改动里调整。

### 二、数字来源划分

| 数字                               | 来源                                                             | 归属                                                                |
| ---------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| 上下文容量 used / max              | `snapshot.usage.contextWindow`（live 推送）                      | 已有，零新增协议                                                    |
| 缓存命中率                         | `snapshot.usage.contextWindow.cache`                             | 已有；展示阈值沿用 `contextUsage.tsx` 的 `0.78`，不得引入第二个阈值 |
| 速度 t/s                           | 新查询的 `latestRequest`（`output_tokens` ÷ 生成耗时）           | 复用 `packages/shared/src/session-debug.ts` 的 `calculateOutputTps` |
| 会话合计、按模型、逐请求、工具调用 | 新增 `v4/conversation/usageDetail`                               | 新查询                                                              |
| 今日（跨会话）                     | 复用 `v4/usage/stats`（`usageStatsService.getAppUsageSnapshot`） | 已有，零新增协议                                                    |
| 子代理用量                         | 新查询的 `subagents` 分块                                        | 新查询                                                              |

**速度是完成态速率**：数值在每次请求完成时更新，不是流式过程中的实时速率。文案不得写成"实时速率"。

### 三、子代理归属按 `task_type`，不按 `parent_id`

子代理用量只统计 `session.task_type = 'subagent_child'` 的子会话。仅按 `parent_id` 关联会把"选择侧边会话"等非子代理子会话算成子代理（本机实测库里存在这类子会话）。子项之和必须能对上合计。

### 四、作用域：按 pane 的 sessionId，绝不回退

- 卡片区按**本 pane** 的 `sessionId` 取数；侧栏 tab 用 tab 自带并冻结的 `parentSessionId` + 作用域字段（`workspacePath`/`workspaceIdentity`/`remoteSessionId`），与 `plan-detail` 同构。
- 取不到就显示空/零。**不得回退到别的会话、别的 pane 或"最近活跃会话"**：多窗格共享 localStorage 时任何启发式都会串数据。
- 隔离键统一 `workspaceIdentity?.trim() || workspacePath`。
- 服务层通过 `getReadOnlyClient(params)` 选 client，因此远程 / 手机远控会话走同一个查询、命中远端库，无需额外分支。

### 五、失败语义与保留期

- 旧版本 host 不认识新 method 时**降级**：只显示 live 区（容量/缓存），累计类数字显示为不可用并给出提示。**不得**静默改用另一种口径顶上。
- 会话用量受 `USAGE_RETENTION_DAYS = 30` 约束（每次写入都会 prune）。UI 文案按"近 30 天"表述，**不得**承诺会话历史总量。

### 六、协议：新增 method，不改现有 strict schema

现有 `v4ConversationUsageParamsSchema` / `v4ConversationUsageResultSchema` 及其 legacy 同名 schema 都是 strict 对象：加字段会让旧渲染端解析失败。因此新增独立 method `v4/conversation/usageDetail` 与独立的 params/result schema，现有 two schema 一字不改。v4-only，legacy 协议不补。

## 唯一所有者

| 事实             | 所有者                                                           | 说明                                                                |
| ---------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| 会话用量事实     | CLI session store（`model_usage` / `turn_usage` / `tool_usage`） | host 侧无副本；一切聚合从 CLI 侧查询产生                            |
| 会话用量聚合     | `usage.ts` 的 `querySessionUsageDetail`                          | 新增；唯一的会话级聚合实现                                          |
| 该查询的对外契约 | `v4/conversation/usageDetail`                                    | 新增 method，结果 schema 是唯一形状定义                             |
| 面板展示值       | `ConversationStatusPanel` 与 `UsageSidePane`                     | **纯只读投影**：无草稿、无乐观层、不进 CommandInbox、不新增写入路径 |
| 实时容量 / 缓存  | v4 会话投影                                                      | 面板不自己算、不另存副本                                            |

## 迁移边界

- 无 db schema 变更、无数据迁移、无版本号 bump、无生成代码。
- 不改 `queryTaskUsage`、`v4ConversationUsageResultSchema`、legacy `session/usage`。
- 卡片区新增的 section 只在 `variant !== "mini"` 时渲染（沿用现有规则）；胶囊的优先级链只**追加**最末一档用量兜底，既有分支次序不动。
- **workspace 归属不在本 method 内校验**（如实记录边界，不是"已修复"）：v4 面的 params 一律不带 workspace 字段（`v4ConversationUsageParamsSchema` 只有 `sessionId`），CLI 侧没有可比对的调用方 workspace，因此这里只做"按请求的 sessionId 取数，取不到返回零值"，不做授权判断——不给单个方法加一份没有参照物的假校验。隔离由两处保证：调用方经 `getReadOnlyClient` 选 workspace/远端对应的 client；pane 只用自己的 `sessionId` 取数且绝不回退。若要真正做归属授权，应在 v4 面**统一**补 workspace 字段，那是独立的协议改动。
- 已知残留：`getTaskTokenUsage`（`v4/conversation/usage`）同样不做归属校验，本次不改它以免影响既有语义。

## 验收场景

1. 有数据的会话：容量/速度/合计三项数值正确，容量与输入框上方的容量计一致。
2. 新会话（库中无数据）：显示空/零，不显示任何其他会话的数字。
3. **分屏两个 pane 各显各的**：两个会话的数字互不串。
4. 请求完成后数字自动刷新（由推送触发，不得引入轮询）。
5. 会话压缩后容量回落；不显示历史峰值。
6. 明细 tab 内按模型、工具、子代理的子项之和等于合计。
7. 旧 host（unknown method）：只显示 live 区并给出提示，不报错、不切换口径。
8. 超过 30 天的会话：按保留期截断，不承诺历史总量。
9. 远程 / 远控会话：命中远端库，与本地会话同样呈现。
10. 剪除：同窗口多条状态条（面板按 pane 的 sessionId 隔离，不需要标题匹配等启发式）。

## 测试

- 已落地并**已执行**：`apps/zcode-cli/packages/adapters/test/sessionUsageDetail.test.mjs`（`node:test` + `node:sqlite` 内存库，跑真实 `SQLITE_MIGRATIONS` 建表），5 例全通过：计费口径只累加 completed 且与按模型分组对账 / 最近一次完成请求与逐请求倒序受 limit 约束 / 工具调用分组与总数对账 / 子代理只认 `task_type='subagent_child'`（带用量的 `selection_side_chat` 不计入、也不混进本会话合计）/ 保留期随结果返回且未知会话返回零值。该包原先没有 `test` 脚本，本次补 `"test": "node --test test/*.test.mjs"`；测试跑在 `dist` 产物上，需先 `tsc`。
- UI 侧无组件测试基础设施（`packages/ui` 无 test 脚本、无 vitest/DOM 测试、无内置 e2e runner）。新增 `data-testid="usage-side-pane"`、`data-usage-*`、`data-usage-open` 契约属性供外部 e2e 断言；**未执行**任何 UI 自动化验证。
- 已执行的门禁：`pnpm typecheck`、`apps/zcode-cli` 三个改动包的 `tsc --noEmit`、`pnpm lint`（0 error / 33 warning，均为存量）、`pnpm architecture:check --changed`（0 违规）、改动文件的 `oxfmt --check`。`pnpm fmt:check` 在本次改动前即为失败状态（未改动的 `tsconfig.base.json`、`third-party/*.json` 等本就未格式化），故只格式化自己改动的文件，未触碰其余文件。

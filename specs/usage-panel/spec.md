# 会话 token 用量面板

## 背景

客户端今天能看到的 token 数字只有两处，且都不覆盖"这个会话一共用了多少"：

- 输入框上方的上下文容量计（`chat-input-toolbar/contextUsage.tsx`），数据来自 v4 快照 `snapshot.usage.contextWindow`，只描述**当前上下文占用**。
- 设置 → 用量（`settings/usage-stats/AppUsagePanel.tsx`），数据来自 `v4/usage/stats`，只描述**全应用**维度。

会话级的累计用量查询其实早就存在（`v4/conversation/usage` → `queryTaskUsage`），但在渲染端**零消费者**。同时 `snapshot.usage.cumulative` 看着像会话总量，实际是**进程级**计数（`projection-state.ts` 从 0 起，`v4-bridge.ts` 的 seed 只回填 `contextWindow`，只有 `product-projection.ts` 在 ModelComplete 时累加），冷恢复后归零，不能当会话总量用。

本 spec 定义把这些数字放进会话右侧卡片（精简区）的行为、口径与边界。

> 变更记录：侧栏「用量明细」tab 已**下线**。它的统计口径是全会话，而 tab 又挂在会话内，与设置 →「用量」的同类统计重复，且入口在分屏链路上本就没有接通（详见 §七）。**悬浮窗/状态卡片里的「用量」分区保留**，会话级 `v4/conversation/usageDetail` 查询也保留——卡片正是它的消费者。

## 规则

### 一、口径：显示值一律是计费口径

**会话合计 = `sum(computed_total_tokens)`，且只统计 `status='completed'` 的行**（`querySessionUsageDetail` 的 `billed`）。`input_tokens` 已含 cache read，不得再加一次。

**全局统计（设置 → 用量）是另一套**：`queryAppUsage` 只按时间窗过滤，**不按 `status` 过滤**（error / cancelled / 在途行都计入，`modelErrorCount` 是附加统计而不是排除条件）。已用新单测锁定该行为（`apps/zcode-cli/packages/adapters/test/appUsageDayBreakdown.test.mjs`）。

这两者**不是同源口径**——早先版本的本 spec 写成"与 `queryAppUsage` 完全同源"是错的，已更正。保留差异的理由：全局统计是既有对外数字，改它的 status 过滤会让用户已看到的累计值突然下降；会话卡片的 `billed` 面向"这次对话花了多少"，排除在途与失败请求更可解释。**两处都不许改口径**，除非是一次把两侧一起对齐的独立改动。

明确否决两种替代口径：

- **不用增量口径做展示值。** `queryTaskUsage` 按 `query_source` 维护 `inputBaselineBySource`，重复的 prompt 前缀只计一次，得到的是"新增上下文"而非"用量"。同一段对话两种口径能差数倍（共享 100k 前缀的三轮请求：增量 109k vs 计费 315k）。面板显示它会让用户拿不到可解释的数字，也和设置 → 用量对不上。
- **不用 `snapshot.usage.cumulative` 做会话总量。** 它是进程级计数，重启/冷恢复后归零；只允许驱动"是否需要重新拉取"，不得作为展示值。

`queryTaskUsage` 及其增量语义**保持不变**（缓存字段对 baseline 来源恒为 0 是其既有行为），不在本次改动里调整。

### 二、数字来源划分

| 数字                 | 来源                                                                                     | 归属                                                                |
| -------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 速度 t/s 与首字延迟  | 新查询的 `latestTimedGeneration`（`output_tokens` ÷ 生成耗时、`time_to_first_token_ms`） | 复用 `packages/shared/src/session-debug.ts` 的 `calculateOutputTps` |
| 会话合计、子代理合计 | 新增 `v4/conversation/usageDetail`                                                       | 新查询                                                              |
| 今日（跨会话）       | `v4/usage/stats` 快照的 `today` 分块（见 §八）                                           | 已有 method，新增一个可选分块                                       |

**上下文容量与缓存命中率不在本面板展示**：输入框下方的容量计已经在显示这两项（容量计自带 `0.78` 命中率阈值与上下文 K 单位），面板再放一遍只会产生两个可能不一致的数字。面板只放"只能从库里算出来"的对话级用量。`snapshot.usage.contextWindow` 仍作为"本会话有用量"的**同步信号**传入面板（面板显示闸门与用量分区开门条件），但不再渲染它。

**速度是完成态速率**：数值在每次请求完成时更新，不是流式过程中的实时速率。文案不得写成"实时速率"。

**速度与首字延迟的来源严格限定为「最近一次可计时的真实生成」**（`query_source ∈ main_turn/subagent/workflow_child`、首 token 时间与总耗时齐全、`duration > timeToFirstToken`、输出非空）。三条实测依据：

1. 辅助请求（会话标题、提交信息、目标校验）**完全没有首 token 时间**；按会话统计时，多数会话的"最近一条 completed 行"正是它们——取最近一条就会让速度/首字延迟整行消失；
2. 真实生成里也有**按请求**缺首 token 时间的（实测某模型 1137/4177 条，`first_token_at` 同时为空）；用户遇到的"有的会话不显示 tps"就是这个原因；
3. 每个有生成的会话都至少有一条可计时生成（实测 39/39），因此这条规则能保证该行不整行消失。

**不得用 `outputTokens / durationMs` 兜底**：两种口径实测差 3.5 倍（78.0 vs 270.7 t/s），混进同一行数字等于静默换口径。两者共用同一个来源行，所以显示的模型与时刻总是一致的。

### 二之二、单位：用量走 K/M/B，上下文读数固定 K

- **用量数字**（会话合计、子代理合计、按模型、今日、胶囊）一律走 **K/M/B**（千/百万/十亿）档，**不随语言**在「万/亿」与 K/M 之间切换（`formatCompactTokenNumber`）。依据：同一个数出现在状态面板、明细页与设置→用量三处，必须能横向比较；K/M/B 与 t/s、ms 同属技术单位。这条同时改变了设置→用量的显示（原本中文读作万/亿）。
- **上下文读数**（输入框下方容量计的已用 / 上限）固定用 **K**（`formatTokenThousands`），同一对数字不允许出现两种单位；不足 1000 时不挂单位（`850` 而不是 `0.9K`）。代价是 1M 窗口显示为 `1000K`——这是刻意的成对统一。
- 模型目录里的容量 badge（`formatModelContextWindowLabel`）仍是 K/M/B 档：它是"能装多少"的规格（`1M` 继续读作 `1M`），不是"当前占用"的读数。
- 缩放过后的数值关闭千分位（`1000K`，不是 `1,000K`）。

### 三、子代理归属按 `task_type`，不按 `parent_id`

子代理用量只统计 `session.task_type = 'subagent_child'` 的子会话。仅按 `parent_id` 关联会把"选择侧边会话"等非子代理子会话算成子代理（本机实测库里存在这类子会话）。子项之和必须能对上合计。

### 四、作用域：按 pane 的 sessionId，绝不回退

- 卡片区按**本 pane** 的 `sessionId` 取数。
- 取不到就显示空/零。**不得回退到别的会话、别的 pane 或"最近活跃会话"**：多窗格共享内存状态时任何启发式都会串数据。
- 隔离键统一 `workspaceIdentity?.trim() || workspacePath`。
- 服务层通过 `getReadOnlyClient(params)` 选 client，因此远程 / 手机远控会话走同一个查询、命中远端库，无需额外分支。

### 五、失败语义与保留期

- 旧版本 host 不认识新 method 时**降级**：只显示 live 区（容量/缓存），累计类数字显示为不可用并给出提示。**不得**静默改用另一种口径顶上。
- 会话用量受 `USAGE_RETENTION_DAYS = 30` 约束（每次写入都会 prune）。UI 文案按"近 30 天"表述，**不得**承诺会话历史总量。

### 六、协议：新增 method，不改现有 strict schema

现有 `v4ConversationUsageParamsSchema` / `v4ConversationUsageResultSchema` 及其 legacy 同名 schema 都是 strict 对象：加字段会让旧渲染端解析失败。因此新增独立 method `v4/conversation/usageDetail` 与独立的 params/result schema，现有 two schema 一字不改。v4-only，legacy 协议不补。

### 七、侧栏「用量明细」tab 已下线

**删除理由**：tab 的统计口径是**全会话**（`v4/conversation/usageDetail` 本身就是会话级聚合），而 tab 又挂在会话内的右侧侧栏；设置 →「用量」已经在做同一件事的全局版本。两处并存的收益是零，成本是一个额外的 tab 类型、一套图标/标题/可见性分支和一条跨 5 层的 props 链。

同时如实记录一个**既有缺陷**（本次删除把它一并消掉，不是"以前能用"）：`onOpenUsage` 这条链在分屏链路上**从未接通**——`WorkbenchShellBinding`（`v4/WorkbenchPane.tsx`）没有声明这个字段，`WorkbenchLeafPane` 也不转发，所以状态卡片里的「打开用量明细」入口行在多窗格路径下永远不会渲染。删除是**行为中性**的，没有移除用户实际用得到的入口。

保留项（不要一起删）：

- 状态卡片 / 悬浮窗里的「用量」分区：速度、首字延迟、会话合计、子代理合计。
- `v4/conversation/usageDetail` 与 `querySessionUsageDetail`：卡片就是它的唯一消费者。
- `sidePane.usageSubagentTotal`：卡片在用。

### 八、设置 →「用量」的今日分块与指标增删

设置页的「用量」是本仓库唯一的**全局**用量视图，本次做两件事。

**一、删掉三个指标**：最长聊天时长（`longestSessionMs`）、当前连续天数（`currentStreakDays`）、最长连续天数（`longestStreakDays`）——它们既不指向可行动的信息，也不是任何一个决策的输入。

**二、补一个「今日」分块**：当日 Token 总量、输入、输出、命中缓存、写入缓存、缓存命中率、请求次数、工具调用次数。

- **今日 Token 总量直接取存库列 `computed_total_tokens` 的求和，不得由分项重算**：该列在 `recordModelUsage` 写入时确定为「输入侧 + 输出」（输入侧取 `input_tokens`，为 0 时才退回 `cache_creation + cache_read`），**推理 token 已经包含在内，不能再加一次**。真实库上已验证 `总量 = 输入 + 输出` 精确成立（332314170 = 330910193 + 1403977），把 reasoning 加进去会得到偏大的数。
- **口径与区间一致**：今日的所有数字都来自 `model_usage` / `turn_usage` / `tool_usage` 三张表的同一套聚合，只把窗口收窄到「本地日 `[startOfLocalDay, until]`」。**不得**为今日另算一套口径（例如用逐请求倒推），也**不得**在这里额外加 `status='completed'` —— 那会让今日与同屏的"合计"、热力图当日格子互相打脸（`queryAppUsage` 不按 status 过滤，已由单测锁定）。
- **"今日"按调用方时区**：日界用请求里的 `tzOffsetMs`（与热力图归桶同一偏移），和用户看到的日历一致；不做 UTC 日界。
- **落在同一个按日聚合里**：`queryAppUsage` 的 `days` 查询本来就按 `dayIndex` 分组，本次只是把这组列一起算出来，`today` 由 `usage-stats-builder` 从 `days` 里取 `endDayIndex` 那一行。**不为今日新增第二条 SQL**，也不新增第二次往返。
- **旧宿主降级**：`today` 在 `appUsageSnapshotSchema` 里是**可选**字段（该 schema 是普通 `z.object`，非 strict，新增可选字段对旧渲染端是剥离、对新渲染端是缺省）。旧 CLI 不返回 `today` 时，今日分块显示 `--` 并给出"当前宿主不支持"提示，**不得**用全区间数字冒充今日。
- **保留区间概览**：`all` 快照的累计 Token、峰值 Token、活跃天数、会话数四项继续显示（原为五项，去掉上面三个）。
- **服务端字段不删**：`longestSessionMs` / `currentStreakDays` / `longestStreakDays` 仍留在 `appUsageSummarySchema` 里。删服务端字段会让**旧渲染端**在解析新 CLI 的响应时因缺字段失败（要求字段的 schema 遇到缺字段是硬错误），这是没有收益的协议破坏。它们只是不再有渲染消费者。

## 唯一所有者

| 事实             | 所有者                                                                     | 说明                                                                |
| ---------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 会话用量事实     | CLI session store（`model_usage` / `turn_usage` / `tool_usage`）           | host 侧无副本；一切聚合从 CLI 侧查询产生                            |
| 会话用量聚合     | `usage-session-query.ts` 的 `querySessionUsageDetail`（`usage.ts` 再导出） | 新增；唯一的会话级聚合实现                                          |
| 该查询的对外契约 | `v4/conversation/usageDetail`                                              | 新增 method，结果 schema 是唯一形状定义                             |
| 面板展示值       | `ConversationStatusPanel`                                                  | **纯只读投影**：无草稿、无乐观层、不进 CommandInbox、不新增写入路径 |
| 实时容量         | v4 会话投影                                                                | 面板不自己算、不另存副本；只当显示闸门的信号，不再渲染              |
| 全局用量聚合     | `usage-app-query.ts` 的 `queryAppUsage`（`usage.ts` 再导出）               | 设置 → 用量的唯一来源；今日分块也只由它产出                         |
| 全局用量对外契约 | `v4/usage/stats` 的 `appUsageSnapshotSchema`                               | 唯一形状定义；`today` 是新增的**可选**分块                          |

## 迁移边界

- 无 db schema 变更、无数据迁移、无版本号 bump、无生成代码。
- 不改 `queryTaskUsage`、`v4ConversationUsageResultSchema`、legacy `session/usage`。
- 卡片区新增的 section 只在 `variant !== "mini"` 时渲染（沿用现有规则）；胶囊的优先级链只**追加**最末一档用量兜底，既有分支次序不动。
- 侧栏 tab 下线：删除 `app-shell/UsageSidePane.tsx`、`UsageSidePaneTab` / `OpenUsageSideTabRequest` / `OpenScopedUsageSideTabRequest` / `createUsageSidePaneTab` / `openUsageSidePane`、`useAppPanels` 的 `handleOpenUsage`、`AnimatedSidePanePanel` 的渲染分支、`SidePaneTabTrigger` 的图标与标题分支、`sidePaneTabPresentation` 的搜索词，以及 `onOpenUsage` 一路的 props 链（`App` → `WorkspaceShellLayout` → `V4WorkspaceChatArea` → `SessionPane` → `ConversationStatusPanel`）。`sidePane` 侧栏状态只存在模块内存（`taskSidePaneMemory.ts` 的 Map，无 localStorage），因此不需要为旧 tab 类型写迁移过滤——新进程里不可能存在该类型。
- 设置页今日分块：`days` 查询多带 6 列 `sum(...)` + `count(*)`；`AppUsageDayRow` 与 `appUsageSnapshotSchema` 各加字段（前者是内部端口类型，后者是**可选**的新增字段，两处都是向后兼容方向）。删除 `AppUsagePanel` 的 `formatAppUsageDuration` / `formatAppUsageDays` 与对应 i18n 键；`settings.usage.longestSession` / `currentStreak` / `longestStreak` 三个文案键一并删除。
- **workspace 归属不在本 method 内校验**（如实记录边界，不是"已修复"）：v4 面的 params 一律不带 workspace 字段（`v4ConversationUsageParamsSchema` 只有 `sessionId`），CLI 侧没有可比对的调用方 workspace，因此这里只做"按请求的 sessionId 取数，取不到返回零值"，不做授权判断——不给单个方法加一份没有参照物的假校验。隔离由两处保证：调用方经 `getReadOnlyClient` 选 workspace/远端对应的 client；pane 只用自己的 `sessionId` 取数且绝不回退。若要真正做归属授权，应在 v4 面**统一**补 workspace 字段，那是独立的协议改动。
- 已知残留：`getTaskTokenUsage`（`v4/conversation/usage`）同样不做归属校验，本次不改它以免影响既有语义。

## 验收场景

1. 有数据的会话：卡片显示 **速度 / 首字延迟 / 会话合计 / 子代理合计**（后两项为互斥集合，任一为零则隐藏该行），不显示上下文与缓存命中率。
2. 新会话（库中无数据）：显示空/零，不显示任何其他会话的数字。
3. **分屏两个 pane 各显各的**：两个会话的数字互不串。
4. 请求完成后数字自动刷新（由推送触发，不得引入轮询）。
5. 会话压缩后：容量读数在输入框下方的容量计里回落（面板不再显示它）。
6. 侧栏里**不再出现**「用量明细」tab：会话切换、刷新、重启后都不出现，也不在 tab 条或 "+" 菜单里留残影。
7. 旧 host（unknown method）：卡片只显示不可用提示，不报错、不切换口径。
8. 超过 30 天的会话：按保留期截断，不承诺历史总量。
9. 远程 / 远控会话：命中远端库，与本地会话同样呈现。
10. 中文界面下：用量读作 `121.2M`（不是 `1.2亿`），容量计读作 `438.3K / 1000K`（不是 `43.8万 / 100万`）；切到英文后单位不变。
11. 剪除：同窗口多条状态条（面板按 pane 的 sessionId 隔离，不需要标题匹配等启发式）。
12. 设置 →「用量」：**不再出现**最长聊天时长 / 当前连续天数 / 最长连续天数三项。
13. 设置 →「用量」：今日分块的总量 = 输入 + 输出（存库的 `computed_total_tokens` 已经是这个和，reasoning 不重复计入）；命中缓存与写入缓存在明细里能落到具体数字，请求次数与工具调用次数为当日计数。
14. 设置 →「用量」今日分块与热力图**当日格子**一致：两者都取同一 `dayIndex`，不得出现两个不同的"今日"。
15. 设置 →「用量」切到 7 日 / 30 日区间时，今日分块**不变**（它来自不随区间变化的当日口径）。
16. 旧 CLI（响应里没有 `today`）：今日分块显示 `--`，不显示任何区间数字，不报错。

## 测试

- **已执行**：`apps/zcode-cli/packages/adapters/test/sessionUsageDetail.test.mjs`（`node:test` + `node:sqlite` 内存库，跑真实 `SQLITE_MIGRATIONS` 建表），5 例通过：计费口径只累加 completed 且与按模型分组对账 / 最近一次完成请求与逐请求倒序受 limit 约束 / 工具调用分组与总数对账 / 子代理只认 `task_type='subagent_child'`（带用量的 `selection_side_chat` 不计入、也不混进本会话合计）/ 保留期随结果返回且未知会话返回零值。
- **已执行（本次新增）**：`apps/zcode-cli/packages/adapters/test/appUsageDayBreakdown.test.mjs`，4 例覆盖今日分块的取数口径，全部通过：
  1. 单日窗口下 `days` 行与 `totals` 逐项相等（今日与合计不可能分叉），并锁定"按时间窗过滤、**不按 status 过滤**"的既有口径；
  2. 总量取存库的 `computed_total_tokens`，不由输入/输出/推理重算（构造分项之和不等于存库总量，若改成重算会立刻失败）；
  3. 跨本地日按调用方时区（UTC+8）归桶，且后一天窗口取不到前一天的行；
  4. `turn_usage` / `tool_usage` 计数合并进同一 `dayIndex`，只有单一来源的日期也补零而不是 `undefined`。
     两文件合计 9 例全通过（`node --test test/*.test.mjs`，跑在 `dist` 上，需先 `tsc`）。
- **已执行（真实库）**：在本机 `~/.zcode/cli/db/db.sqlite` 上直接跑 `queryAppUsage` + `buildAppUsageSnapshot`，`today` 分块产出 `date=2026-09-22`，`totalTokens=333942191` 与热力图当日格子完全一致，`totalTokens = inputTokens + outputTokens` 精确成立，`cacheHitRate=0.988`。同一份数据里 `cacheCreationTokens` 为 0（该供应商不上报缓存写入），因此"写入缓存"格显示 `0` 是真实结果，不是缺数据。
- **已执行（可视化，桌面开发态实机截图）**：`pnpm dev:desktop:test` + 隔离数据目录（`ZCODE_DATA_BASE_DIR=~/.zcode-dev-home`、`ZCODE_SESSION_DB_PATH=<devHome>/.zcode/cli/db/db.sqlite`），用 `playwright-core` attach 开发态 Electron 的 CDP（dev 构建固定监听 `127.0.0.1:9229`），进设置 →「使用统计」实测：
  - **宽屏 1787×1006**：「今日用量」卡为**4 列 × 2 行**的 8 格（Token 总量 333.9M / 输入 332.3M / 输出 1.7M / 命中缓存 327.3M / 写入缓存 0 / Cache 命中率 98% / 请求次数 1855 / 工具调用 40），标题右侧显示日期 `2026年9月22日`；「累计概览」四项（1.4B / 556.9M / 11 / 2）带竖分隔线，右侧显示保留期提示「本地只保留近 30 天记录」；热力图、时间范围 tabs、趋势图、模型占比纵向间距一致，无溢出、无错位。
  - **1024 / 768**：今日卡仍为 4 列，热力图 12 个月标签**无截断**。
  - **420×900（手机宽度）**：今日卡自动降为**2 列 × 4 行**，累计概览改为纵向堆叠，8 个数值的 `scrollWidth <= clientWidth`（无溢出、无省略）——逐项断言过，不是目测。
  - **侧栏 tab 条与 "+" 菜单**：展开侧边面板后空态只给「审查 / 终端 / 浏览器」，打开一个 tab 后点「新增标签」(+) 弹出的菜单项同样是这三项，**没有「用量明细」**，页面全文也不含该字样。
  - 如实说明两点局限：(1) 今日卡的**状态区（悬浮窗/卡片）用量分区**未做实时截图复验——它需要一条带用量数据的真实对话，本次只有空工作区；该分区是未改动代码，且产物中 `chat.statusPanel.usage` 与 `sidePane.usageSubagentTotal` 均在。(2) 420px 下**热力图的月份标签**会出现省略号（`1...`、`11...`）：这是热力图组件在手机宽度下的既有行为，该组件本次未改动，不属回归。
  - 复现要点（都是踩过的坑）：`pnpm dev:web` 单独跑不出可用界面（web 端是需要桌面宿主才能提交供应商配置的远控壳）；`scripts/dev-desktop-env.mjs` 的 `--onSuccess 'node dist/entry-http.js'` 在 Windows cmd 下引号被吃掉会让 server dev 直接失败；本机 `node_modules/electron` 原本没有 `dist/electron.exe`（二进制未下载），需先 `node node_modules/electron/install.js`；用一个**只写 SQL 不写 `schema_migration` 记账**的种子库会让宿主启动直接失败（`Storage preparation failed: sql_failed`），种子必须按 `sha256(sql.trim())` 补齐迁移记账。
  - 验证用的临时脚本、截图、隔离库种子与占位供应商（`sk-dev-ui-layout-check`）在验证后已全部删除；核对了真实配置目录的 mtime 与占位串，确认没有写进用户真实数据（占位 key 只出现在 `~/.zcode-dev-home/.zcode/v2/provider_config.json`）。
- **已执行的门禁**：`pnpm typecheck`（通过）、`pnpm lint`（0 error / 33 warning，全部存量，改动文件内新增 0 条）、`pnpm architecture:check --changed`（0 违规）、改动文件 + 新增测试的 `oxfmt --check`（全绿）。CLI 侧 `turbo` 在本机 shell 不在 PATH，改用逐包直跑：`@zcode/contracts` `tsc`、`@zcode/adapters` `tsc --noEmit`、`@zcode/bootstrap` `tsc --noEmit` 均通过。
- **产物核验（机械证据，不是"应该打进去了"）**：`ZCODE_ENV=production ZCODE_RELEASE_TAG=v0.2.0 ZCODE_SKIP_REMOTE_ASSETS=1 pnpm bundle:desktop -- --os win --arch x64` 成功（脚本自带的 runtime 依赖校验、bundle 体积审计 155.5 MiB / 上限 500 MiB、channel 文件 `latest.yml` 校验全绿），产物 `dist/ZCode-0.2.0-win-x64.exe`（163,074,895 B，sha256 `fc2437438154a82a5cad5dd6e9d4832776889f9ca078cfdedf0f5eb4ec248bd8`）。随后直接在产物内取证：
  - `resources/glm/zcode.cjs`（本次构建重新生成，非陈旧）中按日聚合 SQL 原文为 `…coalesce(sum(cache_creation_input_tokens), 0) as cacheCreationTokens, coalesce(sum(cache_read_input_tokens), 0) as cacheReadTokens, count(*) as modelRequestCount … group by dayIndex`，且存在 `cacheHitRate:<共享函数>({inputTokens:…})` 与返回对象里的 `today:<值>`；
  - `resources/app.asar` 中 `cacheHitRate:…modelRequestCount:…turnCount:…toolCallCount:` 的字段序列与 `today:<schema>.optional()` 均在；`今日用量` / `命中缓存` / `请求次数` / `累计概览` 等新文案在，`最长聊天时长` / `当前连续天数` / `最长连续天数` / `打开用量明细` / `sidePane.usage"` / `usage-side-pane` 全部不在，而保留项 `chat.statusPanel.usage` 与 `sidePane.usageSubagentTotal` 仍在。
- **产物与源码的唯一差异**：打包完成后又改了三处**仅注释**的文档性描述（`usage.ts` / `server-operations.ts` / `zcodeAgent.ts` 里"与 app 级用量同源"这一错误说法，已改为如实描述两套窗口不同）。注释不进入 bundle，故安装包与当前源码在行为上一致；若要求注释与产物字面完全对应，重跑一次打包即可。

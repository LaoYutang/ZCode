# 会话引用评论

## 背景

会话与文件预览里选中文本后，`SelectionActionMenu`（`packages/ui/src/v4/SelectionActionMenu.tsx`）提供「添加到当前任务」与「在辅助对话中提问」两个动作：引用立即进入输入区 pill，发送时序列化为 `# userselect:` 尾块。选中即引用，用户无法在同一处说明「我为什么选中它」。

仓库里已经有现成的对照形态：代码预览的 `CodeCommentEditor`（`packages/ui/src/components/ui/code-viewer.tsx`）是「添加评论 → 可选评论 → 添加到对话」，产出 `# Code comments:` 尾块且带 `comment` 字段。会话侧缺的正是这一步，两个选区入口因此存在交互差。本 spec 把会话侧选区入口收敛成单一「评论」入口，并保留「评论可空」。

## 规则

### 一、单一入口：评论

- 参考菜单只保留一个引用入口，标签为「评论」（`chat.selections.comment`），替代原「添加到当前任务」。原「一键引用」路径由「评论 → 直接提交」承担。
- 「在辅助对话中提问」保持既有语义与位置：它指向另一个目的地（辅助对话），不与「评论」合并，也不因此次改动获得评论能力；它的禁用条件由第十节收敛为「存在非计划审批的挂起交互」。
- 选区超过单条上限时仍只显示上限提示，不出现「评论」入口——不可用动作不进输入态。

### 二、评论可空，提交即入队

- 点击「评论」后就地展开浮层（与动作菜单同一锚点、同一套定位）：引文预览（截断）+ 自动聚焦的 Textarea + 提交按钮。
- 浮层内文字颜色显式取主题前景色（`text-foreground`），与动作菜单同源：浮层经 portal 挂到 `document.body`，根元素不声明前景色，且 Electron 为 vibrancy 不设 `color-scheme`，没有显式前景色时 UA 默认色是黑色——暗色主题下输入的文字会直接看不见。`aria-label` 与 Textarea 同层补齐，避免去掉占位提示后输入框失去可访问名称。
- 输入框不设占位提示：引文预览与提交按钮已经说明该处用途，「可选」语义由「提交空评论等同纯引用」承担。
- 评论文本 trim 后为空时提交，等同于纯引用：引用对象不写 `comment` 字段，尾块 item 也不出现该键。
- 提交后引用进入既有写入路径，pill 累积到输入区，随下一次发送与正文一起进 prompt。**不即时发送**，也不改变「发送时序列化」的既有语义。

### 三、关闭语义：点击外部即关闭且不提交

- 点击浮层外部、按 Esc、会话或作用域切换（`enabled` 变 false / scopeKey 变化）→ 关闭并丢弃草稿，不产生任何写入。
- 只有提交按钮或 Ctrl·Cmd+Enter 才写入。因为「空评论也想引用」由提交按钮承担，浮层不设取消按钮。
- 快捷键挂在 document 上而不是 textarea 上：点到浮层空白处会让焦点离开输入框，挂在输入框上会让 Esc 与提交键静默失效。组合态（`isComposing`）下的 Enter/Escape 属于输入法，不当作提交或关闭。
- 浮层位置固定在被冻结的锚点上，不跟随时间线滚动（与输入态冻结同一来源）；关闭只依赖点击外部、Esc 与作用域变化。

### 四、输入态必须冻结选区（关键不变量）

所有者：`useTextSelection`（实时选区生命周期）与浮层组件本地 state（输入态草稿）。

必须冻结的原因是既有监听语义与文本输入冲突：浮层获得焦点后 DOM 选区塌陷，`useTextSelection` 的两条监听会立即卸载浮层——`selectionchange` 见塌陷即 `close()`；`keyup` 非 Esc 即 `schedule()` → `inspect()` 读到空选区返回 null → snapshot 置空。也就是说「在输入框里打字」本身就会关掉浮层。

规则：

- 进入输入态时把 `{position, reference|text}` 快照进组件本地 state，同时把 hook 的 `enabled` 置 false；输入态渲染只依赖快照，不再读取实时选区。
- 退出输入态（提交或关闭）后恢复实时监听。
- 输入态期间不写 scope：草稿不是引用，只有提交才调用 `dispatchConversationSelectionAdd`。

```text
pointerdown(评论) → preventDefault（保住选区）
  → click → 冻结 {position, reference} + enabled=false（撤销两条 document 监听）
  → 输入态：只有 textarea 与本地草稿，读不到也不改 scope
      ├─ Ctrl/Cmd+Enter / 提交按钮 → 组装引用（可选 comment）→ dispatchConversationSelectionAdd（唯一写入路径）
      │                                → pill 累积 → 发送时 serializeComposerPromptContexts
      └─ Esc / 点击外部 / 作用域变化 → 丢弃草稿
  → 恢复实时监听（enabled=true）
```

### 五、数据模型：comment 与 plan 都是可选字段，不新增构造路径

- `ConversationSelectionText` 增 `comment?: string`，消息引用与 markdown 引用共用。
- 尾块仍是 `# userselect:` + JSON 数组，item 允许第三个键 `comment`、第四个键 `plan`；`isConversationSelectionText` 的严格键集同步放开，否则新版历史在解析时回退成「原文可见」，整段尾块会泄漏进气泡。
- 引用 id 仍由选区手势内的 `createConversationSelectionReference` 产出一次；提交携带评论时只在该对象上补 `comment`，不新增第二个构造点、不新增写路径。
- `plan?: string` 是「引用所在文档的正文快照」：计划 tab 携带整份计划正文。它解决的是模型不会主动按 `path` 去读文件的问题——只给路径时，辅助对话会照着 fork 历史作答，说「这不是我上一轮说的」（见第八节）。快照仍是同一次构造的字段，不新增构造点。
- 序列化顺序不变：selections → code comments → web → pptx，解析严格相反；item 内键序为 `{ path?, text, comment?, plan? }`。

### 六、预算与去重

- **总量**预算按 `text.length + comment.length` 计：评论不能绕过 16,000 上限；评论单独过长会以既有「总计」提示被拒，不新增常量与文案。
- **单条**上限仍只判 `text`，保持「单条引用最多 8,000 个字符」的既有语义。
- **计划正文另计一条总量**：`Σ plan.length ≤ 20,000`（与 CLI 的 `PLAN_MODE_MAX_PLAN_CHARS` 对齐，单份计划不可能超过它）。不并入 16,000：整份计划会直接撑爆既有选段额度，而选段与文档正文是两类上下文。超限同样以既有「总计」提示被拒。
- **去重键**纳入 `comment`、不含 `plan`：引用身份是「哪段文字 + 什么评论」，计划版本只是附加上下文；纳入 `plan` 会让同一片段在计划每次修订后都能再插一条等价 pill。
- pill 不展示 `plan`（正文太长），它只出现在发给模型的尾块里。

### 七、展示

- pill 在引文正文下方显示评论（截断），与 `CodeCommentAttachmentChip` 的评论行同形，来源信息行不变。

### 八、覆盖面：会话、文件预览与计划 tab

三个选区表面共用同一入口、同一冻结规则与同一写路径，差异只在「引用目标」与来源标识：

| 表面                      | 组件入口                                                   | 引用变体                                                      |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| 会话时间线                | `ConversationSelectionTooltip`（行内 `toolCall` 行已可选） | `MessageSelectionReference`（带 sourceRowId/contentType）     |
| 文件预览 markdown         | `MarkdownPreviewContent` 内的 `MarkdownSelectionTooltip`   | `MarkdownSelectionReference`（带 sourceKey/sourceTitle/path） |
| 计划 tab（`plan-detail`） | `PlanDetailSidePane` 内新增的同一 tooltip                  | `MarkdownSelectionReference`（sourceKey 取计划身份）          |

计划 tab 的目标与来源直接从 tab 自身推导，不额外透传：

- `sessionId = tab.parentSessionId`。侧栏 tab 的可见性本身就按 `parentSessionId === 当前任务` 收窄（`getVisibleSidePaneTabsByScope`），因此引用必然落回计划所属的那条对话，不存在跨会话歧义。
- `workspaceKey = buildTaskWorkspaceKey(tab.workspacePath, tab.workspaceIdentity)`，与 composer 的 scope key 同源（均为 `workspaceIdentity?.trim() || workspacePath` 规则），保证 pill 出现在可见输入区而不是无人渲染的 scope。
- `sourceKey = plan:<parentSessionId>:<toolCallId>`（稳定、可去重）；`sourceTitle` 依次取计划标题（`getPlanDirectoryTitle`）、计划文件标签（`getPlanFileLabel`）、兜底「计划」；`path = tab.planFilePath`（存在时发给模型，缺省则只发正文）。
- **`plan = 创建引用时的计划正文快照`**（`PlanDetailSideContent` 当前渲染的 markdown）。计划 tab 是唯一携带 `plan` 的表面：计划正文常只存在于 ExitPlanMode 的 tool 输入里（`planFilePath` 可能根本没有），而模型不会主动按 `path` 去读文件——只给路径时辅助对话会照着 fork 历史作答，说「这不是我上一轮说的」。快照在创建引用的那一刻取一次，之后计划再修订不影响已入队的引用。
- 冻结范围键只随 `sourceKey`/`path` 变化，不随计划正文变化：计划正文来自 live 投影，流式期间每次增量都重建 scope 会把刚建立的选区快照丢掉。`plan` 只进引用对象，不进范围键。

### 九、计划待确认期间：评论即修改意见

计划待确认（该对话存在挂起的 `plan_approval` 交互）时，composer 是阻塞态：`ConversationComposer` 只把它从视觉上隐藏（`display: none`，保留挂载以免丢草稿）。此前「评论」入口仍可用，于是引用被写进 composer 的作用域却没有任何可见位置，也不参与对计划的答复（答复走 `resolveInteraction`，不读引用），只会在确认结束后静默跟随下一条 composer 消息发出。本节把它收敛成一条明确路径。

- **作用域**：本节规则作用于该对话（`sessionId` + `workspaceKey`）内的待发引用，不区分来源表面（计划 tab / 文件预览 / 会话时间线都算）——它们本来就是「下一条消息」的同一份引用集合。
- **可见**：只要该对话有待发引用，计划确认卡片就必须列出它们（复用 `ConversationSelectionReferenceChip`）并支持逐条移除。确认期间 composer 不可见，移除入口不能只存在于 composer，否则「批准被隐藏」会把用户锁死。
- **有评论则不给批准**：`plan_approval` 的批准选项（`value === "approve"`）在该对话存在待发引用时不再渲染；想直接批准必须先移除评论。历史 `answerDrafts` 里残留的批准值一并作废，不能因为选项被隐藏就退化成自定义答案提交。
- **只有评论就是按评论修改计划**：提交时把待发引用序列化成 `# userselect:` 尾块（复用 `buildPromptWithConversationSelections`）作为答复文本：
  - 用户填了理由 → `理由 + 尾块`；没有填理由 → 尾块本身，**不再**走「空答案 = 拒绝并停 turn」（`turnControl.stopTurnAfterResult`）那条分支。
  - 两种情况在 CLI 侧都落进既有 `plan_approval_feedback` 通道（非空且不等于批准值 → deny + 反馈升级为真实 user message），模型据此修订计划。
  - 兜底：有评论时即使答案等于批准值（残留草稿等）也按本规则改写，不存在「带评论批准」。
- **消费即清理**：提交被接受后只移除本次冻结的引用（与 composer 发送同一冻结语义）；提交失败或被拒则保留。
- **回归边界**：没有待发引用时，批准、空答案自动批准与 AskUserQuestion 语义与本节引入前完全一致。

所有者与同步：

- 引用数组仍由 `conversationSelectionReference.ts` 的 `referencesByScope` 独占；新增**变更广播**（`conversation-selection-change`），所有订阅者（composer 与计划确认卡片）只通过它同步，不各自维护副本。这条广播是必需的：确认期间两个消费方同时挂载（composer 仅被隐藏），任一侧的新增/移除都必须让另一侧立刻看到。

非目标（本节）：不覆盖 legacy 权限卡片形态的计划审批（`PermissionDialog` 的 switch-mode / `allowOnce` 分支）。当前 Agent 的 ExitPlanMode 由 v4 投影成 `userInput` + `schema.interaction === "plan_approval"`，UI 侧只经过 `ElicitationDialog`；该形态恢复时另立规则。

### 十、计划待确认期间的选区提问：阻塞门禁按交互语义收窄

计划待确认时该对话存在挂起的 `plan_approval` 交互，而选区入口的父会话阻塞判定取的是「第一个非 `workspaceHookReview` 的挂起交互」。于是同一时刻：计划 tab 与文件预览的「在辅助对话中提问」被禁用；会话时间线的选区菜单整条不出现；但侧栏固定入口（不带引用）与 `/side`、`/btw` 斜杠命令本来就允许在阻塞期间创建辅助对话。结果是「能开空白辅助对话，却不能带着选中的计划片段开」。

规则：**计划审批不构成选区入口的阻塞。**

- **阻塞判定**（唯一所有者：`resolveSelectionInteractionBlocked`，`packages/ui/src/lib/planApproval.ts`）：先剔除 `workspaceHookReview`（既有语义，不计入阻塞）；没有剩余挂起交互 → 不阻塞；剩余**全部**是计划审批 → 不阻塞；出现权限请求或其他 `userInput` → 阻塞。
- **计划审批识别**（唯一所有者：`isPlanApprovalPendingInteraction`，同文件）：`payload.kind === "userInput"` 且 `payload.schema.interaction === "plan_approval"`。`toolName` 不参与判定：v4 侧以 `schema.interaction` 为准；legacy 形态与第九节同属非目标。
- **三个表面用同一判定**：`SessionPane` 里注册 opener 的 `referenceBlocked` 与会话时间线的 `selectionActionsEnabled` 都改读该函数，保证计划 tab / 文件预览 / 会话正文表现一致。
- **不变项**：辅助对话自身的挂起交互仍禁用选区提问（`selectionSideActionBlocked` → `chat.selections.sideBlocked`）；composer 底部 dock 的阻塞态（`blockingInteractionId`）与子会话的阻塞上报保持原语义。

依据（为什么安全）：

- 引用落点是辅助对话的 scope（`targetSessionId = childSessionId`），不写父会话 composer，因此不影响计划审批的答复语义——第九节收敛「评论即修改意见」的理由在这里不适用。
- `createSelectionSideSession` 不带 `firstInput` 时不是输入命令（准入层只登记真正的输入），不排队、不要求父会话空闲。
- 计划待确认期间创建 child 走既有稳定切点：fork 只保留已提交的本轮 real-user 输入，不复制 goal/queue 与阻塞运行态（`selectionSideChatHistoryMessages`）。

已知行为（不是缺陷）：辅助对话的初始 transcript 不包含计划正文；引用序列化带 `path`（计划文件路径，见第八节），正文由模型按该路径自行读取，计划未落盘成文件时只有片段。

## 唯一所有者

| 事实                                     | 所有者                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| 引用数组（按 workspace + session scope） | `packages/ui/src/lib/conversationSelectionReference.ts` 的 `referencesByScope` |
| 引用写入路径                             | `dispatchConversationSelectionAdd`（唯一）                                     |
| 引用变更广播                             | 同上文件的 `setConversationSelectionReferenceScope`（唯一的通知出口）          |
| 计划确认的批准/反馈规则                  | `packages/ui/src/lib/planApproval.ts`（批准选项收窄 + 反馈文本组装）           |
| 计划确认卡片的提交与冻结清理             | `packages/ui/src/v4/V4InteractionDialogs.tsx` 的 `plan_approval` 分支          |
| 尾块格式、解析、键校验、预算、去重       | 同上文件（唯一）                                                               |
| 序列化/反序列化顺序                      | `packages/ui/src/v4/composer/composerPromptContexts.ts`                        |
| 实时选区生命周期                         | `packages/ui/src/hooks/useTextSelection.ts`                                    |
| 输入态草稿                               | 浮层组件本地 state（`enabled=false` 期间；不入 scope、不落盘）                 |
| 浮层定位（动作菜单与评论框共用）         | `packages/ui/src/hooks/useAnchoredPopupPosition.ts`                            |
| 入口、标签与禁用态                       | `packages/ui/src/v4/SelectionActionMenu.tsx` + i18n                            |
| 评论的键盘契约（提交/取消快捷键）        | 与代码预览评论共用同一份判定与文案                                             |
| 计划 tab 的引用目标与来源标识            | `packages/ui/src/app-shell/PlanDetailSidePane.tsx`（按 tab 推导）              |
| 选区入口的父会话阻塞判定                 | `packages/ui/src/lib/planApproval.ts` 的 `resolveSelectionInteractionBlocked`  |

## 失败语义

| 情况                         | 表现                                                              |
| ---------------------------- | ----------------------------------------------------------------- |
| 选区超过单条上限             | 只显示上限提示，无「评论」入口                                    |
| 评论为空或仅空白             | 提交后只有引文；引用对象与尾块 item 都没有 `comment` 键           |
| 引用条数或总量超限           | 写入被拒，按既有 `limitReason` 给出 count/total 提示；草稿丢弃    |
| 输入态中点击外部 / Esc       | 浮层关闭，输入区不新增 pill                                       |
| 输入态中点击浮层空白处       | 焦点离开输入框但浮层保持打开，快捷键仍生效（键位挂在 document）   |
| 输入态中会话或作用域切换     | 浮层关闭，草稿不入队                                              |
| 计划待确认且有评论时想批准   | 没有批准入口：先移除评论才能直接批准                              |
| 计划确认提交失败或被拒       | 评论保留在该作用域，不清空                                        |
| 计划待确认（仅计划审批挂起） | 选区入口可用：辅助对话创建或复用，引用写入辅助对话输入区          |
| 计划待确认且并存其他挂起交互 | 与第十节引入前一致：计划 tab / 预览禁用提问，会话时间线不出现菜单 |
| 旧版客户端读新版历史         | 严格键集解析失败 → 尾块原文进入气泡（仅外观，见「非目标」）       |

## 非目标

- 不做即时发送：引用仍随下一次发送批量进 prompt。
- 不给已入队的 pill 加评论编辑入口，也不做评论历史/持久化。
- 不改变「在辅助对话中提问」的行为，不为该路径提供评论输入。
- 不改 `# Code comments:` 管线，不动 `userselect` 之外的另外三类尾块。
- 不为移动端单独设计：浮层与定位复用同一组件，只跟随既有响应式约束。
- 不为「旧版读新历史」做额外兼容层：降级属于外观问题，改块格式反而要再引入一次历史迁移。

## 验收场景

1. 会话中选中助手文本：菜单只有「评论」与「在辅助对话中提问」；点「评论」出现输入框并自动聚焦，引文预览等于所选文本。
2. 输入评论后 Ctrl/Cmd+Enter（或点提交）：输入区出现引用 pill，hover 可见引文与评论；发送后模型收到的 `# userselect:` item 含 `comment`，气泡里看不到尾块。
3. 不填评论直接提交：pill 只有引文，尾块 item 没有 `comment` 键。
4. 输入态点击浮层外部或按 Esc：浮层关闭且未新增 pill。
5. 输入态连续输入（含空格、标点、退格）期间浮层不消失——冻结生效。
6. 文件预览选段走同一入口与同一冻结规则。
7. 同一句引文写两条不同评论：两条 pill 并存；同文同评论重复添加不新增。
8. 引文与评论合计超过总预算：被拒并给出既有「总计」提示。
9. 回归：辅助对话入口行为不变；`/review` 与 `# Code comments:` 的序列化顺序不变。
10. 从计划卡片点「查看完整计划」进入计划 tab：选中计划正文出现「评论」入口，提交后 pill 出现在**该计划所属对话**的输入区（而非其它对话），hover 可见引文、评论与计划来源。
11. 计划 tab 与文件预览同时开着时，各自选区只触发自己表面的入口，互不串扰；切到别的对话后计划 tab 不可见（可见性由 `parentSessionId` 收窄，非本 spec 引入）。
12. 暗色主题下打开评论浮层：引文、输入的文字与快捷键提示都清晰可读，不出现 UA 默认黑色文本；输入区没有占位提示行，输入框仍有可访问名称。
13. 计划待确认时在计划 tab 评论：确认卡片列出这条评论，批准选项消失；不填理由直接提交 → 模型收到的用户消息是 `# userselect:` 尾块（含引文与评论），据此修订计划；提交后该评论从输入区消失，不会随下一条消息重复发送。
14. 在确认卡片上移除评论 → 批准选项恢复，composer 重新出现时也没有该 pill；无评论时整套计划确认行为（批准、空答案自动批准、AskUserQuestion）与本节引入前一致。
15. 计划待确认（该对话仅 `plan_approval` 挂起）时，计划 tab / 文件预览 / 会话正文选中文字，「在辅助对话中提问」都可点：侧栏创建或复用辅助对话，引用出现在辅助对话输入区，且不出现在计划确认卡片上（分属不同 session scope）。
16. 计划待确认且同时存在权限请求或非计划审批的 `userInput`：三个表面维持既有禁用/隐藏与提示文案。
17. 计划批准后选区入口行为与第十节引入前一致；辅助对话自身挂起交互时提问仍禁用（`chat.selections.sideBlocked`）。
18. 计划 tab 选中一段文字后提问：辅助对话收到的 `# userselect:` item 同时含选段、计划文件路径（若有）与整份计划正文；辅助对话据此回答提问，不需要自己读文件，也不会说「这不是我上一轮说的」。同一份计划的正文只占它自己的 20,000 额度，不挤占选段预算；计划正文变化后再次引用同一片段不会被去重键判重之外的原因拒绝。

## 测试

- 纯函数（构建/解析/键校验/预算/去重/顺序）由 `packages/ui/test/conversationSelectionReference.test.mjs` 覆盖。`packages/ui` 此前没有可运行的测试入口，本次为其补 `test` script（`tsx --test test/*.test.mjs`），与 `packages/desktop` 的 `node --test test/*.test.mjs` 约定一致。
- 交互已在 jsdom + 真实 React 渲染下验证过一轮，两个选区表面各一条链路：会话侧为单一「评论」入口、点击后自动聚焦与引文预览、输入态冻结（选区塌陷与 keyup 后浮层仍在）、Ctrl+Enter 提交后引用带评论写入 scope、点击外部关闭且不写入、空评论提交不写 `comment` 键、辅助对话入口不变；预览侧为同一入口、同一冻结、提交后产出带评论与路径的 markdown 引用。会话侧还用「选区塌陷会关闭动作菜单」作为反证，确认该环境确实能触发关闭路径而非空断言。该脚本依赖 `jsdom`，仓库当前没有 DOM 测试依赖，因此**未纳入仓库**（临时脚本已删除）；若团队接受引入 jsdom 作为 `packages/ui` 的 devDependency，可将其提升为常驻用例。
- 真机交互仍按验收场景 1–6、9–12 在 `pnpm dev:desktop` 下人工核对（视觉、鼠标/触控命中、真实选区行为不在 DOM 替身覆盖范围内）；仓库不为此新增 E2E 框架。场景 12 是纯样式约束（前景色、无占位提示），同样随人工核对。
- 计划 tab 的链路按与预览侧相同的方式验证过一轮（同一份临时 jsdom 脚本，已删除）：按 `PlanDetailSidePane` 的同一组表达式与同一批真实模块组装表面，断言单一「评论」入口、自动聚焦、输入态冻结，以及提交后写入**计划所属对话**（`parentSessionId` + identity 规则算出的 workspaceKey）的 markdown 引用带 `sourceKey`/标题/计划文件路径，且不落进其它对话的 scope。同一脚本还把计划表面与预览表面同时挂载，验证同一时刻只出现一个工具条、各自只写入自己的 `sourceKey`（场景 11）。计划页自身依赖会话投影（需要平台服务），因此该脚本不渲染真实 pane 组件，这一步由人工核对。
- 计划来源的纯函数（`resolvePlanSelectionSource`：身份不随正文漂移、标题回退链、无文件时不写 `path`）已作为常驻用例并入同一测试文件。
- 计划确认的批准/反馈规则同样是纯函数（`packages/ui/src/lib/planApproval.ts`：有评论时收窄批准选项、把待发引用组装成反馈文本、有评论时批准值被改写），并入同一测试文件；卡片内的键盘路径（Tab/↑↓/Enter/Ctrl+Enter、空答案提交）与冻结清理依赖 React 渲染，按既有做法人工核对（场景 13/14）。
- 引用变更广播（`conversation-selection-change`）的跨组件同步同样只能靠渲染验证：仓库没有 DOM 测试依赖，由场景 14 的人工核对覆盖。
- 选区阻塞门禁同样是纯函数（`isPlanApprovalPendingInteraction` / `resolveSelectionInteractionBlocked`：`workspaceHookReview` 不计入、仅计划审批不阻塞、并存权限请求阻塞、普通 `userInput` 阻塞），并入同一测试文件；并用 `selectionSideChatRuntime` 的注册/请求链路断言「仅计划审批挂起时带引用的提问被放行、并存权限时被拒」。三个表面的可见/禁用表现按验收场景 15–17 人工核对。
- 必须执行 `pnpm typecheck`、`pnpm lint`、`pnpm fmt:check`、`pnpm architecture:check --changed`，并如实报告结果。

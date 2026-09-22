# 无账号模式的供应商配置

## 背景

ZCode 原设计与智谱官方账号体系绑定：应用内置 Z.ai / BigModel 的 OAuth 登录，登录凭据换取的 Coding Plan API Key 经 Account Overlay 变成可执行 provider，并派生出一组周边能力（闲时任务、套餐额度、模型徽标、官方 Server MCP 额度、会话分享与反馈鉴权、遥测身份、远程 provisioning）。

这套能力有两个问题：

1. 全部指向官方服务端点（`zcode.z.ai`、`api.z.ai`、`open.bigmodel.cn`），对自部署与纯 BYO API Key 场景无用。
2. 内置配置**不可关闭**：account provider 的 `enabled` 在 `packages/provider/src/resolver.ts` 被强制为 `true`，用户个人配置写 `access` 或 `enabled: false` 会被 `config-service.ts` 直接拒绝，schema 层也禁止用户文件出现 `zhipu-account`。

本次变更移除全部账号与登录能力，模型供应商完全由用户自行添加。

## 规则

### 1. 供应商的唯一来源

用户个人 provider 配置（默认 `~/.zcode/v2/provider_config.json`）是**唯一**的供应商事实来源。内置配置只提供两样东西：

- **模板**（`templateRules`）：仅保留 `access.type: "api-key"` 的模板，作为「添加供应商」表单的预填值。
- **模型元数据**：保留通用 `modelRules` / `modelApiRules` / `providerSiteRules`。这些规则按 `api.type` 与 `baseUrl` 匹配，用户自建同 baseUrl 的 provider 仍能获得正确的上下文长度、推理档位与视觉能力。

`providerRules` 与 `builtinProviderModelRules` 清空：不再声明任何具体 provider。

### 2. provider 解析不再有账号层

- `ProviderConfigResolverInput` 移除 `accountProviders` 与 `accountStates`，解析结果只由内置规则与个人配置叠加得出。
- provider 的 `enabled` 只由 `rule.enabled` 决定，不再有「账号类型强制启用」分支。
- 移除 `accessEntitled`（权益门禁）与 `accountCurrent`（当前连接）两个执行条件：provider 是否可执行仅由 `enabled`、配置有效性与用户是否已填凭据决定。
- `access.type` 联合移除 `zhipu-account` 成员，schema 同步收紧。
- `sources.ts` 不再产出 `AccountProviderConfigSnapshot`。

### 3. 应用无登录状态

应用不再持有、读取或刷新任何账号凭据。凭据存储（`packages/services/src/credential/**`、`adapters/src/auth/shared-credentials.ts`）**保留**：用户自建 provider 的 API Key 与第三方 MCP server 的 OAuth 授权仍写在这里。

### 4. 移除登录派生的全部功能

闲时任务、套餐订阅与额度面板、套餐身份徽标与升级引导、官方 Server MCP 凭据派生、会话分享上传与反馈提交的登录鉴权、遥测身份与营销归因、远程工作区的凭据下发，随登录一并移除。这些能力没有登录即无法工作，保留会造成「入口存在但必然失败」的假功能。

### 5. 保留「自带 API Key」入口

原 WelcomeScreen 的「使用 API Key」与「跳过」是登录之外唯一的可用路径，必须保留并成为默认引导。原 `login/` 目录下与登录无关的表单能力迁移为独立的「添加供应商」入口。

## 唯一所有者

| 状态                       | 所有者                                                          |
| -------------------------- | --------------------------------------------------------------- |
| 内置供应商模板与模型元数据 | `packages/provider/src/sources.ts` 读取的内置配置文件           |
| 用户供应商与默认模型选择   | 个人 provider 配置文件（`packages/provider-node` 的仓库实现）   |
| provider 解析结果          | `ProviderConfigResolver`（`packages/provider/src/resolver.ts`） |
| 通用凭据                   | 凭据存储服务（与账号无关）                                      |

## 失败语义

| 情况                                       | 表现                                                                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 首次启动、尚未添加任何供应商               | 模型选择为空，界面引导添加供应商；不阻塞启动，不出现登录入口                                                            |
| 历史会话的默认模型指向已移除的 `account:*` | 该选择解析为不可用，提示重新选择；不抛异常、不崩溃                                                                      |
| 内置配置远程下发了更高 revision            | 已切断远程来源（`applyRemoteRelease` 已随死代码删除），不再回灌；打包配置与 Active 缓存按 revision 取大，见「迁移边界」 |
| 用户删除最后一个供应商                     | 回到「首次启动」状态，可再次添加                                                                                        |

## 迁移边界

- 历史会话与设置中指向 `account:*` 的模型选择将失效（渲染为不可用）。冻结的迁移脚本（session-store `0020`/`0021`/`0022`、tasksDatabase `official-glm-selection-v3`）**不改写**，保持历史可重放，但其改写的目标 id 不再有对应 provider。
- 内置配置的 active 缓存（`~/.zcode/v2/<endpoint>/.../zcode-builtin.json`）可能残留旧 revision。当前 Bundled 为 revision 31，而 `selectReleaseCandidate` 取 Bundled 与 Active 中 revision 较大者，所以旧缓存只有 revision ≥ 31 时才可能有影响；同 revision 内容冲突时回退 Bundled。
- 已登录用户的凭据文件不主动删除，但不读取。升级后账号相关凭据成为无主的死数据。

## 迁移进度

无账号模式迁移已完成，仓库当前全绿。

### 第一轮移除的遗留面

- 登录/支付 deep link 的 renderer↔main IPC：`PlatformChannels.OAuthRegisterState` / `OAuthCallback` / `OAuthCallbackHandled` / `PaymentCallback`，`IPlatformService.registerOAuthState` / `onOAuthCallback` / `onPaymentCallback`，preload 桥接、renderer/window 类型、web 空实现，以及 `desktopDeepLinkUrl.ts` 中 `zcode://oauth|payment` 的解析与完整性判定分支。
- `packages/shared/src/oauth.ts` 的登录态类型（`OAuthStateRegistration`、`OAuthCallbackParams`、`OAuthCallbackResult` 及回调/令牌/会话恢复类型）；文件只保留凭据解密错误归一化、`BIGMODEL_PROVIDER_ID` / `ZAI_PROVIDER_ID` 与 `OAuthProviderId`（`OAuthLoginAttribution` 当时保留，已在第二轮删除）。
- 死掉的模型菜单类型面：`ModelSelectConnectionOption`（含 `mode: "oauth" | "apiKey"`）、`ModelSelectGroup.connectionOptions` / `directItems` / `selectedOptionKey`、`onConnectionValueChange`、连接方式子菜单渲染与 `Select*` 依赖。
- 宿主侧闲时 denylist：`automationToolPolicy.ts` 的 off-peak 常量与合并入口（只剩空列表）、`zcodeAgentService` 的 `payload.offPeakTaskId` 改写分支、`zcodeTaskServiceAdapter` 的空转循环。
- 22 个已无消费者的测试 id（`TID_OFFPEAK_*`、`TID_START_PLAN_RECOMMENDATION_DIALOG`、`TID_SIDEBAR_CODING_PLAN_USAGE_BUTTON`、`TID_SIDEBAR_USAGE_REMAINING_TRIGGER`、`TID_MODEL_PROVIDER_START_PLAN_*`、`TID_MODEL_PROVIDER_CONNECTION_MODE_*`、`TID_SETTINGS_USAGE_TAB`）。
- 5 处只提到已删工具 `OffPeakCreate` 的过时注释（server-operations、server-types、prompt-turn、core turn、core tool types）。
- 规模：删除 204 个文件、修改 212 个、新增 3 个源文件（`desktopWorkspaceDeepLink.ts`、`useProviderAvailabilityEntryGuard.ts`、`AddProviderForm.tsx`）。

### 验证结果（第一轮，实测）

| 命令                                                                                                             | 结果                               |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `pnpm typecheck`                                                                                                 | 0 error                            |
| `pnpm lint`                                                                                                      | 0 error（73 warning）              |
| `pnpm architecture:check --changed`                                                                              | violations 0（baseline 0 / new 0） |
| CLI 11 个包 `node apps/zcode-cli/node_modules/typescript/bin/tsc -p apps/zcode-cli/packages/<pkg>/tsconfig.json` | 全部无输出                         |

CLI 顺序：shared-types、contracts、dynamic-workflow、i18n、telemetry、dynamic-workflow-runtime、core、adapters、bootstrap、tui、cli；前置 `npx tsc -b --force packages/rpc packages/shared packages/provider packages/provider-node`。

注意：`packages/desktop/tsconfig.{main,preload,renderer}.json` **不在** `pnpm typecheck` 内（只覆盖 `tsconfig.host.json`），且这三个工程各自存在与本次迁移无关的既有错误（第一轮基线：preload 3 个、main 84 个、renderer 大量 `window.zcode` 缺失声明）。preload 与 main 中各有一个错误属于 `@zcode/shared` barrel 漏导出，已在第二轮 B 项修复（preload 3 → 0、main 84 → 83）；其余为既有错误，只做人工核对与针对性 grep。

### 刻意保留的冻结面

- 协议字段 `offPeakTaskId` / `offPeakRunType` / `automationId` 及其互斥校验：旧客户端仍会携带。
- `off_peak_task_id` 列、`zcodeTaskMetaSchema.offPeakTaskId`、`taskIndexRepo.rowToMeta` 的列兜底读取、`backfillOffPeakGroupMemberships`：因此 `isOffPeakTask()` 对**历史任务**仍可能为 true，`TaskListItem` 与 `task-row` 的月亮图标渲染**必须保留**（已加注释说明可达性仅来自历史数据）。
- `LEGACY_OFF_PEAK_MUTATION_TOOL_SENTINEL = "OffPeakCreate"`：旧 host 派发的 denylist 仍会带该哨兵，是冻结的兼容信号；函数名本身不再是冻结面（已改名为 `isOffPeakMutationRestrictedTurn`）。
- CLI 侧 `OFF_PEAK_MUTATION_TOOL_NAMES = ["SendMessage", "Workflow"]`：闲时轮工具策略仍在 CLI turn 循环与工具执行边界（`offPeakTurn` → 禁用后台 Bash）生效。判定函数已改名为 `isOffPeakMutationRestrictedTurn`（旧名 `isOffPeakCreateRestrictedTurn` 只是引用了已删工具名，语义未变）。
- 凭据存储（`services/src/credential/**`、`adapters/src/auth/shared-credentials.ts`）、第三方 MCP OAuth（`adapters/src/mcp/oauth-*`）、`conversation-share` 与 `ShareImport` deep link 通道。
- 冻结迁移脚本：session-store `0020`/`0021`/`0022`、tasksDatabase `official-glm-selection-v3`、`provider-selection-v2`（它们仍在改写已不存在的 `account:*` id）。

### 已知限制

- 历史会话/设置中指向 `account:*` 的模型选择失效：`ProviderRegistry.validateSelection` 返回 `{ code: "provider-not-found" }`，渲染为不可用，不抛异常。
- 内置配置 Bundled revision = 31。`selectReleaseCandidate` 在 Bundled 与 Active 缓存 revision 不同时取 revision 较大者，因此 `~/.zcode/v2/<endpoint>/.../zcode-builtin.json` 若残留 revision > 31 的旧远程内容仍会胜过打包文件（同 revision 内容冲突时回退 Bundled）。`applyRemoteRelease` 已删除，远程回路已断。
- 账号期遗留的静态路由白名单已按第三轮 D 项处理：`packages/desktop/src/main/networkTelemetryAggregator.ts` 的 `STATIC_HTTP_PATH_SEGMENTS` 删除了 `coding-plan` 与 `balance`，保留 `oauth`（仅是 ARMS 路由白名单，无业务语义）。
- `packages/shared/src/model-provider-types.ts` 的 `account:*` 常量表仍保留（冻结的迁移目标 id），属账号期残留，未改动；`packages/shared/src/model-provider-family.ts` 中无消费者的 `shouldShow*ForActiveOAuth` 系列已在第三轮 C 项删除。

### 第二轮遗留面清理（A–G）

在「无账号模式迁移已完成」的基础上，本轮清掉了审计发现的 7 处残留：

- **A. 凭据相邻环境残留**：删除 `packages/shared/src/zcodeEndpoint.ts` 的 `zaiOAuthOrigin` / `zaiOAuthClientId` 字段、`buildRuntimeZaiOAuthUrl` / `buildZaiOAuthUrl` / `resolveZaiOAuthOrigin` / `resolveZaiOAuthClientId`、`DEFAULT_ZAI_OAUTH_*` 常量、`RuntimeZaiEndpointEnv` 的 `ZAI_OAUTH_*` 字段与 `pickProductEndpointEnv` 的三项 key；`desktopRuntimeEnv.ts` 不再向 host 注入 `ZAI_OAUTH_ORIGIN` / `ZAI_OAUTH_CLIENT_ID`（`ZAI_BUSINESS_BASE_URL` 保留，`resolveZaiBusinessBaseUrl` 仍有消费者）；`desktopHostProcess.ts` 删除 `BIGMODEL_OAUTH_APP_SECRET` 来源日志；`tsup.config.ts` 删除 `ZAI_OAUTH_*` / `VITE_ZAI_OAUTH_*` 内联；`server/src/remote/connect.ts` 的远端 env 白名单删除两项；`.env.example` 删除对应示例行。
- **B. preload 类型断链**：`DesktopZoomState` / `WindowControlsOverlayMetrics` / `WindowControlsOverlayReadyPayload` 补进 `packages/shared/src/index.ts` 的 `./platform.js` 具名 re-export（`@zcode/shared` 的 exports 没有 `./platform` 子路径，barrel 是仓内唯一可行修复点）。preload 工程错误数 3 → 0，desktop main 84 → 83。
- **C. 套餐购买 webview 子系统**：删除 `packages/desktop/src/preload/codingPlanWebview.ts` 及其 tsup preload entry、`desktopWindowChrome.ts` 的 coding-plan preload 切换与 PayPal / 支付回调导航守卫（`isCodingPlanEmbeddedWebviewSrc` / `isCodingPlanWebviewUrl` / `isCodingPlanPaymentCallbackUrl` / `isCodingPlanPaypalNavigationUrl` / `isAllowedCodingPlanEmbeddedNavigationUrl` / `isPaypalHostname` / `pendingWebviewCodingPlanGuestFlags` / `isCodingPlanGuest` 及整段只服务 coding-plan 的 `will-navigate` 监听）、`desktopMainIpcRemote.ts` 的重复副本与 `OpenExternal` 回写 webview 分支、`DesktopCommandIds.ClearCodingPlanWebviewStorage` 与 `clearCodingPlanWebviewStorage`、`vite.config.ts` 的 `VITE_CODING_PLAN_WEBVIEW_ORIGIN`；`@zcode/shared` 侧同步删除 `CodingPlanWebviewChannels` / `CodingPlanPurchaseCompletePayload` / `CodingPlanWebviewLocale` / `CodingPlanWebviewLangChangeDetail` / `isTrustedCodingPlanWebviewOrigin` / `isLoopbackHostname`。
- **D. 设置页使用统计 tab**：`settingsNavigation.ts` 删除 `SettingsUsageTabTarget`、`SETTINGS_USAGE_TAB_INTENT_KEY` 会话存储交接、`usageTab` 事件字段、`setPendingSettingsUsageIntent` / `setPendingSettingsUsageCodingPlanIntent` / `consumePendingSettingsUsageTab` / `shouldFallbackSettingsUsageTabToApp`；`SettingsPage.tsx` 删除对应的消费 useEffect。`usage` 分区本身保留（`UsageStatsSection` 仍渲染 `AppUsagePanel`）。
- **E. 分享导入 deep link**：选择「恢复投递方」而不是删除通道——web 落地页 `ConversationShareLandingPage` 仍向可导入分享下发 `zcode://share/import?code=...`，且 preload 缓冲、`IPlatformService.onShareImport`、renderer 导入流程、导入提示 UI 全部存活。`desktopWorkspaceDeepLink.ts` 的 `handleDeepLink` 现在路由 `share/import`，并按工作区打开同样的模式做 renderer-ready 前缓存（`deliverPendingWorkspaceOpen` / `clearWorkspaceDeepLinkRoutesForWindow` 同步处理）。
- **F. 死遥测/营销钩子与死导出**：删除 `telemetryCore.ts` 的 `loadMarketingParams` 依赖、调用与 `didWarnMarketingParamsLoadFailure`、请求体 `marketing_params` 字段；`packages/shared/src/oauth.ts` 删除随之失去消费者的 `OAuthLoginAttribution`；`NodeZCodeBuiltinProviderConfigSource.applyRemoteRelease` 与其返回类型 `ApplyZCodeBuiltinReleaseResult` 删除。
- **G. 命名残留**：`isOffPeakCreateRestrictedTurn` → `isOffPeakMutationRestrictedTurn`（4 处调用点同步）；`ModelConfigSelect.tsx` 删除已无生产者的 `family:` 分组 key 判定，`isFamilyConnectionGroup` 改名 `hasModelGroupLabelBadge`（`labelBadge` 仍由 `modelSelectionGroups.ts` 与 4 个调用方产出，故分隔线逻辑保留）。

刻意保留（有 grep 证据）：`resolveZaiBusinessBaseUrl`（`desktopRuntimeEnv.ts`、`services/src/providers/api/apiEndpoints.ts` 仍有消费者）、`ModelSelectGroup.labelBadge` 与其分隔线渲染、`conversation-share` 全链路。

### 验证结果（第二轮，实测）

| 命令                                                             | 结果                                                                                         |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                                                 | 0 error                                                                                      |
| `pnpm lint`                                                      | 0 error（73 warning，与改动前一致）                                                          |
| `pnpm architecture:check --changed`                              | violations 0（baseline 0 / new 0）                                                           |
| CLI 11 个包 `tsc -p apps/zcode-cli/packages/<pkg>/tsconfig.json` | 全部无输出                                                                                   |
| `tsc -p packages/desktop/tsconfig.host.json --noEmit`            | 0 error（基线 0）                                                                            |
| `tsc -p packages/desktop/tsconfig.preload.json --noEmit`         | 0 error（基线 3，由 B 修复）                                                                 |
| `tsc -p packages/desktop/tsconfig.main.json --noEmit`            | 83 error（基线 84，少的一个是 B 修复的 `WindowControlsOverlayReadyPayload`；其余为既有错误） |

### 第三轮遗留面清理（A–E）

在「无账号模式迁移已完成」的基础上，清掉审计列出的最后一批残留：

- **A. 死 i18n 文案**：`packages/ui/src/i18n/locales/{en-US,zh-CN}.ts` 各删除 373 个 `settings.modelProvider.codingPlan.*` 键（含 `paypalSetupRequired` / `paypalApproveUrlMissing` / `paypalUnsupported` / `paypalCancelled` / `paypalSubscribeFailed` / `overseasPayment.paypal*` 等 PayPal 专属键），两个文件共 746 条。做法是先把候选键写成 pattern 文件，用 `grep -rnIF -f <patterns>`（排除 `node_modules`/`dist`/两个 locale 文件）对全仓做精确串匹配，命中数 0 才删除；再由脚本按精确文本范围删除条目，不做重排。`settings.modelProvider.connectionMode.apiKeyBadge` 不在候选集合内（前缀不同）且仍有 4 处消费者，未触碰。行数 en-US 6486 → 5993（少 493 行）、zh-CN 6191 → 5737（少 454 行）；zh-CN 中一条只描述被删 `codingPlan.description.*` 键的注释一并删除。删后两个文件仍可解析（TypeScript parser 校验：en 5223 键 / zh 5222 键，唯一差异 `settings.memory.viewer.disabled` 是改动前既有差异）。
- **B. 死构建期内联**：`packages/desktop/vite.config.ts` 删除 `VITE_REWARDS_WEBVIEW_ORIGIN` 的 `define`；`packages/desktop/tsup.config.ts` 删除 `ZAI_BUSINESS_LOGIN_URL` 的 env 透传。全仓精确 grep（含 `.env.example`、脚本、JSON、文档）确认两处字符串只出现在定义点自身，无任何消费者。
- **C. 死导出**：删除 `resolveRuntimeProductEndpointConfig` / `RuntimeProductEndpointConfig` / `buildRuntimeZaiBusinessUrl`（`packages/shared/src/zcodeEndpoint.ts`）、`createNodeZCodeBuiltinProviderConfigSource`（`packages/provider-node/src/zcode-builtin-provider-config-source.ts`，类仍被各处直接 `new`）、`ZAI_API_HOST`（`packages/services/src/providers/api/apiEndpoints.ts`，同时收掉随之无用的 `resolveZaiBusinessBaseUrl` 导入）、`shouldShowModelProviderFamilyForActiveOAuth` / `shouldShowBuiltinModelProviderForActiveOAuth`（`packages/shared/src/model-provider-family.ts`）。每项删除前都对仓内做过精确 grep，均只有定义点自身命中。
- **D. 遥测路由白名单**：`packages/desktop/src/main/networkTelemetryAggregator.ts` 的 `STATIC_HTTP_PATH_SEGMENTS` 删除 `coding-plan` 与 `balance`，保留 `oauth` 并在该行上方加注释说明。判定依据：`coding-plan` 只剩展示用链接构造器（`buildBigModelCodingPlanPersonalManageUrl` 无消费者，`buildBigModelCodingPlanTeamManageUrl` 只写入无人读取的 `teamCodingPlanManageUrl` 字段），`balance` 只剩无人读取的 `ZCodeEndpointUrls.zcodePlanBillingBalanceUrl` 字段，二者都不再有活代码发起请求；`oauth` 无法证明不可达——第三方 MCP OAuth 仍在，授权/令牌端点来自远端元数据，常见的 `/oauth/token`、`/oauth/authorize` 形态不可枚举。
- **E. 规格**：本节与「已知限制」中对应条目的状态更新。

### 验证结果（第三轮，实测）

| 命令                                                                                                                                                                | 结果                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `pnpm typecheck \| grep -c "error TS"`                                                                                                                              | 0                                    |
| `pnpm lint`                                                                                                                                                         | 0 error（73 warning，与改动前一致）  |
| `pnpm architecture:check --changed`                                                                                                                                 | violations 0（baseline 0 / new 0）   |
| CLI 11 个包 `tsc -p apps/zcode-cli/packages/<pkg>/tsconfig.json`（前置 `npx tsc -b --force packages/rpc packages/shared packages/provider packages/provider-node`） | 全部无输出                           |
| `tsc -p packages/desktop/tsconfig.host.json --noEmit`                                                                                                               | 0 error（基线 0）                    |
| `tsc -p packages/desktop/tsconfig.preload.json --noEmit`                                                                                                            | 0 error（基线 0）                    |
| `tsc -p packages/desktop/tsconfig.main.json --noEmit`                                                                                                               | 83 error（与第二轮基线一致，未增加） |
| 死键复核 `grep -rnIF -f <373 键>`                                                                                                                                   | 全仓 0 命中（含两 locale 文件本身）  |

刻意保留（有 grep 证据）：

- `STATIC_HTTP_PATH_SEGMENTS` 的 `oauth`（理由见 D）。
- `packages/shared/src/zcodeEndpoint.ts` 的 `ZCodeEndpointUrls` / `buildZCodeEndpointUrls`：多个调用方仍在使用（只读 `.origin`）。
- `packages/shared/src/zcodeEndpoint.ts` 的 `RuntimeProductEndpointEnv`：C 项删除 `resolveRuntimeProductEndpointConfig` 后已无消费者，但不在本轮清单内，未改动（与 `zcodePlan*Url` / `webShareCallbackUrl` 字段同属零消费者的遗留导出面）。
- `packages/shared/src/model-provider-family.ts` 的 `buildBigModelCodingPlanTeamManageUrl` 与 `MODEL_PROVIDER_FAMILY_SPECS.teamCodingPlanManageUrl`：模块初始化时仍会构造该展示链接，是 D 项保留 `coding-plan` 段时的核对对象。

本轮之外（只报告，未改动）：

- 仍是活键的计划类文案：`settings.modelProvider.connectionMode.codingPlan` / `.startPlan`（`packages/ui/src/v4/composer/modelTriggerDisplay.ts`）、`offPeak.keepAwakeBanner`、`offPeak.sidebar.groupTitle`。
- 已无消费者、但不在 A 项清单（非 `settings.modelProvider.codingPlan.*` 前缀）的文案约 247 个：`settings.modelProvider.{planCard,startPlan}.*`、`settings.modelProvider.connectionMode.{codingPlanBadge,startPlanBadge,startPlanCount}`、`settings.usage.codingPlan*`、`codingPlan.quotaReset.*`、`chat.planUsage.*`、`chat.quota.startPlan.*`、`settings.usage.entitlement*`、`settings.usage.billingBanner*`、`purchase.entry.*`、`startPlan.recommendation.*`、`offPeak.*`（`chat.quota.mcp.codingPlanRequired`、`offPeak.create.codingPlanOnly/Toast` 亦在其中）。
- 其他零消费者的死导出：`packages/ui/src/lib/rendererZCodeEndpoint.ts` 的 `RENDERER_ZCODE_ENDPOINT_URLS`、`packages/shared/src/zcodeEndpoint.ts` 的 `buildBigModelCodingPlanPersonalManageUrl`。

## 验收测试

`packages/services/test/accountFreeProviders.test.mts` 断言本次变更的产品规则，直接执行：

```bash
npx tsx packages/services/test/accountFreeProviders.test.mts
```

覆盖：内置 provider 数量为 0、添加供应商模板仍有 18 项、内置配置不含 `account:`/`zhipu-account`、
`zhipu-account` 访问类型被配置 schema 拒绝、用户自建 provider 进入 Registry 且模型可解析、
历史 `account:*` 选择解析为空而不抛错。退出码 0 表示通过。

## 最终验证结果（实测）

| 命令                                                           | 结果                                      |
| -------------------------------------------------------------- | ----------------------------------------- |
| `pnpm typecheck`                                               | 0 错误                                    |
| `pnpm lint`                                                    | 0 错误（73 条既有警告）                   |
| `pnpm architecture:check --changed`                            | OK，violations 0 / baseline 0 / new 0     |
| CLI 11 个包按依赖顺序 `tsc`                                    | 全部 0 错误                               |
| desktop `tsconfig.host.json` / `tsconfig.preload.json`         | 0 / 0 错误                                |
| desktop `tsconfig.main.json`                                   | 83 个**既有**错误（与本变更无关，未增加） |
| `npx tsx packages/services/test/accountFreeProviders.test.mts` | 全部通过                                  |

## 打包与构建期注意

本次改动同时修掉了两个会让"已移除的模块继续出现在产物里"的构建缺陷：

### 1. `out/scheduler` 未参与生产构建清理

`packages/desktop/scripts/run-production-build.mjs` 的 `cleanDesktopProductionOutput` 只清理
`out/{main,host,preload,renderer}`，漏了同样由 tsup 产出的 `out/scheduler`。源文件删除后旧产物会一直留在磁盘，
并被 electron-builder 的 `out/**/*` 打进 `app.asar`——实测第一版安装包里仍带着已删除的
`offPeakDispatchSettlement.js` 与 4 个陈旧 chunk。已把 `out/scheduler` 加入清理列表。

### 2. 构建期会误读运行时缓存的内置配置

`scripts/builtin-provider-config.mjs` 的 `loadBuiltinProviderConfig` 会优先采用
`ZCODE_BUILTIN_PROVIDER_CONFIG_FILE`。从已运行的应用里继承该变量的 shell 中执行打包时，它指向
`~/.zcode/v2/runtime/provider/<platform>/<version>/<endpoint>/zcode-builtin.json`（上一版本留下的缓存，
仍含已删的账号 provider），于是打包在严格 schema 校验处失败：

```
Invalid Built-in Provider config (production): C:\Users\PC\.zcode\v2\runtime\provider\...\zcode-builtin.json
```

打包时必须在干净环境中执行（不继承应用的运行时变量）：

```bash
env -u ZCODE_BUILTIN_PROVIDER_CONFIG_FILE -u ZCODE_DATA_BASE_DIR pnpm bundle:desktop -- --os win --arch x64
```

运行时不受影响：`selectReleaseCandidate` 会丢弃无法解码的缓存并以打包文件为准，且打包文件 `revision` 已升到 32，
下次启动即覆盖旧缓存。

### 3. 官方强更闸会拦下开发版本的打包构建（已通过移除该闸解决）

**结论：启动期强更闸已从代码中移除**，见 `specs/update/desktop-auto-update-source.md` 第 4 节。现在打包自建产物不再需要设置 `ZCODE_UPDATE_REPOSITORY` 来规避它。

以下记录当时的现象与那条"靠构建输入绕过"的旧方案，作为历史证据保留：

打包出的安装包首次启动被"需要升级 ZCode / 当前版本无法继续使用"挡住，与本变更无关，而是构建期更新源没有断开：

`packages/desktop/src/main/index.ts` 的启动闸条件曾是
`usesOfficialUpdateSource() && app.isPackaged`。开发态构建的版本号由 git tag 决定，没有 tag 时回落
`0.0.0-dev`（见 `resolveAppVersion`），低于官方 `minimalVersion`；一旦 `app.isPackaged === true`
（真实安装包），官方强更闸就会阻止创建主窗口。实测官方 `/api/v1/client/configs` 返回的
`minimalVersion` 为 `3.5.3`，`0.2.0` 这类 tag 版本必然被判需要升级。

构建期证据（tsup 注入日志）：

```
[tsup] ZCODE_ENV=production ZCODE_PRODUCT_FLAVOR=production ZCODE_UPDATE_SOURCE=zcode-manifest   ← 会被拦
[tsup] ZCODE_ENV=production ZCODE_PRODUCT_FLAVOR=production ZCODE_UPDATE_SOURCE=github-release    ← 正常启动
```

旧方案是设置 `ZCODE_UPDATE_REPOSITORY`（本仓库远端为 `LaoYutang/ZCode-Lite`），
把更新源切到自己的 GitHub Release，官方强更闸随之失效。该方案现已不必使用——闸本身不存在了。

不要用 `ZCODE_RELEASE_TAG` 伪造版本来绕过这个闸：版本只应由 git tag 决定，开发构建保持 `0.0.0-dev`。
`github-release` 源下更新入口仍存在，只在用户点击时提示并跳转到该仓库的 Release 页面，不自动下载安装。

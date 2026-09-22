# 客户端帮助、反馈与分享入口下线

## 背景

`specs/provider/account-free-providers.md` 移除了账号与登录，并说明了「会话分享上传与反馈提交的登录鉴权」随登录一并移除。但当时只切断了鉴权，**功能本体与入口仍在**，形成三类残留：

1. 标题栏右上角帮助菜单里的「产品文档 / 用户社群 / 问题上报 / 给产品提需求」四项，全部指向官方外部服务（`zcode.z.ai/docs`、飞书/Discord 社群、飞书反馈表单、官方反馈 API）。
2. 顶栏的会话分享按钮（`ConversationShareMenu`）及其整套「选择范围 → 确认 → 上传 → 公开链接」流程，依赖官方 `conversation-share` 服务与 `zcode://share/import` 深链、Web 分享落地页。
3. 反馈系统以「兜底求助入口」的形式散布在 8 处 UI：错误横幅、任务列表右键菜单、任务行菜单、Header 更多菜单、远程连接失败提示、会话订阅失败面板、快速选择命令、帮助菜单。

没有账号体系后这些入口必然失败或指向官方站点，属于「入口存在但不可用」的假功能，需要连同实现一起删除。

## 规则

### 1. 帮助菜单只剩桌面端本地能力

`WorkspaceHelpMenuButton` 的菜单项固定为三项，全部由 `DesktopCommandIds` 驱动：

| 菜单项     | 命令                                                    | 平台 |
| ---------- | ------------------------------------------------------- | ---- |
| 资源管理器 | `DesktopCommandIds.OpenResourceManager`                 | 桌面 |
| 检查更新   | `DesktopCommandIds.CheckForUpdates`（含「重启更新」态） | 桌面 |
| 关于 ZCode | `DesktopCommandIds.ShowAbout`                           | 桌面 |

菜单项全部只在桌面端存在，因此 Web 端不渲染帮助入口本身（`WorkspaceHelpMenuButton` 在 `isDesktop === false` 时返回 `null`），不再渲染一个空菜单。原生应用菜单（macOS）的「帮助」子菜单同样只保留关于 / 检查更新 / 资源管理器 / 导出日志。

### 2. 分享功能整体下线

- 顶栏不再渲染分享入口（`WorkspaceHeaderActionSection` 不再挂载 `ConversationShareMenu`）。
- 分享选择态、上传任务、公开链接、只读分享时间线、分享导入通知、分享深链（`zcode://share/import`）、Web 分享落地页（`packages/web/src/share/**`）与 `conversation-share` 服务一并删除。
- 历史消息里已写入的 `# zcode-share-context:` 尾块的**读取**解析保留（`parseConversationShareContext`）：这是旧数据兼容，删掉会让历史正文暴露原始块。

### 3. 反馈 / 工单能力整体下线

内置反馈中心（提交反馈、我的反馈、后台上传指示）、`IFeedbackService` 与其 HTTP 客户端、本地工单存储、反馈附件与日志归档目录，以及上述 8 处入口全部删除。远程连接失败、会话订阅失败等异常态只保留可执行的恢复动作（重试/重连/复制报错）。

错误横幅的「复制完整报错」是本地能力，**保留**；它原先借用反馈模板文案，改为 `chat.error.copyFull.*`。

### 4. 外部配置来源清空

`config/default.json` 只承载 `feedback_url`、`feedback_use_external_form`、`community_urls` 三个键，随本次下线一并删除；`helpAppConfig` 读取器与 electron-builder 的 `resources/config/default.json` 打包项同步移除。桌面端不再有任何「帮助/社群/反馈」远端配置拉取。

### 5. 保留的相邻能力

- 「导出日志」（`DesktopCommandIds.ExportLogs`、原生菜单项、`exportLogs.ts`）保留：它是本地打包与「在文件夹中显示」，不依赖任何官方服务。反馈专用的日志归档桥（`createFeedbackLogArchiveFromExportLogs`）随反馈删除。
- 消息级「点赞/点踩」（`assistantFeedback`）是独立特性，不在本次范围。
- 快速选择命令里 `app` 分组保留「添加供应商」；`feedback` / `community` / `product-docs` 三条命令及其图标类型删除。
- Agent 侧的 `shared_context` 导入协议（`packages/shared/src/zcode-protocol-v4/shared-context-import.ts`、CLI `server-operations.ts` 的 `source: "conversation_share"` 语义标签）保留：它是 runtime 协议能力，客户端已无生产者，删除需要同时改动 CLI 协议与校验，超出本次客户端入口下线的范围。
- `ConversationRowView` 对 `# zcode-share-context:` 尾块的读取解析保留，只删写入方；旧会话正文的显示行为不变。

## 唯一所有者

| 事实                         | 所有者                                                             |
| ---------------------------- | ------------------------------------------------------------------ |
| 帮助菜单可见项与顺序         | `packages/ui/src/WorkspaceHelpMenuButton.tsx`（桌面端才渲染）      |
| 帮助菜单项到桌面命令的映射   | `DesktopCommandIds`（`packages/shared/src/platform.ts`）           |
| 原生菜单「帮助」子菜单       | `packages/desktop/src/main/desktopApplicationMenu.ts`              |
| 帮助菜单是否渲染             | 挂载处注入的 `isDesktop`（不在组件内嗅探 `executeDesktopCommand`） |
| 错误横幅「复制完整报错」文案 | `chat.error.copyFull.*`（`packages/ui/src/i18n/locales/*`）        |

## 失败语义

| 情况                                | 表现                                             |
| ----------------------------------- | ------------------------------------------------ |
| Web 端（无桌面命令）                | 不渲染帮助入口，不出现空下拉                     |
| 旧版分享深链 `zcode://share/import` | 不再被识别为分享导入；不崩溃，按普通未知深链处理 |
| 历史消息含 `# zcode-share-context:` | 正文仍按旧规则剥离该尾块，用户看不到原始块       |
| 旧安装目录残留 `feedback/` 数据     | 不再被读写；存储清理目录表也不再声明该路径       |
| 需要报障的用户                      | 通过「复制完整报错」+ 导出日志自行提供材料       |

## 验收场景

1. 桌面端右上角「?」菜单只有资源管理器、检查更新（可见时）、关于 ZCode 三项。
2. Web 端右上角没有「?」入口。
3. 顶栏（含活动任务）不再出现分享图标；会话面板不出现分享选择 Dock、遮罩与只读分享时间线。
4. 快速选择（Command/Ctrl+K）搜索「问题上报」「反馈」「社群」「产品文档」无结果；搜索「添加供应商」仍可用。
5. 聊天错误横幅只有「设置模型」（模型缺失时）/「查看详情」（有详情时）/「复制完整报错」/「重试」/「关闭」，没有「反馈」。
6. 任务列表右键菜单与 Header 更多菜单不再有「反馈问题」项。
7. 远程连接失败提示、会话订阅失败面板只剩重试/重连动作。
8. `packages/ui`、`packages/services`、`packages/shared`、`packages/client`、`packages/web`、`packages/desktop` 中不再存在 `IFeedbackService`、`IConversationShareService`、`helpAppConfig`、`ConversationShare*` 组件与 `feedback_url` / `community_urls` 配置键。

## 测试

- `pnpm typecheck`、`pnpm lint`：验证六个包内没有悬空引用。
- `pnpm architecture:check --changed`：验证删除后没有跨层越界。
- 打包验证：`pnpm bundle:desktop -- --os win --arch x64` 产出的安装包中不含 `resources/config/default.json`，且应用可正常启动进入主界面。

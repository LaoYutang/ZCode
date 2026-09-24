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

| 菜单项          | 命令                                                    | 平台 |
| --------------- | ------------------------------------------------------- | ---- |
| 资源管理器      | `DesktopCommandIds.OpenResourceManager`                 | 桌面 |
| 检查更新        | `DesktopCommandIds.CheckForUpdates`（含「重启更新」态） | 桌面 |
| 关于 ZCode-Lite | `DesktopCommandIds.ShowAbout`                           | 桌面 |

菜单项全部只在桌面端存在，因此 Web 端不渲染帮助入口本身（`WorkspaceHelpMenuButton` 在 `isDesktop === false` 时返回 `null`），不再渲染一个空菜单。原生应用菜单（macOS）的「帮助」子菜单同样只保留关于 / 检查更新 / 资源管理器 / 导出日志。

### 2. 「关于」是 renderer 内置 modal，不再是原生窗口

「关于」此前由 main 进程创建原生 `BrowserWindow`（`about.ts` 的 `showAboutDialog` + `aboutWindow.ts` 生成的 data URL 文档）：`transparent: true` 的 frameless 窗口。Windows 上这就是一个 layered 窗口，**它的创建与销毁会让主窗口的 Acrylic 合成表面失效** —— 主窗口底色是 `#00000000` 且依赖 `backgroundMaterial: "acrylic"` 填充，backdrop 失效的瞬间整个窗口变成全透明，用户会看到 ZCode 后面的窗口。该补丁此前只覆盖主窗口的 `resized` / `show`（`desktopWindowChrome.ts`），子窗口的创建与关闭不在覆盖范围内。

因此「关于」改为 renderer 内置 modal，不再创建任何原生窗口：

```
自绘帮助菜单 / 原生应用菜单 / 托盘
        └─ DesktopCommandIds.ShowAbout
              └─ main: executeDesktopCommand 计算展示事实
                    └─ targetWindow.webContents.send(PlatformChannels.ShowAbout, payload)
                          └─ preload onShowAbout → aboutDialogStore.open(payload)
                                └─ <AboutDialogHost /> 渲染内置 modal
```

- **展示事实**（`appVersion`、`isOptimizedForAppleSilicon`）归 main 进程：只有它能读 `app.getVersion()`、`build-meta.json` 与 `os.arch()`。
- **弹框可见性**归 renderer 的 `aboutDialogStore`（Zustand）。`AboutDialogHost` 挂在 `RootShell`，与 `AlertDialogHost` / `ConfirmDialogHost` 同层。
- 三条入口（自绘菜单、原生菜单、托盘）共用同一条 `DesktopCommandIds.ShowAbout` 路径，主进程只做转发，不判断窗口类型。
- 文案归 renderer i18n（`about.dialog.*`，标题复用 `titleBar.menu.help.about`）；main 不再持有 About 文案表，也不再接收 `currentApplicationLocale` 参数。
- `onShowAbout` 是一次性命令，preload **不做** latest 回放：React 重挂载时不得重新弹出已经关闭的对话框。
- `createAboutSnapshot` / `formatAboutDetail` / `readBuildMetadata` 保留：`exportLogs.ts` 仍用它们生成导出报告里的 About 段。

### 3. 分享功能整体下线

- 顶栏不再渲染分享入口（`WorkspaceHeaderActionSection` 不再挂载 `ConversationShareMenu`）。
- 分享选择态、上传任务、公开链接、只读分享时间线、分享导入通知、分享深链（`zcode://share/import`）、Web 分享落地页（`packages/web/src/share/**`）与 `conversation-share` 服务一并删除。
- 历史消息里已写入的 `# zcode-share-context:` 尾块的**读取**解析保留（`parseConversationShareContext`）：这是旧数据兼容，删掉会让历史正文暴露原始块。

### 4. 反馈 / 工单能力整体下线

内置反馈中心（提交反馈、我的反馈、后台上传指示）、`IFeedbackService` 与其 HTTP 客户端、本地工单存储、反馈附件与日志归档目录，以及上述 8 处入口全部删除。远程连接失败、会话订阅失败等异常态只保留可执行的恢复动作（重试/重连/复制报错）。

错误横幅的「复制完整报错」是本地能力，**保留**；它原先借用反馈模板文案，改为 `chat.error.copyFull.*`。

### 5. 外部配置来源清空

`config/default.json` 只承载 `feedback_url`、`feedback_use_external_form`、`community_urls` 三个键，随本次下线一并删除；`helpAppConfig` 读取器与 electron-builder 的 `resources/config/default.json` 打包项同步移除。桌面端不再有任何「帮助/社群/反馈」远端配置拉取。

### 6. 保留的相邻能力

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
| About 展示事实（版本/平台）  | `packages/desktop/src/main/about.ts` 的 `createAboutDialogPayload`  |
| About 弹框可见性与展示数据   | `packages/ui/src/store/aboutDialogStore.ts`（`AboutDialogHost` 只读） |
| 错误横幅「复制完整报错」文案 | `chat.error.copyFull.*`（`packages/ui/src/i18n/locales/*`）        |

## 失败语义

| 情况                                | 表现                                             |
| ----------------------------------- | ------------------------------------------------ |
| Web 端（无桌面命令）                | 不渲染帮助入口，不出现空下拉                     |
| 旧版分享深链 `zcode://share/import` | 不再被识别为分享导入；不崩溃，按普通未知深链处理 |
| 历史消息含 `# zcode-share-context:` | 正文仍按旧规则剥离该尾块，用户看不到原始块       |
| 旧安装目录残留 `feedback/` 数据     | 不再被读写；存储清理目录表也不再声明该路径       |
| 需要报障的用户                      | 通过「复制完整报错」+ 导出日志自行提供材料       |
| `PlatformChannels.ShowAbout` 未送达 | 不打开弹框、不排队重试：命令是一次性的，且目标窗口已销毁时没有可送达对象 |

## 验收场景

1. 桌面端右上角「?」菜单只有资源管理器、检查更新（可见时）、关于 ZCode-Lite 三项。
2. Web 端右上角没有「?」入口。
3. 顶栏（含活动任务）不再出现分享图标；会话面板不出现分享选择 Dock、遮罩与只读分享时间线。
4. 快速选择（Command/Ctrl+K）搜索「问题上报」「反馈」「社群」「产品文档」无结果；搜索「添加供应商」仍可用。
5. 聊天错误横幅只有「设置模型」（模型缺失时）/「查看详情」（有详情时）/「复制完整报错」/「重试」/「关闭」，没有「反馈」。
6. 任务列表右键菜单与 Header 更多菜单不再有「反馈问题」项。
7. 远程连接失败提示、会话订阅失败面板只剩重试/重连动作。
8. `packages/ui`、`packages/services`、`packages/shared`、`packages/client`、`packages/web`、`packages/desktop` 中不再存在 `IFeedbackService`、`IConversationShareService`、`helpAppConfig`、`ConversationShare*` 组件与 `feedback_url` / `community_urls` 配置键。
9. 桌面端点「关于」弹出的是 renderer 内置 modal：不创建新的 `BrowserWindow`，主窗口不出现整窗透明；关闭对话框同样不产生新的窗口合成事件。
10. 三条入口（自绘帮助菜单、原生应用菜单、托盘）都能打开同一个对话框，且展示同一份版本事实。

## 测试

- `pnpm typecheck`、`pnpm lint`：验证六个包内没有悬空引用。
- `pnpm architecture:check --changed`：验证删除后没有跨层越界。
- `packages/desktop/test/aboutDialogPayload.test.mjs`：覆盖展示事实构造（版本取值优先级、Apple Silicon 判定），用 `tsx --test` 运行（与 `packages/ui` 一致：Node 原生 type stripping 不会把 `./x.js` 解析到 `./x.ts`，desktop 测试要导入依赖 `@zcode/shared` 的模块就必须走 tsx）。
- `packages/ui/test/aboutDialogStore.test.mjs`：覆盖开合状态语义（重复触发不叠加、关闭后不残留）。
- 打包验证：`pnpm bundle:desktop -- --os win --arch x64` 产出的安装包中不含 `resources/config/default.json`，且应用可正常启动进入主界面。

## 已知缺口：desktop 的 main / preload / renderer 没有自动类型检查

本次改动首次暴露了这个缺口，记录下来避免重复踩坑：

`pnpm typecheck` 只构建到 `packages/desktop/tsconfig.host.json`，**不覆盖 `tsconfig.main.json` / `tsconfig.preload.json` / `tsconfig.renderer.json`**；生产构建（`run-production-build.mjs`）只跑 `tsup` 与 `vite build`，两者都不做类型检查。

后果：新增一条 `IPlatformService` 方法时，如果漏改 renderer 侧的 `desktopPlatform.ts` 转发，**编译、类型检查、打包都不会失败**，只会在运行时炸成 `platform.<method> is not a function` —— 因为 `AboutDialogHost` 挂在 `RootShell` 上，表现是「应用启动即白屏/崩溃」而不是「关于打不开」。

两道防线（本次已落）：`desktopPlatform.ts` 的转发按 `onOpenWorkspace` 的既有约定写成 `window.zcode.<method>?.(handler) ?? (() => {})`，旧 preload 只降级、不崩溃；新增平台方法时同时改 `shared/platform.ts`、`preload/index.ts`、`desktopPlatform.ts`、`web/main.tsx` 四处实现清单。


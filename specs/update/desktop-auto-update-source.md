# 桌面端自动更新源

## 背景

桌面端自动更新此前硬绑官方分发链路：`initAutoUpdater` 只在 `ZCODE_PRODUCT_FLAVOR === "production"` 时启用，随后无条件 `setFeedURL({ provider: "custom", updateProvider: ManifestUpdateProvider })`，请求 `https://zcode.z.ai/api/v1/releases/electron/manifest`。已有的 `ZCODE_UPDATE_FEED_URL` / `--zcode-update-feed-url` 覆盖在打包态被显式忽略（安全考虑，避免环境变量改道正式包），因此正式包无法改更新源。

对 fork / 社区版而言，这会导致两个问题：打包后的版本会提示官方升级；官方的远端强更配置可以阻止 fork 启动。

## 规则

### 1. 更新源与产品身份解耦

新增构建期输入 `ZCODE_UPDATE_REPOSITORY`（`owner/repo`），解析成编译期常量 `ZCODE_UPDATE_SOURCE`，取值三态：

| `ZCODE_UPDATE_REPOSITORY` | flavor | `ZCODE_UPDATE_SOURCE` | 行为 |
| --- | --- | --- | --- |
| 已设置 | 任意 | `github-release` | 检测自己的 GitHub Release，仅提示并跳转下载页 |
| 未设置 | `production` | `zcode-manifest` | **现状不变**：官方 manifest + 自动下载安装 |
| 未设置 | `preview` | `disabled` | 同今天：不启用更新器 |

`ZCODE_UPDATE_SOURCE` 是更新相关行为的**单一事实来源**，主进程与渲染端都从它派生，不再各自判断 flavor。`owner/repo` 非法时构建期直接失败。

### 2. `github-release` 模式的语义

- **检测**：`electron-updater` 的原生 `github` provider（`{ provider: "github", owner, repo, releaseType: "release" }`），读 Release 资产里的 `latest-yml`（按平台 `latest.yml` / `latest-mac.yml` / `latest-linux.yml`）。
- **不下载、不安装**：永远不调用 `downloadUpdate`；`download-progress` / `update-downloaded` 状态在该模式下不存在；`QuitAndInstallUpdate` 直接拒绝。
- **动作**：用户点击更新入口的主按钮 = 「前往下载」，主进程 `shell.openExternal` 打开 Release 页面，并**保持 `update-available` 状态**（用户可能反复查看，不应因为点过就消失）。
- **版本说明**：`autoUpdater.fullChangelog` 默认 `false`，provider 只取**最新一条** release 的正文。正文以 GitHub REST `GET /repos/{owner}/{repo}/releases/latest` 的 `body` 为准（`Accept: application/vnd.github+json`），而不是 atom feed 的 `<content>`，因为 `body` 保证是作者写入的原始 markdown。取不到时降级为"只有版本号 + 跳转链接"，**绝不影响检测本身**。
- **通道**：固定 `stable`。`receivePreviewUpdates` 在该模式下无意义，相应设置项在 UI 中隐藏，主进程也不据此改变通道。
- **自动下载设置**：`shouldAutoDownloadAndInstallUpdates` 在该模式下恒为 `false`。

### 3. 状态所有者（不变）

`packages/desktop/src/main/autoUpdater.ts` 的 `menuState` 仍是更新状态的**唯一所有者**。`github-release` 模式只是更换 provider 与动作语义，不引入第二条状态写入路径：菜单、托盘、独立更新窗口、标题栏入口继续消费同一份 `UpdateStatePayload` 广播。

### 4. 远端强更闸只在官方源下生效

`maybeBlockStartupForForceUpdate` 请求官方 `/api/v1/client/configs`，版本低于 `minimalVersion` 时会阻止创建主窗口。该闸仅在 `ZCODE_UPDATE_SOURCE === "zcode-manifest"`（即仍从官方源取更新）时执行：不接官方更新源的构建，官方也不应有权阻止其启动。

### 5. 保留的边界

- `ZCODE_UPDATE_FEED_URL` / `--zcode-update-feed-url` 的"打包态忽略"逻辑**保持不动**。新机制是构建期的，不重新打开"环境变量改道正式包"这个口子。
- `ZCODE_UPDATE_REPOSITORY` 只作为构建期输入，不做运行期读取。

## 失败语义

| 情况 | 表现 |
| --- | --- |
| Release 缺对应平台的 `latest*.yml` | `checkForUpdates` 抛 `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND` → "暂无法检查更新：发布产物缺少更新描述文件" |
| tag 已推、Release 还没发布（draft） | GitHub 把 `releases/latest` 重定向到 `/releases` **索引页**，该页面对 `Accept: application/json` 返回 **406** → provider 抛 `ERR_UPDATER_INVALID_RELEASE_FEED` → 归入"解析不出最新发布" |
| 仓库没有任何 Release | 同上一行（`ERR_UPDATER_LATEST_VERSION_NOT_FOUND` / 无 code 的 `No published versions on GitHub`） |
| Release 是 draft 或 prerelease | `releases/latest` 跳过它 → 同上 |
| release notes 接口失败/限流 | 降级为只有版本号 + 跳转链接 |
| 网络不可达 | 与现有行为一致：吞掉错误回到 idle，不阻塞主流程 |
| `owner/repo` 格式非法 | 构建期失败 |

### 「解析不出最新发布」的归类规则

只有 `github-release` 源才把这一类错误当成正常状态（tag 已推、Release 未发布，或仓库无正式发布）。
判据覆盖实测到的三类错误码：`ERR_UPDATER_LATEST_VERSION_NOT_FOUND`、`ERR_UPDATER_INVALID_RELEASE_FEED`、
`ERR_UPDATER_NO_PUBLISHED_VERSIONS`，以及无 code 的 `No published versions on GitHub` 消息。

- **后台轮询 / 启动检查**：静默回到 idle，只写一条 warn 日志（不打 error、不弹提示）。
- **用户手动检查**：必须给出可操作原因（"该仓库还没有已发布的 Release"），**不能回"已是最新"** —— 仓库里一个 Release 都没有时说"已是最新"是误导。

### 用户可见错误文案必须压成单行

electron-updater 的 message 会把**整个 releases atom feed XML、完整 HTTP 响应头和堆栈**拼在一起。
直接把 `error.message` 透传给 renderer 会让报错占满整个界面（这是实际发生过的回归）。

规则：用户可见文案一律经 `toSingleLineErrorMessage()` 折叠空白并截断到 200 字符；完整错误对象只写日志，不进 UI。
逻辑落在零依赖的 `packages/desktop/src/main/updateErrorMessage.ts`，由
`packages/desktop/test/updateErrorMessage.test.mjs` 覆盖（零 import 所以能被纯 Node 直接 import 测试）。

### tag → Release 之间客户端看不到更新

发布流程是「全平台构建完成 → 建 draft → 上传资产 → 转正」，因此从推 tag 到 Release 转正之间，
客户端解析不出最新发布，表现为"没有更新"。这是**正确且安全**的行为：宁可暂时不提示，也不能让客户端
拿到资产不全的 Release。缩短这个窗口只能靠减少一次发布的平台数，当前设计不追求这点。

## 发布侧前置条件

客户端能检测到更新的前提（由 `.github/workflows/package-desktop.yml` 保证）：

1. Release 必须**非 draft、非 prerelease**。
2. Release 资产包含 `latest.yml` / `latest-mac.yml` / `latest-linux.yml`（及 `.blockmap`，供将来开自动下载用）；Windows 与 macOS 的清单由同一次 electron-builder 调用聚合，`files[]` 覆盖该平台两支架构（见 `specs/build/desktop-release-pipeline.md`）。
3. tag 名可归一化为合法 semver（`v3.14.1`），且等于构建产物的应用版本（由版本解析规则保证同源）。
4. 发布顺序为「创建 draft → 上传资产 → 转正」，避免 `releases/latest` 在资产就位前被解析到。

### provider 配置约束

`publish.provider = "github"` 的分支**不接受 `useMultipleRangeRequest`**（electron-builder 的配置 schema 会直接拒绝，报 `Invalid configuration object`）。运行时的 `setFeedURL` 同样不传该字段：`BaseGitHubProvider` 已在内部把 `isUseMultipleRangeRequest` 固定为 `false`。这个字段只属于 generic/s3 等分支。

### 多架构产物：同一平台一次调用产出聚合的 `latest*.yml`

Windows / macOS 的 channel 文件名不带架构后缀（见 `app-builder-lib` 的 `getUpdateInfoFileName`：只对 Linux 追加架构），因此一个平台的两支架构必须由**同一次** electron-builder 调用产出——`PublishManager` 只在单进程内按「文件 + provider」合并 `files[]`，两次调用后者覆写前者。聚合后的清单里两支架构的安装包都在 `files[]` 中。

发布侧契约（矩阵粒度、上传集合、重名断言）见 `specs/build/desktop-release-pipeline.md`。启用应用内自动下载时，`files[]` 的架构信息将被真正读取，届时仍需保持这条一次调用的约束。

## 验收场景

1. 打包的正式身份版本 + 已发布 Release → 启动后更新入口出现"发现新版本"。
2. 悬浮更新入口 → 展示的是该 Release 的说明正文（commit 列表），标题为版本号。
3. 点击主按钮 → 系统浏览器打开该 Release 页面；再次打开入口仍可见。
4. 本地版本不低于 Release 版本 → 静默 idle，无提示。
5. `ZCODE_UPDATE_REPOSITORY` 未设置的 production 构建 → 行为与改造前完全一致（官方 manifest、自动下载安装、强更闸生效）。
6. `ZCODE_UPDATE_REPOSITORY` 已设置的构建 → 不请求 `zcode.z.ai`，且启动不被官方强更闸阻止。
7. `github-release` 模式下的设置页不出现"接收 preview 更新"与"自动下载并安装"。

## 测试

`packages/desktop/test/desktopUpdateSource.test.mjs` 覆盖 `ZCODE_UPDATE_SOURCE` 三态表与 `owner/repo` 校验。`autoUpdater` 状态机本身无既有测试网，行为变更靠真实链路验证（见发布侧前置条件）。

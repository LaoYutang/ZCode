# 桌面端自动更新源

## 背景

桌面端自动更新此前硬绑官方分发链路：`initAutoUpdater` 只在 `ZCODE_PRODUCT_FLAVOR === "production"` 时启用，随后无条件 `setFeedURL({ provider: "custom", updateProvider: ManifestUpdateProvider })`，请求 `https://zcode.z.ai/api/v1/releases/electron/manifest`。已有的 `ZCODE_UPDATE_FEED_URL` / `--zcode-update-feed-url` 覆盖在打包态被显式忽略（安全考虑，避免环境变量改道正式包），因此正式包无法改更新源。

对 fork / 社区版而言，这会导致两个问题：打包后的版本会提示官方升级；官方的远端强更配置可以阻止 fork 启动。

第一个问题由本文的更新源解耦解决。第二个问题在后续变更中改为**彻底移除启动期强更闸**：让第三方远端配置永远不能阻止本产品的启动，不再依赖"更新源是否官方"这一条件间接达成（见第 4 节）。

此后又发现"解耦"本身还留着一个口子：更新源是**构建期输入**，调用方漏传 `ZCODE_UPDATE_REPOSITORY` 就回退官方源——手动跑 `pnpm bundle:desktop` 打出来的包正是这样落回官方 manifest 的，于是本地 0.2.0 的包会长期提示官方 3.14.x 有更新。第 6 节记录了收口方式：桌面构建的回退值改为**本产品自己的 Release**。

## 规则

### 1. 更新源与产品身份解耦

新增构建期输入 `ZCODE_UPDATE_REPOSITORY`（`owner/repo`），解析成编译期常量 `ZCODE_UPDATE_SOURCE`：

| `ZCODE_UPDATE_REPOSITORY` | flavor       | `ZCODE_UPDATE_SOURCE` | 行为                                              |
| ------------------------- | ------------ | --------------------- | ------------------------------------------------- |
| 已设置                    | 任意         | `github-release`      | 检测指定仓库的 GitHub Release，仅提示并跳转下载页 |
| 未设置                    | `production` | `github-release`      | 检测 `DEFAULT_UPDATE_REPOSITORY`（见第 6 节）     |
| 未设置                    | `preview`    | `disabled`            | 不启用更新器                                      |

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

### 4. 启动期远端强更闸已移除

主进程**不再因远端 `minimalVersion` 阻止创建主窗口**：该闸读取官方 `/api/v1/client/configs` 的 `minimalVersion` 并与本机版本比较，这条链路已随模块一起删除。任何远端配置都无法阻止本产品启动。

（注意区分：`/api/v1/client/configs` 仍被单特性灰度 rollout 使用（`singleFeatureRollout.ts` / `desktopContextPromptRollout.ts`），那是功能开关，与启动无关，也不读 `minimalVersion`。）

移除原因：该闸的语义是"官方有权判死客户端"，只对官方分发链路成立。此前的实现把它收窄为"仅 `ZCODE_UPDATE_SOURCE === "zcode-manifest"` 时生效"，但那个条件描述的是**更新源**，不是**启动权**——只要构建期漏设 `ZCODE_UPDATE_REPOSITORY`（例如手动跑 `pnpm bundle:desktop`），产物就会落回官方源并被官方闸拦下，即便与官方分发链路无关。以构建输入决定"官方能否阻止我启动"本身就是错的耦合，因此直接去掉能力，而不是再加一层判断。

随之删除的、只服务于该闸的代码（保持"删除就删干净，不留恒为空的开关"）：

- `packages/desktop/src/main/forceUpdateGuard.ts`（远端配置请求 + 判定 + 阻止窗口）
- `packages/desktop/src/main/forceUpdatePrompt.ts`（强更弹窗）
- `packages/shared/src/forceUpdate.ts`、`getForceUpdateMinimalVersionFromConfig`
- `autoUpdater.ts` 的 `requestForceAutoUpdate` / `ForceAutoUpdateState` 与相关监听变量
- `index.ts` 的 `forceUpdateMainWindowCreationBlocked` / `focusForceUpdateGateWindow`，以及 second-instance、open-url 两条 deep link 路径上的"强更期间忽略请求"分支

保留的边界：本地未打包运行时（`app.isPackaged === false`）不再需要任何跳过逻辑，因为已经没有任何启动闸；更新检查、下载、安装的常规状态机不受影响。

### 5. 保留的边界

- `ZCODE_UPDATE_FEED_URL` / `--zcode-update-feed-url` 的"打包态忽略"逻辑**保持不动**。新机制是构建期的，不重新打开"环境变量改道正式包"这个口子。
- `ZCODE_UPDATE_REPOSITORY` 只作为构建期输入，不做运行期读取。

### 6. 桌面构建的回退值 = 本产品自己的 Release

`packages/desktop/scripts/desktop-update-source.mjs` 导出 `DEFAULT_UPDATE_REPOSITORY = "LaoYutang/ZCode-Lite"`：未显式配置 `ZCODE_UPDATE_REPOSITORY` 时，production 身份的桌面构建用它，**桌面构建因此不再产出 `zcode-manifest`**。

为什么必须收口（实测经过）：更新源是构建期输入，调用方漏传就回退官方源；官方 Release 属于另一条产品线，版本号 `3.14.x` 与本仓库的 `0.x` 不可比，于是本地包会长期停留在一个"有更新"提示上。更危险的是 manifest 模式是**真更新器**：设置页里"自动下载并安装"开关一旦打开，点更新会把官方客户端装进本产品的安装目录。而这个回退同样是把官方远端配置接进本产品的入口——移除强更闸前的拦启动问题也来自这里。

配套语义（不是顺手改的，是这条回退的必然结果）：

- `github-release` 模式下设置页不显示"接收 preview 更新"与"自动下载并安装"（`usesOfficialUpdateSource()` 为 false），因此该模式**永远不会自动安装**，只提示并跳转下载页。
- `ZCODE_UPDATE_REPOSITORY` 优先级最高，临时验证别的仓库（含 fork）不需要改代码。
- `zcode-manifest` 仍是 `@zcode/shared` 里合法的取值，但只由**未注入 define 的 bundle**（web/CLI/测试）沿用旧语义命中。

## 失败语义

| 情况                                | 表现                                                                                                                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release 缺对应平台的 `latest*.yml`  | `checkForUpdates` 抛 `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND` → "暂无法检查更新：发布产物缺少更新描述文件"                                                                                  |
| tag 已推、Release 还没发布（draft） | GitHub 把 `releases/latest` 重定向到 `/releases` **索引页**，该页面对 `Accept: application/json` 返回 **406** → provider 抛 `ERR_UPDATER_INVALID_RELEASE_FEED` → 归入"解析不出最新发布" |
| 仓库没有任何 Release                | 同上一行（`ERR_UPDATER_LATEST_VERSION_NOT_FOUND` / 无 code 的 `No published versions on GitHub`）                                                                                       |
| Release 是 draft 或 prerelease      | `releases/latest` 跳过它 → 同上                                                                                                                                                         |
| release notes 接口失败/限流         | 降级为只有版本号 + 跳转链接                                                                                                                                                             |
| 网络不可达                          | 与现有行为一致：吞掉错误回到 idle，不阻塞主流程                                                                                                                                         |
| `owner/repo` 格式非法               | 构建期失败                                                                                                                                                                              |

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
5. `ZCODE_UPDATE_REPOSITORY` 未设置的 production 构建 → 检测 `DEFAULT_UPDATE_REPOSITORY` 的 Release，**不请求官方 manifest**（回归防线：产物里必须是 `"github-release"` 而不是 `"zcode-manifest"`）；启动不受任何远端配置阻止。
6. `ZCODE_UPDATE_REPOSITORY` 已设置的构建 → 检测该仓库，不请求 `zcode.z.ai`，启动同样不受远端配置阻止。
7. `github-release` 模式下的设置页不出现"接收 preview 更新"与"自动下载并安装"。
8. 任意更新源下，把主进程版本号改成低于官方 `minimalVersion`（例如 tag 决定的 `0.2.0`）并打包安装 → 仍能正常创建主窗口并进入主界面。

## 测试

`packages/desktop/test/desktopUpdateSource.test.mjs` 覆盖 `ZCODE_UPDATE_SOURCE` 解析表与 `owner/repo` 校验，其中"未配仓库时回退到本产品自己的 Release"一条同时断言 `notEqual(..., "zcode-manifest")`，防止回退值被改回官方源。该文件由 `pnpm --filter @zcode/desktop test` 运行；**CI 目前没有任何 workflow 跑它**（发布流水线只做产物与 channel 文件校验），所以它是本地防线，不是发布门禁——需要门禁时应显式加一步。`autoUpdater` 状态机本身无既有测试网，行为变更靠真实链路验证（见发布侧前置条件）。

场景 8 的"移除前"行为已实测：`ZCODE_UPDATE_SOURCE = zcode-manifest`、版本 `0.2.0`（HEAD 落在 tag `v0.2.0`）的安装包启动时被官方 `minimalVersion`（实测返回 `3.5.3`）拦下，只能退出。"移除后"已复验：同一构建输入（仍未设 `ZCODE_UPDATE_REPOSITORY`）重新打包的安装包安装后能正常进入主界面，只剩一条普通更新提示（用户实测，2026-09-22）。

场景 5 的新回退值已用**产物取证**验证（2026-09-22）：仍不传 `ZCODE_UPDATE_REPOSITORY`、只给 `ZCODE_ENV=production` 的构建，`app.asar` 里三处 bundle 注入点都变成 `github-release` + 仓库串：

```
var Az = u_("github-release", l_), zz = "LaoYutang/ZCode-Lite".trim()   // 渲染端
var Ja = sg("github-release", ag), cg = "LaoYutang/ZCode-Lite".trim()   // 主进程 chunk
var SS = $f("github-release", Pf), _S = "LaoYutang/ZCode-Lite".trim()   // 另一 chunk
```

改动前同一条命令产出的是 `u_("zcode-manifest", ag)` + `"".trim()`。取证时注意：`zcode-manifest` 字符串**仍会出现在产物里**（`normalizeZCodeUpdateSource` 的取值白名单与"未注入 define"时的 flavor 回退），判断是否生效要看注入点的实参，不能只 grep 字面量。产物：`dist/ZCode-0.2.0-win-x64.exe`，163,059,846 B，sha256 `6c2845ef16c24c9a7fbaef0b1ea8e91755defe2bbc6724685fbb222f8bea0e67`；脚本自带的 runtime 依赖校验、体积审计（155.5 MiB / 上限 500 MiB）与 `latest.yml` channel 文件校验全绿。

已执行的门禁：`pnpm typecheck` 通过；`pnpm lint` 0 error / 33 warning（均为存量）；`node --test test/desktopUpdateSource.test.mjs` 9 例全通过；改动文件 `oxfmt --check` 全绿。

换成自有源之后"提示消失"这件事也核对了（2026-09-22）：`GET /repos/LaoYutang/ZCode-Lite/releases/latest` 返回 `v0.2.0`（非 draft、非 prerelease，资产含 `latest.yml` / `latest-win-x64.exe` 等），与本包版本 0.2.0 相同 → `update-available` 不成立，入口回到 idle。同一时刻官方 manifest 报的是 3.14.3（另一条产品线），这正是之前那条提示的来源；它只在**旧包**（仍是 `zcode-manifest`）上继续存在，装上本包后消失。该 Release 也是 v0.1.0 之后第二条，说明 tag → draft → 资产 → 转正的发布链路已在跑。

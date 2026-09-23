# 产品身份与展示名

## 背景

本仓库 fork 自 `zai-org/ZCode` 并重命名为 **ZCode-Lite**。展示名此前散落在打包配置、Electron 应用名、窗口标题、About 对话框、菜单/托盘、i18n 文案与发布流程里，没有单一文档说明哪些字段属于"展示名"、哪些属于"安装/更新身份"。

这两类字段的变更代价完全不同：

- 改**展示名**只影响用户看到的字，可逆。
- 改**安装/更新身份**（`appId`、deep link scheme、Linux 包名）与**运行数据目录**会让 `electron-updater` 不再把新版本当作已装版本的升级，或让用户丢失登录态与配置。

因此把边界写成规则，避免下次改文案时误伤身份字段。

## 规则

### 1. 展示名与安装身份分轴

| 类别          | 字段                                                                   | 当前值                                   | 改名时                  |
| ------------- | ---------------------------------------------------------------------- | ---------------------------------------- | ----------------------- |
| 展示名        | `PRODUCTION_IDENTITY.productName`                                      | `ZCode-Lite`                             | 改                      |
| 展示名        | `PREVIEW_IDENTITY.productName`                                         | `ZCode-Lite Preview`                     | 改                      |
| 展示名        | `runtimeApplicationName`                                               | `ZCode-Lite` / `… Dev` / `… Preview`     | 改                      |
| 安装/更新身份 | `appId`                                                                | `dev.zcode.app`（preview 加 `.preview`） | **不改**                |
| 安装/更新身份 | package.json `productName`、`homepage`、`author`、rpm/deb `maintainer` | 见构建配置                               | 跟展示名，或指向本 fork |
| 协议 / 标识符 | deep link scheme `zcode`、`protocols[].schemes`                        | `zcode`                                  | **不改**                |
| Linux 包标识  | `linuxExecutableName`、`linuxPackageName`                              | `zcode` / `zcode-preview`                | **不改**                |
| 代码标识符    | `@zcode/*` 包名、`ZCODE_*` 环境变量、i18n key、`zcode` 进程名前缀      | —                                        | **不改**                |

`productName` 决定安装包/`.app`/产物文件名（`${productName}-${version}-${platform}-${arch}`），`runtimeApplicationName` 决定 `app.setName()`、`process.title` 与 userData 目录。两者必须同时改，否则安装出来的应用名和运行期身份不一致。

`appId` 保持 `dev.zcode.app` 是有意为之：Windows AUMID、macOS bundle id 与 electron-updater 的落地判断都基于它。改掉它会让已装 0.2.x 的用户拿到一个"并存的新应用"而不是升级。同理，Linux 的 `executableName` / `packageName` 保持 `zcode*`，只改 `productName`，dpkg/rpm 才会把新版本当作升级而非另一个包。

### 2. 运行数据目录跟随展示名

`runtimeUserDataPath = <appData>/<runtimeApplicationName>`（`appData` 在 macOS 是 `~/Library/Application Support`、Windows 是 `%APPDATA%`、Linux 是 `~/.config`）。因此改名同时把数据目录从 `ZCode` 迁到 `ZCode-Lite`：

```
改名前                          改名后
<appData>/ZCode/                <appData>/ZCode-Lite/
  session/…                       session/…
  remote-assets-cache/…           remote-assets-cache/…
```

- **不做自动搬运。** 上游官方 ZCode 用的是同一个 `ZCode` 目录，无法区分"本产品 0.2.x 的数据"和"官方客户端的数据"；自动复制会把别人的凭据和配置搬进来。老用户需要重新登录与配置。
- 改名同时让两个产品不再共用 userData，顺带解决 Electron 单实例锁互相激活的问题。
- `scripts/dev-desktop-remote-prod.mjs` 里的 `<appData>/<name>/remote-assets-cache` 必须与 `runtimeApplicationName` 同源，否则开发态会去读一个不存在的缓存目录。

### 3. 组件名不随产品改名

以下名字指**组件/子系统**，与展示名无关，保持原样：

| 名称                      | 位置                                | 原因                                                         |
| ------------------------- | ----------------------------------- | ------------------------------------------------------------ |
| `ZCode Agent`             | i18n、agent 运行时                  | 与 `zcodeAgent` 来源标识、`~/.zcode` 目录一致                |
| `ZCode MCP` / `ZCode CDN` | i18n                                | 内置插件与 CDN 的既有名称                                    |
| `ZCode Protocol`          | 协议层                              | 线协议名，与 `specs/build` 之外的协议文档同源                |
| `ZCode Computer Use`      | `HELPER_DISPLAY_NAME`、权限浮窗标题 | macOS 权限列表按这个名字展示已授权条目，改名会让用户对不上号 |

CUA Helper 的 `HELPER_APP_NAME` 是安装路径的一段（`~/…/computer-use/ZCode Computer Use.app`），改名等于换一个安装路径并要求用户重新授权，故不随展示名变更。

### 3.1 与 OS 集成时"看起来像名字、实际是标识符"的字段

这些字段以产品名命名，但作用是**跨版本识别自己写下的东西**。改名会让旧记录被当成别人的数据（拒绝清理、重复注册或留下删不掉的残留），所以保持原值：

| 字段                                                         | 位置                                                  | 改名后果                                                       |
| ------------------------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------- |
| `Comment=ZCode Desktop App`                                  | `desktopLinuxDeepLinkRegistration.ts` 的归属标记      | 改名之前写下的 `zcode.desktop` 被判为"非本应用写入"，拒绝清理  |
| `ZCode.OpenInZCode`                                          | `desktopWindowsOpenFolderContextMenu.ts` 的注册表键名 | 旧右键菜单项留在注册表，用户无法通过新版本删除                 |
| `Open in ZCode.workflow`                                     | `desktopFinderOpenFolderWorkflow.ts` 的 bundle 目录名 | `~/Library/Services` 下新旧两份并存，Finder 服务菜单出现重复项 |
| `dev.zcode.app.finder-open-workflow`、`dev.zcode.cua-helper` | 各 bundle id                                          | 系统按新身份重新登记，旧授权与关联失效                         |
| `zcode: "ZCode"`                                             | `plugin-display-name.ts` 的 slug 缩写表               | 它只负责把 `zcode` 词元首字母大写，不是品牌名                  |
| `<appData>/ZCode`、`<appData>/ZCode Dev`                     | `mcpUserDirectory/legacy.ts` 的遗留候选路径           | 这些路径本来就该指向改名前的目录，是迁移来源而非当前值         |

对照关系：**用户看得见的文字**（`.desktop` 的 `Name=` / `StartupWMClass=`、Finder 服务菜单标签、Windows `MUIVerb`、OpenRouter `X-OpenRouter-Title`）跟着改；**用来匹配自己写过的记录**的字符串不改。Linux 的 `LINUX_DESKTOP_ENTRY_OWNERSHIP_MARKER` 同时是写进文件的 `Comment=` 内容，既是标识符也是可见文字，这里按标识符处理。

### 3.2 对外标识

`OPENROUTER_ATTRIBUTION_HEADERS` 的 `X-OpenRouter-Title` **要**改：它是 OpenRouter 应用榜单里的展示名，fork 的用量不应记到上游名下。与之相对，`@zcode/*` 包名、`ZCODE_*` 环境变量、CDN 路径（`cdn-zcode.z.ai/zcode/official-plugin/marketplace.json`）与市场 id `zcode-plugins-official` 都是接缝标识，不动。

`zcode-source-headers.ts` 的 `User-Agent: ZCode/<version>` 也保持不动：它是协议层的客户端标识，提供商侧可能按它做识别与支持，用户看不到，改名只有兼容风险。

### 3.3 文案与它绑定的非文案事实

改名时容易只改文字、漏掉跟着文字的数值或匹配集合：

| 位置                                                   | 绑定事实                                                                                                    | 处理                                                   |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `windowsCuaOperationIndicatorContent.ts`               | `indicatorCopy` 的 `width` 就是提示条窗口宽度（白底居中 + nowrap，窄了就裁字）                              | 文案加 5 个字符，两个语言同步 +40px                    |
| `zcodeUiError.ts` 的 `GENERIC_ZCODE_UI_ERROR_MESSAGES` | `"ZCode session failed"` 是 agent 真实吐出的错误原文，用于匹配                                              | 不随产品改名；改了就匹配不上，错误会被当成未知错误透传 |
| `builtinSkillI18n.ts` 的技能描述                       | 描述里的名字对应 `ZCode In-app Browser`、`zcode-plugins-official`、`ZCode Browser Use` 等仍然保持原名的组件 | 不随产品改名，否则描述与它指的东西对不上号             |

### 4. 窗口标题与进程名必须同步

`formatZCodeRendererProcessName()` 按 `document.title` 判定窗口种类（主窗口 / 资源管理器 / 远端窗口）。`document.title` 来自 `packages/desktop/src/renderer/index.html`、`packages/web/index.html` 与运行期的 `packages/web/src/main.tsx`。改 `<title>` 时必须同时改这处比较，否则主窗口会退化成 `zcode-renderer-zcode-lite` 而不是 `zcode-renderer-main`。

### 5. Release 命名

发布流程的 Release 标题、release notes 首行标题都使用展示名（`ZCode-Lite ${version}`）；首行 markdown 标题会被客户端 `deriveReleaseNotesTitle()` 当更新说明标题直接展示。Release 资产名来自 `productName`，无需单独维护。

## 唯一所有者

| 事实                                     | 唯一所有者                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| 打包展示名（productName）与安装/更新身份 | `packages/desktop/scripts/desktop-product-identity.mjs`                          |
| 运行期应用名（含 userData 目录）         | `packages/desktop/src/main/desktopRuntimeEnv.ts` 的 `runtimeApplicationName`     |
| 窗口标题与进程名映射                     | `packages/shared/src/process-names.ts` + 各 `index.html` / `web/src/main.tsx`    |
| 关于对话框文案                           | `packages/desktop/src/main/about.ts`                                             |
| 菜单与托盘文案                           | `packages/shared/src/desktopMenu.ts`（`{appName}` 由 `app.name` 注入）           |
| Release 标题与说明标题                   | `.github/workflows/package-desktop.yml` 的 Generate release notes / Publish 步骤 |
| 其余 UI 文案                             | `packages/ui/src/i18n/locales/*`、`apps/zcode-cli/packages/i18n/src/locales/*`   |

## 失败语义

| 情况                                             | 表现                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| 只改 `productName` 不改 `runtimeApplicationName` | 安装包显示新名，运行期 `app.name` 与数据目录仍是旧名                 |
| 只改 `index.html` 的 `<title>` 不改进程名比较    | 主窗口进程名变成 `zcode-renderer-<新名>`，按进程名过滤的排障逻辑失效 |
| 改 `appId`                                       | 已装用户拿到并存的新应用，`electron-updater` 不再认为可升级          |
| 改 `runtimeApplicationName`                      | 老用户数据目录不被读取，需重新登录；无自动迁移                       |

## 验收场景

1. 打包产物文件名为 `ZCode-Lite-<version>-<platform>-<arch>.<ext>`，macOS 下 `.app` 名为 `ZCode-Lite.app`。
2. 安装后 `app.getName()` 为 `ZCode-Lite`，userData 目录为 `<appData>/ZCode-Lite`。
3. 关于对话框标题为「关于 ZCode-Lite」/「About ZCode-Lite」，版权行为「版权所有 © <year> ZCode-Lite。」/「Copyright © <year> ZCode-Lite.」。
4. 托盘 tooltip 与「打开 ZCode-Lite」、帮助菜单「关于 ZCode-Lite」显示新名；`{appName}` 占位（隐藏/退出）替换后也是新名。
5. 桌面主窗口进程名仍是 `zcode-renderer-main`；Web 站点标题为 `ZCode-Lite - Web + Server`。
6. 新构建的 Release 标题为 `ZCode-Lite <version>`，release notes 首行为 `# ZCode-Lite <version>`。
7. 组装视图里 `ZCode Agent`、`ZCode MCP`、`ZCode Protocol`、`ZCode Computer Use` 四处名称保持未变。
8. deep link `zcode://` 仍能被识别；Windows 快捷方式 AUMID 与旧版一致（升级而非并存）。

## 测试

- `packages/desktop/test/desktopUpdateSource.test.mjs`：更新源与产品身份的耦合关系（改名不影响更新源解析）。
- 展示名本身没有单测：`productName` / `runtimeApplicationName` 是构建期与启动期常量，端到端由 `pnpm bundle:desktop` 的产物名与安装后 About 面板核对（对应验收场景 1、2、3）。
- `formatZCodeRendererProcessName()` 的行为由场景 5 覆盖；改动标题时必须同时改它的比较值。

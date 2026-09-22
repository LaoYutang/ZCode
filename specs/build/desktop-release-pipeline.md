# 桌面端发布流水线

## 背景

桌面端发布此前按「平台 + 架构」拆成 6 个 CI job，每个 job 单独跑一次 electron-builder，各自产出 `latest*.yml`。v0.0.0 的发布把三个问题一起暴露出来：

1. **`latest*.yml` 同名覆盖**：Windows 的两支架构各产出一份 `latest.yml`、macOS 的两支架构各产出一份 `latest-mac.yml`（架构后缀只对 Linux 追加，见 `app-builder-lib/out/publish/updateInfoBuilder.js` 的 `getUpdateInfoFileName`）。上传 Release 时后传的覆盖先传的，清单只描述一支架构。
2. **Release 上传直接失败**：6 个 job 各带一份 `builder-debug.yml`，平铺进 `release-assets` 后 basename 重复。`gh release upload` 在单次调用内以固定并发度上传，`--clobber` 只处理「调用开始前已存在的同名资产」，批内重名会返回 `HTTP 422 ReleaseAsset.name already exists` 并取消整批上传，留下资产残缺的 draft。
3. **残缺 draft 阻塞重跑**：`gh release view` 对 draft 同样返回成功，重跑会被「已存在，拒绝覆盖」守卫拦下。

## 规则

### 1. 构建粒度：每平台一次调用，一次调用内产出两支架构

发布路径的矩阵单位是**平台**而不是「平台 + 架构」。每个平台 job 用**一次** electron-builder 调用同时产出该平台的两支架构（x64 + arm64）。

必须是同一次调用，不能是同一 job 内串行两次调用：channel 文件由 `app-builder-lib` 的 `PublishManager` 在单进程内按「文件路径 + provider」分组累加 `files[]` 后写出（`writeUpdateInfoFiles`），第二次调用是**覆写**而不是合并。串行两次调用会退回问题 1。

手动 `workflow_dispatch` 允许只构建单支架构（用于快速验证）；这类产物 `is_release=false`，不进入发布路径，因此 channel 文件只描述该架构是可接受的。

### 2. channel 文件契约

文件名由 `electron-updater` 客户端按平台固定请求（`Provider.getChannelFilePrefix`），**不可改名**：

| 平台 | 产出文件 | 必须覆盖的架构 |
| --- | --- | --- |
| Windows | `latest.yml` | x64 + arm64（两个 `.exe` 都在 `files[]`） |
| macOS | `latest-mac.yml` | x64 + arm64（各架构的 dmg/zip 都在 `files[]`） |
| Linux | `latest-linux.yml`、`latest-linux-arm64.yml` | 各自覆盖 x64 / arm64 |

构建步骤必须在本地就断言「本平台的 channel 文件存在且覆盖了本次构建的全部架构」，不能等客户端报 `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`。

### 3. 发布资产契约

进入 Release 的资产集合是：各平台安装包、`.blockmap`、channel 文件、`SHA256SUMS.txt`。

- `builder-debug.yml` 是 electron-builder 的排障输出（生效的文件匹配规则转储），客户端与用户都不需要，**不上传**。
- `SHA256SUMS.txt` 由发布步骤生成，条目使用**资产名**（不带 `release-assets/<artifact>/` 前缀），使用户能对下载得到的文件直接执行 `sha256sum -c`；它自身不参与校验和计算。
- 上传前必须断言「上传集合内 basename 唯一」。重名意味着某个文件会被静默丢弃或让整批上传失败，必须在 `gh release create` **之前**失败并列出冲突文件。

### 4. 发布顺序

保持 `specs/update/desktop-auto-update-source.md` 的 `创建 draft → 上传资产 → 转正` 顺序：提前转正会让客户端在资产就位前解析到 `releases/latest`。已存在的 Release 一律拒绝覆盖。

## 唯一所有者

| 事实 | 唯一所有者 |
| --- | --- |
| job 级目标平台（OS）与本次构建的架构集合 | `packages/desktop/scripts/target-platform.mjs`：`getTargetPlatform()`（OS + 默认架构）、`resolveTargetArches()`、`resolvePackContextTarget(context)` |
| 每个 pack target 的 os/arch/key | `resolvePackContextTarget()`；`electron-builder.config.js` 的钩子必须从 `context` 解析，不得用 env 声明的架构替代 |
| 哪些文件进 Release、以什么名字、校验和怎么写 | `packages/desktop/scripts/release-assets.mjs` |
| 应用版本 | `packages/desktop/scripts/build-metadata.mjs`（见 `specs/build/app-version-source.md`） |

## 迁移边界

- 架构相关的静态配置（`asarUnpack`、`files` 裁剪、`extraResources`）用 electron-builder 的 `${arch}` 宏按 target 展开，OS 部分继续取 job 级解析结果。`${platform}` 宏是**宿主**平台，不能用它推导目标 OS。
- 单个平台的构建可以在该平台的同一 OS 宿主上完成两支架构：native 资产全部按 target 预置（node-pty 的 mac/win 预编译随包分发、Linux 两支来自 `@lydell/node-pty-linux-*`、native-search 归档按 key 解包），不依赖宿主架构。
- 回退到「每架构一个 job」只需要改矩阵；此时发布步骤的唯一性断言会主动报错（而不是静默覆盖），这是预期行为。

## 失败语义

| 情况 | 表现 |
| --- | --- |
| channel 文件缺少某支架构 | 构建步骤失败（`bundle.mjs` 的 post-build 校验） |
| 上传集合出现同名文件 | 在创建 draft 之前失败并列出冲突文件 |
| 上传中途失败 | draft 残缺；重跑前必须人工删除该 draft（守卫拒绝覆盖） |
| tag 版本与 channel 文件 `version` 不一致 | 构建步骤失败（见 `specs/build/app-version-source.md`） |

## 验收场景

1. 发布路径（tag 或 `workflow_dispatch target=all`）：每平台一个 job，Windows 的 `dist/latest.yml` 的 `files[]` 同时包含 `-win-x64.exe` 与 `-win-arm64.exe`；macOS 的 `latest-mac.yml` 同时包含两支架构的 dmg/zip；Linux 产出 `latest-linux.yml` 与 `latest-linux-arm64.yml`。
2. `pnpm bundle:desktop -- --os win --arch x64,arm64` 在 Windows 宿主上产出两个 `.exe`，两支架构都通过 native 资源边界断言与运行时依赖校验。
3. Release 资产包含安装包、`.blockmap`、channel 文件与 `SHA256SUMS.txt`，不包含 `builder-debug.yml`。
4. 人为让两个 artifact 产出同名文件 → 发布在创建 draft 之前失败并列出冲突。
5. 单架构 `workflow_dispatch` 构建不创建 Release，且只校验该架构的 channel 文件。
6. `SHA256SUMS.txt` 的条目使用资产名，可直接对下载文件执行 `sha256sum -c`。

## 测试

- `packages/desktop/test/targetPlatform.test.mjs`：架构列表解析、`resolvePackContextTarget()` 的校验分支。
- `packages/desktop/test/channelFiles.test.mjs`：各平台 channel 文件的期望架构覆盖（含缺架构、版本不一致的失败分支）。
- `packages/desktop/test/releaseAssets.test.mjs`：上传集合收集、`builder-debug.yml` 排除、重名冲突、`SHA256SUMS.txt` 条目格式。
- 端到端由 CI 的构建矩阵与发布步骤保证；本地可用 `pnpm bundle:desktop -- --os win --arch x64,arm64` 复核场景 1、2。

# 应用版本号来源

## 背景

此前桌面应用版本取自根 `package.json` 的 `version` 字段，发版需要先改这个文件再打包，版本与发布 tag 之间存在两处事实，容易不一致：`latest.yml` 里的版本来自 `package.json`，而 release tag 来自人工输入。客户端判断"是否有新版本"完全依赖这两者相等，一旦不一致就会永久判定为"已是最新"。

## 规则

桌面应用的版本号**以 git tag 为唯一来源**，开发态使用固定的开发占位版本。

### 解析优先级

`resolveAppVersion()` 按以下顺序取第一个可用值：

1. `ZCODE_RELEASE_TAG` 环境变量（显式覆盖，供本地打包验证指定版本用）。
2. CI 的 tag 构建：`GITHUB_REF_TYPE === "tag"` 时取 `GITHUB_REF_NAME`。
3. 本地仓库：`git describe --tags --exact-match HEAD`。

   必须使用 `--exact-match`：否则普通提交会继承最近一个 tag 的版本，把开发构建伪装成发布版本。

4. 以上都不可用：`0.0.0-dev`。

### 归一化与校验

- 取到的 tag 先经 `normalizeVersion()` 去掉前导非数字字符（`v3.14.1` → `3.14.1`），保留 prerelease 后缀（`v3.15.0-beta.1` → `3.15.0-beta.1`）。
- 结果必须匹配 `^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$`，否则**直接失败**，不静默降级。

  坏 tag 必须让构建失败：静默出版本会让发布产物带着错误版本流到客户端，且客户端无法自愈。

- 开发态占位是 `0.0.0-dev` 而非字面量 `dev`，因为版本值必须是合法 semver：
  - `app-builder-lib/out/util/normalizePackageData.js` 对 `version` 做 `semver.valid()` 校验，非法直接抛错，electron-builder 无法打包。
  - `build-windows-browser-import-helper.mjs` 用 `/^\d+(?:\.\d+){2}(?:-[0-9A-Za-z.-]+)?$/` 校验版本后拼 Windows assembly manifest。
  - `packages/shared/src/version.ts` 运行期 fallback 已经是 `"0.0.0-dev"`，保持一致。

## 唯一所有者

`packages/desktop/scripts/build-metadata.mjs` 的 `resolveAppVersion()` 是**唯一**的版本解析实现。其余需要版本的构建脚本必须 import 它，不得自行读取 `package.json`：

| 消费方 | 用途 |
| --- | --- |
| `packages/desktop/scripts/build-metadata.mjs` | `appVersion` → `__ZCODE_VERSION__` define、`electron-builder.config.js` 的 `version`、`out/metadata/build-meta.json` |
| `packages/desktop/scripts/build-windows-browser-import-helper.mjs` | Windows assembly manifest |
| `scripts/prepare-prebuilds.mjs` | mock CDN 目录 `mock-cdn/releases/<version>` |

后两者必须与主链路同源：`prepare-prebuilds.mjs` 写入的目录名会被运行时 `desktopRuntimeEnv.ts` 用 `join(mockCdnDir, "releases", ZCODE_VERSION)` 反查，版本分歧会导致开发态远端运行时资产找不到。

> 因此 `prepare:runtime-assets` 与 `build` 必须在**同一份环境**下运行（`pnpm bundle:desktop` 会在同一次调用里依次执行两者，天然满足）。若手工分两步执行并只给其中一步设置 `ZCODE_RELEASE_TAG`，mock CDN 目录名会与运行时的 `ZCODE_VERSION` 分歧——这是只影响本地 mock-CDN 调试的已知边界。

> `appVersion` 的消费者必须由**同一次** `build-meta.json` 提供（`build-metadata.mjs` 已把结果落盘，tsup/vite 读同一份），保证一次产物内部版本自洽。

## 迁移边界

- 根 `package.json` 的 `version` **保留**（`release-it`、工作区内其他包仍需要该字段），但**不再是应用版本来源**。修改该字段不会改变构建出的应用版本。
- `apps/zcode-cli` 有独立的 `package.json` 版本，不受本规则影响。
- 走 `workflow_dispatch` 手动构建时没有 tag，版本是 `0.0.0-dev`；这类产物不得作为 release 发布。

## 验收场景

1. 在 `v3.14.1` 上构建 → 应用版本是 `3.14.1`；`dist/latest.yml` 的 `version` 也是 `3.14.1`。
2. 在 `v3.15.0-beta.1` 上构建 → 应用版本是 `3.15.0-beta.1`（prerelease 后缀保留）。
3. HEAD 不在任何 tag 上，且未设置 `ZCODE_RELEASE_TAG` → 应用版本是 `0.0.0-dev`。
4. HEAD 在一个早于 `v3.14.1` 的提交上（即"最近 tag 是 v3.14.1，但 HEAD 已前进"）→ 版本是 `0.0.0-dev`，不是 `3.14.1`。
5. `ZCODE_RELEASE_TAG=v3.13.0` 覆盖 → 版本是 `3.13.0`，即使 HEAD 上有别的 tag。
6. `ZCODE_RELEASE_TAG=nightly` → 构建失败并报出非法版本值。
7. `build-windows-browser-import-helper.mjs` 与 `prepare-prebuilds.mjs` 在场景 1/3 下解析出的版本与主链路一致。

## 测试

`packages/desktop/test/desktopUpdateSource.test.mjs` 覆盖 `resolveAppVersion()` 的优先级与校验失败分支（用注入的 env / tag 解析结果，不依赖真实 git 状态）。

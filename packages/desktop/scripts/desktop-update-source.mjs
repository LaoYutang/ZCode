/**
 * 构建期更新源解析（见 specs/update/desktop-auto-update-source.md）。
 *
 * 更新源与产品身份解耦：`ZCODE_UPDATE_REPOSITORY` 决定从哪个 GitHub Release 检测更新，
 * flavor 只决定"要不要启用更新器"。桌面构建**不再回退官方 manifest**——见
 * `DEFAULT_UPDATE_REPOSITORY` 的说明。
 */
import { resolveDesktopProductFlavor } from "./desktop-product-identity.mjs";

export const ZCODE_UPDATE_REPOSITORY_ENV = "ZCODE_UPDATE_REPOSITORY";

/**
 * 未显式配置 `ZCODE_UPDATE_REPOSITORY` 时的更新源仓库：本产品自己的 GitHub Release。
 *
 * 为什么不继续回退官方 manifest：官方 Release 属于**另一条产品线**，它的版本号（3.14.x）
 * 与本仓库的版本号（0.x）没有可比性，回退过去必然产生一个长期存在、点不掉的"有更新"提示；
 * 而 manifest 模式下那是真更新器（可下载安装），用户一旦开了自动下载就会把官方客户端装到
 * 本产品的安装目录上。官方源还曾经是官方强更闸拦下启动的入口。
 *
 * 把自有仓库放在构建期默认值里，让"产品身份 = 更新源"在编译期就成立，不依赖每个调用方
 * 记得传环境变量。`ZCODE_UPDATE_REPOSITORY` 仍然优先，fork 或临时验证别的仓库不必改这里。
 */
export const DEFAULT_UPDATE_REPOSITORY = "LaoYutang/ZCode-Lite";

/** `owner/repo`。与 electron-updater 的 GithubOptions 取值域一致。 */
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * 解析 GitHub 仓库。非法格式直接失败：构建期拦下来，避免产物带着打不开的更新源流出去。
 */
export function resolveUpdateSourceRepository(env = process.env) {
  const repository = env[ZCODE_UPDATE_REPOSITORY_ENV]?.trim() ?? "";
  if (!repository) {
    return null;
  }

  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error(
      `invalid ${ZCODE_UPDATE_REPOSITORY_ENV}=${repository}; expected "owner/repo" using letters, digits, dot, dash or underscore`,
    );
  }

  return repository;
}

/**
 * 更新源：
 * - 显式配了仓库 → `github-release`（该仓库的 Release，仅提示并跳转下载页）
 * - 未配置 + production 身份 → `github-release`（`DEFAULT_UPDATE_REPOSITORY`，语义同上）
 * - 未配置 + 非 production 身份 → `disabled`（Preview 不启用更新器，与改造前一致）
 *
 * 桌面构建**不再产出 `zcode-manifest`**：它只对官方分发链路成立。该取值仍保留在
 * `@zcode/shared` 的类型与运行期校验里，供未注入 define 的 bundle（web/CLI/测试）沿用旧语义。
 */
export function resolveDesktopUpdateSource(env = process.env) {
  const repository =
    resolveUpdateSourceRepository(env) ??
    (resolveDesktopProductFlavor(env) === "production" ? DEFAULT_UPDATE_REPOSITORY : null);

  if (!repository) {
    return { kind: "disabled", repository: null, owner: null, repo: null };
  }

  // 格式已在 resolveUpdateSourceRepository 校验过，这里只需要拆开给 provider 用。
  const [owner, repo] = repository.split("/");
  return { kind: "github-release", repository, owner, repo };
}

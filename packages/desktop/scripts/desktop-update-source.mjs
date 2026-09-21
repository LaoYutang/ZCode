/**
 * 构建期更新源解析（见 specs/update/desktop-auto-update-source.md）。
 *
 * 更新源与产品身份解耦：`ZCODE_UPDATE_REPOSITORY` 决定是否从自己的 GitHub Release
 * 检测更新，flavor 只作为没有显式仓库时的回退依据。这样 fork 不需要改代码就能
 * 换掉官方更新提示，同时**不接官方源**的构建也不再受官方强更闸约束。
 */
import { resolveDesktopProductFlavor } from "./desktop-product-identity.mjs";

export const ZCODE_UPDATE_REPOSITORY_ENV = "ZCODE_UPDATE_REPOSITORY";

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
 * 三态更新源：
 * - 配了仓库 → `github-release`（自己的 Release，仅提示并跳转下载页）
 * - 未配置 + production 身份 → `zcode-manifest`（官方 manifest，行为与改造前一致）
 * - 未配置 + 非 production 身份 → `disabled`（与改造前一致：Preview 不启用更新器）
 */
export function resolveDesktopUpdateSource(env = process.env) {
  const repository = resolveUpdateSourceRepository(env);
  if (repository) {
    // 格式已在 resolveUpdateSourceRepository 校验过，这里只需要拆开给 provider 用。
    const [owner, repo] = repository.split("/");
    return { kind: "github-release", repository, owner, repo };
  }

  return {
    kind: resolveDesktopProductFlavor(env) === "production" ? "zcode-manifest" : "disabled",
    repository: null,
    owner: null,
    repo: null,
  };
}

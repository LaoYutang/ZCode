import { net } from "electron";
import { logger } from "./logger.js";

/**
 * GitHub Release 详情（版本说明与页面地址）。
 *
 * 版本检测由 electron-updater 的 github provider 负责，这里只补齐**版本说明**：
 * provider 的说明来自 releases.atom 的 `<content>`，无法保证是作者写入的原始 markdown；
 * REST 的 `body` 一定是。取不到时降级为只有版本号 + 跳转链接，不影响检测本身。
 */

const GITHUB_API_BASE_URL = "https://api.github.com/repos";
const GITHUB_WEB_BASE_URL = "https://github.com";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export interface GitHubReleaseDetails {
  tag: string;
  /** 归一化版本号（去掉 tag 前导非数字字符），与构建期版本解析同一口径。 */
  version: string;
  /** Release 正文 markdown；正文为空时为 null。 */
  notes: string | null;
  /** Release 页面地址。 */
  htmlUrl: string;
}

/** tag → 版本号。与 `resolveAppVersion` 的归一化保持一致：`v3.14.1` → `3.14.1`。 */
export function normalizeGitHubTagVersion(tag: string): string {
  return tag.trim().replace(/^[^\d]*/, "");
}

/** Release 页面地址。没有 tag 时回退 releases/latest，保证按钮永远有可用目标。 */
export function buildGitHubReleasePageUrl(
  owner: string,
  repo: string,
  tag?: string | null,
): string {
  const base = `${GITHUB_WEB_BASE_URL}/${owner}/${repo}/releases`;
  const trimmedTag = tag?.trim();
  return trimmedTag ? `${base}/tag/${encodeURIComponent(trimmedTag)}` : `${base}/latest`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 解析 `GET /repos/{owner}/{repo}/releases/latest` 的响应体。 */
export function parseGitHubReleasePayload(
  payload: unknown,
): Omit<GitHubReleaseDetails, "htmlUrl"> & { htmlUrl: string | null } | null {
  if (!isRecord(payload)) {
    return null;
  }

  const tag = typeof payload.tag_name === "string" ? payload.tag_name.trim() : "";
  if (!tag) {
    return null;
  }

  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  const htmlUrl = typeof payload.html_url === "string" ? payload.html_url.trim() : "";
  return {
    tag,
    version: normalizeGitHubTagVersion(tag),
    notes: body.length > 0 ? body : null,
    htmlUrl: htmlUrl.length > 0 ? htmlUrl : null,
  };
}

export type GitHubReleaseRequest = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * 拉取最新正式 Release。只用于增强提示文案，因此任何失败都返回 null。
 *
 * 用 `net.fetch` 而不是 Node 原生 fetch：前者走 Chromium 网络栈，能继承
 * `applyDesktopChromiumNetworkPolicies` 配置的代理，与其余桌面端出网保持一致。
 */
export async function fetchLatestGitHubRelease(options: {
  owner: string;
  repo: string;
  request?: GitHubReleaseRequest;
}): Promise<GitHubReleaseDetails | null> {
  const { owner, repo } = options;
  const request = options.request ?? ((input, init) => net.fetch(input, init));
  const url = `${GITHUB_API_BASE_URL}/${owner}/${repo}/releases/latest`;

  try {
    const response = await request(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn(`[auto-update] github release notes request failed status=${response.status}`);
      return null;
    }

    const raw = await response.text();
    if (raw.length > MAX_RESPONSE_BYTES) {
      logger.warn("[auto-update] github release notes response too large");
      return null;
    }

    const parsed = parseGitHubReleasePayload(JSON.parse(raw));
    if (!parsed) {
      logger.warn("[auto-update] github release notes payload is missing tag_name");
      return null;
    }

    return {
      ...parsed,
      htmlUrl: parsed.htmlUrl ?? buildGitHubReleasePageUrl(owner, repo, parsed.tag),
    };
  } catch (error) {
    logger.warn("[auto-update] fetch github release notes failed:", error);
    return null;
  }
}

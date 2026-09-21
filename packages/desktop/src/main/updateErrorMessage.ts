/**
 * electron-updater 的错误消息不能直接展示给用户：`Cannot parse releases feed` 这类错误会把
 * 完整的 releases atom feed XML、HTTP 响应头和堆栈一起拼进 message，弹到界面上会占满整个屏幕。
 *
 * 本模块保持**零 import**，以便在纯 Node 下用 node:test 直接验证
 * （见 packages/desktop/test/updateErrorMessage.test.mjs）。
 */

/** 用户可见错误文案的长度上限，超出部分截断。 */
export const UPDATE_ERROR_MESSAGE_MAX_LENGTH = 200;

/**
 * 表示「解析不出最新发布」的 electron-updater 错误码。三个都在实测中出现过：
 * - `ERR_UPDATER_LATEST_VERSION_NOT_FOUND`：getLatestTagName 请求失败。仓库没有**已发布**的
 *   Release 时，GitHub 会把 `releases/latest` 重定向到 `/releases` 索引页，而该页面对
 *   `Accept: application/json` 返回 406（索引页没有 JSON 表示）。
 * - `ERR_UPDATER_INVALID_RELEASE_FEED`：provider 把上面的失败重新包装成 feed 解析错误，
 *   并把 feed XML 一起拼进 message。
 * - `ERR_UPDATER_NO_PUBLISHED_VERSIONS`：feed 里没有可用版本。
 */
export const UNRESOLVED_RELEASE_ERROR_CODES: readonly string[] = [
  "ERR_UPDATER_LATEST_VERSION_NOT_FOUND",
  "ERR_UPDATER_INVALID_RELEASE_FEED",
  "ERR_UPDATER_NO_PUBLISHED_VERSIONS",
];

/** feed 里没有 entry 时 electron-updater 抛的是**无 code** 的普通 Error，只能按消息识别。 */
const UNRESOLVED_RELEASE_ERROR_MESSAGE_FRAGMENTS: readonly string[] = [
  "No published versions on GitHub",
  "Unable to find latest version on GitHub",
];

function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "";
}

/**
 * 错误是否属于「解析不出最新发布」。调用方自行决定要不要按更新源这样归类：
 * 只有 `github-release` 源下它才是正常状态（tag 已推、Release 还没发布），
 * 官方 manifest 源的同名错误码含义不同。
 */
export function isUnresolvedReleaseError(error: unknown): boolean {
  const code = readErrorCode(error);
  if (code !== undefined && UNRESOLVED_RELEASE_ERROR_CODES.includes(code)) {
    return true;
  }

  const message = readErrorMessage(error);
  return UNRESOLVED_RELEASE_ERROR_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment));
}

/** 读取错误码，供日志使用。 */
export function getErrorCode(error: unknown): string | undefined {
  return readErrorCode(error);
}

/**
 * 把任意错误消息压成单行并截断。多行原文（feed XML + 响应头）会把整个界面撑满。
 */
export function toSingleLineErrorMessage(
  message: string,
  maxLength: number = UPDATE_ERROR_MESSAGE_MAX_LENGTH,
): string {
  const singleLine = message.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }

  return `${singleLine.slice(0, maxLength)}…`;
}

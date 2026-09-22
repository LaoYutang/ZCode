/**
 * 凭据与内置 provider 标识
 *
 * 说明：敏感信息（如 appSecret）以及 provider 默认端点配置
 * 只允许放在 services 的 provider 模块中，不能放 shared 层。
 *
 * 账号登录（OAuth 登录态、deep link 回调、令牌与用户信息）已随无账号模式整体移除：
 * 这里只保留凭据错误归一化与内置 provider id。
 */

/** 内置 BigModel provider id */
export const BIGMODEL_PROVIDER_ID = "bigmodel" as const;

/** 内置 ZAI provider id */
export const ZAI_PROVIDER_ID = "zai" as const;

/** 凭据解密失败错误前缀 */
export const CREDENTIAL_DECRYPT_ERROR_PREFIX = "凭据解密失败：" as const;

/** 凭据解密失败稳定错误码 */
export const CREDENTIAL_DECRYPT_ERROR_CODE = "ZCODE_CREDENTIAL_DECRYPT_FAILED" as const;

/** 判断错误是否来自本地凭据解密失败 */
export function isCredentialDecryptError(error: unknown): boolean {
  const code = readCredentialErrorCode(error);
  if (code) {
    return code === CREDENTIAL_DECRYPT_ERROR_CODE;
  }

  // 兼容历史错误和跨边界丢失 code 的旧 payload；新错误应优先携带稳定 code。
  if (readCredentialErrorMessage(error).startsWith(CREDENTIAL_DECRYPT_ERROR_PREFIX)) {
    return true;
  }

  return false;
}

function readCredentialErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as { code?: unknown }).code ?? "");
  }

  return "";
}

function readCredentialErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }

  return "";
}

/** OAuth provider 标识；仅用于 `model-provider-family` 的内置 provider 家族判定 */
export type OAuthProviderId =
  | typeof BIGMODEL_PROVIDER_ID
  | typeof ZAI_PROVIDER_ID
  | (string & { readonly __oauthProviderBrand?: never });

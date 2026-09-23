export const OPENROUTER_ATTRIBUTION_HEADERS = {
  // OpenRouter 用这个标题在应用榜单里标注流量来源；本仓库是独立分支，不应把用量记到上游名下。
  "X-OpenRouter-Title": "ZCode-Lite",
  "X-OpenRouter-Categories": "programming-app",
} as const;

export function isOpenRouterBaseUrl(baseUrl: string | undefined): boolean {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const url = new URL(trimmed);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (hostname === "openrouter.ai" || hostname.endsWith(".openrouter.ai"))
    );
  } catch {
    return false;
  }
}

export function withOpenRouterAttributionHeaders(
  headers: Record<string, string>,
  baseUrl: string | undefined,
): Record<string, string> {
  if (!isOpenRouterBaseUrl(baseUrl)) {
    return headers;
  }
  return {
    ...headers,
    ...OPENROUTER_ATTRIBUTION_HEADERS,
  };
}

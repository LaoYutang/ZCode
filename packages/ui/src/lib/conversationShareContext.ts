const SHARE_CONTEXT_BLOCK_PATTERN =
  /(?:\n\n)?# zcode-share-context:\n```zcode-share-context\n([\s\S]*?)\n```\s*$/u;

interface ConversationShareContextReference {
  contextId: string;
  shareUrl: string;
}

function isReference(value: unknown): value is ConversationShareContextReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => key !== "contextId" && key !== "shareUrl")) return false;
  if (typeof candidate.contextId !== "string" || typeof candidate.shareUrl !== "string")
    return false;
  try {
    const url = new URL(candidate.shareUrl);
    return /^\/cn\/share\/[^/]+$/u.test(url.pathname) && !url.search && !url.hash;
  } catch {
    return false;
  }
}

/**
 * 从可见正文里剥掉历史消息可能带的 share URL 尾块。
 *
 * 这个块已经不再产出：它纯粹是 renderer 自产自销（CLI/shared 里没有任何消费者），唯一作用
 * 是驱动一个已被裁掉的 chip，代价却是把 share URL 塞进发给模型的正文。写入端已删除，这里
 * 只保留读取端，避免「接线修复到 chip 删除」之间发出的消息把裸 markup 当正文显示出来。
 */
export function parseConversationShareContext(text: string): {
  visibleContent: string;
  reference: ConversationShareContextReference | null;
} {
  const match = text.match(SHARE_CONTEXT_BLOCK_PATTERN);
  if (!match) return { visibleContent: text, reference: null };
  try {
    const parsed: unknown = JSON.parse(match[1] ?? "");
    return isReference(parsed)
      ? { visibleContent: text.slice(0, match.index).trimEnd(), reference: parsed }
      : { visibleContent: text, reference: null };
  } catch {
    return { visibleContent: text, reference: null };
  }
}

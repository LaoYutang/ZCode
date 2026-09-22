import { useCallback, useEffect, useRef, useState } from "react";
import type { V4ConversationUsageDetailResult } from "@zcode/shared/zcode-protocol-v4";
import { useServices } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";

/** 「方法不存在」：只有它能证明是旧宿主没有这个查询，而不是查询失败。 */
const METHOD_NOT_FOUND_CODE = -32601;

function readErrorCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as Record<string, unknown>;
  if (typeof record.code === "number") return record.code;
  const details = record.details;
  if (typeof details === "object" && details !== null) {
    const nested = (details as Record<string, unknown>).code;
    if (typeof nested === "number") return nested;
  }
  return undefined;
}

export interface SessionUsageDetailState {
  detail: V4ConversationUsageDetailResult | null;
  error: string | null;
  loading: boolean;
  /**
   * 宿主不认识这个查询（旧 CLI / 旧远端）。此时只允许隐藏累计类数字并提示，
   * 不得回退到 `v4/conversation/usage`——那是"前缀只算一次"的另一种口径，
   * 顶上去会让用户看到与设置→用量对不上的数字。
   */
  unsupported: boolean;
}

function emptyState(): SessionUsageDetailState {
  return { detail: null, error: null, loading: false, unsupported: false };
}

/**
 * 会话用量明细（计费口径）。刷新靠 `refreshKey` 触发，不轮询：
 * 调用方用"本轮投影里恰好变一次"的信号当 key（主轮请求完成 / 子代理变化）。
 */
export function useSessionUsageDetail(options: {
  enabled?: boolean;
  refreshKey?: string | number | null;
  recentRequestLimit?: number;
  remoteSessionId?: string;
  sessionId?: string | null;
  workspaceIdentity?: string;
  workspacePath: string;
}) {
  const services = useServices();
  const zcodeAgentService = services.zcodeAgentService;
  const [state, setState] = useState<SessionUsageDetailState>(emptyState);
  const requestVersionRef = useRef(0);
  const requestInFlightRef = useRef(false);
  /** 在途期间到达的刷新请求（见 refresh 的 if 分支）：结束后补拉一次，不丢最新信号。 */
  const pendingRefreshRef = useRef(false);
  /** 供 finally 里的补拉自引用；useCallback 定义体内无法直接引用自身。 */
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const enabled = options.enabled !== false && Boolean(options.sessionId);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setState(emptyState());
      return;
    }
    const sessionId = options.sessionId;
    // 服务实现缺失（旧渲染端 bundle 配新服务）时按"宿主不支持"处理，与 -32601 同一语义。
    if (!sessionId || typeof zcodeAgentService?.getSessionUsageDetail !== "function") {
      setState({ detail: null, error: null, loading: false, unsupported: true });
      return;
    }
    if (requestInFlightRef.current) {
      // 在途期间又来了新结果（连发请求 / 子代理变化）。这里不能直接丢：丢了面板会停在
      // 上一帧、直到下一次请求完成才补上。置标志，让在途那次结束后补拉一次。
      pendingRefreshRef.current = true;
      return;
    }
    requestInFlightRef.current = true;
    const requestVersion = ++requestVersionRef.current;
    setState((current) => ({ ...current, loading: current.detail === null, error: null }));
    try {
      const detail = await zcodeAgentService.getSessionUsageDetail({
        workspacePath: options.workspacePath,
        ...(options.workspaceIdentity ? { workspaceIdentity: options.workspaceIdentity } : {}),
        ...(options.remoteSessionId ? { remoteSessionId: options.remoteSessionId } : {}),
        ...(options.recentRequestLimit ? { recentRequestLimit: options.recentRequestLimit } : {}),
        sessionId,
      });
      if (requestVersion !== requestVersionRef.current) return;
      setState({ detail, error: null, loading: false, unsupported: false });
    } catch (error) {
      if (requestVersion !== requestVersionRef.current) return;
      const unsupported = readErrorCode(error) === METHOD_NOT_FOUND_CODE;
      const message = error instanceof Error ? error.message : String(error);
      if (!unsupported) {
        logger.warn("[session-usage] 读取会话用量失败", {
          error: message,
          sessionId,
          workspaceKey: options.workspaceIdentity?.trim() || options.workspacePath,
        });
      }
      setState({
        detail: null,
        error: unsupported ? null : message,
        loading: false,
        unsupported,
      });
    } finally {
      requestInFlightRef.current = false;
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        void refreshRef.current();
      }
    }
  }, [
    enabled,
    options.remoteSessionId,
    options.recentRequestLimit,
    options.sessionId,
    options.workspaceIdentity,
    options.workspacePath,
    zcodeAgentService,
  ]);
  refreshRef.current = refresh;

  // 切换会话/工作区/远端必须清空并作废旧结果：宁可短暂空态，也不能显示上一个会话的数字。
  useEffect(() => {
    pendingRefreshRef.current = false;
    setState(emptyState());
    return () => {
      requestVersionRef.current += 1;
      pendingRefreshRef.current = false;
    };
  }, [
    options.remoteSessionId,
    options.sessionId,
    options.workspaceIdentity,
    options.workspacePath,
  ]);

  useEffect(() => {
    void refresh();
  }, [options.refreshKey, refresh]);

  return { ...state, refresh };
}

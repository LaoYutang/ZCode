import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelSelectionView } from "@zcode/services";
import { resolveProviderAvailabilityState } from "@/lib/modelProviderAvailability.js";
import { logger } from "@/logger.js";

interface ProviderAvailabilityEntryGuardResult {
  hasUsableProvider: boolean;
  providerCount: number;
  shouldOpenProviderEntry: boolean;
}

/**
 * 首次启动且没有任何可用供应商时引导用户添加供应商。
 * 应用没有登录入口：这里的唯一动作是打开「添加供应商」引导页。
 */
export function useProviderAvailabilityEntryGuard({
  enabled = true,
  startupSyncPending,
  modelSelectionView,
  modelSelectionError,
  refreshProviderState,
  readModelSelectionView,
  setProviderEntryOpen,
}: {
  enabled?: boolean;
  startupSyncPending: boolean;
  modelSelectionView: ModelSelectionView | null;
  modelSelectionError?: Error;
  refreshProviderState: () => Promise<void>;
  readModelSelectionView: () => Promise<ModelSelectionView>;
  setProviderEntryOpen: (open: boolean) => void;
}) {
  const [startupCheckCompleted, setStartupCheckCompleted] = useState(!enabled);
  const startupCheckCompletedRef = useRef(false);
  const providerAvailabilityHydrated = modelSelectionView !== null;

  const syncEntryWithProviderAvailability = useCallback(
    async (options: { forceRefresh?: boolean; reason: string }) => {
      if (!enabled) {
        return {
          hasUsableProvider: true,
          providerCount: modelSelectionView?.providers.length ?? 0,
          shouldOpenProviderEntry: false,
        } satisfies ProviderAvailabilityEntryGuardResult;
      }

      if (options.forceRefresh) {
        await refreshProviderState();
      }

      const refreshedView = options.forceRefresh
        ? await readModelSelectionView()
        : modelSelectionView;
      const availability = resolveProviderAvailabilityState({ modelSelectionView: refreshedView });
      const { hasUsableProvider, providerCount } = availability;
      // 没有任何可用模型配置时必须引导用户添加供应商（填写 Base URL 与 API Key）。
      // 启动检查、供应商保存回流等入口统一走这里，避免各处复制判断后语义分叉。
      const shouldOpenProviderEntry = !hasUsableProvider;

      logger.info("[Root] provider 可用性引导入口守卫完成检查", {
        reason: options.reason,
        source: availability.source,
        providerCount,
        hasUsableProvider,
        shouldOpenProviderEntry,
      });
      setProviderEntryOpen(shouldOpenProviderEntry);
      return {
        hasUsableProvider,
        providerCount,
        shouldOpenProviderEntry,
      } satisfies ProviderAvailabilityEntryGuardResult;
    },
    [
      enabled,
      modelSelectionView,
      refreshProviderState,
      readModelSelectionView,
      setProviderEntryOpen,
    ],
  );

  useEffect(() => {
    if (!enabled) {
      startupCheckCompletedRef.current = true;
      setStartupCheckCompleted(true);
      return;
    }

    if (modelSelectionError) {
      // 首次读取失败不能伪装成“没有 Provider”，也不能让启动门禁永久停在 loading。
      logger.error("[Root] provider 可用性读取失败，结束启动门禁等待", modelSelectionError);
      startupCheckCompletedRef.current = true;
      setStartupCheckCompleted(true);
      return;
    }

    if (startupCheckCompletedRef.current || startupSyncPending || !providerAvailabilityHydrated) {
      return;
    }

    startupCheckCompletedRef.current = true;
    void syncEntryWithProviderAvailability({
      reason: "startup",
    }).finally(() => {
      setStartupCheckCompleted(true);
    });
  }, [
    enabled,
    startupSyncPending,
    modelSelectionError,
    providerAvailabilityHydrated,
    syncEntryWithProviderAvailability,
  ]);

  return {
    startupCheckCompleted,
    syncEntryWithProviderAvailability,
  };
}

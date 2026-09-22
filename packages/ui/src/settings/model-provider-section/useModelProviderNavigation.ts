import { useEffect, useMemo } from "react";
import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";
import { getProviderFormLabel } from "@/lib/providerSettingsFormTypes.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { ModelProviderNavGroup } from "@/settings/model-provider-section/constants.js";
import { createCustomProviderNodeKey } from "@/settings/model-provider-section/utils.js";
import {
  sortModelProvidersForDisplay,
  type ProviderOrderView,
} from "@/lib/modelProviderOrdering.js";

interface UseModelProviderNavigationOptions {
  modelProviders: ProviderSettingsFormProvider[];
  modelProvidersLoading?: boolean;
  displayOrder?: ProviderOrderView;
  selectedNodeKey: string | null;
  setSelectedNodeKey: (key: string | null) => void;
  intl: ReturnType<typeof useZCodeIntl>["intl"];
}

/**
 * 设置页供应商导航。
 * 供应商只来自用户自己的配置，左侧就是这一份列表（含排序），没有账号套餐分支。
 */
export function useModelProviderNavigation({
  modelProviders,
  modelProvidersLoading = false,
  displayOrder,
  selectedNodeKey,
  setSelectedNodeKey,
  intl,
}: UseModelProviderNavigationOptions) {
  const orderedProviders = useMemo(
    // 复用模型菜单的展示排序，确保设置页和聊天框供应商顺序一致。
    () => sortModelProvidersForDisplay(modelProviders, displayOrder),
    [displayOrder, modelProviders],
  );

  const navigationGroups = useMemo<ModelProviderNavGroup[]>(
    () => [
      {
        id: "custom",
        title: intl.formatMessage({ id: "settings.modelProvider.customTitle" }),
        items: orderedProviders.map((provider) => ({
          key: createCustomProviderNodeKey(provider.providerId),
          type: "provider" as const,
          label: getProviderFormLabel(provider),
          provider,
          statusActive: provider.executable === true,
        })),
      },
    ],
    [intl, orderedProviders],
  );

  const navigationItems = useMemo(
    () => navigationGroups.flatMap((group) => group.items),
    [navigationGroups],
  );

  const selectedNavItem = useMemo(
    () => navigationItems.find((item) => item.key === selectedNodeKey) ?? null,
    [navigationItems, selectedNodeKey],
  );

  const fallbackNodeKey = navigationItems[0]?.key ?? null;
  useEffect(() => {
    if (modelProvidersLoading || selectedNavItem) {
      return;
    }
    if (selectedNodeKey !== fallbackNodeKey) {
      setSelectedNodeKey(fallbackNodeKey);
    }
  }, [
    fallbackNodeKey,
    modelProvidersLoading,
    selectedNavItem,
    selectedNodeKey,
    setSelectedNodeKey,
  ]);

  return {
    navigationGroups,
    navigationItems,
    selectedNavItem,
    navigationUnavailable: false,
  };
}

import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";
import { getProviderFormLabel } from "@/lib/providerSettingsFormTypes.js";

/**
 * 供应商展示名只来自用户自己的配置。
 * 账号套餐态（Start Plan / Coding Plan）随登录一并移除，不再有按 provider id 覆盖名称的分支。
 */
export function resolveModelProviderDisplayName(
  provider: Pick<ProviderSettingsFormProvider, "providerId" | "config">,
): string {
  return getProviderFormLabel(provider);
}

/** 设置页左侧导航项：一个用户自建 Provider 一项。 */
export type ModelProviderNavItem = {
  key: string;
  type: "provider";
  label: string;
  provider: ProviderSettingsFormProvider;
  statusActive: boolean;
};

export type ModelProviderNavGroupId = "custom";

export interface ModelProviderNavGroup {
  id: ModelProviderNavGroupId;
  title: string;
  items: ModelProviderNavItem[];
}

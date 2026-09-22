import { Loader2Icon, PackageIcon } from "lucide-react";
import type { SavePersonalModelDraftInput } from "@zcode/provider";
import type { ModelConnectivityResult } from "@zcode/shared";
import {
  getProviderFormApiKeyManagementUrl,
  type ProviderSettingsFormProvider,
} from "@/lib/providerSettingsFormTypes.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { InlineEditableProviderCard } from "./InlineEditableProviderCard.js";
import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";
import type { ModelProviderNavItem } from "./constants.js";

interface ModelProviderSectionDetailProps {
  selectedNavItem: ModelProviderNavItem | null;
  loading: boolean;
  onSave: (config: ProviderSettingsFormProvider) => void | Promise<void>;
  onAddPersonalModel?: (
    providerId: string,
    modelId: string,
    config: ProviderSettingsFormProvider["models"][number]["personalConfig"],
    useRecommendedConfig?: boolean,
  ) => Promise<unknown>;
  onSavePersonalModelDraft?: (input: SavePersonalModelDraftInput) => Promise<unknown>;
  onSetPersonalModelEnabled?: (
    providerId: string,
    modelId: string,
    enabled: boolean,
  ) => Promise<unknown>;
  onDeletePersonalModel?: (providerId: string, modelId: string) => Promise<unknown>;
  onDelete: (provider: ProviderSettingsFormProvider) => Promise<void>;
  onReorderProviderModels?: (providerId: string, modelIds: string[]) => Promise<void>;
  onTestModel: (providerId: string, modelId: string) => Promise<ModelConnectivityResult>;
  onOpenApiKeyUrl: (url: string) => void;
}

function ModelProviderLoadingCard({ loadingLabel }: { loadingLabel: string }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-2 text-ui-base text-foreground-subtle">
      <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
      <p>{loadingLabel}</p>
    </div>
  );
}

function ModelProviderEmptyCard() {
  const { intl } = useZCodeIntl();
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-2 text-center text-ui-base text-foreground-subtle">
      <PackageIcon className="size-5 text-foreground-subtlest" aria-hidden="true" />
      <p className="max-w-md">{intl.formatMessage({ id: "settings.modelProvider.empty" })}</p>
    </div>
  );
}

/**
 * 供应商详情只编辑用户自己的配置（连接、API Key、模型）。
 * 账号套餐、额度与 Start Plan 面板随登录一并移除。
 */
export function ModelProviderSectionDetail({
  selectedNavItem,
  loading,
  onSave,
  onAddPersonalModel,
  onSavePersonalModelDraft,
  onSetPersonalModelEnabled,
  onDeletePersonalModel,
  onDelete,
  onReorderProviderModels,
  onTestModel,
  onOpenApiKeyUrl,
}: ModelProviderSectionDetailProps) {
  const { intl } = useZCodeIntl();
  const loadingLabel = intl.formatMessage({ id: "common.loading" });
  const rootProviderSettingsRead = useProviderSettingsView();
  const settingsRevision =
    rootProviderSettingsRead.state.status === "ready"
      ? rootProviderSettingsRead.state.view.revision
      : undefined;

  if (!selectedNavItem) {
    return loading ? (
      <ModelProviderLoadingCard loadingLabel={loadingLabel} />
    ) : (
      <ModelProviderEmptyCard />
    );
  }

  const provider = selectedNavItem.provider;
  const apiKeyUrl = provider.templateId ? getProviderFormApiKeyManagementUrl(provider) : undefined;

  return (
    // 仅展示模板声明的入口，不根据地址猜测自定义 Provider 的 Key 控制台。
    <InlineEditableProviderCard
      provider={provider}
      onSave={onSave}
      onAddPersonalModel={onAddPersonalModel}
      onSavePersonalModelDraft={onSavePersonalModelDraft}
      onSetPersonalModelEnabled={onSetPersonalModelEnabled}
      onDeletePersonalModel={onDeletePersonalModel}
      onDelete={() => onDelete(provider)}
      onReorderModelIds={
        onReorderProviderModels
          ? (modelIds) => onReorderProviderModels(provider.providerId, modelIds)
          : undefined
      }
      onTestModel={onTestModel}
      presetApiKeyUrl={apiKeyUrl}
      readOnlyEndpoints={false}
      nameEditable
      settingsRevision={settingsRevision}
      onOpenPresetApiKey={
        apiKeyUrl
          ? () => {
              onOpenApiKeyUrl(apiKeyUrl);
            }
          : undefined
      }
    />
  );
}

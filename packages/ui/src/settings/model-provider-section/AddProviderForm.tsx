import { useMemo, useState } from "react";
import { isApiKeyAccess, resolveProviderTemplateName } from "@zcode/provider";
import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import {
  TID_LOGIN_API_KEY_CANCEL_BUTTON,
  TID_LOGIN_API_KEY_CONTINUE_BUTTON,
  TID_LOGIN_API_KEY_ERROR,
  TID_LOGIN_API_KEY_INPUT,
  TID_LOGIN_API_KEY_PROVIDER_ITEM,
  TID_LOGIN_API_KEY_PROVIDER_TRIGGER,
  testId,
} from "@zcode/shared";
import { Alert, AlertDescription } from "@/components/ui/alert.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { ProviderLogo } from "./ProviderLogo.js";

interface AddProviderFormProps {
  /** 供应商创建成功（API Key 已落盘）。 */
  onSaved: () => void | Promise<void>;
  /** 用户主动放弃添加。 */
  onCancel?: () => void;
}

/**
 * 「添加供应商」表单：从内置模板里选一个 API Key provider，填 Key 后写入用户自己的配置。
 * 账号模式下的登录入口、OAuth 渠道与套餐选择随登录一并移除，这里只保留 BYO API Key 一条路径。
 */
export function AddProviderForm({ onSaved, onCancel }: AddProviderFormProps) {
  const { intl, locale } = useZCodeIntl();
  const platform = usePlatform();
  const { providerSettingsService } = useServices();
  const providerSettingsRead = useProviderSettingsView();
  const providerSettingsView =
    providerSettingsRead.state.status === "ready" ? providerSettingsRead.state.view : null;
  const templates = useMemo(
    () =>
      (providerSettingsView?.providerTemplates ?? []).filter((template) =>
        isApiKeyAccess(template.config.access),
      ),
    [providerSettingsView],
  );
  const [templateId, setTemplateId] = useState<string | null>(null);
  const selectedTemplateId = templateId ?? templates[0]?.templateId ?? null;
  const selectedTemplate =
    templates.find((template) => template.templateId === selectedTemplateId) ?? null;
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const templateAccess = selectedTemplate?.config.access;
  const apiKeyUrl = isApiKeyAccess(templateAccess) ? templateAccess.apiKeyManagementUrl : undefined;
  // 用户已经输入或回填 API Key 后，右侧获取入口会挤占密码输入区域。
  const showApiKeyLink = Boolean(apiKeyUrl) && apiKeyValue.trim().length === 0;

  const handleSave = async () => {
    const apiKey = apiKeyValue.trim();
    if (!apiKey) {
      setError(intl.formatMessage({ id: "login.apiKey.emptyError" }));
      return;
    }
    if (!selectedTemplate || !isApiKeyAccess(selectedTemplate.config.access)) {
      setError(
        intl.formatMessage(
          { id: "login.apiKey.providerMissingError" },
          { provider: selectedTemplate?.templateId ?? "" },
        ),
      );
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await providerSettingsService.createPersonalProvider({
        templateId: selectedTemplate.templateId,
        locale,
        initialConfig: {
          access: { type: selectedTemplate.config.access.type, apiKey },
        },
      });
      await onSaved();
    } catch (saveError) {
      logger.error("[AddProvider] 保存 API Key provider 失败", {
        templateId: selectedTemplate.templateId,
        error: saveError,
      });
      setError(
        intl.formatMessage(
          { id: "login.apiKey.saveError" },
          {
            error: saveError instanceof Error ? saveError.message : String(saveError),
          },
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-ui-base font-medium text-foreground">
          {intl.formatMessage({ id: "login.apiKey.title" })}
        </h2>
        <div className="space-y-2">
          <Select
            value={selectedTemplateId ?? ""}
            onValueChange={(value) => {
              setTemplateId(value);
              setError(null);
            }}
            disabled={saving}
          >
            <SelectTrigger
              id="add-provider-template"
              size="lg"
              className="h-10 w-full text-ui-base"
              data-testid={TID_LOGIN_API_KEY_PROVIDER_TRIGGER}
              aria-label={intl.formatMessage({ id: "login.apiKey.providerLabel" })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end" className="rounded-lg">
              {templates.map((template) => (
                <SelectItem
                  key={template.templateId}
                  value={template.templateId}
                  className="rounded-md"
                  data-testid={testId(TID_LOGIN_API_KEY_PROVIDER_ITEM, template.templateId)}
                >
                  <ProviderLogo logo={template.config.logo} className="size-4" />
                  {resolveProviderTemplateName(template.templateId, template, locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative">
            <Input
              id="add-provider-api-key"
              type="password"
              size="lg"
              className={`h-10 w-full text-ui-base ${showApiKeyLink ? "pr-28" : ""}`}
              data-testid={TID_LOGIN_API_KEY_INPUT}
              aria-label={intl.formatMessage({ id: "login.apiKey.placeholder" })}
              value={apiKeyValue}
              placeholder={intl.formatMessage({ id: "login.apiKey.placeholder" })}
              autoComplete="off"
              onChange={(event) => {
                setApiKeyValue(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && apiKeyValue.trim() && !saving) {
                  void handleSave();
                }
              }}
            />
            {showApiKeyLink ? (
              <button
                type="button"
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-ui-base font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                disabled={saving}
                onClick={() => {
                  platform.openExternal(apiKeyUrl ?? "");
                }}
              >
                {intl.formatMessage({ id: "login.apiKey.getApiKey" })}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive" data-testid={TID_LOGIN_API_KEY_ERROR}>
          <TriangleAlertIcon className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Button
        type="button"
        className="h-10 w-full text-ui-base"
        size="lg"
        data-testid={TID_LOGIN_API_KEY_CONTINUE_BUTTON}
        disabled={!apiKeyValue.trim() || !selectedTemplate || saving}
        onClick={() => void handleSave()}
      >
        {saving ? <Loader2Icon className="size-4 animate-spin" /> : null}
        {intl.formatMessage({ id: "login.apiKey.continue" })}
      </Button>
      {onCancel ? (
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full text-ui-base"
          size="lg"
          data-testid={TID_LOGIN_API_KEY_CANCEL_BUTTON}
          disabled={saving}
          onClick={onCancel}
        >
          {intl.formatMessage({ id: "login.apiKey.cancel" })}
        </Button>
      ) : null}
    </div>
  );
}

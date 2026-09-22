import { createConfig } from "@zcode/adapters/config";
import type { RuntimeConfigPatch } from "@zcode/contracts";
import { resolveLocale, type SupportedLocale } from "@zcode/i18n";
import type { GlobalOptions } from "@zcode/shared-types";
import type { RunDependencies } from "./cli-types.js";

type ResolveTuiStartupLocaleInput = {
  deps: RunDependencies;
  options: GlobalOptions;
  workingDirectory: string;
};

const localeCliOverrides = (locale: GlobalOptions["locale"]): RuntimeConfigPatch | undefined =>
  locale
    ? {
        ui: {
          locale,
        },
      }
    : undefined;

export function resolveTuiStartupLocale({
  deps,
  options,
  workingDirectory,
}: ResolveTuiStartupLocaleInput): SupportedLocale {
  const configResult = createConfig({
    cliOverrides: localeCliOverrides(options.locale),
    env: deps.env ?? process.env,
    projectConfigPath: deps.projectConfigPath,
    skipUserConfig: deps.skipUserConfig,
    userConfigPath: deps.userConfigPath,
    workingDirectory,
  });

  // 无可用模型时的启动面板在 ZCodeApp 之前就要渲染，因此 CLI 边界必须自己解析
  // 已持久化的 ui.locale。
  return resolveLocale(configResult.config.ui.locale, options.detectedLocale);
}

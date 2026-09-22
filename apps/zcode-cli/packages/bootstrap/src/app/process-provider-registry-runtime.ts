import { resolveRuntimeZCodeEndpointOrigin } from "@zcode/shared";
import {
  NodeModelSelectionConfigRepository,
  NodeProviderRegistryRuntime,
  resolveNodeProviderRuntimePaths,
  ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE_ENV,
} from "@zcode/provider-node";
import { readLegacyCliPersonalProviderConfig } from "./legacy-cli-personal-provider-config-importer.js";

export interface ProcessProviderRegistryRuntimeOptions {
  /** Standalone Prompt CLI / TUI 自己拥有旧配置的一次性导入。 */
  readonly standalone?: {
    readonly legacyCliUserConfigFilePath?: string;
  };
}

/**
 * 进程级 Provider Registry：唯一供应商事实源是用户的个人 provider 配置。
 *
 * 账号型配置层（Account Overlay / 账号状态 / Host 下发）随账号能力移除，
 * 不再有第三层 Config Source，也不再暴露 providerRuntimeHeadersPort——
 * 无登录态就没有按请求刷新的账号鉴权材料。
 */
export async function startProcessProviderRegistryRuntime(
  env: Readonly<Record<string, string | undefined>>,
  options: ProcessProviderRegistryRuntimeOptions = {},
) {
  const paths = resolveNodeProviderRuntimePaths(env);
  if (!paths) {
    throw new Error("缺少进程 Provider Registry 的 ZCode Built-in / Personal Config 路径");
  }

  const bundledFile = options.standalone
    ? env[ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE_ENV]?.trim()
    : undefined;
  const runtime = new NodeProviderRegistryRuntime({
    ...paths,
    // 内置配置以打包文件为唯一来源；这里不再有远端下发或刷新控制文件。
    ...(bundledFile
      ? {
          zcodeBuiltinFilePath: bundledFile,
          zcodeBuiltinActiveFilePath: paths.zcodeBuiltinFilePath,
        }
      : {}),
    ...(options.standalone
      ? {
          importLegacy: () =>
            readLegacyCliPersonalProviderConfig({
              ...(options.standalone?.legacyCliUserConfigFilePath
                ? { filePath: options.standalone.legacyCliUserConfigFilePath }
                : {}),
            }),
        }
      : {}),
  });
  try {
    await runtime.start();
    const snapshot = runtime.registryService.getSnapshot()!;
    const modelSelectionConfigRepository = new NodeModelSelectionConfigRepository({
      personalRepository: runtime.personalRepository,
    });
    try {
      const configuredDefaultModelSelection = await modelSelectionConfigRepository.read();
      return Object.freeze({
        dispose() {
          modelSelectionConfigRepository.dispose();
          runtime.dispose();
        },
        runtime,
        snapshot,
        modelSelectionConfigRepository,
        configuredDefaultModelSelection,
      });
    } catch (error) {
      modelSelectionConfigRepository.dispose();
      throw error;
    }
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

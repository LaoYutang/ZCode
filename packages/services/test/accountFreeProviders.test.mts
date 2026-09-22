/*
 * 无账号模式的供应商装配验收：内置零供应商、用户自建可执行、账号访问类型被拒绝、
 * 历史 account:* 选择优雅失效。仓库没有统一测试运行器，直接执行：
 *   npx tsx packages/services/test/accountFreeProviders.test.mts
 * 退出码 0 表示全部通过。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ProviderConfigResolver,
  parseProviderConfigMap,
  parseProviderTemplateMap,
  parseZCodeBuiltinModelConfigRules,
  parseZCodeBuiltinProviderConfigMap,
  parsePersonalModelConfigRules,
} from "@zcode/provider";
import { decodeZCodeBuiltinRelease } from "@zcode/provider-node";

let failures = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failures += 1;
};

const raw = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../config/provider/zcode-builtin.json"), "utf8"),
);
const release = decodeZCodeBuiltinRelease(raw);
const rawRules = raw.config.providerConfigRules.providerRules as unknown[];
const rawTemplates = raw.config.providerConfigRules.templateRules as unknown[];
const builtinProviders = parseZCodeBuiltinProviderConfigMap(rawRules);
const builtinTemplates = parseProviderTemplateMap(rawTemplates);
const builtinModelRules = parseZCodeBuiltinModelConfigRules(raw.config.modelConfigRules);

check("内置 provider 为空（应用不内置任何供应商）", builtinProviders.keys().length === 0, `count=${builtinProviders.keys().length}`);
check("添加供应商模板仍可用（含智谱自带 Key 模板）", builtinTemplates.keys().length >= 20, `count=${builtinTemplates.keys().length}`);
check("解码后的内置配置 providers 为空", release.config.providers.keys().length === 0);
check("内置配置不含 account: provider", !JSON.stringify(release).includes("account:"));
check(
  "内置配置不含 zhipu-account 访问类型",
  !JSON.stringify(release).includes("zhipu-account"),
);

let accountRejected = false;
try {
  parseProviderConfigMap([
    {
      providerId: "acct-1",
      providerName: "Account",
      enabled: true,
      config: {
        access: { type: "zhipu-account", accountType: "zai", mode: "start-plan", entitled: true },
        api: { type: "anthropic-messages", baseUrl: "https://api.z.ai/api/anthropic" },
      },
    },
  ]);
} catch {
  accountRejected = true;
}
check("zhipu-account 访问类型已被配置 schema 拒绝", accountRejected);

const personal = parseProviderConfigMap([
  {
    providerId: "user-1",
    providerName: "My Provider",
    enabled: true,
    config: {
      group: "standard-personal",
      access: { type: "api-key", apiKey: "sk-test" },
      api: { type: "anthropic-messages", baseUrl: "https://api.example.com/anthropic" },
      personalModelIds: ["my-model"],
    },
  },
]);
const resolution = new ProviderConfigResolver().resolve({
  zcodeBuiltinProviders: builtinProviders,
  zcodeBuiltinProviderTemplates: builtinTemplates,
  personalProviders: personal,
  zcodeBuiltinModelRules: builtinModelRules,
  personalModels: parsePersonalModelConfigRules({
    providerModelRules: [],
    manualProviderModelRules: [],
  }),
});
const registryIds = resolution.registryProviders.map((p) => p.providerId);
const userProvider = resolution.registryProviders.find((p) => p.providerId === "user-1");

check("用户自建 provider 进入 Registry（可执行）", registryIds.includes("user-1"), `registry=[${registryIds.join(",")}]`);
check("Registry 不含任何内置账号 provider", !registryIds.some((id) => id.startsWith("account:")));
check("用户自建 provider 的模型已解析", userProvider?.models.length === 1, `models=${userProvider?.models.length ?? 0}`);
check("解析无配置问题", resolution.issues.length === 0, `issues=${JSON.stringify(resolution.issues)}`);
check(
  "历史 account:* 选择解析为空（优雅失效、不崩溃）",
  resolution.resolvedProviders.every((p) => !p.providerId.startsWith("account:")),
);

console.log(failures === 0 ? "\nSMOKE_OK" : `\nSMOKE_FAILED(${failures})`);
process.exit(failures === 0 ? 0 : 1);

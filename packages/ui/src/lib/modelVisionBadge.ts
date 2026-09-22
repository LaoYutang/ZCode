import type { ProviderConfigObject } from "@zcode/provider";

/** 产品展示例外：Coding Plan 网关的 GLM-5.3 图片输入是服务端桥接，不能把桥接标为原生视觉。 */
export function shouldShowModelVisionBadge(
  modelId: string,
  supportsImage: boolean | null | undefined,
  access?: ProviderConfigObject["access"],
): boolean {
  if (supportsImage !== true) return false;
  const hideGlm53Vision = access?.type === "zhipu-coding-plan-api-key";
  // 只控制徽标，不改能力事实、附件校验或精确模型身份；Flash 和其他型号不受影响。
  return !(hideGlm53Vision && modelId.toLowerCase() === "glm-5.3");
}

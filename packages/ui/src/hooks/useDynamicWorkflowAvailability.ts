import { createDynamicWorkflowClientConfig, type DynamicWorkflowClientConfig } from "@zcode/shared";

export interface DynamicWorkflowAvailabilitySnapshot {
  readonly enabled: boolean;
  readonly config: DynamicWorkflowClientConfig;
}

/**
 * 动态工作流的可用性快照。
 *
 * 本仓没有灰度通道（见 specs/workflow/no-gray-release.md）：上游的取值来自订阅服务读取的远端
 * `configs.dynamicWorkflow`，随账号体系一并删除，renderer 侧没有读取通道，Host 侧也不再按远端
 * 或环境变量裁决。因此这里直接给出启用的常量快照，与 Host 装配处同一份裁定——run 详情页的
 * 恢复入口、自动化页的工作流页签都据此显示。
 */
const AVAILABILITY: DynamicWorkflowAvailabilitySnapshot = {
  enabled: true,
  config: createDynamicWorkflowClientConfig("alwaysOn", "override"),
};

export function useDynamicWorkflowAvailability(): DynamicWorkflowAvailabilitySnapshot {
  return AVAILABILITY;
}

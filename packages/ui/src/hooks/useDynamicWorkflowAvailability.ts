import { useMemo } from "react";
import {
  resolveDynamicWorkflowClientConfig,
  type DynamicWorkflowClientConfig,
} from "@zcode/shared";

export interface DynamicWorkflowAvailabilitySnapshot {
  /** 未知即不提供；入口宁可晚半拍出现也不闪一下再收起。 */
  readonly enabled: boolean;
  readonly config: DynamicWorkflowClientConfig;
}

/**
 * 动态工作流灰度快照。
 *
 * 账号形态下这份快照来自订阅服务读取的远端 `configs.dynamicWorkflow`，随登录一并删除。
 * 无账号形态下 renderer 没有账号无关的灰度读取通道：Host 只按进程环境变量裁决，
 * 再经 `workspace/updateDynamicWorkflowPolicy` 告知 CLI，不向 renderer 发布该事实。
 * 因此这里按 shared 的 fail-closed 缺省（disabled）取值，入口跟随缺省关闭。
 * Host 将来若发布读取通道（例如把它并入 client config 快照），只需替换这里的取值。
 */
export function useDynamicWorkflowAvailability(): DynamicWorkflowAvailabilitySnapshot {
  const config = useMemo(() => resolveDynamicWorkflowClientConfig({ remote: undefined }), []);
  return useMemo(() => ({ enabled: config.enabled, config }), [config]);
}

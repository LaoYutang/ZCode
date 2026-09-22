import type { AppUsageRequest, AppUsageSnapshot } from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

/**
 * 应用用量统计。只发布本地 agent 数据库的真实统计：账号套餐额度随登录一并移除，
 * 不再有按套餐查询/重置的入口。
 */
export interface IUsageStatsService {
  getAppUsageSnapshot(request: AppUsageRequest): Promise<AppUsageSnapshot>;
}

export const IUsageStatsService = createServiceDescriptor<IUsageStatsService>(
  ServiceChannels.UsageStats,
);

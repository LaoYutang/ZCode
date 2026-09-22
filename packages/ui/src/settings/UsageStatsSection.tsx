import { AppUsagePanel } from "@/settings/usage-stats/AppUsagePanel.js";

/**
 * 使用统计只剩本机 agent 数据库的真实统计。
 * 账号套餐额度（Coding Plan / Team Plan / 额度重置）随登录一并移除，不再有 provider 维度 Tab。
 */
export function UsageStatsSection() {
  return <AppUsagePanel />;
}

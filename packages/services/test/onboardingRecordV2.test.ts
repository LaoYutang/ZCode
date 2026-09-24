/*
 * Onboarding v2 规则验收（见 specs/onboarding/spec.md）：
 *   npx tsx --test packages/services/test/onboardingRecordV2.test.ts
 * 覆盖：关闭记账、老用户（本机已有任务）不引导、v1 文件兼容、作答与决策互斥、坏文件降级。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createOnboardingRecordService } from "../src/onboarding/onboardingRecordService.js";
import { getAppConfigDir, setDataBaseDir } from "../src/paths.js";

const DEVICE_MID = "device-mid-under-test";

const entry = {
  occupation: "developer",
  interfaceMode: "coding" as const,
  memoryEnabled: true,
  proactiveSuggestionsEnabled: false,
  completedAt: "2026-09-24T00:00:00.000Z",
};

const recordPath = () => join(getAppConfigDir(), "onboarding-record.json");
const readRecord = async () => JSON.parse(await readFile(recordPath(), "utf8"));

async function withTempHome(run: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "zcode-onboarding-"));
  setDataBaseDir(dir);
  // 应用启动时 dataBaseDir 已存在；测试里显式建好，便于直接预置 v1 / 损坏文件。
  await mkdir(getAppConfigDir(), { recursive: true });
  try {
    await run();
  } finally {
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
}

test("全新设备应当引导；关闭后落 dismissed 决策并不再触发", async () => {
  await withTempHome(async () => {
    const service = createOnboardingRecordService({ hasExistingLocalTask: async () => false });
    assert.equal(await service.shouldOnboard(DEVICE_MID), true);

    await service.dismissOnboarding(DEVICE_MID);
    const record = await readRecord();
    assert.equal(record.version, 2);
    assert.equal(record.entries.length, 0);
    assert.equal(record.decisions.length, 1);
    assert.deepEqual(
      {
        userId: record.decisions[0].userId,
        status: record.decisions[0].status,
        reason: record.decisions[0].reason,
      },
      { userId: null, status: "dismissed", reason: "user_closed" },
    );
    assert.equal(await service.shouldOnboard(DEVICE_MID), false);

    // 重复关闭覆盖同一条决策，不追加。
    await service.dismissOnboarding(DEVICE_MID);
    assert.equal((await readRecord()).decisions.length, 1);
  });
});

test("本机已有任务的老用户不引导，且落 existing_local_user 决策而不写 entries", async () => {
  await withTempHome(async () => {
    const service = createOnboardingRecordService({ hasExistingLocalTask: async () => true });
    assert.equal(await service.shouldOnboard(DEVICE_MID), false);

    const record = await readRecord();
    assert.equal(record.entries.length, 0);
    assert.equal(record.decisions.length, 1);
    assert.equal(record.decisions[0].status, "existing_local_user");
    assert.equal(record.decisions[0].reason, "existing_local_task");
  });
});

test("未注入 hasExistingLocalTask 时退化为纯记录判定", async () => {
  await withTempHome(async () => {
    const service = createOnboardingRecordService();
    assert.equal(await service.shouldOnboard(DEVICE_MID), true);
  });
});

test("v1 文件读取时补空 decisions；已有作答不引导，关闭是空操作", async () => {
  await withTempHome(async () => {
    const v1 = {
      version: 1,
      deviceMid: DEVICE_MID,
      entries: [{ userId: null, ...entry, uploadState: "pending" }],
    };
    await writeFile(recordPath(), JSON.stringify(v1, null, 2), "utf8");

    const service = createOnboardingRecordService({ hasExistingLocalTask: async () => true });
    assert.equal(await service.shouldOnboard(DEVICE_MID), false);

    // 作答优先：关闭不写决策，磁盘上仍是那份 v1 文件（读取只是视图升级，不写回）。
    await service.dismissOnboarding(DEVICE_MID);
    const record = await readRecord();
    assert.equal(record.version, 1);
    assert.equal(record.decisions, undefined);
  });
});

test("作答会清掉同身份的决策，之后重新按记录判定", async () => {
  await withTempHome(async () => {
    const service = createOnboardingRecordService({ hasExistingLocalTask: async () => false });
    await service.dismissOnboarding(DEVICE_MID);
    assert.equal((await readRecord()).decisions.length, 1);

    await service.appendRecord(DEVICE_MID, entry);
    const record = await readRecord();
    assert.equal(record.version, 2);
    assert.equal(record.entries.length, 1);
    assert.equal(record.decisions.length, 0);
    assert.equal(await service.shouldOnboard(DEVICE_MID), false);
  });
});

test("记录文件损坏按缺失处理：照常触发，写入时重建 v2 文件", async () => {
  await withTempHome(async () => {
    await writeFile(recordPath(), "{ 这不是 JSON", "utf8");
    const service = createOnboardingRecordService({ hasExistingLocalTask: async () => false });
    assert.equal(await service.shouldOnboard(DEVICE_MID), true);

    await service.appendRecord(DEVICE_MID, entry);
    const record = await readRecord();
    assert.equal(record.version, 2);
    assert.equal(record.entries.length, 1);
  });
});

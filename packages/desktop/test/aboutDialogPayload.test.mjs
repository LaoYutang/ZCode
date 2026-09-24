import assert from "node:assert/strict";
import test from "node:test";
import { createAboutDialogPayload } from "../src/main/about.ts";

// 「关于」从 main 进程的原生窗口改成 renderer 内置 modal 后，main 只负责产出展示事实。
// 这里固定住事实构造的两条规则：版本取值优先级，以及 Apple Silicon 提示的平台判定。
// 见 specs/help/client-help-surfaces.md。

const testOsInfo = ({ platform = "win32", arch = "x64" } = {}) => ({
  type: "Windows_NT",
  platform,
  release: "10.0.22631",
  version: "10.0.22631",
  arch,
  hostname: "test-host",
});

test("版本取值：显式 appVersion 优先于 build-meta.json 与编译时常量", () => {
  const payload = createAboutDialogPayload({
    appVersion: "9.9.9",
    buildMetadata: { appVersion: "1.2.3" },
    osInfo: testOsInfo(),
  });

  assert.equal(payload.appVersion, "9.9.9");
});

test("版本取值：没有 appVersion 时回退到 build-meta.json", () => {
  const payload = createAboutDialogPayload({
    buildMetadata: { appVersion: "1.2.3" },
    osInfo: testOsInfo(),
  });

  assert.equal(payload.appVersion, "1.2.3");
});

test("版本取值：两者都缺失时仍有非空版本号", () => {
  const payload = createAboutDialogPayload({ buildMetadata: null, osInfo: testOsInfo() });

  assert.equal(typeof payload.appVersion, "string");
  assert.notEqual(payload.appVersion.trim(), "");
});

test("Apple Silicon 提示只在 macOS arm64 为 true", () => {
  const isOptimizedOn = (platform, arch) =>
    createAboutDialogPayload({ osInfo: testOsInfo({ platform, arch }) })
      .isOptimizedForAppleSilicon;

  assert.equal(isOptimizedOn("darwin", "arm64"), true);
  assert.equal(isOptimizedOn("darwin", "x64"), false);
  // Windows arm64 不是「Apple Silicon」，不能复用这条提示。
  assert.equal(isOptimizedOn("win32", "arm64"), false);
  assert.equal(isOptimizedOn("linux", "arm64"), false);
});

import assert from "node:assert/strict";
import test from "node:test";

// 「关于」对话框从原生窗口改成 renderer 内置 modal 后，开合状态由这个 store 单一持有。
// 这里固定住两个约束：重复触发不叠加，关闭后不残留展示事实（否则下次打开会先闪旧版本号）。
// 见 specs/help/client-help-surfaces.md。

const { useAboutDialogStore } = await import("../src/store/aboutDialogStore.ts");

const payloadOf = (appVersion, isOptimizedForAppleSilicon = false) => ({
  appVersion,
  isOptimizedForAppleSilicon,
});

test("关于对话框：重复触发只刷新事实，不排队也不叠加", () => {
  useAboutDialogStore.getState().openAbout(payloadOf("1.0.0"));
  assert.deepEqual(useAboutDialogStore.getState().payload, payloadOf("1.0.0"));

  useAboutDialogStore.getState().openAbout(payloadOf("2.0.0", true));
  assert.deepEqual(useAboutDialogStore.getState().payload, payloadOf("2.0.0", true));
});

test("关于对话框：关闭后不残留展示事实", () => {
  useAboutDialogStore.getState().openAbout(payloadOf("3.0.0"));
  useAboutDialogStore.getState().closeAbout();

  assert.equal(useAboutDialogStore.getState().payload, undefined);
});

test("关于对话框：未关闭时再次关闭保持幂等", () => {
  useAboutDialogStore.getState().closeAbout();
  useAboutDialogStore.getState().closeAbout();

  assert.equal(useAboutDialogStore.getState().payload, undefined);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  createTargetPlatform,
  normalizeTargetArchList,
  resolveDeclaredTargetArches,
  resolvePackContextTarget,
} from "../scripts/target-platform.mjs";

// 目标平台解析是打包链路的入口决策：多架构场景下 pack context 的架构必须逐个解析，
// 用环境变量里的单一架构替代会让另一支架构静默套用错误的 prebuild / 打包资源。
// 见 specs/build/desktop-release-pipeline.md。

test("架构集合解析：逗号、空格与别名", () => {
  assert.deepEqual(normalizeTargetArchList("x64,arm64"), ["x64", "arm64"]);
  assert.deepEqual(normalizeTargetArchList("arm64 x64"), ["arm64", "x64"]);
  assert.deepEqual(normalizeTargetArchList("amd64,AARCH64"), ["x64", "arm64"]);
  assert.deepEqual(normalizeTargetArchList(["arm64"]), ["arm64"]);
});

test("架构集合解析：去重并保持声明顺序", () => {
  assert.deepEqual(normalizeTargetArchList("arm64,arm64,x86_64,amd64"), ["arm64", "x64"]);
});

test("架构集合解析：非法架构与空值直接失败", () => {
  assert.throws(() => normalizeTargetArchList("ia32"), /Unsupported target arch/);
  assert.throws(() => normalizeTargetArchList("   "), /未解析出任何目标架构/);
});

test("ZCODE_TARGET_ARCHES 优先于 ZCODE_TARGET_ARCH；未声明时返回 null", () => {
  assert.deepEqual(resolveDeclaredTargetArches({ ZCODE_TARGET_ARCH: "arm64" }), ["arm64"]);
  assert.deepEqual(
    resolveDeclaredTargetArches({ ZCODE_TARGET_ARCH: "arm64", ZCODE_TARGET_ARCHES: "x64,arm64" }),
    ["x64", "arm64"],
  );
  assert.equal(resolveDeclaredTargetArches({}), null);
});

test("pack context 解析：electron-builder 的 Arch 枚举映射到架构名", () => {
  assert.equal(
    resolvePackContextTarget({ electronPlatformName: "win32", arch: 1 }).key,
    "win32-x64",
  );
  assert.equal(
    resolvePackContextTarget({ electronPlatformName: "win32", arch: 3 }).key,
    "win32-arm64",
  );
  assert.equal(
    resolvePackContextTarget({ electronPlatformName: "darwin", arch: 3 }).key,
    "darwin-arm64",
  );
  assert.throws(
    () => resolvePackContextTarget({ electronPlatformName: "win32", arch: 9 }),
    /不支持的 electron-builder 架构/,
  );
});

test("pack context 校验：平台必须与本次构建目标一致", () => {
  assert.throws(
    () =>
      resolvePackContextTarget({
        electronPlatformName: "win32",
        arch: 1,
        expectedOs: "darwin",
      }),
    /与本次构建的目标平台/,
  );
});

test("pack context 校验：架构必须在声明的集合内", () => {
  const target = resolvePackContextTarget({
    electronPlatformName: "win32",
    arch: 3,
    expectedOs: "win32",
    declaredArches: ["x64", "arm64"],
  });
  assert.equal(target.arch, "arm64");

  assert.throws(
    () =>
      resolvePackContextTarget({
        electronPlatformName: "win32",
        arch: 3,
        expectedOs: "win32",
        declaredArches: ["x64"],
      }),
    /不在本次构建声明的架构集合内/,
  );
});

test("createTargetPlatform 保留 npm 目标字段（Linux 需要显式 glibc）", () => {
  const linux = createTargetPlatform({ os: "linux", arch: "arm64" });
  assert.deepEqual(
    { key: linux.key, npmOs: linux.npmOs, npmCpu: linux.npmCpu, npmLibc: linux.npmLibc },
    { key: "linux-arm64", npmOs: "linux", npmCpu: "arm64", npmLibc: "glibc" },
  );
  assert.equal(createTargetPlatform({ os: "darwin", arch: "x64" }).npmLibc, undefined);
});

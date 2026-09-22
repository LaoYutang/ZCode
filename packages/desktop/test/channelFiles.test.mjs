import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertChannelFileCoverage,
  collectChannelFileArches,
  expectedChannelFiles,
  verifyChannelFileCoverage,
} from "../scripts/channel-files.mjs";

// Windows / macOS 的 latest*.yml 文件名不带架构后缀，一份文件必须覆盖该平台的全部架构；
// Linux 的文件名按架构分开。漏架构会让客户端“检测不到更新”，必须在构建阶段失败。
// 见 specs/build/desktop-release-pipeline.md。

const WINDOWS_CHANNEL_FILE = `version: 3.14.1
files:
  - url: ZCode-3.14.1-win-x64.exe
    sha512: AAAA
  - url: ZCode-3.14.1-win-arm64.exe
    sha512: BBBB
path: ZCode-3.14.1-win-x64.exe
sha512: AAAA
releaseDate: '2026-09-21T00:00:00.000Z'
`;

const MAC_CHANNEL_FILE = `version: 3.14.1
files:
  - url: ZCode-3.14.1-mac-x64.zip
    sha512: AAAA
  - url: ZCode-3.14.1-mac-arm64.zip
    sha512: BBBB
`;

const MAC_CHANNEL_FILE_X64_ONLY = `version: 3.14.1
files:
  - url: ZCode-3.14.1-mac-x64.zip
    sha512: AAAA
`;

test("架构识别覆盖各 target 的命名别名", () => {
  // deb 用 amd64/aarch64，AppImage/rpm 用 x86_64/aarch64
  assert.deepEqual(
    collectChannelFileArches(`version: 3.14.1
files:
  - url: ZCode-3.14.1-linux-amd64.deb
    sha512: A
  - url: ZCode-3.14.1-linux-x86_64.AppImage
    sha512: B
`),
    ["x64"],
  );
  assert.deepEqual(
    collectChannelFileArches(`version: 3.14.1
files:
  - url: ZCode-3.14.1-linux-aarch64.rpm
    sha512: A
`),
    ["arm64"],
  );
});

test("没有 files[] 时回退到 electron-updater 1.x 的 path 字段", () => {
  assert.deepEqual(
    collectChannelFileArches(`version: 3.14.1
path: ZCode-3.14.1-win-arm64.exe
sha512: AAAA
`),
    ["arm64"],
  );
});

test("覆盖校验：缺架构必须失败", () => {
  assert.deepEqual(
    assertChannelFileCoverage({
      fileName: "latest.yml",
      content: WINDOWS_CHANNEL_FILE,
      expectedArches: ["x64", "arm64"],
    }),
    ["x64", "arm64"],
  );

  assert.deepEqual(
    assertChannelFileCoverage({
      fileName: "latest-mac.yml",
      content: MAC_CHANNEL_FILE,
      expectedArches: ["x64", "arm64"],
    }),
    ["x64", "arm64"],
  );

  assert.throws(
    () =>
      assertChannelFileCoverage({
        fileName: "latest.yml",
        content: MAC_CHANNEL_FILE_X64_ONLY,
        expectedArches: ["x64", "arm64"],
      }),
    /latest\.yml 未覆盖本次构建的架构/,
  );
});

test("期望文件：Windows/macOS 一个文件覆盖两支架构，Linux 按架构分开", () => {
  assert.deepEqual(expectedChannelFiles({ os: "win", arches: ["x64", "arm64"] }), [
    { fileName: "latest.yml", expectedArches: ["x64", "arm64"] },
  ]);
  assert.deepEqual(expectedChannelFiles({ os: "mac", arches: ["x64", "arm64"] }), [
    { fileName: "latest-mac.yml", expectedArches: ["x64", "arm64"] },
  ]);
  assert.deepEqual(expectedChannelFiles({ os: "linux", arches: ["x64", "arm64"] }), [
    { fileName: "latest-linux.yml", expectedArches: ["x64"] },
    { fileName: "latest-linux-arm64.yml", expectedArches: ["arm64"] },
  ]);
});

test("期望文件：单架构构建只要求该架构的文件", () => {
  assert.deepEqual(expectedChannelFiles({ os: "mac", arches: ["arm64"] }), [
    { fileName: "latest-mac.yml", expectedArches: ["arm64"] },
  ]);
  assert.deepEqual(expectedChannelFiles({ os: "linux", arches: ["arm64"] }), [
    { fileName: "latest-linux-arm64.yml", expectedArches: ["arm64"] },
  ]);
});

test("期望文件：不支持的操作系统直接失败", () => {
  assert.throws(
    () => expectedChannelFiles({ os: "freebsd", arches: ["x64"] }),
    /不支持的目标操作系统/,
  );
});

test("verifyChannelFileCoverage 读取 dist 并报告覆盖情况", async () => {
  const distDir = await mkdtemp(join(tmpdir(), "zcode-channel-files-"));
  try {
    await writeFile(join(distDir, "latest.yml"), WINDOWS_CHANNEL_FILE, "utf8");
    assert.deepEqual(verifyChannelFileCoverage({ os: "win", arches: ["x64", "arm64"], distDir }), [
      { fileName: "latest.yml", expectedArches: ["x64", "arm64"], coveredArches: ["x64", "arm64"] },
    ]);

    // 单架构构建只要求该文件覆盖该架构，多出来的架构不影响判定。
    assert.deepEqual(verifyChannelFileCoverage({ os: "win", arches: ["arm64"], distDir }), [
      { fileName: "latest.yml", expectedArches: ["arm64"], coveredArches: ["x64", "arm64"] },
    ]);

    await rm(join(distDir, "latest.yml"));
    assert.throws(
      () => verifyChannelFileCoverage({ os: "win", arches: ["x64"], distDir }),
      /缺少更新描述文件/,
    );
  } finally {
    await rm(distDir, { recursive: true, force: true });
  }
});

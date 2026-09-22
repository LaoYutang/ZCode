import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  EXCLUDED_RELEASE_FILE_NAMES,
  formatSha256Sums,
  listFilesRecursive,
  prepareReleaseAssets,
  selectReleaseAssets,
} from "../scripts/release-assets.mjs";

// 发布资产集合是 Release 的对外契约：多一个 debug 文件会撞名导致整批上传失败，
// 少一个 channel 文件会让客户端检测不到更新。见 specs/build/desktop-release-pipeline.md。

test("builder-debug.yml 固定排除", () => {
  const { assets, skipped } = selectReleaseAssets([
    "zcode-desktop-win-production/ZCode-3.14.1-win-x64.exe",
    "zcode-desktop-win-production/builder-debug.yml",
  ]);

  assert.deepEqual(EXCLUDED_RELEASE_FILE_NAMES, ["builder-debug.yml"]);
  assert.deepEqual(
    assets.map((asset) => asset.name),
    ["ZCode-3.14.1-win-x64.exe"],
  );
  assert.deepEqual(skipped, ["zcode-desktop-win-production/builder-debug.yml"]);
});

test("同名文件必须失败并列出全部冲突路径", () => {
  assert.throws(
    () =>
      selectReleaseAssets([
        "zcode-desktop-linux-x64-production/latest.yml",
        "zcode-desktop-linux-arm64-production/latest.yml",
        "zcode-desktop-win-production/ZCode-3.14.1-win-x64.exe",
      ]),
    (error) => {
      assert.match(error.message, /发布资产存在同名文件/);
      assert.match(error.message, /zcode-desktop-linux-x64-production\/latest\.yml/);
      assert.match(error.message, /zcode-desktop-linux-arm64-production\/latest\.yml/);
      return true;
    },
  );
});

test("SHA256SUMS 条目使用资产名，格式与 sha256sum 一致", () => {
  assert.equal(
    formatSha256Sums([
      { name: "a.deb", sha256: "abc" },
      { name: "b.rpm", sha256: "def" },
    ]),
    "abc  a.deb\ndef  b.rpm\n",
  );
});

test("prepareReleaseAssets 落盘校验和与 NUL 分隔的上传列表", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-release-assets-"));
  const assetsDir = join(root, "release-assets");
  const listFile = join(root, "upload-files.txt");

  try {
    const artifactDir = join(assetsDir, "zcode-desktop-win-production");
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, "ZCode-3.14.1-win-x64.exe"), "hello");
    await writeFile(join(artifactDir, "builder-debug.yml"), "x64:\n");
    await writeFile(join(artifactDir, "latest.yml"), "version: 3.14.1\n");

    const { entries, uploadPaths, skipped } = await prepareReleaseAssets({
      assetsDir,
      listFile,
    });

    assert.deepEqual(await listFilesRecursive(assetsDir), [
      "SHA256SUMS.txt",
      "zcode-desktop-win-production/ZCode-3.14.1-win-x64.exe",
      "zcode-desktop-win-production/builder-debug.yml",
      "zcode-desktop-win-production/latest.yml",
    ]);
    assert.deepEqual(skipped, ["zcode-desktop-win-production/builder-debug.yml"]);
    assert.deepEqual(uploadPaths, [
      "zcode-desktop-win-production/ZCode-3.14.1-win-x64.exe",
      "zcode-desktop-win-production/latest.yml",
      "SHA256SUMS.txt",
    ]);
    assert.equal(entries.length, 2);

    const sums = await readFile(join(assetsDir, "SHA256SUMS.txt"), "utf8");
    // "hello" 的 sha256 是已知值；条目必须用资产名而不是 release-assets/<artifact>/... 前缀，
    // 否则用户下载后无法直接 sha256sum -c。
    assert.match(
      sums,
      /^2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824 {2}ZCode-3\.14\.1-win-x64\.exe\n/m,
    );
    assert.ok(sums.includes("  latest.yml\n"), "channel 文件也要进校验和");
    assert.ok(!sums.includes("SHA256SUMS.txt"), "校验和文件不参与自身计算");
    assert.ok(!sums.includes("builder-debug.yml"), "排除的文件不得出现在校验和里");

    assert.deepEqual((await readFile(listFile, "utf8")).split("\0").filter(Boolean), uploadPaths);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("空产物目录直接失败", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-release-assets-empty-"));
  try {
    await assert.rejects(
      () => prepareReleaseAssets({ assetsDir: join(root, "release-assets"), listFile: null }),
      /没有可发布的产物/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEV_APP_VERSION,
  resolveAppVersion,
  resolveReleaseTag,
} from "../scripts/build-metadata.mjs";
import {
  DEFAULT_UPDATE_REPOSITORY,
  resolveDesktopUpdateSource,
} from "../scripts/desktop-update-source.mjs";

// 版本解析与更新源解析都是构建期决策，出错会直接产出错误产物（版本对不上、更新源指错），
// 因此这里覆盖三态表与全部优先级分支。见 specs/build/app-version-source.md 与
// specs/update/desktop-auto-update-source.md。

const NO_TAG = () => null;

test("版本以 tag 为来源：显式覆盖优先于 CI tag", () => {
  const env = {
    ZCODE_RELEASE_TAG: "v3.14.1",
    GITHUB_REF_TYPE: "tag",
    GITHUB_REF_NAME: "v9.9.9",
  };
  assert.equal(resolveAppVersion(env, NO_TAG), "3.14.1");
});

test("版本以 tag 为来源：CI tag 构建去掉 v 前缀", () => {
  const env = { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v3.14.1" };
  assert.equal(resolveAppVersion(env, NO_TAG), "3.14.1");
});

test("版本以 tag 为来源：prerelease 后缀保留", () => {
  const env = { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v3.15.0-beta.1" };
  assert.equal(resolveAppVersion(env, NO_TAG), "3.15.0-beta.1");
});

test("版本以 tag 为来源：CI 分支构建回退到 git 精确匹配探测", () => {
  const env = { GITHUB_REF_TYPE: "branch", GITHUB_REF_NAME: "main" };
  assert.equal(
    resolveAppVersion(env, () => "v3.14.1"),
    "3.14.1",
  );
  assert.equal(
    resolveReleaseTag(env, () => "v3.14.1"),
    "v3.14.1",
  );
});

test("版本以 tag 为来源：无 tag 时用开发占位版本", () => {
  assert.equal(resolveAppVersion({}, NO_TAG), DEV_APP_VERSION);
  assert.equal(DEV_APP_VERSION, "0.0.0-dev");
  // HEAD 不在 tag 上时探测返回 null，不能继承最近一个 tag 的版本。
  const env = { GITHUB_REF_TYPE: "branch" };
  assert.equal(resolveAppVersion(env, NO_TAG), DEV_APP_VERSION);
});

test("版本以 tag 为来源：非法 tag 必须让构建失败", () => {
  assert.throws(
    () => resolveAppVersion({ ZCODE_RELEASE_TAG: "nightly" }, NO_TAG),
    /Invalid app version from tag "nightly"/,
  );
  assert.throws(
    () => resolveAppVersion({ GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "release-2024" }, NO_TAG),
    /Invalid app version/,
  );
});

test("更新源：配了仓库就是 github-release，与产品身份无关", () => {
  const previewEnv = { ZCODE_UPDATE_REPOSITORY: "LaoYutang/ZCode-Lite", ZCODE_ENV: "test" };
  assert.deepEqual(resolveDesktopUpdateSource(previewEnv), {
    kind: "github-release",
    repository: "LaoYutang/ZCode-Lite",
    owner: "LaoYutang",
    repo: "ZCode-Lite",
  });

  const productionEnv = {
    ZCODE_UPDATE_REPOSITORY: "LaoYutang/ZCode-Lite",
    ZCODE_ENV: "production",
  };
  assert.equal(resolveDesktopUpdateSource(productionEnv).kind, "github-release");

  // 仓库名允许点、下划线、短横线。
  assert.equal(
    resolveDesktopUpdateSource({ ZCODE_UPDATE_REPOSITORY: "my-org/zcode.js_v2" }).kind,
    "github-release",
  );
});

test("更新源：未配仓库时回退到本产品自己的 Release，绝不回退官方 manifest", () => {
  assert.deepEqual(resolveDesktopUpdateSource({ ZCODE_ENV: "production" }), {
    kind: "github-release",
    repository: DEFAULT_UPDATE_REPOSITORY,
    owner: "LaoYutang",
    repo: "ZCode-Lite",
  });
  // 回归防线：production 身份下任何输入都不允许产出官方 manifest 源。
  assert.notEqual(resolveDesktopUpdateSource({ ZCODE_ENV: "production" }).kind, "zcode-manifest");

  assert.equal(resolveDesktopUpdateSource({ ZCODE_ENV: "test" }).kind, "disabled");
  assert.equal(resolveDesktopUpdateSource({}).kind, "disabled");

  // ZCODE_PREVIEW_IDENTITY=1 让生产后端构建仍是 Preview 身份 → 不启用更新器。
  assert.equal(
    resolveDesktopUpdateSource({ ZCODE_ENV: "production", ZCODE_PREVIEW_IDENTITY: "1" }).kind,
    "disabled",
  );
});

test("更新源：非法 owner/repo 在构建期直接失败", () => {
  for (const repository of ["no-slash", "a/b/c", "has space/repo", "owner/", "/repo"]) {
    assert.throws(
      () => resolveDesktopUpdateSource({ ZCODE_UPDATE_REPOSITORY: repository }),
      /expected "owner\/repo"/,
      `repository=${JSON.stringify(repository)} 应当被拒绝`,
    );
  }

  // 空白等于未配置，不抛错，走 production 的默认仓库。
  assert.equal(
    resolveDesktopUpdateSource({ ZCODE_UPDATE_REPOSITORY: "   ", ZCODE_ENV: "production" })
      .repository,
    DEFAULT_UPDATE_REPOSITORY,
  );
});

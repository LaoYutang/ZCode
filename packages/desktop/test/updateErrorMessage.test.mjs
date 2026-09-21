import assert from "node:assert/strict";
import test from "node:test";
import {
  getErrorCode,
  isUnresolvedReleaseError,
  UPDATE_ERROR_MESSAGE_MAX_LENGTH,
  toSingleLineErrorMessage,
} from "../src/main/updateErrorMessage.ts";

// 回归背景：用户点击“检查更新”时界面被原始错误文本占满。electron-updater 的
// `Cannot parse releases feed` 会把整个 releases atom feed XML + HTTP 响应头拼进 message，
// 而当时又没把 ERR_UPDATER_INVALID_RELEASE_FEED 归类成“解析不出最新发布”，于是走了错误路径
// 直接透传原文。这里固定住这两个行为。

function makeError(message, code) {
  const error = new Error(message);
  if (code !== undefined) {
    error.code = code;
  }
  return error;
}

test("识别实测到的三类「解析不出最新发布」错误码", () => {
  for (const code of [
    "ERR_UPDATER_LATEST_VERSION_NOT_FOUND",
    "ERR_UPDATER_INVALID_RELEASE_FEED",
    "ERR_UPDATER_NO_PUBLISHED_VERSIONS",
  ]) {
    assert.equal(isUnresolvedReleaseError(makeError("boom", code)), true, code);
  }
});

test("识别无 code 的 'No published versions on GitHub'", () => {
  // feed 里没有 entry 时 electron-updater 抛的是普通 Error，没有 code。
  assert.equal(
    isUnresolvedReleaseError(new Error("No published versions on GitHub")),
    true,
  );
  assert.equal(
    isUnresolvedReleaseError(
      makeError("Unable to find latest version on GitHub (https://...)", undefined),
    ),
    true,
  );
});

test("其它错误不能被误判成「解析不出最新发布」", () => {
  assert.equal(isUnresolvedReleaseError(makeError("net::ERR_INTERNET_DISCONNECTED")), false);
  assert.equal(
    isUnresolvedReleaseError(makeError("Cannot find latest.yml in the latest release artifacts")),
    false,
  );
  assert.equal(isUnresolvedReleaseError(undefined), false);
  assert.equal(isUnresolvedReleaseError(null), false);
  assert.equal(isUnresolvedReleaseError("plain string"), false);
});

test("真实报错原文被压成单行并截断", () => {
  const raw = [
    "Cannot parse releases feed: Error: Unable to find latest version on GitHub (https://github.com/o/r/releases/latest), please ensure a production release exists: HttpError: 406",
    '"method: GET url: https://github.com/o/r/releases\\n\\n Data:\\n \\n "',
    "Headers: {",
    '"content-security-policy": "default-src \'none\'; base-uri \'self\'; ...",',
    "}",
    "XML:",
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
  ].join("\n");

  const sanitized = toSingleLineErrorMessage(raw);
  assert.equal(sanitized.includes("\n"), false, "不能保留换行");
  assert.equal(sanitized.length <= UPDATE_ERROR_MESSAGE_MAX_LENGTH + 1, true);
  assert.equal(sanitized.startsWith("Cannot parse releases feed:"), true);
  assert.equal(sanitized.endsWith("…"), true, "截断要有省略号");
  // 关键：XML 与响应头不能进入用户可见文案
  assert.equal(sanitized.includes("<feed"), false);
  assert.equal(sanitized.includes("content-security-policy"), false);
});

test("短消息不被截断也不加省略号", () => {
  assert.equal(toSingleLineErrorMessage("网络不可达"), "网络不可达");
  assert.equal(
    toSingleLineErrorMessage("  a\n\tb  "),
    "a b",
    "内部空白应折叠成单空格",
  );
});

test("getErrorCode 只返回字符串类型的 code", () => {
  assert.equal(getErrorCode(makeError("x", "ERR_UPDATER_INVALID_RELEASE_FEED")), "ERR_UPDATER_INVALID_RELEASE_FEED");
  assert.equal(getErrorCode(makeError("x")), undefined);
  assert.equal(getErrorCode({ code: 42 }), undefined);
  assert.equal(getErrorCode(null), undefined);
});

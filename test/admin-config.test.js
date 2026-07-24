"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { loadAdminConfig, parseTrustProxy } = require("../config/admin");

const validEnvironment = {
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD: "password",
  SESSION_SECRET: "a-session-secret-that-is-at-least-32-characters",
};

test("administrator configuration fails fast without required values", () => {
  assert.throws(
    () => loadAdminConfig({}),
    /ADMIN_USERNAME, ADMIN_PASSWORD, SESSION_SECRET/,
  );
});

test("administrator configuration keeps secret values out of errors", () => {
  const secret = "too-short";

  assert.throws(
    () => loadAdminConfig({ ...validEnvironment, SESSION_SECRET: secret }),
    (error) => {
      assert.match(error.message, /SESSION_SECRET/);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
});

test("administrator configuration defaults to secure production cookies", () => {
  const config = loadAdminConfig({
    ...validEnvironment,
    NODE_ENV: "production",
    SESSION_DB_PATH: "data/test-admin-sessions.db",
  });

  assert.equal(config.secureCookie, true);
  assert.equal(config.sessionMaxAgeMs, 7 * 24 * 60 * 60 * 1000);
  assert.equal(
    config.sessionDbPath,
    path.resolve("data/test-admin-sessions.db"),
  );
});

test("trusted proxies must be explicitly scoped", () => {
  assert.throws(() => parseTrustProxy("true"), /trusted proxies/);
  assert.equal(parseTrustProxy("1"), 1);
  assert.deepEqual(parseTrustProxy("loopback, 10.0.0.0/8"), [
    "loopback",
    "10.0.0.0/8",
  ]);
});

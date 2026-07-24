"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const dotenv = require("dotenv");

const { loadAdminConfig } = require("../config/admin");

const projectRoot = path.resolve(__dirname, "..");

function readProjectFile(filename) {
  return fs.readFileSync(path.join(projectRoot, filename), "utf8");
}

test("environment example contains valid secure production defaults", () => {
  const environment = dotenv.parse(readProjectFile(".env.example"));
  const config = loadAdminConfig(environment);

  assert.ok(environment.ADMIN_USERNAME);
  assert.ok(environment.ADMIN_PASSWORD);
  assert.ok(environment.SESSION_SECRET);
  assert.notEqual(environment.ADMIN_PASSWORD, environment.SESSION_SECRET);
  assert.equal(environment.NODE_ENV, "production");
  assert.equal(config.secureCookie, true);
  assert.equal(config.trustProxy, false);
  assert.equal(
    config.sessionDbPath,
    path.join(projectRoot, "data", "admin-sessions.db"),
  );
});

test("Compose requires administrator secrets and persists application data", () => {
  const compose = readProjectFile("docker-compose.yml");

  for (const variable of [
    "ADMIN_USERNAME",
    "ADMIN_PASSWORD",
    "SESSION_SECRET",
  ]) {
    assert.match(compose, new RegExp(
      `${variable}: "\\$\\{${variable}:\\?`,
    ));
  }

  assert.match(compose, /\.\/data:\/app\/data/);
  assert.match(
    compose,
    /SESSION_DB_PATH: "\$\{SESSION_DB_PATH:-\/app\/data\/admin-sessions\.db\}"/,
  );
  assert.match(
    compose,
    /SESSION_COOKIE_SECURE: "\$\{SESSION_COOKIE_SECURE:-true\}"/,
  );
});

test("container build excludes local secrets and runs as a non-root user", () => {
  const dockerignore = readProjectFile(".dockerignore").split(/\r?\n/);
  const dockerfile = readProjectFile("Dockerfile");

  for (const pattern of [".env", ".env.*", "data/*"]) {
    assert.ok(
      dockerignore.includes(pattern),
      `expected .dockerignore to contain ${pattern}`,
    );
  }

  assert.match(dockerfile, /^ENV NODE_ENV=production$/m);
  assert.match(dockerfile, /pnpm install --frozen-lockfile --prod/);
  assert.match(dockerfile, /^USER node$/m);
});

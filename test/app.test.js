"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");

process.env.ADMIN_USERNAME = "test-admin";
process.env.ADMIN_PASSWORD = "test-password";
process.env.SESSION_SECRET = "test-only-session-secret-32-characters";
process.env.SESSION_DB_PATH = path.join(
  os.tmpdir(),
  `moe-counter-app-sessions-${process.pid}.db`,
);
process.env.NODE_ENV = "test";

const { app, counterService, sessionStore } = require("../index");

let listener;
let baseUrl;

before(async () => {
  listener = app.listen(0);

  await new Promise((resolve, reject) => {
    listener.once("listening", resolve);
    listener.once("error", reject);
  });

  const { port } = listener.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (listener) {
    await new Promise((resolve, reject) => {
      listener.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  await counterService.close();
  sessionStore.close();
});

test("GET /heart-beat reports the service as alive", async () => {
  const response = await fetch(`${baseUrl}/heart-beat`);

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "alive");
  assert.match(response.headers.get("cache-control"), /no-cache/);
});

test("GET /@demo keeps rendering the public SVG counter", async () => {
  const response = await fetch(`${baseUrl}/@demo?theme=moebooru`);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^image\/svg\+xml/);
  assert.match(body, /^<\?xml\b/);
  assert.match(body, /<svg\b/);
  assert.match(body, /<image id="9"/);
});

test("GET /record keeps auto-creating and incrementing during migration", async () => {
  const name = `stage3-${process.pid}-${Date.now()}`;

  try {
    const first = await fetch(`${baseUrl}/record/@${name}`);
    const second = await fetch(`${baseUrl}/record/@${name}`);

    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { name, num: 1 });
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { name, num: 2 });
  } finally {
    await counterService.delete(name);
  }
});

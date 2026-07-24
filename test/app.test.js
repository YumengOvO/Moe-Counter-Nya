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

test("GET / keeps only the safe usage guide and current source link", async () => {
  const response = await fetch(`${baseUrl}/`);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /Moe Counter!/);
  assert.match(body, /How to use/);
  assert.match(body, /SVG address/);
  assert.match(body, /Img tag/);
  assert.match(body, /Markdown/);
  assert.match(body, /YumengOvO\/Moe-Counter-Nya/);
  assert.match(
    body,
    /href="https:\/\/github\.com\/YumengOvO\/Moe-Counter-Nya"/,
  );

  for (const removedContent of [
    "More theme",
    "Credits",
    "gelbooru.com",
    "A-SOUL",
    "<h3>Tool</h3>",
    "Unusual Options",
    "Generate",
    "/@index",
    "journey-ad/Moe-Counter",
    "party-js",
    "/script.js",
  ]) {
    assert.doesNotMatch(body, new RegExp(escapeRegExp(removedContent)));
  }

  assert.doesNotMatch(body, /<img\b/);
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

test("existing public SVG and JSON routes keep incrementing", async () => {
  const name = uniqueName("s5-existing");

  try {
    assert.equal(await counterService.create(name), true);

    const first = await fetch(`${baseUrl}/@${name}?theme=moebooru`);
    const second = await fetch(`${baseUrl}/get/@${name}?theme=moebooru`);
    const third = await fetch(`${baseUrl}/record/@${name}`);

    assert.equal(first.status, 200);
    assert.match(first.headers.get("content-type"), /^image\/svg\+xml/);
    assert.equal(second.status, 200);
    assert.match(second.headers.get("content-type"), /^image\/svg\+xml/);
    assert.equal(third.status, 200);
    assert.deepEqual(await third.json(), { name, num: 3 });
  } finally {
    await counterService.delete(name);
  }
});

test("unknown public names return 404 without creating a counter", async () => {
  const name = uniqueName("s5-missing");
  const routes = [
    `/@${name}`,
    `/get/@${name}`,
    `/record/@${name}`,
  ];

  assert.equal(await counterService.get(name), null);

  for (const route of routes) {
    const response = await fetch(`${baseUrl}${route}`);
    assert.equal(response.status, 404);
    assert.equal(await counterService.get(name), null);
  }
});

test("temporary num rendering does not require or create a counter", async () => {
  const name = uniqueName("s5-preview");
  const response = await fetch(
    `${baseUrl}/@${name}?theme=moebooru&num=42`,
  );
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^image\/svg\+xml/);
  assert.match(body, /<image id="4"/);
  assert.match(body, /<image id="2"/);
  assert.equal(await counterService.get(name), null);
});

function uniqueName(prefix) {
  return `${prefix}-${process.pid}-${Date.now().toString(36)}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

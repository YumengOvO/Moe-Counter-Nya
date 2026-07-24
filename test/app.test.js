"use strict";

const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");

const { app } = require("../index");

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
  if (!listener) return;

  await new Promise((resolve, reject) => {
    listener.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
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

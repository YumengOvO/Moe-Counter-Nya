"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");

process.env.ADMIN_USERNAME = "stage4-admin";
process.env.ADMIN_PASSWORD = "stage4-password";
process.env.SESSION_SECRET = "stage4-test-session-secret-32-characters";
process.env.SESSION_DB_PATH = path.join(
  os.tmpdir(),
  `moe-counter-auth-sessions-${process.pid}.db`,
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

  baseUrl = `http://127.0.0.1:${listener.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    listener.close((error) => error ? reject(error) : resolve());
  });
  await counterService.close();
  sessionStore.close();
});

test("unauthenticated administrators are redirected to the login page", async () => {
  const response = await request("/admin");

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/admin/login");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("login page creates a protected CSRF session and never permits caching", async () => {
  const response = await request("/admin/login");
  const body = await response.text();
  const cookie = getCookie(response);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(body, /type="password"/);
  assert.match(body, /name="_csrf"/);
  assert.match(cookie, /^moe_admin_session=/);

  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  const expires = setCookie.match(/Expires=([^;]+)/i);
  assert.ok(expires, "expected an explicit cookie expiration");
  const remainingLifetime = new Date(expires[1]).getTime() - Date.now();
  assert.ok(remainingLifetime > 6.9 * 24 * 60 * 60 * 1000);
  assert.ok(remainingLifetime <= 7 * 24 * 60 * 60 * 1000);
});

test("login rejects missing CSRF tokens", async () => {
  const response = await request("/admin/login", {
    method: "POST",
    body: form({
      username: process.env.ADMIN_USERNAME,
      password: process.env.ADMIN_PASSWORD,
    }),
  });

  assert.equal(response.status, 403);
});

test("login uses one error for either invalid credential", async () => {
  const firstPage = await getLoginSession();
  const wrongUsername = await submitLogin(firstPage, {
    username: "wrong-user",
    password: process.env.ADMIN_PASSWORD,
  });
  const wrongUsernameBody = await wrongUsername.text();

  const secondPage = await getLoginSession();
  const wrongPassword = await submitLogin(secondPage, {
    username: process.env.ADMIN_USERNAME,
    password: "wrong-password",
  });
  const wrongPasswordBody = await wrongPassword.text();

  assert.equal(wrongUsername.status, 401);
  assert.equal(wrongPassword.status, 401);
  assert.match(wrongUsernameBody, /用户名或密码错误/);
  assert.equal(
    extractAlert(wrongUsernameBody),
    extractAlert(wrongPasswordBody),
  );
  assert.doesNotMatch(wrongPasswordBody, /wrong-password/);
});

test("successful login rotates the session and logout invalidates it", async () => {
  const loginPage = await getLoginSession();
  const oldCookie = loginPage.cookie;
  const loginResponse = await submitLogin(loginPage, {
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD,
  });
  const authenticatedCookie = getCookie(loginResponse);

  assert.equal(loginResponse.status, 302);
  assert.equal(loginResponse.headers.get("location"), "/admin");
  assert.notEqual(authenticatedCookie, oldCookie);

  const loginRedirect = await request("/admin/login", {
    cookie: authenticatedCookie,
  });
  assert.equal(loginRedirect.status, 302);
  assert.equal(loginRedirect.headers.get("location"), "/admin");

  const adminResponse = await request("/admin", {
    cookie: authenticatedCookie,
  });
  const adminBody = await adminResponse.text();
  assert.equal(adminResponse.status, 200);
  assert.match(adminBody, /退出登录/);

  const logoutResponse = await request("/admin/logout", {
    method: "POST",
    cookie: authenticatedCookie,
    body: form({ _csrf: extractCsrf(adminBody) }),
  });
  assert.equal(logoutResponse.status, 302);
  assert.equal(logoutResponse.headers.get("location"), "/admin/login");

  const afterLogout = await request("/admin", {
    cookie: authenticatedCookie,
  });
  assert.equal(afterLogout.status, 302);
  assert.equal(afterLogout.headers.get("location"), "/admin/login");
});

test("expired server sessions cannot access the administration page", async () => {
  const loginPage = await getLoginSession();
  const loginResponse = await submitLogin(loginPage, {
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD,
  });
  const cookie = getCookie(loginResponse);
  const sid = getSessionId(cookie);

  await setSession(sid, {
    cookie: {
      expires: new Date(Date.now() - 1000),
      originalMaxAge: 0,
    },
    authenticated: true,
    csrfToken: "expired-token",
  });

  const response = await request("/admin", { cookie });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/admin/login");
});

test("repeated failures from one source are rate limited", async () => {
  const loginPage = await getLoginSession();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await submitLogin(loginPage, {
      username: process.env.ADMIN_USERNAME,
      password: "wrong-password",
    });
    assert.equal(response.status, 401);
  }

  const limited = await submitLogin(loginPage, {
    username: process.env.ADMIN_USERNAME,
    password: "wrong-password",
  });

  assert.equal(limited.status, 429);
  assert.match(limited.headers.get("retry-after"), /^\d+$/);
});

async function getLoginSession() {
  const response = await request("/admin/login");
  const body = await response.text();
  return {
    cookie: getCookie(response),
    csrfToken: extractCsrf(body),
  };
}

function submitLogin(loginPage, credentials) {
  return request("/admin/login", {
    method: "POST",
    cookie: loginPage.cookie,
    body: form({
      ...credentials,
      _csrf: loginPage.csrfToken,
    }),
  });
}

function request(route, {
  method = "GET",
  cookie,
  body,
} = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body) headers["content-type"] = "application/x-www-form-urlencoded";

  return fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body,
    redirect: "manual",
  });
}

function form(values) {
  return new URLSearchParams(values).toString();
}

function getCookie(response) {
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, "expected a Set-Cookie header");
  return setCookie.split(";")[0];
}

function extractCsrf(body) {
  const match = body.match(/name="_csrf" value="([^"]+)"/);
  assert.ok(match, "expected a CSRF token");
  return match[1];
}

function extractAlert(body) {
  const match = body.match(/<p role="alert">([^<]+)<\/p>/);
  assert.ok(match, "expected an alert message");
  return match[1];
}

function getSessionId(cookie) {
  const value = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
  const signatureIndex = value.lastIndexOf(".");
  assert.match(value, /^s:/);
  assert.ok(signatureIndex > 2);
  return value.slice(2, signatureIndex);
}

function setSession(sid, data) {
  return new Promise((resolve, reject) => {
    sessionStore.set(sid, data, (error) => error ? reject(error) : resolve());
  });
}

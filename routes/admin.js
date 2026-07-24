"use strict";

const crypto = require("node:crypto");

const express = require("express");
const session = require("express-session");
const { z } = require("zod");

const SESSION_COOKIE_NAME = "moe_admin_session";
const LOGIN_ERROR = "用户名或密码错误";
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const loginSchema = z.object({
  username: z.string().max(256),
  password: z.string().max(1024),
  _csrf: z.string().min(1).max(256),
});

const counterNameSchema = z.string()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9._-]+$/);

const createCounterSchema = z.object({
  name: counterNameSchema,
  _csrf: z.string().min(1).max(256),
});

const existingCounterSchema = z.object({
  name: z.string().min(1),
  _csrf: z.string().min(1).max(256),
});

const counterValueSchema = z.string()
  .regex(/^\d+$/)
  .transform(Number)
  .refine(Number.isSafeInteger);

const setCounterSchema = existingCounterSchema.extend({
  num: counterValueSchema,
});

function registerAdminRoutes(app, {
  config,
  counterService,
  sessionStore,
  logger,
  publicSite,
  now = Date.now,
}) {
  app.set("trust proxy", config.trustProxy);

  const router = express.Router();
  const limiter = createLoginLimiter({ now });
  const cookie = {
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookie,
    maxAge: config.sessionMaxAgeMs,
    path: "/admin",
  };

  router.use(noStore);
  router.use(express.urlencoded({ extended: false, limit: "16kb" }));
  router.use(session({
    name: SESSION_COOKIE_NAME,
    secret: config.sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: false,
    cookie,
  }));

  router.get("/login", (req, res) => {
    if (req.session.authenticated) return res.redirect("/admin");

    return renderLogin(req, res);
  });

  router.post("/login", verifyCsrf, (req, res) => {
    const source = req.ip;
    const limitState = limiter.check(source);

    if (limitState.limited) {
      res.set("Retry-After", String(Math.ceil(limitState.retryAfterMs / 1000)));
      return renderLogin(req, res, {
        status: 429,
        error: "登录尝试次数过多，请稍后重试",
      });
    }

    const parsed = loginSchema.safeParse(req.body);
    let validCredentials = false;

    if (parsed.success) {
      const usernameMatches = safeEqual(parsed.data.username, config.username);
      const passwordMatches = safeEqual(parsed.data.password, config.password);
      validCredentials = usernameMatches && passwordMatches;
    }

    if (!validCredentials) {
      limiter.recordFailure(source);
      return renderLogin(req, res, { status: 401, error: LOGIN_ERROR });
    }

    limiter.clear(source);
    return req.session.regenerate((regenerateError) => {
      if (regenerateError) return renderServerError(res, logger, regenerateError);

      req.session.authenticated = true;
      req.session.csrfToken = createToken();

      return req.session.save((saveError) => {
        if (saveError) return renderServerError(res, logger, saveError);
        return res.redirect("/admin");
      });
    });
  });

  router.get("/", requireAdminPage, asyncHandler(async (req, res) => {
    const notice = req.session.notice || null;
    delete req.session.notice;

    return renderAdmin(req, res, {
      counterService,
      publicSite,
      notice,
    });
  }));

  router.post(
    "/counters",
    requireAdminPage,
    verifyCsrf,
    asyncHandler(async (req, res) => {
      const parsed = createCounterSchema.safeParse(req.body);

      if (!parsed.success) {
        return renderAdmin(req, res, {
          counterService,
          publicSite,
          status: 400,
          error: "Name 必须为 1–32 个字符，且只能包含 ASCII 字母、数字、-、_ 和 .",
          inputName: typeof req.body.name === "string"
            ? req.body.name.slice(0, 256)
            : "",
        });
      }

      const created = await counterService.create(parsed.data.name, 0);
      if (!created) {
        return renderAdmin(req, res, {
          counterService,
          publicSite,
          status: 409,
          error: `Name “${parsed.data.name}” 已存在`,
          inputName: parsed.data.name,
        });
      }

      req.session.notice = `计数器 “${parsed.data.name}” 已创建`;
      return res.redirect(303, "/admin");
    }),
  );

  router.post(
    "/counters/set",
    requireAdminPage,
    verifyCsrf,
    asyncHandler(async (req, res) => {
      const parsed = setCounterSchema.safeParse(req.body);

      if (!parsed.success) {
        return renderAdmin(req, res, {
          counterService,
          publicSite,
          status: 400,
          error: "计数值必须是 JavaScript 安全范围内的非负整数",
        });
      }

      const updated = await counterService.setNum(
        parsed.data.name,
        parsed.data.num,
      );
      if (!updated) {
        return renderMissingCounter(req, res, {
          counterService,
          publicSite,
          name: parsed.data.name,
        });
      }

      req.session.notice = `计数器 “${parsed.data.name}” 已修改为 ${parsed.data.num}`;
      return res.redirect(303, "/admin");
    }),
  );

  router.post(
    "/counters/reset",
    requireAdminPage,
    verifyCsrf,
    asyncHandler(async (req, res) => {
      const parsed = existingCounterSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).send("Bad Request");
      }

      const reset = await counterService.reset(parsed.data.name);
      if (!reset) {
        return renderMissingCounter(req, res, {
          counterService,
          publicSite,
          name: parsed.data.name,
        });
      }

      req.session.notice = `计数器 “${parsed.data.name}” 已清零`;
      return res.redirect(303, "/admin");
    }),
  );

  router.post(
    "/counters/delete",
    requireAdminPage,
    verifyCsrf,
    asyncHandler(async (req, res) => {
      const parsed = existingCounterSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).send("Bad Request");
      }

      const deleted = await counterService.delete(parsed.data.name);
      if (!deleted) {
        return renderMissingCounter(req, res, {
          counterService,
          publicSite,
          name: parsed.data.name,
        });
      }

      req.session.notice = `计数器 “${parsed.data.name}” 已删除`;
      return res.redirect(303, "/admin");
    }),
  );

  router.post("/logout", requireAdminPage, verifyCsrf, (req, res) => {
    req.session.destroy((error) => {
      if (error) return renderServerError(res, logger, error);

      res.clearCookie(SESSION_COOKIE_NAME, {
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        secure: cookie.secure,
        path: cookie.path,
      });
      return res.redirect("/admin/login");
    });
  });

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    const status = Number.isInteger(error.status)
      && error.status >= 400
      && error.status < 500
      ? error.status
      : 500;

    logger.error("Administrator request failed", {
      name: error?.name,
      status,
    });

    return res.status(status).send(
      status === 500 ? "Internal Server Error" : "Bad Request",
    );
  });

  app.use("/admin", router);

  return {
    limiter,
  };
}

function noStore(req, res, next) {
  res.set("Cache-Control", "no-store");
  next();
}

function requireAdminPage(req, res, next) {
  if (!req.session.authenticated) return res.redirect("/admin/login");
  return next();
}

function verifyCsrf(req, res, next) {
  const expected = req.session.csrfToken;
  const received = req.body?._csrf;

  if (!expected || !received || !safeEqual(received, expected)) {
    return res.status(403).send("Forbidden");
  }

  return next();
}

function renderLogin(req, res, { status = 200, error = null } = {}) {
  return res.status(status).render("admin-login", {
    csrfToken: getCsrfToken(req),
    error,
  });
}

async function renderAdmin(req, res, {
  counterService,
  publicSite,
  status = 200,
  notice = null,
  error = null,
  inputName = "",
}) {
  const site = getPublicSite(req, publicSite);
  const counters = (await counterService.getAll()).map((counter) => ({
    ...counter,
    publicUrl: `${site}/@${encodeURIComponent(counter.name)}`,
  }));

  return res.status(status).render("admin", {
    csrfToken: getCsrfToken(req),
    counters,
    notice,
    error,
    inputName,
  });
}

function renderMissingCounter(req, res, {
  counterService,
  publicSite,
  name,
}) {
  return renderAdmin(req, res, {
    counterService,
    publicSite,
    status: 404,
    error: `计数器 “${name}” 不存在`,
  });
}

function getPublicSite(req, configuredSite) {
  return (configuredSite || `${req.protocol}://${req.get("host")}`)
    .replace(/\/+$/, "");
}

function getCsrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = createToken();
  return req.session.csrfToken;
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function createToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function safeEqual(actual, expected) {
  const actualDigest = crypto.createHash("sha256").update(String(actual)).digest();
  const expectedDigest = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(actualDigest, expectedDigest);
}

function createLoginLimiter({
  limit = LOGIN_LIMIT,
  windowMs = LOGIN_WINDOW_MS,
  now = Date.now,
} = {}) {
  const failures = new Map();

  function getCurrent(source) {
    const current = failures.get(source);
    if (!current || current.resetAt <= now()) {
      failures.delete(source);
      return null;
    }
    return current;
  }

  return {
    check(source) {
      const current = getCurrent(source);
      return {
        limited: Boolean(current && current.count >= limit),
        retryAfterMs: current ? Math.max(0, current.resetAt - now()) : 0,
      };
    },
    recordFailure(source) {
      const current = getCurrent(source);
      failures.set(source, current
        ? { ...current, count: current.count + 1 }
        : { count: 1, resetAt: now() + windowMs });
    },
    clear(source) {
      failures.delete(source);
    },
  };
}

function renderServerError(res, logger, error) {
  logger.error("Administrator session operation failed", {
    name: error.name,
    code: error.code,
  });
  return res.status(500).send("Internal Server Error");
}

module.exports = {
  createLoginLimiter,
  registerAdminRoutes,
  safeEqual,
};

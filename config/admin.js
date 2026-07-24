"use strict";

const path = require("node:path");

const { z } = require("zod");

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");

const adminEnvironmentSchema = z.object({
  ADMIN_USERNAME: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  SESSION_DB_PATH: z.string().min(1).optional(),
  SESSION_COOKIE_SECURE: booleanString.optional(),
  TRUST_PROXY: z.string().min(1).optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).optional(),
});

function parseTrustProxy(value) {
  if (value === undefined || value === "false") return false;

  if (value === "true") {
    throw new Error("TRUST_PROXY must identify trusted proxies instead of trusting every proxy");
  }

  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (Number.isSafeInteger(hops) && hops > 0) return hops;
  }

  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function loadAdminConfig(environment = process.env) {
  const result = adminEnvironmentSchema.safeParse(environment);

  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path[0]))];
    throw new Error(`Invalid administrator configuration: ${fields.join(", ")}`);
  }

  const values = result.data;
  const secureCookie = values.SESSION_COOKIE_SECURE
    ?? values.NODE_ENV === "production";

  return {
    username: values.ADMIN_USERNAME,
    password: values.ADMIN_PASSWORD,
    sessionSecret: values.SESSION_SECRET,
    sessionDbPath: path.resolve(
      values.SESSION_DB_PATH || path.join("data", "admin-sessions.db"),
    ),
    secureCookie,
    trustProxy: parseTrustProxy(values.TRUST_PROXY),
    sessionMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
  };
}

module.exports = {
  loadAdminConfig,
  parseTrustProxy,
};

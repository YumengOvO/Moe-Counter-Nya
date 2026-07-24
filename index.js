"use strict";

require('dotenv').config();
const express = require("express");
const compression = require("compression");
const { z } = require("zod");

const { loadAdminConfig } = require("./config/admin");
const adminConfig = loadAdminConfig();

const db = require("./db");
const { registerAdminRoutes } = require("./routes/admin");
const { createCounterService } = require("./services/counter");
const { SQLiteSessionStore } = require("./services/session-store");
const { themeList, getCountImage } = require("./utils/themify");
const { cors, ZodValid } = require("./utils/middleware");
const { randomArray, logger } = require("./utils");

const app = express();
const counterService = createCounterService({
  db,
  intervalSeconds: process.env.DB_INTERVAL,
  logger,
});
const sessionStore = new SQLiteSessionStore({
  filename: adminConfig.sessionDbPath,
  defaultMaxAgeMs: adminConfig.sessionMaxAgeMs,
});

app.use(express.static("assets"));
app.use(compression());
registerAdminRoutes(app, {
  config: adminConfig,
  sessionStore,
  logger,
});
app.use(cors());
app.set("view engine", "pug");

app.get('/', (req, res) => {
  const site = process.env.APP_SITE || `${req.protocol}://${req.get('host')}`
  const ga_id = process.env.GA_ID || null
  res.render('index', {
    site,
    ga_id,
    themeList,
  })
});

// get the image
app.get(["/@:name", "/get/@:name"],
  ZodValid({
    params: z.object({
      name: z.string().max(32),
    }),
    query: z.object({
      theme: z.string().default("moebooru"),
      padding: z.coerce.number().int().min(0).max(16).default(7),
      offset: z.coerce.number().min(-500).max(500).default(0),
      align: z.enum(["top", "center", "bottom"]).default("top"),
      scale: z.coerce.number().min(0.1).max(2).default(1),
      pixelated: z.enum(["0", "1"]).default("1"),
      darkmode: z.enum(["0", "1", "auto"]).default("auto"),

      // Unusual Options
      num: z.coerce.number().int().min(0).max(1e15).default(0), // a carry-safe integer, less than `2^53-1`, and aesthetically pleasing in decimal.
      prefix: z.coerce.number().int().min(-1).max(999999).default(-1)
    })
  }),
  async (req, res) => {
    const { name } = req.params;
    let { theme = "moebooru", num = 0, ...rest } = req.query;

    // This helps with GitHub's image cache
    res.set({
      "content-type": "image/svg+xml",
      "cache-control": "max-age=0, no-cache, no-store, must-revalidate",
    });

    const data = await getCountByName(String(name), Number(num));

    if (name === "demo") {
      res.set("cache-control", "max-age=31536000");
    }

    if (theme === "random") {
      theme = randomArray(Object.keys(themeList));
    }

    // Send the generated SVG as the result
    const renderSvg = getCountImage({
      count: data.num,
      theme,
      ...rest
    });

    res.send(renderSvg);

    logger.debug(
      data,
      { theme, ...req.query },
      `ip: ${req.headers['x-forwarded-for'] || req.connection.remoteAddress}`,
      `ref: ${req.get("Referrer") || null}`,
      `ua: ${req.get("User-Agent") || null}`
    );
  }
);

// JSON record
app.get("/record/@:name", async (req, res) => {
  const { name } = req.params;

  const data = await getCountByName(name);

  res.json(data);
});

app.get("/heart-beat", (req, res) => {
  res.set("cache-control", "max-age=0, no-cache, no-store, must-revalidate");
  res.send("alive");
  logger.debug("heart-beat");
});

function startServer(port = process.env.APP_PORT || 3000) {
  const listener = app.listen(port, () => {
    logger.info("Your app is listening on port " + listener.address().port);
  });

  return listener;
}

if (require.main === module) {
  startServer();
}

async function getCountByName(name, num) {
  const defaultCount = { name, num: 0 };

  if (name === "demo") return { name, num: "0123456789" };

  if (num > 0) { return { name, num } };

  try {
    return await counterService.increment(name, { createIfMissing: true });
  } catch (error) {
    logger.error("get count by name is error: ", error);
    return defaultCount;
  }
}

module.exports = {
  app,
  startServer,
  counterService,
  sessionStore,
};

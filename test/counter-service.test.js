"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createCounterService } = require("../services/counter");

function createMemoryAdapter(initial = []) {
  const records = new Map(initial.map(({ name, num }) => [name, num]));
  let nextFlushGate = null;
  let nextFlushError = null;

  return {
    async getNum(name) {
      return records.has(name)
        ? { name, num: records.get(name) }
        : null;
    },

    async getAll() {
      return [...records].map(([name, num]) => ({ name, num }));
    },

    async create(name, num = 0) {
      if (records.has(name)) {
        const error = new Error("duplicate key");
        error.code = 11000;
        throw error;
      }

      records.set(name, num);
      return { name, num };
    },

    async setNum(name, num) {
      if (!records.has(name)) return false;
      records.set(name, num);
      return true;
    },

    async delete(name) {
      return records.delete(name);
    },

    async setNumMulti(counters) {
      if (nextFlushError) {
        const error = nextFlushError;
        nextFlushError = null;
        throw error;
      }

      if (nextFlushGate) {
        const gate = nextFlushGate;
        nextFlushGate = null;
        gate.markStarted();
        await gate.waitForRelease;
      }

      for (const { name, num } of counters) {
        if (records.has(name)) records.set(name, num);
      }
    },

    blockNextFlush() {
      let markStarted;
      let release;

      const started = new Promise((resolve) => {
        markStarted = resolve;
      });
      const waitForRelease = new Promise((resolve) => {
        release = resolve;
      });

      nextFlushGate = { markStarted, waitForRelease };
      return { started, release };
    },

    failNextFlush(error = new Error("flush failed")) {
      nextFlushError = error;
    },
  };
}

function createService(db) {
  return createCounterService({
    db,
    intervalSeconds: 60,
    logger: { error() {} },
  });
}

test("increment can preserve legacy creation or require an existing counter", async (t) => {
  const db = createMemoryAdapter();
  const service = createService(db);
  t.after(() => service.close());

  assert.equal(
    await service.increment("missing", { createIfMissing: false }),
    null
  );
  assert.deepEqual(await service.increment("created"), {
    name: "created",
    num: 1,
  });

  await service.flush();
  assert.deepEqual(await db.getNum("created"), { name: "created", num: 1 });
});

test("concurrent increments are serialized without losing counts", async (t) => {
  const db = createMemoryAdapter([{ name: "counter", num: 0 }]);
  const service = createService(db);
  t.after(() => service.close());

  const results = await Promise.all(
    Array.from({ length: 50 }, () => service.increment("counter"))
  );

  assert.equal(results.at(-1).num, 50);
  await service.flush();
  assert.deepEqual(await db.getNum("counter"), { name: "counter", num: 50 });
});

test("increments made during a flush remain pending for the next snapshot", async (t) => {
  const db = createMemoryAdapter([{ name: "counter", num: 0 }]);
  const service = createService(db);
  t.after(() => service.close());

  await service.increment("counter");

  const gate = db.blockNextFlush();
  const flushing = service.flush();
  await gate.started;

  await service.increment("counter");
  gate.release();
  await flushing;

  assert.deepEqual(await db.getNum("counter"), { name: "counter", num: 2 });
});

test("a failed flush keeps dirty counts available for a later retry", async (t) => {
  const db = createMemoryAdapter([{ name: "counter", num: 0 }]);
  const service = createService(db);
  t.after(() => service.close());

  await service.increment("counter");
  db.failNextFlush();

  await assert.rejects(() => service.flush(), /flush failed/);
  assert.deepEqual(await service.get("counter"), { name: "counter", num: 1 });

  await service.flush();
  assert.deepEqual(await db.getNum("counter"), { name: "counter", num: 1 });
});

test("set and reset override dirty cached values consistently", async (t) => {
  const db = createMemoryAdapter([{ name: "counter", num: 5 }]);
  const service = createService(db);
  t.after(() => service.close());

  assert.deepEqual(await service.increment("counter"), {
    name: "counter",
    num: 6,
  });
  assert.equal(await service.setNum("counter", 20), true);
  assert.deepEqual(await service.get("counter"), { name: "counter", num: 20 });

  assert.deepEqual(await service.increment("counter"), {
    name: "counter",
    num: 21,
  });
  assert.equal(await service.reset("counter"), true);
  assert.deepEqual(await service.get("counter"), { name: "counter", num: 0 });
  assert.deepEqual(await db.getNum("counter"), { name: "counter", num: 0 });
});

test("management updates win over an in-flight stale flush", async (t) => {
  const db = createMemoryAdapter([{ name: "counter", num: 5 }]);
  const service = createService(db);
  t.after(() => service.close());

  await service.increment("counter");

  const gate = db.blockNextFlush();
  const flushing = service.flush();
  await gate.started;

  const updating = service.setNum("counter", 20);
  gate.release();

  await Promise.all([flushing, updating]);
  await service.flush();

  assert.deepEqual(await service.get("counter"), { name: "counter", num: 20 });
  assert.deepEqual(await db.getNum("counter"), { name: "counter", num: 20 });

  await service.increment("counter");

  const resetGate = db.blockNextFlush();
  const resetFlushing = service.flush();
  await resetGate.started;

  const resetting = service.reset("counter");
  resetGate.release();

  await Promise.all([resetFlushing, resetting]);
  await service.flush();

  assert.deepEqual(await service.get("counter"), { name: "counter", num: 0 });
  assert.deepEqual(await db.getNum("counter"), { name: "counter", num: 0 });
});

test("delete wins over an in-flight flush and stale cache cannot revive a name", async (t) => {
  const db = createMemoryAdapter([{ name: "counter", num: 0 }]);
  const service = createService(db);
  t.after(() => service.close());

  await service.increment("counter");

  const gate = db.blockNextFlush();
  const flushing = service.flush();
  await gate.started;

  const deleting = service.delete("counter");
  gate.release();

  await Promise.all([flushing, deleting]);
  await service.flush();

  assert.equal(await service.get("counter"), null);
  assert.equal(await db.getNum("counter"), null);
});

test("create and delete report conflicts and support clean recreation", async (t) => {
  const db = createMemoryAdapter();
  const service = createService(db);
  t.after(() => service.close());

  assert.equal(await service.create("counter"), true);
  assert.equal(await service.create("counter"), false);
  assert.deepEqual(await service.getAll(), [{ name: "counter", num: 0 }]);

  assert.equal(await service.delete("counter"), true);
  assert.equal(await service.delete("counter"), false);
  assert.equal(await service.create("counter"), true);
  assert.deepEqual(await service.get("counter"), { name: "counter", num: 0 });
});

test("management updates never create a missing counter", async (t) => {
  const db = createMemoryAdapter();
  const service = createService(db);
  t.after(() => service.close());

  assert.equal(await service.setNum("missing", 12), false);
  assert.equal(await service.reset("missing"), false);
  assert.equal(await service.delete("missing"), false);
  assert.equal(await service.get("missing"), null);
});

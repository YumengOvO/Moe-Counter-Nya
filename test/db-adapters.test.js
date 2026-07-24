"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createMongoAdapter } = require("../db/mongodb-adapter");
const { countSchema } = require("../db/mongodb-schema");
const { createSQLiteAdapter } = require("../db/sqlite-adapter");

async function assertAdapterContract(adapter) {
  assert.equal(await adapter.getNum("missing"), null);
  assert.deepEqual(await adapter.getAll(), []);

  assert.deepEqual(
    await adapter.create("alpha", 3),
    { name: "alpha", num: 3 }
  );
  assert.deepEqual(await adapter.getNum("alpha"), { name: "alpha", num: 3 });
  assert.deepEqual(await adapter.getAll(), [{ name: "alpha", num: 3 }]);

  await assert.rejects(() => adapter.create("alpha", 9));
  assert.deepEqual(await adapter.getNum("alpha"), { name: "alpha", num: 3 });

  assert.equal(await adapter.setNum("missing", 4), false);
  assert.equal(await adapter.getNum("missing"), null);

  assert.equal(await adapter.setNum("alpha", 7), true);
  assert.deepEqual(await adapter.getNum("alpha"), { name: "alpha", num: 7 });

  assert.equal(await adapter.delete("missing"), false);
  assert.equal(await adapter.delete("alpha"), true);
  assert.equal(await adapter.getNum("alpha"), null);

  await adapter.setNumMulti([{ name: "missing", num: 11 }]);
  assert.equal(await adapter.getNum("missing"), null);

  await adapter.create("batch", 1);
  await adapter.setNumMulti([{ name: "batch", num: 11 }]);
  assert.deepEqual(await adapter.getNum("batch"), { name: "batch", num: 11 });
}

function createFakeMongoModel() {
  const records = new Map();
  const query = (value) => ({
    lean() {
      return this;
    },
    exec: async () => value,
  });

  return {
    findOne({ name }) {
      const value = records.has(name)
        ? { name, num: records.get(name) }
        : null;
      return query(value);
    },

    find() {
      const values = [...records].map(([name, num]) => ({ name, num }));
      return query(values);
    },

    async create({ name, num }) {
      if (records.has(name)) {
        const error = new Error("duplicate key");
        error.code = 11000;
        throw error;
      }

      records.set(name, num);
    },

    updateOne({ name }, update, options = {}) {
      assert.notEqual(options.upsert, true);
      const matchedCount = records.has(name) ? 1 : 0;
      if (matchedCount) records.set(name, update.$set.num);
      return query({ matchedCount });
    },

    deleteOne({ name }) {
      const deletedCount = records.delete(name) ? 1 : 0;
      return query({ deletedCount });
    },

    async bulkWrite(operations) {
      for (const { updateOne } of operations) {
        const { name } = updateOne.filter;
        if (records.has(name)) {
          records.set(name, updateOne.update.$set.num);
        }
      }
    },
  };
}

test("SQLite adapter implements the counter data contract", async () => {
  const adapter = createSQLiteAdapter(":memory:");

  try {
    await assertAdapterContract(adapter);
  } finally {
    adapter.close();
  }
});

test("MongoDB adapter implements the counter data contract", async () => {
  const adapter = createMongoAdapter(createFakeMongoModel());
  await assertAdapterContract(adapter);
});

test("MongoDB schema enforces unique counter names", () => {
  assert.equal(countSchema.path("name").options.unique, true);
});

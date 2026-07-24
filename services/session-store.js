"use strict";

const fs = require("node:fs");
const path = require("node:path");

const Database = require("better-sqlite3");
const session = require("express-session");

class SQLiteSessionStore extends session.Store {
  constructor({ filename, defaultMaxAgeMs }) {
    super();

    fs.mkdirSync(path.dirname(filename), { recursive: true });

    this.database = new Database(filename);
    this.defaultMaxAgeMs = defaultMaxAgeMs;
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS admin_sessions (
        sid     TEXT    PRIMARY KEY NOT NULL,
        expires INTEGER NOT NULL,
        data    TEXT    NOT NULL
      );
    `);

    this.readStatement = this.database.prepare(
      "SELECT expires, data FROM admin_sessions WHERE sid = ?",
    );
    this.writeStatement = this.database.prepare(`
      INSERT INTO admin_sessions (sid, expires, data)
      VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET
        expires = excluded.expires,
        data = excluded.data
    `);
    this.deleteStatement = this.database.prepare(
      "DELETE FROM admin_sessions WHERE sid = ?",
    );
    this.deleteExpiredStatement = this.database.prepare(
      "DELETE FROM admin_sessions WHERE expires <= ?",
    );
  }

  get(sid, callback) {
    try {
      const row = this.readStatement.get(sid);

      if (!row) return callback(null, null);
      if (row.expires <= Date.now()) {
        this.deleteStatement.run(sid);
        return callback(null, null);
      }

      return callback(null, JSON.parse(row.data));
    } catch (error) {
      return callback(error);
    }
  }

  set(sid, sessionData, callback = () => {}) {
    try {
      this.deleteExpiredStatement.run(Date.now());
      this.writeStatement.run(
        sid,
        getExpiresAt(sessionData, this.defaultMaxAgeMs),
        JSON.stringify(sessionData),
      );
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, sessionData, callback = () => {}) {
    this.set(sid, sessionData, callback);
  }

  destroy(sid, callback = () => {}) {
    try {
      this.deleteStatement.run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  close() {
    if (this.database.open) this.database.close();
  }
}

function getExpiresAt(sessionData, defaultMaxAgeMs) {
  const expires = sessionData.cookie?.expires;
  const expiresAt = expires ? new Date(expires).getTime() : NaN;

  if (Number.isFinite(expiresAt)) return expiresAt;
  return Date.now() + defaultMaxAgeMs;
}

module.exports = {
  SQLiteSessionStore,
};

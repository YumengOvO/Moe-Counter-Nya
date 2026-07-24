'use strict'

const Database = require('better-sqlite3')

function createSQLiteAdapter(filename) {
  const database = new Database(filename)

  database.exec(`CREATE TABLE IF NOT EXISTS tb_count (
      id    INTEGER      PRIMARY KEY AUTOINCREMENT
                         NOT NULL
                         UNIQUE,
      name  VARCHAR (32) NOT NULL
                         UNIQUE,
      num   BIGINT       NOT NULL
                         DEFAULT (0)
  );`)

  async function getNum(name) {
    const stmt = database.prepare('SELECT `name`, `num` from tb_count WHERE `name` = ?')
    return stmt.get(name) || null
  }

  async function getAll() {
    const stmt = database.prepare('SELECT `name`, `num` from tb_count ORDER BY `id`')
    return stmt.all()
  }

  async function create(name, num = 0) {
    const stmt = database.prepare(`INSERT INTO tb_count(\`name\`, \`num\`)
      VALUES($name, $num);`)

    stmt.run({ name, num })
    return { name, num }
  }

  async function setNum(name, num) {
    const stmt = database.prepare('UPDATE tb_count SET `num` = ? WHERE `name` = ?')
    const result = stmt.run(num, name)
    return result.changes > 0
  }

  async function deleteCounter(name) {
    const stmt = database.prepare('DELETE FROM tb_count WHERE `name` = ?')
    const result = stmt.run(name)
    return result.changes > 0
  }

  async function setNumMulti(counters) {
    const stmt = database.prepare(`INSERT INTO tb_count(\`name\`, \`num\`)
      VALUES($name, $num)
      ON CONFLICT(name) DO
      UPDATE SET \`num\` = $num;`)

    const setMany = database.transaction((items) => {
      for (const counter of items) stmt.run(counter)
    })

    setMany(counters)
  }

  function close() {
    database.close()
  }

  return {
    getNum,
    getAll,
    create,
    setNum,
    delete: deleteCounter,
    setNumMulti,
    close,
  }
}

module.exports = {
  createSQLiteAdapter,
}

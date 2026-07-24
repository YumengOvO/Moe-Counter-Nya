'use strict'

const path = require('path')

const { createSQLiteAdapter } = require('./sqlite-adapter')

const filename = path.resolve(__dirname, '../data/count.db')

module.exports = createSQLiteAdapter(filename)

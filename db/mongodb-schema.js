'use strict'

const mongoose = require('mongoose')

const countSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    num: { type: Number, required: true }
  },
  { collection: 'tb_count', versionKey: false }
)

module.exports = {
  countSchema,
}

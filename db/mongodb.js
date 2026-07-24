"use strict";

const mongoose = require("mongoose");

const { createMongoAdapter } = require("./mongodb-adapter");
const { countSchema } = require("./mongodb-schema");

// the default mongodb url (local server)
const mongodbURL = process.env.DB_URL || "mongodb://127.0.0.1:27017";
mongoose.connect(mongodbURL);

const Count = mongoose.connection.model("Count", countSchema);

module.exports = createMongoAdapter(Count);

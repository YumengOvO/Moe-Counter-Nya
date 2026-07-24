'use strict'

function createMongoAdapter(Count) {
  function getNum(name) {
    return Count.findOne({ name }, '-_id -__v').lean().exec()
  }

  function getAll() {
    return Count.find({}, '-_id -__v').lean().exec()
  }

  async function create(name, num = 0) {
    await Count.create({ name, num })
    return { name, num }
  }

  async function setNum(name, num) {
    const result = await Count.updateOne(
      { name },
      { $set: { num } }
    ).exec()

    return result.matchedCount > 0
  }

  async function deleteCounter(name) {
    const result = await Count.deleteOne({ name }).exec()
    return result.deletedCount > 0
  }

  function setNumMulti(counters) {
    const bulkOps = counters.map(({ name, num }) => ({
      updateOne: {
        filter: { name },
        update: { $set: { num } },
      },
    }))

    return Count.bulkWrite(bulkOps, { ordered: false })
  }

  return {
    getNum,
    getAll,
    create,
    setNum,
    delete: deleteCounter,
    setNumMulti,
  }
}

module.exports = {
  createMongoAdapter,
}

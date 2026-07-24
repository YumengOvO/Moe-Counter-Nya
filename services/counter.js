'use strict'

function createCounterService({
  db,
  intervalSeconds = 0,
  logger = console,
}) {
  const cache = new Map()
  const nameLocks = new Map()
  const delayMs = Math.max(0, Number(intervalSeconds) || 0) * 1000

  let version = 0
  let mutationTail = Promise.resolve()
  let flushPromise = null
  let timer = null
  let closed = false

  function nextVersion() {
    version += 1
    return version
  }

  function enqueueMutation(task) {
    const operation = mutationTail.then(task)
    mutationTail = operation.catch(() => {})
    return operation
  }

  async function withNameLock(name, task) {
    const previous = nameLocks.get(name) || Promise.resolve()
    const operation = previous.catch(() => {}).then(task)
    nameLocks.set(name, operation)

    try {
      return await operation
    } finally {
      if (nameLocks.get(name) === operation) {
        nameLocks.delete(name)
      }
    }
  }

  function isDuplicateError(error) {
    return error?.code === 11000
      || String(error?.code).startsWith('SQLITE_CONSTRAINT')
  }

  function scheduleAutomaticFlush() {
    if (closed) return

    queueMicrotask(() => {
      requestFlushOnce().catch((error) => {
        logger.error('counter flush failed:', error)
      })
    })
  }

  async function flushSnapshot() {
    const snapshot = [...cache].map(([name, entry]) => ({
      name,
      num: entry.num,
      version: entry.version,
    }))

    if (snapshot.length === 0) return

    await enqueueMutation(() => db.setNumMulti(
      snapshot.map(({ name, num }) => ({ name, num }))
    ))

    for (const item of snapshot) {
      const current = cache.get(item.name)
      if (current?.version === item.version) {
        cache.delete(item.name)
      }
    }
  }

  function requestFlushOnce() {
    if (flushPromise) return flushPromise

    let succeeded = false
    flushPromise = flushSnapshot()
      .then(() => {
        succeeded = true
      })
      .finally(() => {
        flushPromise = null

        if (succeeded && delayMs === 0 && cache.size > 0 && !closed) {
          scheduleAutomaticFlush()
        }
      })

    return flushPromise
  }

  async function flush() {
    do {
      await requestFlushOnce()
    } while (cache.size > 0)
  }

  async function ensureCounter(name, createIfMissing) {
    const existing = await db.getNum(name)
    if (existing) return existing
    if (!createIfMissing) return null

    try {
      await enqueueMutation(() => db.create(name, 0))
      return { name, num: 0 }
    } catch (error) {
      if (!isDuplicateError(error)) throw error

      const concurrent = await db.getNum(name)
      if (!concurrent) throw error
      return concurrent
    }
  }

  async function increment(name, { createIfMissing = true } = {}) {
    const counter = await withNameLock(name, async () => {
      const cached = cache.get(name)
      const current = cached || await ensureCounter(name, createIfMissing)

      if (!current) return null

      const next = {
        num: Number(current.num) + 1,
        version: nextVersion(),
      }

      cache.set(name, next)
      return { name, num: next.num }
    })

    if (counter && delayMs === 0) {
      scheduleAutomaticFlush()
    }

    return counter
  }

  async function get(name) {
    return withNameLock(name, async () => {
      const cached = cache.get(name)
      if (cached) return { name, num: cached.num }
      return db.getNum(name)
    })
  }

  async function getAll() {
    await flush()
    const counters = await db.getAll()
    const merged = new Map(counters.map(({ name, num }) => [name, num]))

    for (const [name, entry] of cache) {
      merged.set(name, entry.num)
    }

    return [...merged].map(([name, num]) => ({ name, num }))
  }

  async function create(name, num = 0) {
    return withNameLock(name, async () => {
      if (cache.has(name) || await db.getNum(name)) return false

      try {
        await enqueueMutation(() => db.create(name, num))
        return true
      } catch (error) {
        if (isDuplicateError(error)) return false
        throw error
      }
    })
  }

  async function setNum(name, num) {
    return withNameLock(name, async () => {
      const cached = cache.get(name)

      if (!cached) {
        return enqueueMutation(() => db.setNum(name, num))
      }

      const updatedEntry = {
        num,
        version: nextVersion(),
      }
      cache.set(name, updatedEntry)

      const updated = await enqueueMutation(() => db.setNum(name, num))
      const current = cache.get(name)

      if (current?.version === updatedEntry.version) {
        cache.delete(name)
      }

      return updated
    })
  }

  function reset(name) {
    return setNum(name, 0)
  }

  async function deleteCounter(name) {
    return withNameLock(name, async () => {
      cache.delete(name)
      return enqueueMutation(() => db.delete(name))
    })
  }

  async function close() {
    closed = true
    if (timer) clearInterval(timer)
    await flush()
    await mutationTail
  }

  if (delayMs > 0) {
    timer = setInterval(scheduleAutomaticFlush, delayMs)
    timer.unref?.()
  }

  return {
    increment,
    get,
    getAll,
    create,
    setNum,
    reset,
    delete: deleteCounter,
    flush,
    close,
  }
}

module.exports = {
  createCounterService,
}

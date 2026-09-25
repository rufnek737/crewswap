// D1 compares the entire prior JSON value inside one SQL write. The KV fallback
// is for single-process tests only; deployed services must have the DB binding.
const queues = new WeakMap();
export async function compareAndSwap(store, key, before, after) {
  if (store.compareAndSwap) return store.compareAndSwap(key, before, after);
  let locks = queues.get(store);
  if (!locks) queues.set(store, locks = new Map());
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const done = new Promise(resolve => { release = resolve; });
  const tail = previous.then(() => done);
  locks.set(key, tail);
  await previous;
  try {
    if (await store.get(key) !== before) return false;
    await store.put(key, after);
    return true;
  } finally {
    release();
    if (locks.get(key) === tail) locks.delete(key);
  }
}

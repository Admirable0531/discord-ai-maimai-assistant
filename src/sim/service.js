// Runs simulations off the main thread (they take seconds and the bot must stay
// responsive), one at a time, and remembers recent results.
const { Worker } = require('worker_threads');
const path = require('path');

const cache = new Map();
const MAX_CACHE = 16;
let chain = Promise.resolve();

function runInWorker(events, options) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, 'worker.js'), {
            workerData: { events, options },
        });
        worker.once('message', (m) => (m.error ? reject(new Error(m.error)) : resolve(m.result)));
        worker.once('error', reject);
        worker.once('exit', (code) => code && reject(new Error(`simulation stopped (${code})`)));
    });
}

/**
 * simulate(key, events, options): result of simulateSpots, from the cache when the
 * same `key` was run before. Runs queue up so only one is computing at a time.
 */
function simulate(key, events, options) {
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    const job = chain.then(async () => {
        if (cache.has(key)) return cache.get(key);
        const result = await runInWorker(events, options);
        cache.set(key, result);
        if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
        return result;
    });
    chain = job.catch(() => {});
    return job;
}

module.exports = { simulate };

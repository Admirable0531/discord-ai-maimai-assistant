const { parentPort, workerData } = require('worker_threads');
const { simulateSpots } = require('./report');

try {
    parentPort.postMessage({ result: simulateSpots(workerData.events, workerData.options) });
} catch (err) {
    parentPort.postMessage({ error: String(err && err.message ? err.message : err) });
}

// An isolated reader validates a staged successor before its pointer publishes.
import crypto from 'node:crypto';
import { workerData } from 'node:worker_threads';
import { scanGeneration } from './history-store.mjs';
import { History } from './history.mjs';
const { shared, file, marker, count, digest } = workerData;
const state = new Int32Array(shared, 0, 2);
try {
  const parsed = scanGeneration({ generation: file, raw: marker, bytes: Buffer.from(JSON.stringify(marker)) });
  History.fromJSON(parsed.raw);
  if (parsed.tornTail || parsed.raw.events.length !== count || crypto.createHash('sha256').update(JSON.stringify(parsed.raw.events)).digest('hex') !== digest) throw Error('事件内容、数量或文件完整性不匹配');
  Atomics.store(state, 0, 1);
} catch (error) {
  const bytes = new TextEncoder().encode(error.message).subarray(0, 8184); new Uint8Array(shared, 8, bytes.length).set(bytes);
  Atomics.store(state, 1, bytes.length); Atomics.store(state, 0, 2);
} finally { Atomics.notify(state, 0); }

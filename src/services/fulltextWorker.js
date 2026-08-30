import { config } from '../config.js';
import { pollOnce } from './fulltextService.js';

let timer = null;
let running = false;
let started = false;

/**
 * Start the background poller that advances pending MinerU tasks.
 * Safe to call multiple times: a single interval is kept.
 */
export function startFullTextWorker() {
  if (started) return;
  if (!config.mineru.tokens.length) {
    console.warn('[fulltext] OTERO_MINERU_TOKEN not set; worker disabled');
    return;
  }
  started = true;
  const interval = Math.max(2000, config.mineru.pollIntervalMs);
  timer = setInterval(tick, interval);
  // Don't keep the process alive on our own account.
  if (timer.unref) timer.unref();
  // Kick one off shortly after start.
  setTimeout(tick, 1000).unref?.();
  const n = config.mineru.tokens.length;
  console.log(`[fulltext] worker started (poll every ${interval}ms, ${n} MinerU token${n === 1 ? '' : 's'})`);
}

export function stopFullTextWorker() {
  if (timer) { clearInterval(timer); timer = null; }
  started = false;
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const res = await pollOnce();
    if (res.checked > 0) {
      console.log(`[fulltext] tick: batches=${res.checked} finalized=${res.finalized} failed=${res.failed}`);
    }
  } catch (err) {
    console.error('[fulltext] worker tick failed:', err.message);
  } finally {
    running = false;
  }
}

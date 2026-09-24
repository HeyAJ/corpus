import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Disk cache for every upstream fetch.
 *
 * Two reasons this exists rather than fetching each run:
 *  1. Re-running the pipeline must be idempotent and must diff cleanly against the
 *     committed data/*.json (spec 5.6). A cached fetch makes that reproducible.
 *  2. GtoPdb's interactions.csv is 7 MB; pulling it on every iteration is rude to a
 *     free academic resource.
 *
 * `--offline` refuses to reach the network at all and fails loudly if something is
 * not cached, so CI can prove the build does not silently depend on a live service.
 */

const CACHE_DIR = join(process.cwd(), '.cache', 'ingest');

export interface FetchOptions {
  /** Human-readable label used in logs and in the generated provenance. */
  label: string;
  offline: boolean;
  /** Re-fetch even when cached. */
  force?: boolean;
  binary?: boolean;
}

function cachePathFor(url: string, binary: boolean): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 16);
  const safe = url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  return join(CACHE_DIR, `${safe}.${hash}${binary ? '.bin' : '.txt'}`);
}

export async function cachedFetch(url: string, opts: FetchOptions): Promise<Buffer> {
  const path = cachePathFor(url, opts.binary ?? false);

  if (!opts.force && existsSync(path)) {
    process.stdout.write(`  cache  ${opts.label}\n`);
    return readFileSync(path);
  }

  if (opts.offline) {
    throw new Error(
      `--offline was requested but "${opts.label}" is not cached.\n` +
        `  url: ${url}\n` +
        `  Run the pipeline once with network access to populate .cache/ingest.`,
    );
  }

  process.stdout.write(`  fetch  ${opts.label}\n`);
  const res = await fetch(url, { headers: { 'user-agent': 'corpus-ingest/0.1 (educational simulator)' } });
  if (!res.ok) throw new Error(`fetch failed ${res.status} ${res.statusText}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  return buf;
}

export function cacheDir(): string {
  return CACHE_DIR;
}

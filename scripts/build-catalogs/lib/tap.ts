/**
 * Minimal IVOA TAP client (Table Access Protocol) used for the ESA Gaia archive
 * and the NASA Exoplanet Archive.
 *
 * - `tapSync`  : small queries, answered in one request.
 * - `tapAsync` : big queries. Submits a UWS job, polls its phase and downloads
 *                the result when COMPLETED (the Gaia archive caps anonymous
 *                sync queries at 2000 rows, async jobs at 3 million rows).
 */
import { existsSync, statSync } from 'node:fs';
import { download, fetchRetry, rawPath, sleep } from './http';

export async function tapSync(endpoint: string, adql: string, format = 'csv'): Promise<string> {
  const body = new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: format, QUERY: adql });
  const res = await fetchRetry(`${endpoint}/sync`, { method: 'POST', body });
  const text = await res.text();
  if (!res.ok) throw new Error(`TAP sync failed (${res.status}): ${text.slice(0, 300)}`);
  return text;
}

/** Thrown when the archive aborts a job for exceeding its execution-time quota. */
export class TapTimeLimitError extends Error {}

/**
 * Run an async TAP job and store its CSV result as .raw/`name`.
 * Cached: if the file already exists the job is not re-submitted.
 *
 * MAXREC is always sent explicitly: the Gaia archive otherwise truncates
 * results silently at its default row limit.
 */
export async function tapAsync(endpoint: string, name: string, adql: string, opts: { refresh?: boolean; minBytes?: number } = {}): Promise<string> {
  const dest = rawPath(name);
  if (!opts.refresh && existsSync(dest) && statSync(dest).size >= (opts.minBytes ?? 1)) return dest;

  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const body = new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', PHASE: 'RUN', MAXREC: '3000000', QUERY: adql });
      // The job URL comes back as a 303 redirect; follow manually to capture it.
      const submit = await fetch(`${endpoint}/async`, { method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(120_000) });
      const jobUrl = submit.headers.get('location') ?? '';
      if (!jobUrl) throw new Error(`TAP async submit failed (${submit.status}): ${(await submit.text()).slice(0, 300)}`);
      const job = jobUrl.replace(/^http:/, 'https:');
      console.info(`  … job ${job.split('/').pop()} submitted for ${name}`);

      const started = Date.now();
      for (;;) {
        await sleep(4000);
        const phase = (await (await fetchRetry(`${job}/phase`)).text()).trim();
        if (phase === 'COMPLETED') break;
        if (phase === 'ERROR' || phase === 'ABORTED') {
          const err = await (await fetchRetry(`${job}/error`)).text();
          const msg = /<uws:message>(?:<!\[CDATA\[)?([^\]<]*)/.exec(err)?.[1] ?? err.slice(0, 300);
          if (/execution time/i.test(msg)) throw new TapTimeLimitError(msg);
          throw new Error(`TAP job ${phase}: ${msg}`);
        }
        if (Date.now() - started > 45 * 60_000) throw new Error('TAP job timed out after 45 minutes');
      }
      const path = await download(name, `${job}/results/result`, { refresh: true, minBytes: opts.minBytes });
      // Be a good citizen: free the job's server-side storage.
      await fetch(job, { method: 'DELETE', signal: AbortSignal.timeout(30_000) }).catch(() => undefined);
      return path;
    } catch (err) {
      if (err instanceof TapTimeLimitError) throw err; // caller should split the query instead of retrying
      lastErr = err;
      console.warn(`  ! ${name}: ${String(err).slice(0, 300)} — attempt ${attempt + 1}/4`);
      await sleep(15_000 * (attempt + 1));
    }
  }
  throw new Error(`TAP async query for ${name} failed: ${String(lastErr)}`);
}

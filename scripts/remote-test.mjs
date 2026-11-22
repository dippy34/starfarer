#!/usr/bin/env node
// Run the browser suites on GitHub's runners (.github/workflows/browser-tests.yml) for the commit
// checked out here, and bring the results back: pass/fail per suite, the logs and the pictures.
//
//   node scripts/remote-test.mjs [--suites "flight walk" | --suites all] [--name you] [--out dir] [--keep]
//
// 1. pushes HEAD (or, with --suites, a commit on top of it with the same files and a `Suites:`
//    trailer; your branch does not move) to a throwaway branch claude/test-<name>-<sha>-<stamp>
// 2. waits for the workflow's run on it, printing each suite as it finishes
// 3. downloads every suite's artifact into <out>/<suite>/ (default out/remote-<sha>), prints a summary
// 4. deletes the branch (--keep leaves it)
// Without --suites the workflow runs what scripts/affected.mjs picks for the change against
// claude/friendly-hypatia-up418z (or what a `Suites:` trailer in HEAD's own message says).
// Exit code 0 only when every suite that ran passed. Uncommitted changes are NOT tested.
//
// Needs `git push` to origin and api.github.com reachable with a token (in the agents' container
// the proxy adds it; elsewhere set GITHUB_TOKEN). Uses curl for HTTP.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const keep = args.includes('--keep');
const suitesArg = opt('--suites', null);
const name = (opt('--name', process.env.REMOTE_TEST_NAME || 'helper')).replace(/[^a-z0-9-]/gi, '-').toLowerCase();
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const remote = git('remote', 'get-url', 'origin');
const repo = /github\.com[/:]([^/]+\/[^/.]+)/.exec(remote)?.[1];
if (!repo) throw new Error(`origin is not a GitHub repository: ${remote}`);
const API = `https://api.github.com/repos/${repo}`;
const say = (...m) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...m);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function curl(url, extra = []) {
  const auth = process.env.GITHUB_TOKEN && !process.env.CCR_AGENT_PROXY_ENABLED ? ['-H', `Authorization: Bearer ${process.env.GITHUB_TOKEN}`] : [];
  return execFileSync('curl', ['-sSfL', '--retry', '3', '-H', 'Accept: application/vnd.github+json', ...auth, ...extra, url], { encoding: extra.includes('-o') ? undefined : 'utf8', maxBuffer: 64 << 20 });
}
const api = (p) => JSON.parse(curl(`${API}${p}`));

if (git('status', '--porcelain', '--untracked-files=no')) say('note: uncommitted changes are not part of the test (only commits are pushed)');
let sha = git('rev-parse', 'HEAD');
if (suitesArg) {
  const msg = `Remote test of ${sha.slice(0, 8)}\n\nSuites: ${suitesArg}\n`;
  sha = execFileSync('git', ['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-F', '-'], { input: msg, encoding: 'utf8' }).trim();
}
const branch = `claude/test-${name}-${sha.slice(0, 8)}-${Date.now().toString(36)}`;
const out = path.resolve(opt('--out', path.join('out', `remote-${sha.slice(0, 8)}`)));
say(`pushing ${sha.slice(0, 8)} to ${branch}`);
git('push', '--quiet', 'origin', `${sha}:refs/heads/${branch}`);
const t0 = Date.now();

let code = 1;
try {
  // the run for that push
  let run = null;
  for (let i = 0; !run; i++) {
    if (i > 60) throw new Error('no workflow run appeared for the push in 10 minutes');
    await wait(10000);
    run = api(`/actions/runs?branch=${encodeURIComponent(branch)}&per_page=5`).workflow_runs.find((r) => r.head_sha === sha && r.path.endsWith('browser-tests.yml')) ?? null;
  }
  say(`run ${run.html_url}`);
  const seen = new Set();
  for (;;) {
    run = api(`/actions/runs/${run.id}`);
    const jobs = api(`/actions/runs/${run.id}/jobs?per_page=100`).jobs;
    for (const j of jobs) {
      if (j.status !== 'completed' || seen.has(j.id)) continue;
      seen.add(j.id);
      const min = ((new Date(j.completed_at) - new Date(j.started_at)) / 60000).toFixed(1);
      say(`${j.name}: ${j.conclusion} (${min} min)`);
    }
    if (run.status === 'completed') break;
    await wait(30000);
  }
  // the results
  fs.mkdirSync(out, { recursive: true });
  const jobs = api(`/actions/runs/${run.id}/jobs?per_page=100`).jobs;
  const arts = api(`/actions/runs/${run.id}/artifacts?per_page=100`).artifacts.filter((a) => !a.name.startsWith('dist-'));
  const rows = [];
  for (const a of arts) {
    const suite = a.name.replace(`-${sha}`, '');
    const dir = path.join(out, suite), zip = path.join(out, `${suite}.zip`);
    curl(a.archive_download_url, ['-o', zip]);
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('unzip', ['-qo', zip, '-d', dir]);
    fs.rmSync(zip);
    const log = fs.existsSync(path.join(dir, `${suite}.log`)) ? fs.readFileSync(path.join(dir, `${suite}.log`), 'utf8') : '';
    const pass = (log.match(/^PASS /gm) ?? []).length, fail = log.match(/^FAIL .*/gm) ?? [];
    const job = jobs.find((j) => j.name === suite);
    rows.push({ suite, conclusion: job?.conclusion ?? '?', pass, fail, last: log.trim().split('\n').slice(-2).join(' | ') });
  }
  for (const j of jobs) if (!['plan', 'build'].includes(j.name) && !rows.some((r) => r.suite === j.name)) rows.push({ suite: j.name, conclusion: j.conclusion, pass: 0, fail: [], last: '(no artifact)' });
  const bad = jobs.filter((j) => j.conclusion !== 'success' && j.conclusion !== 'skipped');
  console.log(`\n${run.html_url}\nwall time ${((Date.now() - t0) / 60000).toFixed(1)} min; results in ${out}`);
  for (const r of rows.sort((p, q) => p.suite.localeCompare(q.suite))) {
    console.log(`${r.conclusion === 'success' ? 'ok  ' : 'FAIL'} ${r.suite.padEnd(9)} ${String(r.pass).padStart(3)} passed, ${r.fail.length} failed   ${r.last.slice(0, 110)}`);
    for (const f of r.fail) console.log(`       ${f.slice(0, 160)}`);
  }
  if (!rows.length) console.log('no suites ran (the change touches nothing a browser suite sees; --suites all runs every one)');
  for (const j of bad.filter((j) => ['plan', 'build'].includes(j.name))) console.log(`FAIL ${j.name}: ${j.html_url}`);
  code = bad.length ? 1 : 0;
} finally {
  if (!keep) {
    try { git('push', '--quiet', 'origin', '--delete', branch); say(`deleted ${branch}`); } catch (e) { say(`could not delete ${branch}: ${e.message}`); }
  }
}
process.exit(code);

#!/usr/bin/env node
// Run the browser suites on GitHub's runners (.github/workflows/browser-tests.yml) for the commit
// checked out here, and bring the results back: pass/fail per suite, the logs and the pictures.
//
//   node scripts/remote-test.mjs [--suites "flight walk" | --suites all] [--name you] [--lane x] [--out dir]
//   node scripts/remote-test.mjs --suites interact --old <rev>   today's scripts against the app as it was at <rev>
//   node scripts/remote-test.mjs --cancel [--name you] [--lane x]  stop the run in flight on your branch
//
// 1. pushes a commit with the files of HEAD (your branch does not move) to your test branch,
//    claude/test-<name> (claude/test-<name>-<lane> with --lane, for a second small run alongside).
//    The commit's parents are HEAD and the branch's last test commit, so the push is never a force
//    push; and a push to the branch cancels the run still going there (the workflow's concurrency):
//    a new trial supersedes the last one by itself. (The branch is never deleted: the git proxy here
//    refuses branch deletion, and the GitHub API refuses to cancel runs, with HTTP 403.)
// 2. waits for the workflow's run on it, printing each job as it finishes
// 3. downloads every job's artifact into <out>/<job>/ (default out/remote-<sha>), prints a summary
// --suites writes a `Suites:` trailer into the pushed commit: "all", "none", or suite names. Without
// it, a `Suites:` trailer in HEAD's own message counts, else the workflow runs what
// scripts/affected.mjs picks for the change against claude/friendly-hypatia-up418z.
// --old <rev>: the files of <rev> with today's scripts/ and .github/ (and --suites needed): to show that
// a new check fails on the app as it was before the fix it was written for.
// Exit code 0 only when every job that ran passed. Uncommitted changes are NOT tested.
//
// Needs `git push` to origin and api.github.com reachable with a token (in the agents' container
// the proxy adds it; elsewhere set GITHUB_TOKEN). Uses curl for HTTP.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// (not a browser suite: keep out of the machine-wide count, `pgrep -fc '^node (scripts|trailer)/...'`)
process.title = 'remote-test';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
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

const lane = opt('--lane', '').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
const branch = `claude/test-${name}${lane ? `-${lane}` : ''}`;
// the branch's last test commit (fetched, to be a parent of the next one), or null
const tipOf = () => {
  const line = git('ls-remote', 'origin', `refs/heads/${branch}`);
  if (!line) return null;
  git('fetch', '--quiet', '--no-tags', 'origin', `refs/heads/${branch}`);
  return line.split(/\s/)[0];
};
const commit = (tree, parents, msg) => execFileSync('git', ['commit-tree', tree, ...parents.flatMap((p) => ['-p', p]), '-F', '-'], { input: msg, encoding: 'utf8' }).trim();

if (args.includes('--cancel')) {
  const tip = tipOf();
  if (!tip) { say(`no branch ${branch}`); process.exit(0); }
  const c = commit(`${tip}^{tree}`, [tip], 'Supersede the run on this branch\n\nSuites: none\n');
  git('push', '--quiet', 'origin', `${c}:refs/heads/${branch}`);
  say(`pushed a "Suites: none" commit to ${branch}: the run that was going there is cancelled`);
  process.exit(0);
}

if (git('status', '--porcelain', '--untracked-files=no')) say('note: uncommitted changes are not part of the test (only commits are pushed)');
const head = git('rev-parse', 'HEAD');
const old = opt('--old', null);
if (old && !suitesArg) throw new Error('--old needs --suites');
// (the title names the change under test too, for the progress page, public/progress/: "Remote test of 1a2b3c4d: <its subject>")
const subject = git('log', '-1', '--format=%s', head);
let tree = `${head}^{tree}`, base = head, title = `Remote test of ${head.slice(0, 8)}: ${subject}`;
if (old) {
  // a tree: <old> with scripts/ and .github/ as they are at HEAD
  const idx = path.join(fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'remote-test-')), 'index');
  const env = { ...process.env, GIT_INDEX_FILE: idx };
  const g = (...a) => execFileSync('git', a, { encoding: 'utf8', env }).trim();
  g('read-tree', old);
  g('rm', '-r', '-q', '-f', '--cached', '--ignore-unmatch', 'scripts', '.github'); // (the index only)
  g('read-tree', '--prefix=scripts/', 'HEAD:scripts');
  g('read-tree', '--prefix=.github/', 'HEAD:.github');
  tree = g('write-tree');
  fs.rmSync(path.dirname(idx), { recursive: true });
  base = git('rev-parse', old);
  title = `Remote test: today's checks (${head.slice(0, 8)}) against the app at ${base.slice(0, 8)}: ${subject}`;
}
const trailer = suitesArg ?? /^Suites:[ \t]*(.*)$/im.exec(git('log', '-1', '--format=%B', head))?.[1] ?? null;
const tip = tipOf();
const sha = commit(tree, tip ? [base, tip] : [base], `${title}\n${trailer ? `\nSuites: ${trailer}\n` : ''}`);
const out = path.resolve(opt('--out', path.join('out', `remote-${sha.slice(0, 8)}`)));
say(`pushing ${sha.slice(0, 8)} (${trailer ? `Suites: ${trailer}` : 'the affected suites'}) to ${branch}${tip ? ': a run still going there is cancelled' : ''}`);
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
  if (run.conclusion === 'cancelled') console.log('the run was cancelled: a newer push to the branch superseded it');
  for (const r of rows.sort((p, q) => p.suite.localeCompare(q.suite))) {
    console.log(`${r.conclusion === 'success' ? 'ok  ' : 'FAIL'} ${r.suite.padEnd(9)} ${String(r.pass).padStart(3)} passed, ${r.fail.length} failed   ${r.last.slice(0, 110)}`);
    for (const f of r.fail) console.log(`       ${f.slice(0, 160)}`);
  }
  if (!rows.length) console.log('no suites ran (the change touches nothing a browser suite sees; --suites all runs every one)');
  for (const j of bad.filter((j) => ['plan', 'build'].includes(j.name))) console.log(`FAIL ${j.name}: ${j.html_url}`);
  code = bad.length ? 1 : 0;
} finally {
  say(`branch ${branch} kept for your next run (each push to it cancels the run before)`);
}
process.exit(code);

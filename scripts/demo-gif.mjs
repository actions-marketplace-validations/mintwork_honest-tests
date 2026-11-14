#!/usr/bin/env node
/**
 * Renders docs/demo.gif from the real CLI output.
 *
 *   npm run demo:gif        (builds dist/ first)
 *
 * 1. Runs `audit` and `mutate` on fixtures/bad-project through the CLI's own `run()`, with colors
 *    and progress on, and records stdout plus every progress update.
 * 2. Replays that output in a styled terminal page (typing, line reveal, scrolling) and captures
 *    deterministic frames with Playwright + Google Chrome (`channel: 'chrome'`).
 * 3. Builds the GIF with ffmpeg palettegen/paletteuse.
 *
 * Env: FFMPEG (default /opt/homebrew/bin/ffmpeg, then `ffmpeg` on PATH), DEMO_FPS (default 15),
 * DEMO_OUT (default docs/demo.gif), DEMO_KEEP_FRAMES=1 to keep the PNG frames.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'fixtures', 'bad-project');
const OUT = resolve(ROOT, process.env.DEMO_OUT ?? 'docs/demo.gif');
const FPS = Number(process.env.DEMO_FPS ?? 15);
const WIDTH = 1200;
const HEIGHT = 760;
const FFMPEG = process.env.FFMPEG ?? (existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg');

const AUDIT_CMD = 'npx @mintwork/honest-tests audit .';
const MUTATE_TARGET = 'src/pricing.ts';
const MUTATE_CMD = `npx @mintwork/honest-tests mutate ${MUTATE_TARGET}`;

// ---------------------------------------------------------------------------------------------
// 1. Real CLI output

process.env.FORCE_COLOR = '1'; // must be set before the reporters are imported
delete process.env.NO_COLOR;
if (!existsSync(join(ROOT, 'dist', 'run.js'))) {
  console.error('dist/ is missing — run `npm run build` first (npm run demo:gif does this).');
  process.exit(2);
}
const { run } = await import(join(ROOT, 'dist', 'run.js'));

async function capture(argv) {
  let stdout = '';
  const progress = [];
  const code = await run(argv, {
    stdout: (s) => (stdout += s),
    stderr: (s) => {
      // Progress updates are `\r<line>   `; the final `\r\x1b[2K` clears the line.
      const line = s.replace(/^\r/, '').replace(/\x1b\[2K/g, '').trimEnd();
      if (line) progress.push(line);
    },
    cwd: FIXTURE,
    progress: true,
  });
  return { code, stdout, progress };
}

console.log('Running audit…');
const audit = await capture(['audit', '.']);
console.log('Running mutate (takes a few seconds)…');
const mutation = await capture(['mutate', MUTATE_TARGET]);
if (mutation.code === 2) {
  console.error('mutate failed:\n' + mutation.stdout);
  process.exit(2);
}

// ---------------------------------------------------------------------------------------------
// 2. ANSI -> HTML

const FG = { 31: 'red', 32: 'green', 33: 'yellow', 34: 'blue', 35: 'magenta', 36: 'cyan', 90: 'gray' };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function ansiToHtml(line) {
  let bold = false;
  let dim = false;
  let fg = null;
  let html = '';
  for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
    const m = /^\x1b\[([0-9;]*)m$/.exec(part);
    if (m) {
      for (const code of (m[1] || '0').split(';').map(Number)) {
        if (code === 0) [bold, dim, fg] = [false, false, null];
        else if (code === 1) bold = true;
        else if (code === 2) dim = true;
        else if (code === 22) [bold, dim] = [false, false];
        else if (code === 39) fg = null;
        else if (FG[code]) fg = FG[code];
      }
      continue;
    }
    if (!part) continue;
    const cls = [fg, bold && 'b', dim && 'd'].filter(Boolean).join(' ');
    html += cls ? `<span class="${cls}">${esc(part)}</span>` : esc(part);
  }
  return html || ' ';
}

const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const toLines = (s) => s.replace(/\n+$/, '').split('\n');

// ---------------------------------------------------------------------------------------------
// 3. Timeline (ms)

const PROMPT = '<span class="cyan b">bad-project</span> <span class="magenta">❯</span> ';
const segments = [];
let t = 600;

function typeCommand(text, charMs = 45) {
  segments.push({ kind: 'prompt', at: t, html: PROMPT });
  t += 500;
  segments.push({ kind: 'type', at: t, text, charMs });
  t += text.length * charMs + 450; // a beat before "Enter"
}

function output(lines, { lineMs, highlight, hold, pauseAfter }) {
  const html = lines.map((l) => {
    const h = ansiToHtml(l);
    // Finding lines (`  16:5    error   message…`) wrap under the message, like the CLI's layout intends.
    return /^\s+\d+:\d+\s/.test(plain(l)) ? { cls: 'hang', html: h } : { cls: '', html: h };
  });
  const times = [];
  let at = t;
  for (const l of lines) {
    times.push(at);
    at += lineMs + (pauseAfter && pauseAfter.test(plain(l)) ? 900 : 0);
  }
  const hl = highlight ? lines.findIndex((l) => highlight.test(plain(l))) : -1;
  segments.push({ kind: 'out', at: t, lines: html, times, hl, hlAt: at + 250 });
  t = at + hold;
}

// Scene 1: audit
typeCommand(AUDIT_CMD);
output(toLines(audit.stdout), { lineMs: 45, highlight: /tests can't fail/, hold: 3600 });
segments.push({ kind: 'clear', at: t }); // Ctrl-L
t += 250;

// Scene 2: mutate — progress (sped up), then the report
typeCommand(MUTATE_CMD);
const stepMs = 95;
segments.push({ kind: 'progress', at: t, frames: mutation.progress.map(ansiToHtml), stepMs });
t += mutation.progress.length * stepMs + 150;
output(toLines(mutation.stdout), { lineMs: 55, highlight: /Mutation score/, hold: 4800, pauseAfter: /mutants? survived/ });
const DURATION = t;

// ---------------------------------------------------------------------------------------------
// 4. Page

const page = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: #1b1f27; }
  .win { position: absolute; inset: 18px; border-radius: 12px; background: #0d1117; overflow: hidden;
         box-shadow: 0 0 0 1px #30363d; display: flex; flex-direction: column; }
  .bar { height: 38px; flex: none; display: flex; align-items: center; padding: 0 16px; background: #161b22;
         border-bottom: 1px solid #262c36; position: relative; }
  .dot { width: 12px; height: 12px; border-radius: 50%; margin-right: 8px; }
  .title { position: absolute; left: 0; right: 0; text-align: center; color: #8b949e;
           font: 500 13px -apple-system, "Helvetica Neue", sans-serif; }
  .tag { position: absolute; right: 16px; color: #d29922; font: 600 12px -apple-system, sans-serif; opacity: 0; }
  .tag.on { opacity: 1; }
  .term { flex: 1; overflow: hidden; padding: 14px 20px 18px; }
  .lines { font: 14px/20px Menlo, "SF Mono", monospace; color: #c9d1d9; white-space: pre-wrap; overflow-wrap: anywhere;
           -webkit-font-smoothing: antialiased; }
  .line { min-height: 20px; }
  .hang { padding-left: 18ch; text-indent: -18ch; }
  .hl { background: #3a2a12; box-shadow: -6px 0 0 #3a2a12, 6px 0 0 #3a2a12; border-radius: 3px; }
  .red { color: #ff7b72; } .green { color: #3fb950; } .yellow { color: #e3b341; } .blue { color: #58a6ff; }
  .magenta { color: #d2a8ff; } .cyan { color: #56d4dd; } .gray { color: #6e7681; }
  .b { font-weight: bold; } .d { opacity: .62; }
  .cursor { display: inline-block; width: 8px; height: 17px; background: #c9d1d9; vertical-align: -3px; }
</style></head><body>
  <div class="win">
    <div class="bar">
      <span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span>
      <div class="title">honest-tests — fixtures/bad-project</div>
      <div class="tag" id="tag">▶▶ sped up</div>
    </div>
    <div class="term" id="term"><div class="lines" id="lines"></div></div>
  </div>
<script>
  const SEGMENTS = ${JSON.stringify(segments)};
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  window.render = (t) => {
    const lines = [];
    let cursorLine = -1, typing = false, sped = false;
    for (const s of SEGMENTS) {
      if (s.at > t) break;
      if (s.kind === 'prompt') { lines.push({ cls: '', html: s.html }); cursorLine = lines.length - 1; }
      else if (s.kind === 'type') {
        const n = Math.min(s.text.length, Math.floor((t - s.at) / s.charMs));
        typing = n < s.text.length;
        lines[lines.length - 1].html += esc(s.text.slice(0, n));
      } else if (s.kind === 'out') {
        cursorLine = -1;
        for (let i = 0; i < s.lines.length && s.times[i] <= t; i++) {
          const { cls, html } = s.lines[i];
          const body = t >= s.hlAt && i === s.hl ? html.replace(/^(\s*)(.*)$/s, '$1<span class="hl">$2</span>') : html;
          lines.push({ cls, html: body });
        }
      } else if (s.kind === 'clear') {
        lines.length = 0;
        cursorLine = -1;
      } else if (s.kind === 'progress') {
        cursorLine = -1;
        const k = Math.floor((t - s.at) / s.stepMs);
        if (k < s.frames.length) { lines.push({ cls: '', html: s.frames[k] }); sped = true; }
      }
    }
    if (cursorLine >= 0 && cursorLine === lines.length - 1 && (typing || Math.floor(t / 530) % 2 === 0)) lines[cursorLine].html += '<span class="cursor"></span>';
    document.getElementById('lines').innerHTML = lines.map((l) => '<div class="line ' + l.cls + '">' + l.html + '</div>').join('');
    document.getElementById('tag').className = sped ? 'tag on' : 'tag';
    const term = document.getElementById('term');
    term.scrollTop = term.scrollHeight;
  };
</script></body></html>`;

// ---------------------------------------------------------------------------------------------
// 5. Frames + GIF

const { chromium } = await import('playwright-core');
const work = mkdtempSync(join(tmpdir(), 'honest-tests-demo-'));
const framesDir = join(work, 'frames');
mkdirSync(framesDir);
writeFileSync(join(work, 'demo.html'), page);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const p = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  await p.goto('file://' + join(work, 'demo.html'));
  await p.evaluate(() => document.fonts.ready);
  const total = Math.ceil((DURATION / 1000) * FPS);
  console.log(`Capturing ${total} frames (${(DURATION / 1000).toFixed(1)}s @ ${FPS}fps)…`);
  for (let i = 0; i < total; i++) {
    await p.evaluate((ms) => window.render(ms), (i * 1000) / FPS);
    await p.screenshot({ path: join(framesDir, `${String(i).padStart(5, '0')}.png`) });
  }
} finally {
  await browser.close();
}

mkdirSync(dirname(OUT), { recursive: true });
const ff = spawnSync(
  FFMPEG,
  [
    '-y', '-loglevel', 'error',
    '-framerate', String(FPS),
    '-i', join(framesDir, '%05d.png'),
    '-vf', 'split[a][b];[a]palettegen=max_colors=96:stats_mode=full:reserve_transparent=0[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
    '-loop', '0',
    OUT,
  ],
  { stdio: 'inherit' },
);
if (ff.status !== 0) {
  console.error(`ffmpeg failed (${FFMPEG}). Frames kept in ${framesDir}`);
  process.exit(2);
}
if (process.env.DEMO_KEEP_FRAMES) console.log(`Frames: ${framesDir}`);
else rmSync(work, { recursive: true, force: true });

const size = statSync(OUT).size;
console.log(`Wrote ${OUT.replace(ROOT + '/', '')} — ${WIDTH}x${HEIGHT}, ${(DURATION / 1000).toFixed(1)}s, ${(size / 1024 / 1024).toFixed(2)} MB`);
if (size > 5 * 1024 * 1024) console.warn('Warning: GIF is over 5 MB — lower DEMO_FPS or shorten the holds.');

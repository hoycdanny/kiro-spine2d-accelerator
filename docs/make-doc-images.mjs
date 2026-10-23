#!/usr/bin/env node
/**
 * Regenerate every file in `docs/images/` from a real demo run.
 *
 *   npm run build && npm run docs:images
 *
 * The images on the README are screenshots of this project's own output, so
 * they have to be reproducible or they become folklore. This script is the
 * only thing that writes `docs/images/`: it runs `demo/run-demo.js`, drives
 * the server over stdio for the two pictures the demo does not produce, and
 * hands the raw frames to `docs/compose-doc-images.py` for labelling.
 *
 * Nothing it touches comes from outside the repository. Every pixel starts
 * either in the procedurally drawn sample PSD (`demo/make-sample-psd.py`) or
 * in a frame rendered from it. Spine's own example artwork is never read.
 *
 * Needs what the demo needs, plus Pillow: `uv` and the Python sidecar for
 * the PSD, `playwright-core` with a Chromium build for the rendered frames
 * and the browser screenshot. It fails loudly rather than writing a partial
 * set, because a half-regenerated folder is worse than none.
 *
 * Flags:
 *   --skip-demo   reuse the existing demo/out/ instead of re-running the demo
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SERVER = join(REPO, 'dist', 'server.js');
const WORKSPACE = join(REPO, 'demo', 'out');
/** Raw frames land here: inside demo/out, which is git-ignored. */
const SCRATCH = join(WORKSPACE, 'doc-frames');
const IMAGES = join(REPO, 'docs', 'images');

/** Interactive preview screenshot size. Wide enough for the control strip. */
const PREVIEW_VIEWPORT = { width: 720, height: 760 };
/** Where the preview's timeline is parked, as a fraction of the duration. */
const PREVIEW_SCRUB = 0.5;

/** Frames per GIF. 20 over a 1.00 s animation is one frame every 50 ms. */
const GIF_FRAME_COUNT = 20;
/** Frame delay, matching the sample spacing so playback runs at real speed. */
const GIF_FRAME_MS = 50;
/** Square render size per GIF frame, as for the still strips. */
const GIF_CANVAS = 240;
/** Size ceiling per GIF: 600 KB. A README should not cost a megabyte. */
const GIF_MAX_BYTES = 614_400;
/**
 * Render the GIF frames straight onto the colour they will sit on.
 *
 * This is `IMAGE_BG` in `docs/compose-doc-images.py`, the card fill. An
 * antialiased outline rendered over transparency and then composited onto
 * the card keeps a trace of the transparent black it was blended with,
 * which shows up as a dark fringe once the frame is quantised to 256
 * colours. Rendering onto the final colour has nothing to fringe against.
 */
const STAGE_BACKGROUND = [252 / 255, 252 / 255, 253 / 255, 1];

/**
 * `count` sample times spread across `duration`, excluding the endpoint.
 *
 * t = duration is the same pose as t = 0 in a clean loop, so sampling it
 * would put a duplicate frame in the GIF and stall the motion for one
 * frame on every cycle.
 */
function evenTimes(duration, count) {
  return Array.from({ length: count }, (_, index) => (index * duration) / count);
}

function log(message) {
  console.log(`[docs:images] ${message}`);
}

function fail(message) {
  console.error(`[docs:images] ${message}`);
  process.exit(1);
}

function run(command, args, label) {
  const outcome = spawnSync(command, args, {
    cwd: REPO,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (outcome.status !== 0) {
    fail(`${label} failed (exit ${outcome.status ?? 'signal'}).`);
  }
}

/** Compose one labelled image with the Python side. */
function compose(args) {
  run(
    'uv',
    ['run', '--project', join(REPO, 'python'), 'python', join(HERE, 'compose-doc-images.py'), ...args],
    'compose-doc-images.py',
  );
}

/** Call a tool and stop the whole script if it refuses. */
async function callTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const summary = (result.content ?? [])[0]?.text ?? '(no output)';
  if (result.isError) fail(`${name} refused:\n${summary}`);
  log(`${name}: ${summary.split('\n')[0]}`);
  return result;
}

/** The PNGs render_preview wrote, in frame order. */
function framesIn(directory) {
  return readdirSync(directory)
    .filter((file) => file.endsWith('.png'))
    .sort()
    .map((file) => join(directory, file));
}

/**
 * Render three moments of a template-generated walk, plus the two GIF sets.
 *
 * Done over stdio rather than by importing `dist/` so the frames come from
 * the same path an MCP client takes, which is what the README claims about
 * them. One session for all four renders: a second one would start another
 * server process and another Chromium for no gain.
 */
async function generatedWalkFrames() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: { ...process.env, SPINE_WORKSPACE_ROOT: WORKSPACE },
  });
  const client = new Client({ name: 'spine-doc-images', version: '1.0.0' });
  await client.connect(transport);

  try {
    await callTool(client, 'skeleton_animate', {
      skeleton: 'generated/hero.json',
      atlas: 'generated/hero.atlas',
      animations: [{ template: 'idle' }, { template: 'wave' }, { template: 'walk' }],
      outPath: 'doc-frames/hero-generated.json',
      overwriteFile: true,
    });

    await callTool(client, 'render_preview', {
      skeleton: 'doc-frames/hero-generated.json',
      atlas: 'generated/hero.atlas',
      imageDir: 'generated',
      animation: 'walk',
      outputDir: 'doc-frames/walk',
      width: 240,
      height: 240,
      times: [0, 0.25, 0.5],
    });

    // The same `walk`, sampled densely enough to animate.
    await callTool(client, 'render_preview', {
      skeleton: 'doc-frames/hero-generated.json',
      atlas: 'generated/hero.atlas',
      imageDir: 'generated',
      animation: 'walk',
      outputDir: 'doc-frames/walk-gif',
      width: GIF_CANVAS,
      height: GIF_CANVAS,
      background: STAGE_BACKGROUND,
      times: evenTimes(1, GIF_FRAME_COUNT),
    });

    // The demo's own hand-written 1.00 s `wave`, which loops cleanly.
    await callTool(client, 'render_preview', {
      skeleton: 'generated/hero-animated.json',
      atlas: 'generated/hero.atlas',
      imageDir: 'generated',
      animation: 'wave',
      outputDir: 'doc-frames/wave-gif',
      width: GIF_CANVAS,
      height: GIF_CANVAS,
      background: STAGE_BACKGROUND,
      times: evenTimes(1, GIF_FRAME_COUNT),
    });
  } finally {
    await client.close();
  }

  const frames = framesIn(join(SCRATCH, 'walk'));
  if (frames.length !== 3) fail(`expected 3 walk frames, found ${frames.length}.`);

  for (const directory of ['walk-gif', 'wave-gif']) {
    const found = framesIn(join(SCRATCH, directory)).length;
    if (found !== GIF_FRAME_COUNT) {
      fail(`expected ${GIF_FRAME_COUNT} ${directory} frames, found ${found}.`);
    }
  }

  return {
    walk: frames,
    walkGif: join(SCRATCH, 'walk-gif'),
    waveGif: join(SCRATCH, 'wave-gif'),
  };
}

/**
 * Screenshot the self-contained HTML preview with its control strip.
 *
 * Paused and scrubbed to the middle of the animation, because the point of
 * the picture is that the strip works, and a screenshot of a page mid-play
 * says nothing about whether the scrub does.
 */
async function screenshotInteractivePreview(outPath) {
  const page = join(WORKSPACE, 'preview', 'hero.html');
  if (!existsSync(page)) fail(`${page} is missing; run the demo first.`);

  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    fail('playwright-core is not installed. Install it with: npm install playwright-core@1.62.0');
  }

  // The same two arguments src/preview-renderer.ts launches with, and for
  // the same reason: no --use-gl override, because forcing swiftshader
  // breaks the spine-ts two-colour tint shader.
  const browser = await chromium.launch({
    headless: true,
    args: ['--hide-scrollbars', '--mute-audio'],
  });

  try {
    const tab = await browser.newPage({ viewport: PREVIEW_VIEWPORT });
    await tab.goto(pathToFileURL(page).href);
    await tab.waitForFunction('window.__spineViewerReady === true', null, { timeout: 60_000 });

    const error = await tab.evaluate('window.__spineViewerError ?? null');
    if (error) fail(`the preview page reported a failure: ${error}`);

    // Pause, then park the timeline, through the controls themselves.
    await tab.click('#play-toggle');
    await tab.evaluate(
      `(() => {
         const timeline = document.getElementById('timeline');
         timeline.value = '${PREVIEW_SCRUB}';
         timeline.dispatchEvent(new Event('input', { bubbles: true }));
       })()`,
    );
    await tab.waitForTimeout(250);

    await tab.screenshot({ path: outPath, fullPage: true });
  } finally {
    await browser.close();
  }

  log(`interactive preview screenshot: ${outPath}`);
}

async function main() {
  if (!existsSync(SERVER)) fail('dist/server.js is missing. Run: npm run build');

  if (process.argv.includes('--skip-demo')) {
    log('reusing the existing demo/out/');
  } else {
    log('running the demo to produce the source artefacts');
    run(process.execPath, [join(REPO, 'demo', 'run-demo.js')], 'demo/run-demo.js');
  }

  for (const required of [
    join(WORKSPACE, 'hero.psd'),
    join(WORKSPACE, 'generated', 'hero.json'),
    join(WORKSPACE, 'generated', 'hero-animated.json'),
    join(WORKSPACE, 'generated', 'images'),
    join(WORKSPACE, 'preview', 'wave-02-0_500s.png'),
    join(WORKSPACE, 'baseline', 'wave', 'wave-02-0_500s.png'),
    join(WORKSPACE, 'regression-diff', 'wave-02-0_500s.png'),
    join(WORKSPACE, 'preview', 'hero.html'),
  ]) {
    if (!existsSync(required)) {
      fail(
        `${required} is missing. The demo must complete its PSD and visual steps: ` +
          'install uv (`uv sync --project python`) and Chromium (`npx playwright-core install chromium`).',
      );
    }
  }

  mkdirSync(SCRATCH, { recursive: true });
  mkdirSync(IMAGES, { recursive: true });

  const { walk: walkFrames, walkGif, waveGif } = await generatedWalkFrames();
  await screenshotInteractivePreview(join(IMAGES, 'interactive-preview.png'));

  // 1. The payoff: layered artwork on the left, the rig rendered on the right.
  const psdFlat = join(SCRATCH, 'hero-psd-flat.png');
  compose(['psd-flat', '--psd', join(WORKSPACE, 'hero.psd'), '--out', psdFlat, '--height', '320']);
  compose([
    'strip',
    '--out',
    join(IMAGES, 'psd-to-rig.png'),
    '--height',
    '300',
    '--trim',
    '--panel',
    psdFlat,
    'hero.psd - 17 layers',
    '--panel',
    join(WORKSPACE, 'preview', 'wave-02-0_500s.png'),
    'rendered from the generated rig',
  ]);

  // 2. The gate that catches what the data cannot show.
  compose([
    'strip',
    '--out',
    join(IMAGES, 'visual-regression-diff.png'),
    '--height',
    '240',
    '--panel',
    join(WORKSPACE, 'baseline', 'wave', 'wave-02-0_500s.png'),
    'baseline',
    '--panel',
    join(WORKSPACE, 'regression-diff', 'wave-02-0_500s.png'),
    'diff after a 3 px atlas shift',
  ]);

  // 3. The folder that makes File -> Import Data resolve.
  compose([
    'grid',
    '--out',
    join(IMAGES, 'attachment-images.png'),
    '--dir',
    join(WORKSPACE, 'generated', 'images'),
  ]);

  // 4. Three moments of a template-generated walk.
  compose([
    'strip',
    '--out',
    join(IMAGES, 'generated-walk.png'),
    '--height',
    '240',
    '--panel',
    walkFrames[0],
    'walk  t = 0.00 s',
    '--panel',
    walkFrames[1],
    'walk  t = 0.25 s',
    '--panel',
    walkFrames[2],
    'walk  t = 0.50 s',
  ]);

  // 5. The same two animations moving. The strips above stay as the static
  //    fallback for any reader whose client does not play a GIF.
  compose([
    'animate',
    '--out',
    join(IMAGES, 'generated-walk.gif'),
    '--dir',
    walkGif,
    '--height',
    String(GIF_CANVAS),
    '--label',
    `walk  1.00 s loop, ${GIF_FRAME_COUNT} frames`,
    '--duration-ms',
    String(GIF_FRAME_MS),
    '--max-bytes',
    String(GIF_MAX_BYTES),
  ]);

  compose([
    'animate',
    '--out',
    join(IMAGES, 'hero-wave.gif'),
    '--dir',
    waveGif,
    '--height',
    String(GIF_CANVAS),
    '--label',
    `wave  1.00 s, ${GIF_FRAME_COUNT} frames`,
    '--duration-ms',
    String(GIF_FRAME_MS),
    '--max-bytes',
    String(GIF_MAX_BYTES),
  ]);

  log(`done. ${readdirSync(IMAGES).sort().join(', ')}`);
}

main().catch((cause) => fail(cause && cause.stack ? cause.stack : String(cause)));

#!/usr/bin/env node
/**
 * A two-minute, client-facing demo.
 *
 * It drives the real MCP server over stdio — the same transport an AI client
 * uses — and narrates each step, so the story holds up whether you run it on
 * a projector or read the transcript afterwards.
 *
 * The story:
 *   1. What can this machine actually do?   licensing, answered honestly
 *   2. Artwork in, rig out                  PSD -> skeleton + atlas + page
 *   3. Is the data correct?                 inspect + lint, with the atlas
 *                                           cross-check that catches the
 *                                           "renders nothing" case
 *   4. An animator adds a movement          skeleton_diff says what changed
 *   5. Does it render?                      headless PNG frames
 *   6. Prove it has not changed             baseline, then a passing gate
 *   7. Break it on purpose                  a repack is caught, with a diff
 *   8. What does the engine need?           Unity scaffold + mix table
 *   9. What needs a license?                refusal with the exact command
 *
 * Degrades rather than failing: without the Python sidecar it synthesises a
 * small rig instead of reading a PSD, and without Chromium it skips the
 * three visual steps and says so.
 */

const { spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const REPO = resolve(__dirname, '..');
const WORKSPACE = join(__dirname, 'out');
const SERVER = join(REPO, 'dist', 'server.js');

const COLOUR = process.stdout.isTTY && !process.env.NO_COLOR;
const dim = (text) => (COLOUR ? `\u001b[2m${text}\u001b[0m` : text);
const bold = (text) => (COLOUR ? `\u001b[1m${text}\u001b[0m` : text);
const green = (text) => (COLOUR ? `\u001b[32m${text}\u001b[0m` : text);
const red = (text) => (COLOUR ? `\u001b[31m${text}\u001b[0m` : text);
const cyan = (text) => (COLOUR ? `\u001b[36m${text}\u001b[0m` : text);
const rule = '─'.repeat(74);

const failures = [];
let stepNumber = 0;

function heading(title, why) {
  stepNumber += 1;
  console.log(`\n${bold(rule)}`);
  console.log(bold(`${stepNumber}. ${title}`));
  console.log(dim(`   ${why}`));
  console.log(bold(rule));
}

function note(text) {
  console.log(dim(`   ${text}`));
}

function summaryOf(result) {
  const blocks = result.content ?? [];
  return blocks.length > 0 ? blocks[0].text : '(no output)';
}

/**
 * Call a tool and check the outcome against what the step expects.
 * `expect` is 'ok', 'refused', or 'either'.
 */
async function step(client, name, args, expect = 'ok') {
  const started = Date.now();
  console.log(cyan(`   → ${name}(${Object.keys(args).join(', ')})`));

  const result = await client.callTool({ name, arguments: args });
  const refused = Boolean(result.isError);
  const asExpected =
    expect === 'either' ? true : expect === 'refused' ? refused : !refused;

  console.log(
    `   ${asExpected ? green('✓') : red('✗')} ${refused ? red('refused') : green('ok')}`,
  );
  console.log(
    summaryOf(result)
      .split('\n')
      .map((line) => `     ${line}`)
      .join('\n'),
  );
  console.log(dim(`     [${((Date.now() - started) / 1000).toFixed(1)}s]`));

  if (!asExpected) failures.push(`${name} (expected ${expect})`);
  return { refused, result, asExpected };
}

function sidecarAvailable() {
  return spawnSync('uv', ['--version'], { encoding: 'utf8', shell: false }).status === 0;
}

function buildSamplePsd() {
  const target = join(WORKSPACE, 'hero.psd');
  const run = spawnSync(
    'uv',
    [
      'run',
      '--project',
      join(REPO, 'python'),
      'python',
      join(__dirname, 'make-sample-psd.py'),
      target,
    ],
    { encoding: 'utf8', shell: false },
  );

  if (run.status !== 0) {
    note(
      `Could not build the sample PSD: ${(run.stderr || run.stdout || '').trim().split('\n').pop()}`,
    );
    return null;
  }
  note((run.stdout || '').trim());
  return target;
}

/**
 * Synthesise a small rig without Python, so the rest of the demo still runs.
 * Uses the project's own PNG encoder, which keeps binary assets out of git.
 */
function synthesiseRig() {
  const { encodePng, solidImage } = require(join(REPO, 'dist', 'png.js'));
  const dir = join(WORKSPACE, 'generated');
  mkdirSync(dir, { recursive: true });

  const skeleton = {
    skeleton: {
      hash: 'demofallback',
      spine: '4.2.37',
      x: -30,
      y: 0,
      width: 60,
      height: 150,
      fps: 30,
      images: './images/',
    },
    bones: [
      { name: 'root' },
      { name: 'hip', parent: 'root', y: 60 },
      { name: 'torso', parent: 'hip', length: 90 },
      { name: 'head', parent: 'torso', y: 90 },
    ],
    slots: [
      { name: 'torso', bone: 'torso', attachment: 'torso' },
      { name: 'head', bone: 'head', attachment: 'head' },
    ],
    skins: [
      {
        name: 'default',
        attachments: {
          torso: { torso: { x: 0, y: 45, width: 60, height: 90 } },
          head: { head: { x: 0, y: 28, width: 56, height: 56 } },
        },
      },
    ],
    animations: { setup: {} },
  };

  const atlas = [
    'hero.png',
    'size: 128, 128',
    'format: RGBA8888',
    'filter: Linear, Linear',
    'repeat: none',
    'pma: false',
    'head',
    'bounds: 2, 2, 56, 56',
    'torso',
    'bounds: 60, 2, 60, 90',
    '',
  ].join('\n');

  const page = solidImage(128, 128, [0, 0, 0, 0]);
  const paint = (x0, y0, width, height, rgba) => {
    for (let y = y0; y < y0 + height; y += 1) {
      for (let x = x0; x < x0 + width; x += 1) {
        const index = (y * 128 + x) * 4;
        page.data[index] = rgba[0];
        page.data[index + 1] = rgba[1];
        page.data[index + 2] = rgba[2];
        page.data[index + 3] = rgba[3];
      }
    }
  };
  paint(2, 2, 56, 56, [238, 206, 166, 255]);
  paint(60, 2, 60, 90, [205, 72, 72, 255]);

  writeFileSync(join(dir, 'hero.json'), `${JSON.stringify(skeleton, null, 2)}\n`, 'utf8');
  writeFileSync(join(dir, 'hero.atlas'), atlas, 'utf8');
  writeFileSync(join(dir, 'hero.png'), encodePng(page));

  note('Built a small rig directly, without the PSD step.');
  return { skeleton: 'generated/hero.json', atlas: 'generated/hero.atlas' };
}

/**
 * Stand in for the work an animator does in the Spine editor: add a one
 * second movement to whichever limb bones the rig actually has.
 *
 * Written as a separate file so the next step can diff the two versions,
 * which is exactly what a reviewer wants to see after an artist hands work
 * back.
 */
function addAnimation(relativeSkeletonPath) {
  const source = join(WORKSPACE, relativeSkeletonPath);
  const data = JSON.parse(readFileSync(source, 'utf8'));
  const bones = new Set(data.bones.map((bone) => bone.name));

  const timelines = {};
  const swing = (amplitude) => [
    { time: 0, value: 0 },
    { time: 0.5, value: amplitude },
    { time: 1, value: 0 },
  ];

  if (bones.has('arm_left')) timelines['arm_left'] = { rotate: swing(26) };
  if (bones.has('arm_right')) timelines['arm_right'] = { rotate: swing(-26) };
  if (bones.has('head')) timelines['head'] = { rotate: swing(10) };
  if (Object.keys(timelines).length === 0) {
    timelines[data.bones[data.bones.length - 1].name] = { rotate: swing(15) };
  }

  // A second, longer animation so the runtime scaffold has a pair to suggest
  // a mix duration for — which is the interesting half of that output.
  const idleBone = bones.has('head')
    ? 'head'
    : data.bones[data.bones.length - 1].name;
  const idle = {
    bones: {
      [idleBone]: {
        rotate: [
          { time: 0, value: 0 },
          { time: 1.5, value: 4 },
          { time: 3, value: 0 },
        ],
      },
    },
  };

  data.animations = { ...data.animations, wave: { bones: timelines }, idle };

  const target = relativeSkeletonPath.replace(/\.json$/, '-animated.json');
  writeFileSync(join(WORKSPACE, target), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  note(
    `Added a 1s "wave" on ${Object.keys(timelines).join(', ')} and a 3s "idle" on ${idleBone}.`,
  );
  return target.split('\\').join('/');
}

async function main() {
  console.log(bold('\nSpine 2D Accelerator — demo'));
  console.log(dim('Driving the real MCP server over stdio, as an AI client would.'));

  if (!existsSync(SERVER)) {
    console.error(red('dist/server.js is missing. Run: npm run build'));
    return 1;
  }

  // A clean workspace each run, so the demo is repeatable in front of people.
  rmSync(WORKSPACE, { recursive: true, force: true });
  mkdirSync(WORKSPACE, { recursive: true });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: { ...process.env, SPINE_WORKSPACE_ROOT: WORKSPACE },
  });
  const client = new Client({ name: 'spine-demo', version: '1.0.0' });
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log(dim(`${tools.length} tools exposed by the server.`));

  // ------------------------------------------------------------------
  heading(
    'What can this machine actually do?',
    'Licensing decides which half of the toolset is available. Asking first turns a confusing failure later into an answer now.',
  );
  await step(client, 'spine_env_probe', {});

  // ------------------------------------------------------------------
  heading(
    'Artwork in, rig out',
    'A layered PSD becomes a skeleton, an atlas and a page image without opening the Spine editor — which is why this part works on a trial license.',
  );

  let assets = null;
  if (sidecarAvailable()) {
    const psd = buildSamplePsd();
    if (psd) {
      const generated = await step(client, 'psd_to_skeleton', {
        psd,
        outDir: 'generated',
        name: 'hero',
      });
      if (!generated.refused) {
        assets = { skeleton: 'generated/hero.json', atlas: 'generated/hero.atlas' };
      }
    }
  } else {
    note('uv is not installed, so the PSD step is unavailable.');
  }

  if (!assets) assets = synthesiseRig();

  // ------------------------------------------------------------------
  heading(
    'Is the data correct?',
    'The cross-check between the regions the skeleton needs and the regions the atlas provides is the one that matters: a missing region renders as nothing, with no error anywhere.',
  );
  await step(client, 'skeleton_inspect', {
    input: assets.skeleton,
    atlas: assets.atlas,
  });
  await step(client, 'skeleton_lint', { input: assets.skeleton, atlas: assets.atlas });

  // ------------------------------------------------------------------
  heading(
    'An animator adds a movement',
    'This stands in for work done in the Spine editor. The question a reviewer actually has is "what changed?", and a text diff of exported JSON cannot answer it.',
  );
  const animated = addAnimation(assets.skeleton);
  await step(client, 'skeleton_diff', { from: assets.skeleton, to: animated });

  const animatedAssets = { skeleton: animated, atlas: assets.atlas };

  // ------------------------------------------------------------------
  heading(
    'Does it render?',
    'Frames come from the real Spine web runtime in headless Chromium. Per-frame pixel coverage is reported, so "it silently rendered nothing" is detectable.',
  );
  const preview = await step(
    client,
    'render_preview',
    {
      ...animatedAssets,
      animation: 'wave',
      outputDir: 'preview',
      width: 240,
      height: 240,
      times: [0, 0.25, 0.5, 0.75],
    },
    'either',
  );

  const visuals = !preview.refused;
  if (!visuals) {
    note('Chromium is unavailable, so the visual steps are skipped.');
    note('Install it with: npx playwright install chromium');
  }

  if (visuals) {
    // ----------------------------------------------------------------
    heading(
      'Prove it has not changed',
      'A baseline is recorded, then the same inputs are compared against it. This is the gate a pipeline runs on every change.',
    );
    const regressionArgs = {
      ...animatedAssets,
      baselineDir: 'baseline/wave',
      animation: 'wave',
      width: 240,
      height: 240,
      times: [0, 0.25, 0.5, 0.75],
    };
    await step(client, 'visual_regression', { ...regressionArgs, mode: 'update' });
    await step(client, 'visual_regression', regressionArgs);

    // ----------------------------------------------------------------
    heading(
      'Break it on purpose',
      'Re-packing an atlas moves regions by a few pixels. The skeleton data does not change at all, so only a visual check can catch it.',
    );
    const atlasPath = join(WORKSPACE, assets.atlas.split('/').join('\\'));
    const original = readFileSync(atlasPath, 'utf8');
    writeFileSync(
      atlasPath,
      original.replace(
        /bounds: (\d+), (\d+),/,
        (_match, x, y) => `bounds: ${Number(x) + 3}, ${Number(y) + 3},`,
      ),
      'utf8',
    );
    note('Shifted one atlas region by 3 pixels, as a repack would.');

    await step(
      client,
      'visual_regression',
      { ...regressionArgs, diffDir: 'regression-diff' },
      'refused',
    );

    writeFileSync(atlasPath, original, 'utf8');
    note('Atlas restored.');
  }

  // ------------------------------------------------------------------
  heading(
    'What does the engine need?',
    'Each runtime has naming rules that break imports silently — spine-unity cannot load a plain .atlas or .skel. The mix table comes from this skeleton\'s own animations.',
  );
  await step(client, 'runtime_scaffold', {
    target: 'unity',
    skeleton: animated,
    atlas: assets.atlas,
    outputDir: 'integration/unity',
    name: 'Hero',
  });

  // ------------------------------------------------------------------
  heading(
    'What needs a license?',
    'On a trial every write is blocked. The tool names the refused operation and prints the exact command line it would have run, so the work can be repeated verbatim once a license is in place.',
  );
  const refusal = await step(
    client,
    'spine_export',
    { input: animated, exportSpec: 'binary' },
    'either',
  );
  if (!refusal.refused) {
    note('This machine has a licensed Spine, so the export ran rather than being refused.');
  }

  await client.close();

  // ------------------------------------------------------------------
  console.log(`\n${bold(rule)}`);
  console.log(bold('Artifacts to show'));
  console.log(bold(rule));
  console.log(`   ${join(WORKSPACE, 'generated')}`);
  console.log(dim('     skeleton JSON, atlas, packed page image'));
  if (visuals) {
    console.log(`   ${join(WORKSPACE, 'preview')}`);
    console.log(dim('     four rendered frames of the wave animation'));
    console.log(`   ${join(WORKSPACE, 'regression-diff')}`);
    console.log(dim('     the diff image that caught the 3-pixel atlas shift'));
  }
  console.log(`   ${join(WORKSPACE, 'integration', 'unity')}`);
  console.log(dim('     HeroController.cs and a README with the required renames'));

  console.log('');
  if (failures.length === 0) {
    console.log(green('Every step behaved as expected.'));
  } else {
    console.log(red(`Unexpected outcomes: ${failures.join(', ')}`));
  }
  console.log(dim('Open the preview and regression-diff folders to show the images.\n'));

  return failures.length === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(red(`\ndemo failed: ${error && error.message ? error.message : error}`));
    console.error(
      dim('Run `npm run build` first, and `uv sync --project python` for the PSD step.'),
    );
    process.exit(1);
  });

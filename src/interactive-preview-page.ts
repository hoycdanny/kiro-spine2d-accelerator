// ============================================================
// The standalone interactive preview page.
//
// One HTML file that plays a skeleton in any browser: the spine-webgl
// runtime, the skeleton JSON, the atlas text and every atlas page image are
// inlined as data URLs, so nothing is fetched, no server is needed and
// file:// CORS never applies.
//
// Why this is a separate module from `preview-page.ts`: that file's
// RENDER_SCRIPT feeds visual-regression baselines, and any edit to it risks
// moving pixels in every stored baseline. This one is free to change
// because nothing compares its output byte for byte.
//
// Seeking and playback are deliberately different operations:
//  - Seeking re-poses from the setup pose in fixed 1/60 steps, so physics
//    constraints (4.2+) land where a runtime that played from the start
//    would have put them.
//  - Playback advances incrementally by the frame delta, which is what a
//    real render loop does.
// ============================================================

/** Inputs handed to the in-page viewer. */
export interface InteractivePageInput {
  skeletonJson: string;
  atlasText: string;
  /** Atlas page image name to data URL. */
  images: Record<string, string>;
  /** Animation selected on load. Null selects the first one. */
  animation: string | null;
  /** Skin to apply before rendering. */
  skin: string | null;
  /** Must match how the atlas was packed. */
  premultipliedAlpha: boolean;
  /** Skeleton scale applied at load time. */
  scale: number;
  /** Background as [r, g, b, a], each 0..1. Alpha 0 gives transparency. */
  background: [number, number, number, number];
  width: number;
  height: number;
  /** Shown in the title bar and the page heading. */
  title: string;
  /** Whether the debug-bones overlay starts on. */
  showBones: boolean;
}

/** Link the page and its licence note point at. */
export const PURCHASE_URL = 'https://esotericsoftware.com/spine-purchase';

/** The one sentence anyone handed this file has to read. */
export const LICENSE_SENTENCE =
  `This file embeds the Spine Runtimes. Distributing it — to a client, a server or anyone else — requires your own Spine license: ${PURCHASE_URL}`;

/**
 * Serialize a value for embedding inside a `<script>` element.
 *
 * `</script>` anywhere in the payload would end the element early, and the
 * line separators U+2028/U+2029 are valid in JSON but not in a JavaScript
 * string literal. All four escapes stay valid JSON, so `JSON.parse` on the
 * other side is unaffected.
 */
export function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Neutralise `</script` inside raw script text.
 *
 * Everything else reaches the page through `embedJson`; the runtime bundle
 * is the one payload inlined verbatim, and the sequence anywhere inside it
 * — even in a string literal — would end the element early and truncate
 * the page with no error anywhere. The installed 4.2.120 bundle contains
 * none, so this guards future bundles. `<\/script` parses in JavaScript
 * exactly like `</script`.
 */
export function embedScriptSource(source: string): string {
  return source.replace(/<\/script/gi, '<\\/script');
}

/** Escape text destined for HTML body or attribute content. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The in-page viewer, as source text.
 *
 * Kept as a string — like RENDER_SCRIPT — because this package compiles
 * with `lib: ES2022` and no DOM types, so browser code cannot be written as
 * real TypeScript here.
 */
export const VIEWER_SCRIPT = String.raw`
window.__spineInteractiveViewer = async function (input) {
  const byId = function (id) { return document.getElementById(id); };
  const canvas = byId('spine-canvas');
  const status = byId('viewer-status');
  const playToggle = byId('play-toggle');
  const timeline = byId('timeline');
  const timeReadout = byId('time-readout');
  const animationSelect = byId('animation-select');
  const speedSelect = byId('speed-select');
  const loopToggle = byId('loop-toggle');
  const bonesToggle = byId('bones-toggle');

  function fail(message) {
    status.textContent = message;
    status.className = 'status failed';
    window.__spineViewerError = message;
  }

  canvas.width = input.width;
  canvas.height = input.height;

  const glOptions = { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: true };
  const gl = canvas.getContext('webgl2', glOptions) || canvas.getContext('webgl', glOptions);
  if (!gl) {
    fail('WebGL is unavailable in this browser, so the skeleton cannot be drawn.');
    return;
  }

  // --- atlas pages, from the inlined data URLs ---
  let atlas;
  try {
    atlas = new spine.TextureAtlas(input.atlasText);
  } catch (cause) {
    fail('The embedded atlas text could not be parsed: ' + cause);
    return;
  }

  for (const page of atlas.pages) {
    const dataUrl = input.images[page.name];
    if (!dataUrl) {
      fail('No image was embedded for atlas page "' + page.name + '".');
      return;
    }
    const image = new Image();
    try {
      await new Promise(function (resolve, reject) {
        image.onload = resolve;
        image.onerror = function () { reject(new Error(page.name)); };
        image.src = dataUrl;
      });
    } catch (cause) {
      fail('Atlas page image failed to decode: ' + page.name);
      return;
    }
    page.setTexture(new spine.GLTexture(gl, image));
  }

  // --- skeleton data ---
  let skeletonData;
  try {
    const json = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas));
    json.scale = input.scale;
    skeletonData = json.readSkeletonData(input.skeletonJson);
  } catch (cause) {
    fail('The embedded skeleton data could not be loaded: ' + cause);
    return;
  }

  const animations = skeletonData.animations.map(function (a) { return a.name; });
  const skins = skeletonData.skins.map(function (s) { return s.name; });

  // Shader compilation and a lost context both surface here, so this block
  // reports through fail() like the four before it.
  let skeleton;
  let state;
  let renderer;
  try {
    skeleton = new spine.Skeleton(skeletonData);
    if (input.skin && skins.indexOf(input.skin) !== -1) {
      skeleton.setSkinByName(input.skin);
    }
    state = new spine.AnimationState(new spine.AnimationStateData(skeletonData));
    renderer = new spine.SceneRenderer(canvas, gl);
  } catch (cause) {
    fail('The skeleton could not be prepared for drawing: ' + cause);
    return;
  }

  let animationName =
    input.animation && animations.indexOf(input.animation) !== -1
      ? input.animation
      : animations.length > 0 ? animations[0] : null;

  for (const name of animations) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    if (name === animationName) option.selected = true;
    animationSelect.appendChild(option);
  }
  if (animations.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '(setup pose only)';
    animationSelect.appendChild(option);
    animationSelect.disabled = true;
  }

  const STEP_SECONDS = 1 / 60;
  const MAX_STEPS = 20000;
  const PADDING = 0.15;

  function durationOf(name) {
    if (!name) return 0;
    for (const animation of skeletonData.animations) {
      if (animation.name === name) return animation.duration;
    }
    return 0;
  }

  function advance(delta) {
    state.update(delta);
    state.apply(skeleton);
    skeleton.update(delta);
    skeleton.updateWorldTransform(spine.Physics.update);
  }

  // Re-pose from the setup pose in fixed steps rather than jumping: one
  // large delta would land physics constraints somewhere no runtime would.
  function seekTo(requestedTime) {
    // Clamp to the work the step budget can actually cover: folding the
    // remainder into the final advance would hand physics the one large
    // delta the fixed stepping exists to avoid.
    const time = Math.min(Math.max(requestedTime, 0), MAX_STEPS * STEP_SECONDS);
    skeleton.setToSetupPose();
    state.clearTracks();
    if (!animationName) {
      skeleton.updateWorldTransform(spine.Physics.update);
      return;
    }
    state.setAnimation(0, animationName, true);
    const steps = Math.min(Math.ceil(time / STEP_SECONDS), MAX_STEPS);
    if (steps <= 0) {
      advance(0);
      return;
    }
    for (let i = 0; i < steps; i++) {
      advance(i === steps - 1 ? time - STEP_SECONDS * (steps - 1) : STEP_SECONDS);
    }
  }

  // One framing per animation, taken from the union of sampled poses, so
  // the character does not drift in and out of view while it plays.
  function frameCamera() {
    const duration = durationOf(animationName);
    const samples = 12;
    const offset = new spine.Vector2();
    const size = new spine.Vector2();
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < samples; i++) {
      const time = duration <= 0 ? 0 : (duration * i) / (samples - 1);
      seekTo(time);
      skeleton.getBounds(offset, size, []);
      if (isFinite(offset.x) && isFinite(size.x) && size.x > 0 && size.y > 0) {
        minX = Math.min(minX, offset.x);
        minY = Math.min(minY, offset.y);
        maxX = Math.max(maxX, offset.x + size.x);
        maxY = Math.max(maxY, offset.y + size.y);
      }
      if (duration <= 0) break;
    }

    if (!isFinite(minX)) {
      minX = -1; minY = -1; maxX = 1; maxY = 1;
    }

    const boundsWidth = Math.max(maxX - minX, 1e-3);
    const boundsHeight = Math.max(maxY - minY, 1e-3);

    renderer.camera.position.x = minX + boundsWidth / 2;
    renderer.camera.position.y = minY + boundsHeight / 2;
    renderer.camera.setViewport(canvas.width, canvas.height);
    // zoom > 1 zooms out, so fit the larger axis and leave a margin.
    renderer.camera.zoom =
      Math.max(boundsWidth / canvas.width, boundsHeight / canvas.height) * (1 + PADDING);
    renderer.camera.update();
  }

  let playing = animations.length > 0;
  let currentTime = 0;
  let speed = 1;
  let showBones = Boolean(input.showBones);

  loopToggle.checked = true;
  bonesToggle.checked = showBones;
  speedSelect.value = '1';

  function setPlaying(value) {
    playing = value && Boolean(animationName);
    playToggle.setAttribute('aria-pressed', playing ? 'true' : 'false');
    playToggle.textContent = playing ? 'Pause' : 'Play';
  }

  function syncTimeline() {
    const duration = durationOf(animationName);
    timeline.min = '0';
    timeline.max = (duration > 0 ? duration : 1).toFixed(3);
    timeline.step = '0.01';
    timeline.disabled = duration <= 0;
    timeline.value = currentTime.toFixed(3);
    timeline.setAttribute(
      'aria-valuetext',
      currentTime.toFixed(2) + ' of ' + duration.toFixed(2) + ' seconds',
    );
    timeReadout.textContent = currentTime.toFixed(2) + ' / ' + duration.toFixed(2) + ' s';
  }

  function draw() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(input.background[0], input.background[1], input.background[2], input.background[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    renderer.begin();
    renderer.drawSkeleton(skeleton, input.premultipliedAlpha);
    if (showBones) renderer.drawSkeletonDebug(skeleton, input.premultipliedAlpha);
    renderer.end();
  }

  playToggle.addEventListener('click', function () { setPlaying(!playing); });

  timeline.addEventListener('input', function () {
    // Scrubbing is an explicit "hold it here", so it pauses.
    setPlaying(false);
    currentTime = Number(timeline.value) || 0;
    seekTo(currentTime);
    syncTimeline();
    draw();
  });

  animationSelect.addEventListener('change', function () {
    animationName = animationSelect.value || null;
    currentTime = 0;
    frameCamera();
    seekTo(currentTime);
    syncTimeline();
    draw();
  });

  speedSelect.addEventListener('change', function () {
    speed = Number(speedSelect.value) || 1;
  });

  bonesToggle.addEventListener('change', function () {
    showBones = bonesToggle.checked;
    draw();
  });

  let lastTimestamp = 0;
  function loop(timestamp) {
    const raw = lastTimestamp === 0 ? 0 : (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;
    // Clamp the delta: a backgrounded tab hands back a multi-second jump,
    // which makes physics explode.
    const delta = Math.min(Math.max(raw, 0), 0.05) * speed;
    const duration = durationOf(animationName);

    if (playing && animationName && duration > 0 && delta > 0) {
      advance(delta);
      currentTime += delta;
      if (currentTime >= duration) {
        if (loopToggle.checked) {
          currentTime = currentTime % duration;
        } else {
          currentTime = duration;
          setPlaying(false);
          seekTo(currentTime);
        }
      }
      syncTimeline();
      // Only a pose that moved needs a new frame. A paused page left open
      // on someone's machine would otherwise hold the GPU busy forever;
      // every control that changes the image draws on demand.
      draw();
    }

    requestAnimationFrame(loop);
  }

  // Written before the framing pass: that pass re-poses the skeleton 12
  // times, and until it finishes the page would still read "Loading…".
  status.textContent =
    (skeletonData.version ? 'Spine ' + skeletonData.version + ' data' : 'Skeleton data') +
    ' · ' + animations.length + ' animation(s) · ' + skins.length + ' skin(s) · ' +
    atlas.pages.length + ' atlas page(s), all embedded in this file.';

  try {
    frameCamera();
    seekTo(0);
    syncTimeline();
    setPlaying(playing);
    draw();
  } catch (cause) {
    fail('The first frame could not be drawn: ' + cause);
    return;
  }

  requestAnimationFrame(loop);
  window.__spineViewerReady = true;
};
`;

/**
 * Build the standalone page.
 *
 * `runtimeSource` is the spine-webgl IIFE bundle, inlined verbatim; `input`
 * carries the skeleton, the atlas and the page images, already as data
 * URLs. The result depends on nothing outside itself.
 */
export function buildInteractiveHtml(
  runtimeSource: string,
  input: InteractivePageInput,
): string {
  const title = escapeHtml(input.title);

  return `<!DOCTYPE html>
<!--
  Spine 2D Accelerator — standalone interactive preview.
  ${LICENSE_SENTENCE}
-->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Spine preview</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0;
    font: 14px/1.5 system-ui, -apple-system, Segoe UI, sans-serif;
    background: #15171c;
    color: #e7e9ee;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 20px 16px 28px;
  }
  h1 { font-size: 16px; font-weight: 600; margin: 0; }
  /* A checkerboard, so a fully transparent render is still visible as a
     render rather than looking like a broken page. */
  .stage {
    background-color: #2a2d34;
    background-image:
      linear-gradient(45deg, #23252b 25%, transparent 25%, transparent 75%, #23252b 75%),
      linear-gradient(45deg, #23252b 25%, transparent 25%, transparent 75%, #23252b 75%);
    background-size: 24px 24px;
    background-position: 0 0, 12px 12px;
    border: 1px solid #3a3e47;
    border-radius: 6px;
    line-height: 0;
  }
  canvas { display: block; }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
    max-width: 720px;
    justify-content: center;
  }
  .controls label { color: #aeb4c0; }
  button, select {
    font: inherit;
    color: #e7e9ee;
    background: #2a2d34;
    border: 1px solid #454a55;
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
  }
  button { min-width: 72px; }
  button:focus-visible, select:focus-visible, input:focus-visible {
    outline: 2px solid #7aa2f7;
    outline-offset: 2px;
  }
  #timeline { width: 240px; accent-color: #7aa2f7; }
  #time-readout { font-variant-numeric: tabular-nums; color: #aeb4c0; min-width: 96px; }
  .status { color: #aeb4c0; font-size: 13px; text-align: center; max-width: 720px; }
  .status.failed { color: #ff8f8f; }
  footer { color: #8a909c; font-size: 12px; text-align: center; max-width: 720px; }
  footer a { color: #7aa2f7; }
</style>
</head>
<body>
<h1>${title}</h1>

<div class="stage">
  <canvas id="spine-canvas" width="${input.width}" height="${input.height}"
    aria-label="Interactive Spine skeleton preview of ${title}"></canvas>
</div>

<div class="controls">
  <button id="play-toggle" type="button" aria-pressed="true">Pause</button>

  <label for="timeline">Timeline</label>
  <!-- No aria-label here: it would override the visible "Timeline" text
       (WCAG 2.5.3), and aria-valuetext already announces the value. -->
  <input id="timeline" type="range" min="0" max="1" step="0.01" value="0">
  <span id="time-readout">0.00 / 0.00 s</span>

  <label for="animation-select">Animation</label>
  <select id="animation-select"></select>

  <label for="speed-select">Speed</label>
  <select id="speed-select">
    <option value="0.25">0.25x</option>
    <option value="0.5">0.5x</option>
    <option value="1" selected>1x</option>
    <option value="2">2x</option>
  </select>

  <label for="loop-toggle">Loop</label>
  <input id="loop-toggle" type="checkbox" checked>

  <label for="bones-toggle">Bones</label>
  <input id="bones-toggle" type="checkbox"${input.showBones ? ' checked' : ''}>
</div>

<p id="viewer-status" class="status" role="status">Loading the embedded skeleton…</p>

<footer>
  ${escapeHtml(LICENSE_SENTENCE.slice(0, LICENSE_SENTENCE.lastIndexOf(': ') + 1))}
  <a href="${PURCHASE_URL}">${PURCHASE_URL}</a>
</footer>

<script>${embedScriptSource(runtimeSource)}</script>
<script>${VIEWER_SCRIPT}</script>
<script>
window.__spineInteractiveViewer(${embedJson(input)}).catch(function (cause) {
  // The viewer is async, so without this a failure past the skeleton load
  // would be an unhandled rejection: a page stuck on "Loading…" and no
  // message for whoever opened it.
  var message = 'The viewer failed to start: ' + cause;
  window.__spineViewerError = message;
  var status = document.getElementById('viewer-status');
  if (status) {
    status.textContent = message;
    status.className = 'status failed';
  }
});
</script>
</body>
</html>
`;
}

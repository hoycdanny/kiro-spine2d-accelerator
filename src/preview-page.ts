// ============================================================
// The headless preview page.
//
// Everything the renderer needs is inlined into the page: the spine-webgl
// runtime, the skeleton JSON, the atlas text, and each atlas page image as
// a data URL. Nothing is fetched, which removes file:// CORS problems and
// makes a render depend only on its inputs.
//
// Two decisions that exist for reproducibility, because these screenshots
// feed visual regression:
//  - Animation time is advanced in fixed steps rather than one jump, so
//    physics constraints (Spine 4.2+) land where a real runtime would.
//  - The camera is framed once from the union of all sampled poses, so
//    every frame in a run shares one coordinate system.
// ============================================================

/** Inputs handed to the in-page renderer. */
export interface PreviewPageInput {
  skeletonJson: string;
  atlasText: string;
  /** Atlas page image name to data URL. */
  images: Record<string, string>;
  /** Animation to play. Null renders the setup pose. */
  animation: string | null;
  /** Skin to apply before rendering. */
  skin: string | null;
  /** Times in seconds to capture. */
  times: number[];
  width: number;
  height: number;
  /** Background as [r, g, b, a], each 0..1. Alpha 0 gives transparency. */
  background: [number, number, number, number];
  /** Must match how the atlas was packed. */
  premultipliedAlpha: boolean;
  /** Skeleton scale applied at load time. */
  scale: number;
  /** Fixed time step used to advance the animation. */
  stepSeconds: number;
  /** Extra space around the skeleton bounds, as a fraction. */
  padding: number;
}

/** One captured frame. */
export interface PreviewFrame {
  time: number;
  /** PNG data URL of the canvas. */
  dataUrl: string;
  /** Fraction of pixels with any alpha, used to detect blank renders. */
  coverage: number;
}

/** What the in-page renderer returns. */
export interface PreviewPageResult {
  frames: PreviewFrame[];
  /** Union bounds of every sampled pose, in skeleton space. */
  bounds: { x: number; y: number; width: number; height: number };
  animations: string[];
  skins: string[];
  warnings: string[];
  spineVersion: string | null;
}

/**
 * The in-page render function, as source text.
 *
 * Kept as a string rather than a real function so it can be evaluated in
 * the page without a bundler step, and so the Node-side types above remain
 * the single description of the contract.
 */
export const RENDER_SCRIPT = String.raw`
window.__spinePreviewRender = async function (input) {
  const warnings = [];
  const canvas = document.getElementById('spine-canvas');
  canvas.width = input.width;
  canvas.height = input.height;

  const glOptions = { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: true };
  const gl = canvas.getContext('webgl2', glOptions) || canvas.getContext('webgl', glOptions);
  if (!gl) throw new Error('WebGL is unavailable in this browser context.');

  // --- atlas and textures ---
  const atlas = new spine.TextureAtlas(input.atlasText);
  for (const page of atlas.pages) {
    const dataUrl = input.images[page.name];
    if (!dataUrl) {
      throw new Error('No image was supplied for atlas page "' + page.name + '".');
    }
    const image = new Image();
    await new Promise(function (resolve, reject) {
      image.onload = resolve;
      image.onerror = function () { reject(new Error('Atlas page image failed to decode: ' + page.name)); };
      image.src = dataUrl;
    });
    page.setTexture(new spine.GLTexture(gl, image));
  }

  // --- skeleton data ---
  const loader = new spine.AtlasAttachmentLoader(atlas);
  const json = new spine.SkeletonJson(loader);
  json.scale = input.scale;
  const skeletonData = json.readSkeletonData(input.skeletonJson);

  const animations = skeletonData.animations.map(function (a) { return a.name; });
  const skins = skeletonData.skins.map(function (s) { return s.name; });

  const skeleton = new spine.Skeleton(skeletonData);
  if (input.skin) {
    if (skins.indexOf(input.skin) === -1) {
      throw new Error('Skin "' + input.skin + '" does not exist. Available: ' + skins.join(', '));
    }
    skeleton.setSkinByName(input.skin);
  }

  let animationName = input.animation;
  if (animationName && animations.indexOf(animationName) === -1) {
    throw new Error('Animation "' + animationName + '" does not exist. Available: ' + animations.join(', '));
  }
  if (!animationName && animations.length > 0) {
    animationName = animations[0];
    warnings.push('No animation was requested; rendering "' + animationName + '".');
  }

  const stateData = new spine.AnimationStateData(skeletonData);
  const state = new spine.AnimationState(stateData);

  const maxSteps = 20000;

  function poseAt(time) {
    skeleton.setToSetupPose();
    state.clearTracks();
    if (animationName) {
      state.setAnimation(0, animationName, true);
      const step = Math.max(input.stepSeconds, 1 / 240);
      const steps = Math.min(Math.ceil(time / step), maxSteps);
      // Fixed-step advance: physics constraints integrate per step, so one
      // large delta would land somewhere a real runtime never would.
      for (let i = 0; i < steps; i++) {
        const delta = i === steps - 1 ? time - step * (steps - 1) : step;
        state.update(delta);
        state.apply(skeleton);
        skeleton.update(delta);
        skeleton.updateWorldTransform(spine.Physics.update);
      }
      if (steps === 0) {
        state.update(0);
        state.apply(skeleton);
        skeleton.updateWorldTransform(spine.Physics.update);
      }
    } else {
      skeleton.updateWorldTransform(spine.Physics.update);
    }
  }

  // --- pass 1: union bounds over every sampled pose ---
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const offset = new spine.Vector2();
  const size = new spine.Vector2();

  for (const time of input.times) {
    poseAt(time);
    skeleton.getBounds(offset, size, []);
    if (!isFinite(offset.x) || !isFinite(size.x) || size.x <= 0 || size.y <= 0) continue;
    minX = Math.min(minX, offset.x);
    minY = Math.min(minY, offset.y);
    maxX = Math.max(maxX, offset.x + size.x);
    maxY = Math.max(maxY, offset.y + size.y);
  }

  if (!isFinite(minX)) {
    warnings.push('The skeleton has no visible attachment bounds; falling back to a unit viewport.');
    minX = -1; minY = -1; maxX = 1; maxY = 1;
  }

  const boundsWidth = Math.max(maxX - minX, 1e-3);
  const boundsHeight = Math.max(maxY - minY, 1e-3);

  const renderer = new spine.SceneRenderer(canvas, gl);
  renderer.camera.position.x = minX + boundsWidth / 2;
  renderer.camera.position.y = minY + boundsHeight / 2;
  renderer.camera.setViewport(canvas.width, canvas.height);
  // zoom > 1 zooms out, so fit the larger axis and add padding.
  renderer.camera.zoom =
    Math.max(boundsWidth / canvas.width, boundsHeight / canvas.height) * (1 + input.padding);
  renderer.camera.update();

  // --- pass 2: render each sample ---
  const frames = [];
  for (const time of input.times) {
    poseAt(time);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(input.background[0], input.background[1], input.background[2], input.background[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);

    renderer.begin();
    renderer.drawSkeleton(skeleton, input.premultipliedAlpha);
    renderer.end();

    // Coverage is a cheap blank-render check: a rig with a missing atlas
    // renders nothing, and that must not pass silently.
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let covered = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] !== 0) covered++;
    }

    frames.push({
      time: time,
      dataUrl: canvas.toDataURL('image/png'),
      coverage: covered / (canvas.width * canvas.height),
    });
  }

  return {
    frames: frames,
    bounds: { x: minX, y: minY, width: boundsWidth, height: boundsHeight },
    animations: animations,
    skins: skins,
    warnings: warnings,
    spineVersion: skeletonData.version || null,
  };
};
`;

/** Build the HTML page, with the runtime and render script inlined. */
export function buildPreviewHtml(runtimeSource: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Spine headless preview</title>
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  canvas { display: block; }
</style>
</head>
<body>
<canvas id="spine-canvas" width="512" height="512" aria-label="Spine skeleton preview"></canvas>
<script>${runtimeSource}</script>
<script>${RENDER_SCRIPT}</script>
</body>
</html>`;
}

// ============================================================
// The influence probe page.
//
// An extension of the harness above, not a second harness: same runtime,
// same minimal document, same GL options, same launcher. `RENDER_SCRIPT`
// and `buildPreviewHtml` are deliberately left byte-identical — they feed
// every visual-regression baseline in the repo, so editing them would move
// pixels everywhere. `PROBE_SCRIPT` is a separate function on `window` in
// a separate page; the two never run together.
//
// Split into init and render because one `evaluate` returning every frame
// is unbounded in a way `maxProbes` does not catch: at the schema maxima
// (512 probes, 1024x1024) the page would accumulate 513 base64 PNGs and
// Playwright would serialise all of them through one CDP response. Init
// does the expensive, once-per-invocation work — atlas, textures,
// skeleton data, the bounds pre-pass and the camera — and the render call
// draws one batch of the plan.
// ============================================================

/** One axis of one bone's local transform that a probe perturbs. */
export type ProbePageAxis = 'rotate' | 'translateX' | 'translateY';

/** Inputs handed to {@link PROBE_SCRIPT}'s init function. */
export interface ProbePageInput {
  skeletonJson: string;
  atlasText: string;
  /** Atlas page image name to data URL. */
  images: Record<string, string>;
  skin: string | null;
  /** The whole plan, flattened in bone-major order. */
  probes: Array<{ bone: string; axis: ProbePageAxis }>;
  rotationDegrees: number;
  /** Fraction of the larger setup-pose bounds axis to translate by. */
  translateFraction: number;
  width: number;
  height: number;
  /** Taken from the atlas's `pma` flag, the same rule `prepareRender` applies. */
  premultipliedAlpha: boolean;
  scale: number;
  padding: number;
}

/**
 * One slot's pixel rectangle in a single render.
 *
 * Integer pixel coordinates in the decoded PNG's coordinate system: `x`
 * rightward from the left edge, `y` **downward from the top edge**, both
 * bounds inclusive.
 */
export interface ProbePageSlotBox {
  slot: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** What the init call returns: everything that is computed exactly once. */
export interface ProbePageInitResult {
  neutral: { dataUrl: string; slotBoxes: ProbePageSlotBox[]; coverage: number };
  /** The camera rectangle every fraction in this run is relative to. */
  framing: {
    x: number;
    y: number;
    width: number;
    height: number;
    padding: number;
    /** Neutral pose plus every pose in the plan: `probes.length + 1`. */
    fromPoses: number;
  };
  translateUnits: number;
  canvas: { width: number; height: number };
  warnings: string[];
  /** Slot names in draw order, as the page saw them. */
  slots: string[];
}

/** One rendered probe frame, as the page returns it. */
export interface ProbePageFrame {
  bone: string;
  axis: ProbePageAxis;
  dataUrl: string;
  slotBoxes: ProbePageSlotBox[];
}

/**
 * The in-page probe functions, as source text.
 *
 * Written with string concatenation rather than template literals because
 * the whole thing lives inside a `String.raw` template.
 */
export const PROBE_SCRIPT = String.raw`
window.__spineProbeState = null;

/** Called once per invocation: atlas, textures, skeleton data, bounds pre-pass, camera framing. */
window.__spineProbeInit = async function (input) {
  const warnings = [];
  const skippedKinds = {};

  // --- 1. canvas and context ---
  const canvas = document.getElementById('spine-canvas');
  canvas.width = input.width;
  canvas.height = input.height;

  // EXACTLY the options RENDER_SCRIPT uses. preserveDrawingBuffer is
  // load-bearing, not cosmetic: without it canvas.toDataURL after a draw
  // can return a cleared buffer, every probe would read changedFraction 0,
  // and the document would confidently report the whole rig as dead bones.
  const glOptions = { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: true };
  const gl = canvas.getContext('webgl2', glOptions) || canvas.getContext('webgl', glOptions);
  if (!gl) throw new Error('WebGL is unavailable in this browser context.');

  const atlas = new spine.TextureAtlas(input.atlasText);
  for (const page of atlas.pages) {
    const dataUrl = input.images[page.name];
    if (!dataUrl) {
      throw new Error('No image was supplied for atlas page "' + page.name + '".');
    }
    const image = new Image();
    await new Promise(function (resolve, reject) {
      image.onload = resolve;
      image.onerror = function () { reject(new Error('Atlas page image failed to decode: ' + page.name)); };
      image.src = dataUrl;
    });
    page.setTexture(new spine.GLTexture(gl, image));
  }

  // --- 2. skeleton data ---
  const json = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas));
  json.scale = input.scale;
  const skeletonData = json.readSkeletonData(input.skeletonJson);
  const skeleton = new spine.Skeleton(skeletonData);
  const skinNames = skeletonData.skins.map(function (s) { return s.name; });
  if (input.skin) {
    if (skinNames.indexOf(input.skin) === -1) {
      throw new Error('Skin "' + input.skin + '" does not exist. Available: ' + skinNames.join(', '));
    }
    skeleton.setSkinByName(input.skin);
  }

  // --- 3. no AnimationState: the pose is always the setup pose ---
  const offset = new spine.Vector2();
  const size = new spine.Vector2();

  function neutralPose() {
    skeleton.setToSetupPose();
    skeleton.updateWorldTransform(spine.Physics.update);
  }

  // --- 4. resolve the translation delta once ---
  neutralPose();
  skeleton.getBounds(offset, size, []);
  const boundsSpan = Math.max(isFinite(size.x) ? size.x : 0, isFinite(size.y) ? size.y : 0);
  // Rounded in the page so Node and the page report the same number.
  const translateUnits = Math.round(boundsSpan * input.translateFraction * 1000) / 1000;

  function poseFor(probe) {
    skeleton.setToSetupPose();
    const bone = skeleton.findBone(probe.bone);
    if (bone) {
      if (probe.axis === 'rotate') bone.rotation += input.rotationDegrees;
      else if (probe.axis === 'translateX') bone.x += translateUnits;
      else bone.y += translateUnits;
    }
    skeleton.updateWorldTransform(spine.Physics.update);
  }

  // --- 5. bounds pre-pass over the neutral pose AND EVERY POSE IN THE PLAN ---
  // Not just the first batch: if a perturbed limb left the viewport the
  // diff would under-report and a strong bone could read as dead.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  function accumulateBounds() {
    skeleton.getBounds(offset, size, []);
    if (!isFinite(offset.x) || !isFinite(size.x) || size.x <= 0 || size.y <= 0) return;
    minX = Math.min(minX, offset.x);
    minY = Math.min(minY, offset.y);
    maxX = Math.max(maxX, offset.x + size.x);
    maxY = Math.max(maxY, offset.y + size.y);
  }

  neutralPose();
  accumulateBounds();
  for (const probe of input.probes) {
    poseFor(probe);
    accumulateBounds();
  }

  if (!isFinite(minX)) {
    warnings.push('The skeleton has no visible attachment bounds; falling back to a unit viewport.');
    minX = -1; minY = -1; maxX = 1; maxY = 1;
  }

  const boundsWidth = Math.max(maxX - minX, 1e-3);
  const boundsHeight = Math.max(maxY - minY, 1e-3);

  const renderer = new spine.SceneRenderer(canvas, gl);
  renderer.camera.position.x = minX + boundsWidth / 2;
  renderer.camera.position.y = minY + boundsHeight / 2;
  renderer.camera.setViewport(canvas.width, canvas.height);
  renderer.camera.zoom =
    Math.max(boundsWidth / canvas.width, boundsHeight / canvas.height) * (1 + input.padding);
  renderer.camera.update();

  function nameList(names) {
    const shown = names.slice(0, 5).join(', ');
    const extra = names.length - 5;
    return extra > 0 ? shown + ' and ' + extra + ' more' : shown;
  }

  function kindOf(attachment) {
    if (attachment instanceof spine.MeshAttachment) return 'mesh';
    if (attachment instanceof spine.RegionAttachment) return 'region';
    if (attachment instanceof spine.ClippingAttachment) return 'clipping';
    if (attachment instanceof spine.BoundingBoxAttachment) return 'boundingbox';
    if (attachment instanceof spine.PathAttachment) return 'path';
    if (attachment instanceof spine.PointAttachment) return 'point';
    return 'unknown';
  }

  function clamp(value, lo, hi) {
    return value < lo ? lo : value > hi ? hi : value;
  }

  // --- 8. slot boxes, in the mask's coordinate system ---
  function slotBoxes() {
    const boxes = [];
    const camera = renderer.camera;

    for (const slot of skeleton.drawOrder) {
      const attachment = slot.getAttachment();
      if (!attachment) continue;

      // computeWorldVertices has TWO INCOMPATIBLE SIGNATURES in
      // spine-core 4.2.120: RegionAttachment takes 4 arguments and
      // MeshAttachment takes 6. Calling one with the other's argument
      // order writes garbage coordinates and throws nothing, which would
      // put slot boxes in the wrong place and make attribution name the
      // wrong slot. So the dispatch is written out rather than implied.
      let verts;
      if (attachment instanceof spine.RegionAttachment) {
        verts = new Float32Array(8);
        attachment.computeWorldVertices(slot, verts, 0, 2);
      } else if (attachment instanceof spine.MeshAttachment) {
        verts = new Float32Array(attachment.worldVerticesLength);
        attachment.computeWorldVertices(slot, 0, attachment.worldVerticesLength, verts, 0, 2);
      } else {
        // point / clipping / boundingbox / path are not DRAWN, which is
        // why they have no slot box — not because they lack vertices.
        const kind = kindOf(attachment);
        if (!skippedKinds[kind]) skippedKinds[kind] = [];
        if (skippedKinds[kind].indexOf(slot.data.name) === -1) {
          skippedKinds[kind].push(slot.data.name);
        }
        continue;
      }

      let wx0 = Number.POSITIVE_INFINITY;
      let wy0 = Number.POSITIVE_INFINITY;
      let wx1 = Number.NEGATIVE_INFINITY;
      let wy1 = Number.NEGATIVE_INFINITY;
      for (let i = 0; i + 1 < verts.length; i += 2) {
        const x = verts[i];
        const y = verts[i + 1];
        if (!isFinite(x) || !isFinite(y)) continue;
        if (x < wx0) wx0 = x;
        if (x > wx1) wx1 = x;
        if (y < wy0) wy0 = y;
        if (y > wy1) wy1 = y;
      }
      if (!isFinite(wx0) || !isFinite(wy0)) continue;

      // FLIP Y, EXACTLY ONCE, HERE — the one place both conventions are
      // visible. camera.worldToScreen is BOTTOM-LEFT origin (spine-webgl
      // dist/Camera.js:72: worldCoords.y = screenHeight * (worldCoords.y + 1) / 2)
      // while the mask comes from decodePng in src/png.ts, which fills
      // row-major from the first scanline and is TOP-LEFT origin.
      // Unflipped, nothing throws: the head slot's box gets credited with
      // pixels that moved around the feet and the document names the wrong
      // slots. Two fresh Vector3s, because worldToScreen mutates and
      // returns the vector it is given.
      const p0 = camera.worldToScreen(new spine.Vector3(wx0, wy1, 0), canvas.width, canvas.height);
      const p1 = camera.worldToScreen(new spine.Vector3(wx1, wy0, 0), canvas.width, canvas.height);

      boxes.push({
        slot: slot.data.name,
        x0: clamp(Math.floor(Math.min(p0.x, p1.x)), 0, canvas.width - 1),
        y0: clamp(Math.floor(canvas.height - Math.max(p0.y, p1.y)), 0, canvas.height - 1),
        x1: clamp(Math.ceil(Math.max(p0.x, p1.x)), 0, canvas.width - 1),
        y1: clamp(Math.ceil(canvas.height - Math.min(p0.y, p1.y)), 0, canvas.height - 1),
      });
    }

    return boxes;
  }

  function draw() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    renderer.begin();
    renderer.drawSkeleton(skeleton, input.premultipliedAlpha);
    renderer.end();
  }

  function coverage() {
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let covered = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] !== 0) covered++;
    }
    return covered / (canvas.width * canvas.height);
  }

  // --- 6. the neutral frame ---
  neutralPose();
  draw();
  const neutralCoverage = coverage();
  const neutral = {
    dataUrl: canvas.toDataURL('image/png'),
    slotBoxes: slotBoxes(),
    coverage: neutralCoverage,
  };

  // Named once per invocation, not once per probe. The setup pose does not
  // change between probes, so the neutral pass has already seen every
  // attachment kind in the rig.
  for (const kind of Object.keys(skippedKinds).sort()) {
    warnings.push(
      "Attachment kind '" + kind + "' is not drawn, so it has no slot box: " +
        nameList(skippedKinds[kind]),
    );
  }

  window.__spineProbeState = {
    input: input,
    canvas: canvas,
    poseFor: poseFor,
    slotBoxes: slotBoxes,
    draw: draw,
  };

  return {
    neutral: neutral,
    framing: {
      x: minX,
      y: minY,
      width: boundsWidth,
      height: boundsHeight,
      padding: input.padding,
      fromPoses: input.probes.length + 1,
    },
    translateUnits: translateUnits,
    canvas: { width: canvas.width, height: canvas.height },
    warnings: warnings,
    slots: skeleton.drawOrder.map(function (slot) { return slot.data.name; }),
  };
};

/** Called once per batch: renders probes [fromIndex, fromIndex + count) and returns their frames. */
window.__spineProbeRender = async function (fromIndex, count) {
  const state = window.__spineProbeState;
  if (!state) throw new Error('__spineProbeInit has not run in this page.');

  const probes = state.input.probes;
  const end = Math.min(fromIndex + count, probes.length);
  const frames = [];

  for (let index = fromIndex; index < end; index++) {
    const probe = probes[index];
    state.poseFor(probe);
    state.draw();
    frames.push({
      bone: probe.bone,
      axis: probe.axis,
      dataUrl: state.canvas.toDataURL('image/png'),
      slotBoxes: state.slotBoxes(),
    });
  }

  return frames;
};
`;

/**
 * Build the probe page, with the runtime and the probe script inlined.
 *
 * The same minimal document {@link buildPreviewHtml} emits, differing only
 * in which script is inlined: the in-page algorithm sets
 * `canvas.width`/`height` on the `#spine-canvas` element, so that element
 * has to exist with the same CSS reset around it.
 */
export function buildProbeHtml(runtimeSource: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Spine headless influence probe</title>
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  canvas { display: block; }
</style>
</head>
<body>
<canvas id="spine-canvas" width="512" height="512" aria-label="Spine skeleton influence probe"></canvas>
<script>${runtimeSource}</script>
<script>${PROBE_SCRIPT}</script>
</body>
</html>`;
}

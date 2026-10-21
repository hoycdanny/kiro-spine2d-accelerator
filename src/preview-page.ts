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

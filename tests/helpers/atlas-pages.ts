/**
 * Paint an atlas page image from the regions the atlas declares.
 *
 * The real runtime needs a real page image, and a uniform one would make
 * every limb look the same in a rendered frame — which is exactly what the
 * visual proofs have to tell apart. Each region gets the colour the caller
 * chose for it, with its lower half darkened so a rotation changes interior
 * pixels and not only the silhouette.
 *
 * Hand-generated; nothing here comes from a Spine install.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { AtlasPage, inspectAtlasText } from '../../src/atlas-data';
import { encodePng, solidImage } from '../../src/png';
import { toJsonText } from './fixtures';

/** Straight (non-premultiplied) RGBA, matching every fixture's `pma: false`. */
export type Rgba = [number, number, number, number];

/** Used for a region the palette does not name. */
const FALLBACK: Rgba = [200, 200, 200, 255];

/** How much darker the lower half of each region is painted. */
const SHADE = 0.55;

/** Encode one atlas page, one solid rectangle per declared region. */
export function paintAtlasPage(page: AtlasPage, palette: Record<string, Rgba>): Buffer {
  const image = solidImage(page.width, page.height, [0, 0, 0, 0]);

  for (const region of page.regions) {
    const colour = palette[region.name] ?? FALLBACK;
    const xEnd = Math.min(page.width, region.x + region.width);
    const yEnd = Math.min(page.height, region.y + region.height);
    const midY = region.y + Math.floor(region.height / 2);

    for (let y = Math.max(0, region.y); y < yEnd; y++) {
      const shade = y < midY ? 1 : SHADE;
      for (let x = Math.max(0, region.x); x < xEnd; x++) {
        const index = (y * page.width + x) * 4;
        image.data[index] = Math.round(colour[0] * shade);
        image.data[index + 1] = Math.round(colour[1] * shade);
        image.data[index + 2] = Math.round(colour[2] * shade);
        image.data[index + 3] = colour[3];
      }
    }
  }

  return encodePng(image);
}

/**
 * One colour per CANONICAL_RIG region.
 *
 * Shared because two integration files render the same rig, and because the
 * visual proof depends on these: left limbs green and purple, right limbs
 * orange and teal, torso and chest blue. A limb sweeping through the torso
 * is only visible when the limb and the torso are different colours.
 */
export const CANONICAL_PALETTE: Record<string, Rgba> = {
  head: [255, 220, 170, 255],
  neck: [230, 170, 150, 255],
  chest: [40, 70, 190, 255],
  torso: [70, 120, 225, 255],
  arm_left: [60, 200, 80, 255],
  forearm_left: [110, 230, 130, 255],
  hand_left: [170, 255, 190, 255],
  arm_right: [235, 140, 40, 255],
  forearm_right: [250, 185, 90, 255],
  hand_right: [255, 215, 150, 255],
  thigh_left: [150, 60, 200, 255],
  shin_left: [195, 125, 235, 255],
  thigh_right: [40, 180, 180, 255],
  shin_right: [105, 220, 220, 255],
};

/** A rig on disk: skeleton, atlas, and one painted image per atlas page. */
export interface RigPaths {
  skeleton: string;
  atlas: string;
}

/** Write a fixture rig into `dir` so the real runtime can load it. */
export function writeRig(
  dir: string,
  name: string,
  skeleton: unknown,
  atlasText: string,
  palette: Record<string, Rgba>,
): RigPaths {
  const paths: RigPaths = {
    skeleton: join(dir, `${name}.json`),
    atlas: join(dir, `${name}.atlas`),
  };
  writeFileSync(paths.skeleton, toJsonText(skeleton), 'utf8');
  writeFileSync(paths.atlas, atlasText, 'utf8');

  const atlas = inspectAtlasText(atlasText);
  if (!atlas.ok) throw new Error(atlas.message);
  // Page images are looked up next to the .atlas file.
  for (const page of atlas.data.pages) {
    writeFileSync(join(dir, page.name), paintAtlasPage(page, palette));
  }

  return paths;
}

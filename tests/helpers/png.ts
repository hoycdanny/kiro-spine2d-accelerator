/**
 * Test-facing re-export of the PNG codec.
 *
 * The codec itself lives in `src/png.ts` because the visual regression tool
 * needs it at runtime; tests keep importing it from here.
 */
export {
  decodePng,
  encodePng,
  pixelDifference,
  solidImage,
  type RgbaImage,
} from '../../src/png';

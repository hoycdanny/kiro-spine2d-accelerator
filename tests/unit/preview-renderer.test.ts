/**
 * What the real Chromium launcher asks for.
 *
 * Every screenshot this package compares — visual-regression baselines and
 * the influence probes `skeleton_document` records as measured in this
 * environment — assumes one launch configuration. These tests bind that
 * assumption to the launcher instead of to a second copy of the array:
 * playwright-core is stubbed through the module registry, so nothing here
 * starts a browser.
 */
import { CHROMIUM_LAUNCH_ARGS } from '../../src/preview-renderer';

interface LaunchOptions {
  headless: boolean;
  args?: string[];
}

describe('createPlaywrightLauncher', () => {
  afterEach(() => {
    jest.dontMock('playwright-core');
    jest.resetModules();
  });

  it('launches with exactly CHROMIUM_LAUNCH_ARGS', async () => {
    const launches: LaunchOptions[] = [];
    jest.doMock('playwright-core', () => ({
      chromium: {
        launch: async (options: LaunchOptions) => {
          launches.push(options);
          return { newPage: async () => ({}), close: async () => {} };
        },
      },
    }));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const renderer = require('../../src/preview-renderer') as typeof import('../../src/preview-renderer');
    await renderer.createPlaywrightLauncher()();

    expect(launches).toHaveLength(1);
    expect(launches[0]?.headless).toBe(true);
    expect(launches[0]?.args).toEqual([...renderer.CHROMIUM_LAUNCH_ARGS]);
  });

  it('overrides no GL backend, because swiftshader breaks the tint shader', () => {
    // Verified on Chromium 151: `--use-gl=swiftshader` makes the spine-ts
    // two-colour tint shader fail to compile, so the absence of any
    // `--use-gl` entry is a contract, not an oversight.
    expect(CHROMIUM_LAUNCH_ARGS).toEqual(['--hide-scrollbars', '--mute-audio']);
    expect(CHROMIUM_LAUNCH_ARGS.some((arg) => arg.startsWith('--use-gl'))).toBe(false);
  });
});

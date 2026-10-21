/**
 * Integration tests against the real Spine installation on this machine.
 *
 * Both the environment probe and the live CLI checks live in one file on
 * purpose: running the CLI rewrites `spine.log`, which the probe reads. In
 * separate files Jest would run them in parallel workers and the probe
 * could read the log mid-rewrite. Within one file, tests run in order.
 *
 * Tiers:
 *  - The probe and `--version` run whenever a Spine install is present.
 *    `--version` is handled by the launcher itself, so it returns even with
 *    a Spine editor window open.
 *  - `-i` (project info) needs the editor closed: the launcher forwards the
 *    request to a running instance and then waits forever. Set
 *    SPINE_CLI_LIVE=1 with no Spine window open to run that tier.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

import { parseLauncherBanner } from '../../src/cli-output';
import { createNodeSpawn } from '../../src/cli-runner';
import { createNodeHost } from '../../src/host';
import { formatVersion, probeEnvironment, summarizeEnvironment } from '../../src/spine-env';
import { projectInfo } from '../../src/tools/cli-tools';
import { SpineEdition } from '../../src/types';

const exists = (p: string) => existsSync(p);
const readText = (p: string) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};

const env = probeEnvironment({
  platform: platform(),
  homeDir: homedir(),
  ...(process.env.ProgramFiles ? { programFiles: process.env.ProgramFiles } : {}),
  explicitExecutable: process.env.SPINE_EXECUTABLE ?? null,
  exists,
  readText,
});

const spawn = createNodeSpawn();
const describeIfInstalled = env.found ? describe : describe.skip;

describeIfInstalled('local Spine installation', () => {
  it('locates a command-line executable', () => {
    expect(env.executable).not.toBeNull();
    if (platform() === 'win32') {
      // The .com console executable is the only one that returns an exit code.
      expect(env.executable!.toLowerCase().endsWith('.com')).toBe(true);
    }
    expect(existsSync(env.executable!)).toBe(true);
  });

  it('determines the edition and version', () => {
    expect([SpineEdition.Trial, SpineEdition.Licensed]).toContain(env.edition);
    expect(env.editorVersion).not.toBeNull();
    expect(env.editorVersion!.major).toBeGreaterThanOrEqual(3);
  });

  it('derives a runtime branch that matches the editor version', () => {
    const version = env.editorVersion!;
    expect(env.runtimeBranch).toBe(`${version.major}.${version.minor}`);
  });

  it('keeps the capability matrix consistent with the edition', () => {
    const licensed = env.edition === SpineEdition.Licensed;
    expect(env.capabilities.canExport).toBe(licensed);
    expect(env.capabilities.canPack).toBe(licensed);
    expect(env.capabilities.canSave).toBe(licensed);
    // Project info is read-only and always available.
    expect(env.capabilities.canInfo).toBe(true);
  });

  it('produces a usable summary line', () => {
    const summary = summarizeEnvironment(env);
    expect(summary).toContain(formatVersion(env.editorVersion!));
    expect(summary).toContain(env.edition);
  });

  it('reports its version through the launcher', async () => {
    const outcome = await spawn(env.executable!, ['--version'], { timeoutMs: 120_000 });

    expect(outcome.timedOut).toBe(false);
    expect(outcome.code).toBe(0);

    const banner = parseLauncherBanner(outcome.stdout);
    expect(banner.editorVersion).not.toBeNull();
    expect(banner.edition).toBe(env.edition);
    expect(banner.completed).toBe(true);
  }, 150_000);

  // Opt-in: requires every Spine editor window to be closed.
  const liveInfo = process.env.SPINE_CLI_LIVE === '1' ? it : it.skip;

  liveInfo(
    'reads project info from the bundled spineboy example',
    async () => {
      const example = join(
        env.userDataDir ?? homedir(),
        'examples',
        `${env.editorVersion!.major}.${env.editorVersion!.minor}`,
        'spineboy',
        'spineboy-pro.spine',
      );

      if (!existsSync(example)) {
        // Nothing to assert against on this machine.
        return;
      }

      const host = createNodeHost();
      const result = await projectInfo(host, spawn, {
        input: example,
        timeoutSeconds: 180,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.result.raw.length).toBeGreaterThan(0);
      expect(result.data.result.banner.openedEditor).toBe(false);
    },
    240_000,
  );
});

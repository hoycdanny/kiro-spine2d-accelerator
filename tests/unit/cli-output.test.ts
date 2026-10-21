import {
  parseLauncherBanner,
  parseProjectInfo,
  stripBanner,
  summarizeProjectInfo,
} from '../../src/cli-output';
import { SpineEdition } from '../../src/types';

/**
 * Recorded verbatim from `SpineTrial.com --version` on Windows
 * (Spine 4.3.26 Trial, launcher 4.3.08).
 */
const REAL_VERSION_OUTPUT = [
  'Spine Launcher 4.3.08 Trial',
  'Esoteric Software LLC (C) 2013-2026 | http://esotericsoftware.com',
  'Windows 10 Pro amd64 10.0',
  'Starting: Spine 4.3.26 Trial',
  'Spine 4.3.26 Trial',
  'Complete.',
  '',
].join('\r\n');

/**
 * Recorded verbatim from a `-i` run made while a Spine editor window was
 * already open: the launcher forwarded the request to the running editor,
 * printed `Started.`, and never returned.
 */
const EDITOR_HANDOFF_OUTPUT = [
  'Spine Launcher 4.3.08 Trial',
  'Esoteric Software LLC (C) 2013-2026 | http://esotericsoftware.com',
  'Windows 10 Pro amd64 10.0',
  'Intel, Intel(R) UHD Graphics 730, 4.6.0 - Build 32.0.101.7088',
  'Starting: Spine 4.3.26 Trial',
  'Spine 4.3.26 Trial',
  'Started.',
  'OpenAL 1.1, Default audio device',
].join('\n');

describe('parseLauncherBanner', () => {
  it('parses the real --version output', () => {
    const banner = parseLauncherBanner(REAL_VERSION_OUTPUT);
    expect(banner.edition).toBe(SpineEdition.Trial);
    expect(banner.launcherVersion?.raw).toBe('4.3.08');
    expect(banner.editorVersion?.raw).toBe('4.3.26');
    expect(banner.completed).toBe(true);
    expect(banner.openedEditor).toBe(false);
  });

  it('flags a GUI handoff as openedEditor', () => {
    const banner = parseLauncherBanner(EDITOR_HANDOFF_OUTPUT);
    expect(banner.completed).toBe(false);
    expect(banner.openedEditor).toBe(true);
  });

  it('detects a licensed build from a banner without the trial marker', () => {
    const banner = parseLauncherBanner(
      ['Spine Launcher 4.2.37', 'Starting: Spine 4.2.37', 'Complete.'].join('\n'),
    );
    expect(banner.edition).toBe(SpineEdition.Licensed);
    expect(banner.editorVersion?.raw).toBe('4.2.37');
  });

  it('returns unknown for unrelated output', () => {
    expect(parseLauncherBanner('nothing to see').edition).toBe(SpineEdition.Unknown);
  });
});

describe('stripBanner', () => {
  it('removes every banner line from the real output', () => {
    expect(stripBanner(REAL_VERSION_OUTPUT)).toEqual([]);
  });

  it('keeps the command body', () => {
    const output = [
      'Spine Launcher 4.2.37',
      'Starting: Spine 4.2.37',
      'Animations: 11',
      'Complete.',
    ].join('\n');
    expect(stripBanner(output)).toEqual(['Animations: 11']);
  });
});

describe('parseProjectInfo', () => {
  it('parses a single project block keyed by a path line', () => {
    const output = [
      'Spine Launcher 4.2.37',
      'Starting: Spine 4.2.37',
      'C:\\projects\\spineboy-pro.spine',
      '  Spine: 4.2.37',
      '  Skeletons: 1',
      '  Animations: 11',
      '  Bones: 67',
      '  Slots: 52',
      '  Skins: 1',
      '  Events: 7',
      'Complete.',
    ].join('\n');

    const report = parseProjectInfo(output);
    expect(report.entries).toHaveLength(1);
    const entry = report.entries[0]!;
    expect(entry.path).toBe('C:\\projects\\spineboy-pro.spine');
    expect(entry.spineVersion).toBe('4.2.37');
    expect(entry.skeletons).toBe(1);
    expect(entry.animations).toBe(11);
    expect(entry.bones).toBe(67);
    expect(entry.slots).toBe(52);
    expect(entry.skins).toBe(1);
    expect(entry.events).toBe(7);
    expect(report.unparsedLines).toEqual([]);
  });

  it('parses several projects when a folder was scanned', () => {
    const output = [
      'Spine Launcher 4.2.37',
      'Starting: Spine 4.2.37',
      'hero.spine',
      'Animations: 4',
      'boss.spine',
      'Animations: 9',
      'Complete.',
    ].join('\n');

    const report = parseProjectInfo(output);
    expect(report.entries.map((entry) => entry.path)).toEqual([
      'hero.spine',
      'boss.spine',
    ]);
    expect(report.entries.map((entry) => entry.animations)).toEqual([4, 9]);
  });

  it('accepts `Project:` as an entry delimiter', () => {
    const output = [
      'Spine Launcher 4.2.37',
      'Project: /data/hero.spine',
      'Animations: 3',
      'Complete.',
    ].join('\n');

    const report = parseProjectInfo(output);
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]!.path).toBe('/data/hero.spine');
    expect(report.entries[0]!.animations).toBe(3);
  });

  it('keeps unknown keys in fields without losing them', () => {
    const output = [
      'Spine Launcher 4.2.37',
      'hero.spine',
      'Some Future Field: 42',
      'Complete.',
    ].join('\n');

    const report = parseProjectInfo(output);
    expect(report.entries[0]!.fields['some future field']).toBe('42');
  });

  it('collects key/value pairs that appear before any path line', () => {
    const output = ['Spine Launcher 4.2.37', 'Animations: 11', 'Complete.'].join('\n');
    const report = parseProjectInfo(output);
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]!.path).toBeNull();
    expect(report.entries[0]!.animations).toBe(11);
  });

  it('records lines it cannot interpret', () => {
    const output = ['Spine Launcher 4.2.37', 'hero.spine', 'mystery line', 'Complete.'].join(
      '\n',
    );
    expect(parseProjectInfo(output).unparsedLines).toEqual(['mystery line']);
  });

  it('always preserves the raw output', () => {
    expect(parseProjectInfo(REAL_VERSION_OUTPUT).raw).toBe(REAL_VERSION_OUTPUT);
  });

  it('reports no entries for a GUI handoff', () => {
    const report = parseProjectInfo(EDITOR_HANDOFF_OUTPUT);
    expect(report.entries).toEqual([]);
    expect(report.banner.openedEditor).toBe(true);
  });
});

describe('summarizeProjectInfo', () => {
  it('summarizes each entry on its own line', () => {
    const report = parseProjectInfo(
      [
        'Spine Launcher 4.2.37',
        'hero.spine',
        'Spine: 4.2.37',
        'Skeletons: 1',
        'Animations: 4',
        'Complete.',
      ].join('\n'),
    );
    expect(summarizeProjectInfo(report)).toBe(
      'hero.spine: saved with 4.2.37, 1 skeleton(s), 4 animation(s)',
    );
  });

  it('explains a GUI handoff', () => {
    const report = parseProjectInfo(EDITOR_HANDOFF_OUTPUT);
    expect(summarizeProjectInfo(report)).toContain('opened an editor window');
  });
});

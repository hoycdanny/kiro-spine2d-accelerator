import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  findExportPairs,
  listFiles,
  listSubdirectories,
  parseArgs,
} from '../../src/ci-cli';
import { RENDERABLE_ATLAS, RICH_SKELETON, toJsonText } from '../helpers/fixtures';

describe('parseArgs', () => {
  it('reads the command and simple flags', () => {
    const parsed = parseArgs(['lint', '--export-dir', 'export']);
    expect(parsed.command).toBe('lint');
    expect(parsed.flags['export-dir']).toEqual(['export']);
  });

  it('accepts --flag=value', () => {
    expect(parseArgs(['lint', '--fail-on=warning']).flags['fail-on']).toEqual([
      'warning',
    ]);
  });

  it('collects a repeated flag', () => {
    const parsed = parseArgs([
      'lint',
      '--rules',
      'a.json',
      '--rules',
      'b.json',
    ]);
    expect(parsed.flags['rules']).toEqual(['a.json', 'b.json']);
  });

  it('treats a flag with no value as true', () => {
    const parsed = parseArgs(['regression', '--update', '--diff-dir', 'd']);
    expect(parsed.flags['update']).toEqual(['true']);
    expect(parsed.flags['diff-dir']).toEqual(['d']);
  });

  it('handles no command', () => {
    expect(parseArgs([]).command).toBeUndefined();
  });
});

describe('file discovery', () => {
  let dir = '';

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'spine-ci-'));
    mkdirSync(join(dir, 'export', 'nested'), { recursive: true });
    mkdirSync(join(dir, 'baseline', 'walk'), { recursive: true });
    mkdirSync(join(dir, 'baseline', 'idle'), { recursive: true });

    writeFileSync(join(dir, 'export', 'hero.json'), toJsonText(RICH_SKELETON));
    writeFileSync(join(dir, 'export', 'hero.atlas'), RENDERABLE_ATLAS);
    // A Unity-targeted export writes .atlas.txt.
    writeFileSync(join(dir, 'export', 'nested', 'boss.json'), toJsonText(RICH_SKELETON));
    writeFileSync(join(dir, 'export', 'nested', 'boss.atlas.txt'), RENDERABLE_ATLAS);
    // A skeleton with no atlas beside it.
    writeFileSync(join(dir, 'export', 'lonely.json'), toJsonText(RICH_SKELETON));
    // Settings files must not be mistaken for skeleton data.
    writeFileSync(join(dir, 'export', 'unity.export.json'), '{}');
    writeFileSync(join(dir, 'export', 'atlas.pack.json'), '{}');
    writeFileSync(join(dir, 'baseline', 'walk', 'baseline.json'), '{}');
    // skeleton_document writes these beside the skeleton it documents.
    writeFileSync(join(dir, 'export', 'hero.spine-doc.json'), '{}');
    writeFileSync(join(dir, 'export', 'nested', 'boss.spine-doc.json'), '{}');
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('lists files recursively', () => {
    const files = listFiles(join(dir, 'export'));
    expect(files.some((file) => file.endsWith('boss.json'))).toBe(true);
    expect(files.some((file) => file.endsWith('hero.atlas'))).toBe(true);
  });

  it('returns nothing for a missing directory', () => {
    expect(listFiles(join(dir, 'nope'))).toEqual([]);
  });

  it('pairs a skeleton with its .atlas', () => {
    const pairs = findExportPairs(join(dir, 'export'));
    const hero = pairs.find((pair) => pair.name === 'hero')!;
    expect(hero.atlas).toBe(join(dir, 'export', 'hero.atlas'));
  });

  it('pairs a skeleton with its .atlas.txt', () => {
    const pairs = findExportPairs(join(dir, 'export'));
    const boss = pairs.find((pair) => pair.name === 'boss')!;
    expect(boss.atlas).toBe(join(dir, 'export', 'nested', 'boss.atlas.txt'));
  });

  it('reports a skeleton with no atlas rather than skipping it', () => {
    const pairs = findExportPairs(join(dir, 'export'));
    const lonely = pairs.find((pair) => pair.name === 'lonely')!;
    expect(lonely.atlas).toBeNull();
  });

  it('ignores settings files and baseline manifests', () => {
    const names = findExportPairs(join(dir, 'export')).map((pair) => pair.name);
    expect(names.sort()).toEqual(['boss', 'hero', 'lonely']);
  });

  it('ignores the documents skeleton_document writes beside a skeleton', () => {
    // Otherwise the lint gate fails on this project's own output.
    const names = findExportPairs(join(dir, 'export')).map((pair) => pair.name);
    expect(names).not.toContain('hero.spine-doc');
    expect(names).not.toContain('boss.spine-doc');
  });

  it('lists baseline subdirectories', () => {
    expect(listSubdirectories(join(dir, 'baseline')).map((path) => path.split(/[\\/]/).pop())).toEqual(
      ['idle', 'walk'],
    );
  });

  it('returns nothing for a missing baseline root', () => {
    expect(listSubdirectories(join(dir, 'nope'))).toEqual([]);
  });
});

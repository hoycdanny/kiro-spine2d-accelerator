/**
 * Documentation consistency.
 *
 * POWER.md and the steering files are read by an AI before it acts, so a
 * tool that exists but is undocumented — or a steering file referenced but
 * absent — is a real defect, not a cosmetic one. These tests fail when the
 * docs and the code disagree.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..');

function read(...parts: string[]): string {
  return readFileSync(join(REPO_ROOT, ...parts), 'utf8');
}

const POWER = read('POWER.md');
const README = read('README.md');
const HOOK = read('hooks', 'pre-spine-tool.kiro.hook');

/** Every tool registered in src/tools/*.ts, found by its registration call. */
function registeredTools(): string[] {
  const dir = join(REPO_ROOT, 'src', 'tools');
  const names: string[] = [];

  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.ts')) continue;
    const source = readFileSync(join(dir, file), 'utf8');
    for (const match of source.matchAll(/registerTool\(\s*'([a-z_]+)'/g)) {
      names.push(match[1]!);
    }
  }

  return [...new Set(names)].sort();
}

const STEERING_FILES = readdirSync(join(REPO_ROOT, 'steering'))
  .filter((file) => file.endsWith('.md'))
  .sort();

describe('tool documentation', () => {
  const tools = registeredTools();

  it('finds every registered tool', () => {
    // A sanity floor: if the scan breaks, the rest of this file is vacuous.
    expect(tools.length).toBeGreaterThanOrEqual(18);
  });

  it('documents every tool in POWER.md', () => {
    const missing = tools.filter((tool) => !POWER.includes(tool));
    expect(missing).toEqual([]);
  });

  it('documents every tool in the README', () => {
    const missing = tools.filter((tool) => !README.includes(tool));
    expect(missing).toEqual([]);
  });

  it('does not document tools that no longer exist', () => {
    // Any `spine_*`/`skeleton_*`-shaped name in the POWER.md tool tables
    // must correspond to a registered tool.
    const documented = [...POWER.matchAll(/`(spine_[a-z_]+|skeleton_[a-z_]+|atlas_inspect|psd_to_skeleton|render_preview|visual_regression|runtime_scaffold|export_settings_build|pack_settings_build)`/g)]
      .map((match) => match[1]!)
      .filter((name) => !name.startsWith('spine_runtimes'));

    const unknown = [...new Set(documented)].filter((name) => !tools.includes(name));
    expect(unknown).toEqual([]);
  });
});

describe('steering files', () => {
  it('ships the full set the Power documents', () => {
    expect(STEERING_FILES).toEqual([
      'ci-pipeline.md',
      'export-automation.md',
      'language-zh-tw.md',
      'psd-to-rig.md',
      'runtime-integration-godot.md',
      'runtime-integration-unity.md',
      'runtime-integration-web.md',
      'skeleton-data-lint.md',
      'spine-general.md',
      'texture-packing.md',
      'version-compatibility.md',
      'visual-regression.md',
      'workflow-automation.md',
    ]);
  });

  it('is fully listed in the POWER.md steering table', () => {
    const missing = STEERING_FILES.filter((file) => !POWER.includes(file));
    expect(missing).toEqual([]);
  });

  it('is fully listed in the auto-activate hook', () => {
    const missing = STEERING_FILES.filter((file) => !HOOK.includes(file));
    expect(missing).toEqual([]);
  });

  it('references no steering file that does not exist', () => {
    const referenced = [...POWER.matchAll(/`([a-z0-9-]+\.md)`/g)].map((match) => match[1]!);
    const unknown = [...new Set(referenced)].filter(
      (file) => !STEERING_FILES.includes(file) && !existsSync(join(REPO_ROOT, file)),
    );
    expect(unknown).toEqual([]);
  });

  it('gives every steering file a purpose comment or front matter', () => {
    const missing = STEERING_FILES.filter((file) => {
      const content = read('steering', file);
      return !content.includes('File Purpose') && !content.startsWith('---');
    });
    expect(missing).toEqual([]);
  });

  it('cross-links each steering file from spine-general', () => {
    const general = read('steering', 'spine-general.md');
    const missing = STEERING_FILES.filter(
      (file) => file !== 'spine-general.md' && file !== 'language-zh-tw.md' && !general.includes(file),
    );
    expect(missing).toEqual([]);
  });
});

describe('referenced paths exist', () => {
  const PATHS = [
    'mcp.json',
    'LICENSE',
    'CONTRIBUTING.md',
    'CODE_OF_CONDUCT.md',
    'README_ZH.md',
    'README_CN.md',
    'README_JP.md',
    'README_KR.md',
    'templates/export-settings/README.md',
    'templates/export-settings/unity-binary.export.json',
    'templates/export-settings/web-json.export.json',
    'templates/export-settings/ci-batch.export.json',
    'templates/pack-settings/unity-default.pack.json',
    'templates/pack-settings/web-pot.pack.json',
    'templates/pack-settings/pixelart.pack.json',
    'templates/lint-rules/naming.json',
    'templates/lint-rules/budgets.json',
    'templates/ci/spine-assets.yml',
    'templates/ci/Invoke-SpineCi.ps1',
    'hooks/pre-spine-tool.kiro.hook',
    'python/pyproject.toml',
    'python/README.md',
    'demo/run-demo.js',
    'demo/make-sample-psd.py',
    'demo/README.md',
    'demo/README_ZH.md',
    'demo/README_CN.md',
    'demo/README_JP.md',
    'demo/README_KR.md',
  ];

  for (const path of PATHS) {
    it(`${path} exists`, () => {
      expect(existsSync(join(REPO_ROOT, path))).toBe(true);
    });
  }

  it('POWER.md references only template folders that exist', () => {
    const referenced = [...POWER.matchAll(/`(templates\/[a-z-]+)\/`/g)].map(
      (match) => match[1]!,
    );
    const unknown = [...new Set(referenced)].filter(
      (path) => !existsSync(join(REPO_ROOT, path)),
    );
    expect(unknown).toEqual([]);
  });
});

describe('the CI templates reference the real entry point', () => {
  it('the workflow calls dist/ci-cli.js', () => {
    const workflow = read('templates', 'ci', 'spine-assets.yml');
    expect(workflow).toContain('dist/ci-cli.js');
    expect(workflow).not.toContain('ci/spine-ci.js');
  });

  it('the PowerShell script calls dist/ci-cli.js', () => {
    const script = read('templates', 'ci', 'Invoke-SpineCi.ps1');
    expect(script).toContain('dist/ci-cli.js');
    expect(script).not.toContain('ci/spine-ci.js');
  });

  it('every subcommand the templates use is implemented', () => {
    const cli = read('src', 'ci-cli.ts');
    for (const command of ['lint', 'regression', 'export', 'diff']) {
      expect(cli).toContain(`case '${command}':`);
    }
  });
});

describe('the hook states the facts that must always hold', () => {
  it('names the Power it activates', () => {
    expect(HOOK).toContain('kiro-spine2d-accelerator');
  });

  it('fires on prompt submit', () => {
    expect(JSON.parse(HOOK).when.type).toBe('promptSubmit');
  });

  it('warns about the editor handoff and the trial locks', () => {
    expect(HOOK).toContain('no in-editor API');
    expect(HOOK).toContain('CLI hang');
    expect(HOOK).toContain('trial cannot save');
  });

  it('is valid JSON', () => {
    // The hook is consumed by the IDE, so a syntax error here disables it
    // silently. This test exists because that happened once already.
    expect(() => JSON.parse(HOOK)).not.toThrow();
  });
});

describe('honesty about verification status', () => {
  it('POWER.md keeps a Known gaps section', () => {
    expect(POWER).toContain('## Known gaps');
    expect(POWER).toContain('No licensed-editor verification');
  });

  it('the README separates verified from unverified', () => {
    expect(README).toContain('Verified against the real thing');
    expect(README).toContain('Not yet verified');
  });

  it('the export settings templates carry their provenance', () => {
    const readme = read('templates', 'export-settings', 'README.md');
    expect(readme).toContain('--last-export-settings');
  });
});

describe('the Spine Runtimes license notice', () => {
  // The HTML written by preview_export_html embeds the Spine Runtimes, so a
  // doc that drops the purchase link leaves someone handing that file over
  // without knowing a license applies. The URL is language-neutral, so the
  // translations stay assertable.
  const DOCS = ['README.md', 'README_ZH.md', 'README_CN.md', 'README_JP.md', 'README_KR.md', 'POWER.md'];

  it('links the purchase page from every top-level document', () => {
    for (const file of DOCS) {
      expect(read(file)).toContain('esotericsoftware.com/spine-purchase');
    }
  });

  it('names the tool whose output embeds the runtime', () => {
    expect(POWER).toContain('preview_export_html');
    expect(README).toContain('preview_export_html');
  });

  it('lists the tool in every language\'s tool table, not only in the license note', () => {
    // A reader of a translated README who only meets the tool inside the
    // license paragraph is told their output needs a license without ever
    // being told the tool exists.
    for (const file of DOCS) {
      const table = read(file)
        .split('\n')
        .filter((line) => line.startsWith('| `preview_export_html`'));
      expect(table).not.toEqual([]);
    }
  });

  it('names the exported file in every demo README language', () => {
    for (const file of ['README.md', 'README_ZH.md', 'README_CN.md', 'README_JP.md', 'README_KR.md']) {
      expect(read('demo', file)).toContain('hero.html');
    }
  });
});

describe('the editor import path is documented', () => {
  // psd_to_skeleton writes an images/ folder of loose per-attachment PNGs
  // because the Spine editor's File -> Import Data resolves attachments
  // against it and never reads the .atlas. A doc that omits this leaves the
  // reader debugging a blank canvas, so both files must state it.
  const PSD_TO_RIG = read('steering', 'psd-to-rig.md');

  it('POWER.md names the images folder and the editor import', () => {
    expect(POWER).toContain('images/');
    expect(POWER).toContain('Import Data');
    expect(POWER).toContain('emitLooseImages');
  });

  it('the psd-to-rig steering file names the images folder and the editor import', () => {
    expect(PSD_TO_RIG).toContain('images/');
    expect(PSD_TO_RIG).toContain('Import Data');
    expect(PSD_TO_RIG).toContain('emitLooseImages');
  });
});

describe('the demo is wired up', () => {
  const PACKAGE = JSON.parse(read('package.json')) as {
    scripts: Record<string, string>;
  };
  const DEMO = read('demo', 'run-demo.js');

  it('is runnable as npm run demo', () => {
    expect(PACKAGE.scripts['demo']).toBe('node demo/run-demo.js');
  });

  it('only calls tools that exist', () => {
    const tools = registeredTools();
    const called = [...DEMO.matchAll(/step\(\s*client,\s*'([a-z_]+)'/g)].map(
      (match) => match[1]!,
    );

    expect(called.length).toBeGreaterThanOrEqual(8);
    expect([...new Set(called)].filter((name) => !tools.includes(name))).toEqual([]);
  });

  it('confines its output to demo/out, which is git-ignored', () => {
    expect(DEMO).toContain("join(__dirname, 'out')");
    expect(read('.gitignore')).toContain('demo/out/');
  });

  it('is documented in every README language', () => {
    for (const file of ['README.md', 'README_ZH.md', 'README_CN.md', 'README_JP.md', 'README_KR.md']) {
      const content = read('demo', file);
      // Each translation carries the run command and the honesty section.
      expect(content).toContain('npm run demo');
      expect(content).toContain('make-sample-psd.py');
      expect(content).toContain('demo/out/regression-diff');
    }
  });

  it('names the loose images folder in every README language', () => {
    // The images/ folder is what makes File -> Import Data resolve
    // attachments; a translation that drops it sends an artist to a blank
    // canvas. The literal is language-neutral, so it stays assertable.
    for (const file of ['README.md', 'README_ZH.md', 'README_CN.md', 'README_JP.md', 'README_KR.md']) {
      const content = read('demo', file);
      expect(content).toContain('images/');
      expect(content).toContain('generated/images/');
      expect(content).toContain('Import Data');
    }
  });

  it('narrates the loose images folder in the demo script', () => {
    expect(DEMO).toContain('images');
    expect(DEMO).toContain('Import Data');
  });

  it('is linked from the top-level READMEs', () => {
    expect(README).toContain('demo/README.md');
    expect(read('README_ZH.md')).toContain('demo/README_ZH.md');
  });

  it('is described in POWER.md so the AI offers it', () => {
    expect(POWER).toContain('npm run demo');
  });
});

/**
 * Documentation consistency.
 *
 * POWER.md and the steering files are read by an AI before it acts, so a
 * tool that exists but is undocumented — or a steering file referenced but
 * absent — is a real defect, not a cosmetic one. These tests fail when the
 * docs and the code disagree.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

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

  it('quotes the same step-2 counts in every README language', () => {
    // The counts follow from the layer table in make-sample-psd.py and are
    // hand-written in five files, so adding a part would silently
    // invalidate all of them — the way the stale 236 KB figure did before
    // it was removed.
    const SAMPLE = read('demo', 'make-sample-psd.py');
    const drawOrder = /DRAW_ORDER: tuple\[str, \.\.\.\] = \(([^)]*)\)/.exec(SAMPLE);
    expect(drawOrder).not.toBeNull();

    const layers = [...drawOrder![1]!.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]!);
    // `cape` is the deliberate unrecognised layer: reported, not rigged.
    const attachments = layers.filter((name) => name !== 'cape').length;
    const virtualBones = ['root', 'neck', 'shoulder_left', 'shoulder_right'];
    // One bone per rigged layer, plus the intermediates the PSD omits.
    const counts = [attachments + virtualBones.length, attachments, virtualBones.length, attachments];

    expect(layers).toContain('cape');
    expect(counts).toEqual([20, 16, 4, 16]);

    for (const file of ['README.md', 'README_ZH.md', 'README_CN.md', 'README_JP.md', 'README_KR.md']) {
      const rows = read('demo', file)
        .split('\n')
        .filter((line) => /^\|\s*2\./.test(line));
      expect(rows).toHaveLength(1);

      // Cell 2 of the table row is the counts cell; the digits in it are
      // the four numbers, in the same order in every translation.
      const cell = rows[0]!.split('|')[2]!;
      expect([...cell.matchAll(/\d+/g)].map((match) => Number(match[0]))).toEqual(counts);
      for (const bone of [...virtualBones, 'cape']) {
        expect(cell).toContain(bone);
      }
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

describe('skeleton intelligence tools are documented honestly', () => {
  // Every assertion here is a language-neutral literal — a tool name, a file
  // extension, or an English phrase that is deliberately kept in English in
  // every translation. That is what makes the four translated READMEs
  // checkable without reading them.
  const READMES = ['README.md', 'README_ZH.md', 'README_CN.md', 'README_JP.md', 'README_KR.md'];
  const TOOLS = ['skeleton_document', 'skeleton_animate'];

  /**
   * What must not appear is the *claim*, not the words.
   *
   * An earlier version of this test banned the substring `artist quality`
   * outright. That cannot tell a boast from a disclaimer, so it also banned
   * "not artist quality" — the honest disclaimer the tool itself prints, and
   * the exact opposite of overselling. The rule it was derived from, FR-B14
   * and AC-34 in requirements.md, bans wording that *claims or implies*
   * artist quality. These patterns ban that instead.
   *
   * `(?<!not )` and friends are what keep the disclaimer legal: the phrase is
   * an offence only when nothing negates it.
   */
  const FORBIDDEN_CLAIMS: Array<{ label: string; pattern: RegExp }> = [
    {
      label: 'claims artist quality without negating it',
      pattern: /(?<!\b(?:not|never|no|isn't|is not|rather than)\s)\bartist[- ]quality\b/i,
    },
    {
      label: 'claims production readiness without negating it',
      pattern: /(?<!\b(?:not|never|no|isn't|is not|rather than)\s)\bproduction[- ]ready\b/i,
    },
    { label: 'claims it replaces an animator', pattern: /\breplaces an animator\b/i },
    { label: 'claims professional quality', pattern: /\bprofessional[- ](?:quality|grade)\b/i },
  ];

  function claimsIn(content: string): string[] {
    return FORBIDDEN_CLAIMS.filter((claim) => claim.pattern.test(content)).map((claim) => claim.label);
  }

  it('names both tools in POWER.md and in every README language', () => {
    for (const tool of TOOLS) {
      expect(POWER).toContain(tool);
    }

    for (const file of READMES) {
      const content = read(file);
      for (const tool of TOOLS) {
        expect(content.includes(tool)).toBe(true);
      }
    }
  });

  it('claims no artist quality anywhere', () => {
    const offenders: string[] = [];

    for (const file of ['POWER.md', 'docs/USAGE.md', ...READMES]) {
      for (const label of claimsIn(read(file))) offenders.push(`${file}: ${label}`);
    }

    expect(offenders).toEqual([]);
  });

  it('fails on the boast and passes the disclaimer', () => {
    // Both directions are asserted so the intent of the rule above is
    // documented here rather than in a commit message. A substring ban would
    // flag all four of these; a claim ban flags only the first two.
    expect(claimsIn('skeleton_animate produces artist-quality animation.')).not.toEqual([]);
    expect(claimsIn('The output is production-ready.')).not.toEqual([]);

    expect(claimsIn('mechanically plausible placeholder motion, not artist quality')).toEqual([]);
    expect(claimsIn('This is placeholder motion and is not production-ready.')).toEqual([]);
  });

  it('states the placeholder-motion caveat next to the generator', () => {
    expect(POWER).toContain('mechanically plausible');
    expect(README).toContain('mechanically plausible');
  });

  it('mirrors the honesty sentence from its single source of truth', () => {
    // The sentence lives once, in src/animation-templates.ts, and feeds the
    // tool description, the tool summary and `_generator.note`. Reading it
    // out of the source rather than hard-coding it here means editing the
    // constant fails this test loudly instead of letting the documents drift
    // away from what the tool actually prints — and makes copying the
    // constant into a document the correct thing to do.
    const source = read('src', 'animation-templates.ts');
    const match = /export const PLACEHOLDER_MOTION_NOTE =\s*'([^']+)'/.exec(source);

    expect(match).not.toBeNull();
    const note = match![1]!;
    expect(note).toContain('mechanically plausible placeholder motion');

    // POWER.md and README.md reproduce it verbatim as English prose. The four
    // translations explain it in their own language and quote the English
    // sentence as the literal tool output, which is how every other tool
    // string is handled in those files.
    // docs/USAGE.md quotes it twice: once as the real summary line a run
    // printed, and once as the sentence the tool prints with every result.
    const missing = ['POWER.md', 'docs/USAGE.md', ...READMES].filter(
      (file) => !read(file).includes(note),
    );
    expect(missing).toEqual([]);
  });

  it('names the document files and the fingerprint', () => {
    expect(POWER).toContain('spine-doc.json');
    expect(POWER).toContain('fingerprint');
  });

  it('documents both tools in the steering files that cover them', () => {
    expect(read('steering', 'skeleton-data-lint.md')).toContain('skeleton_document');
    expect(read('steering', 'psd-to-rig.md')).toContain('skeleton_animate');
  });
});

describe('the documentation images', () => {
  // These are the only binary files in the repository, and they carry most
  // of the README's argument. GitHub renders a missing image as a silent
  // broken box on the project's front page, in five languages at once, so
  // the failure has to happen here instead.
  const READMES = ['README.md', 'README_ZH.md', 'README_CN.md', 'README_JP.md', 'README_KR.md'];

  /** The still images `docs/make-doc-images.mjs` is expected to produce. */
  const COMMITTED_PNGS = [
    'attachment-images.png',
    'generated-walk.png',
    'interactive-preview.png',
    'psd-to-rig.png',
    'visual-regression-diff.png',
  ];

  /** The animated ones, from the same generator and the same frames. */
  const COMMITTED_GIFS = ['generated-walk.gif', 'hero-wave.gif'];

  /** Every image `docs/make-doc-images.mjs` is expected to produce. */
  const COMMITTED_IMAGES = [...COMMITTED_PNGS, ...COMMITTED_GIFS].sort();

  /** Markdown image references, as [altText, path] pairs. */
  function imageReferences(markdown: string): Array<[string, string]> {
    return [...markdown.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)].map((match) => [
      match[1]!,
      match[2]!,
    ]);
  }

  it('ships exactly the set the generator writes', () => {
    const present = readdirSync(join(REPO_ROOT, 'docs', 'images')).sort();
    expect(present).toEqual(COMMITTED_IMAGES);
  });

  it('is regenerated by a committed script, wired to an npm script', () => {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> })
      .scripts;
    expect(scripts['docs:images']).toBe('node docs/make-doc-images.mjs');
    expect(existsSync(join(REPO_ROOT, 'docs', 'make-doc-images.mjs'))).toBe(true);
    expect(existsSync(join(REPO_ROOT, 'docs', 'compose-doc-images.py'))).toBe(true);
  });

  it('names every committed image in the generator, so an orphan is visible', () => {
    const generator = read('docs', 'make-doc-images.mjs');
    const missing = COMMITTED_IMAGES.filter((file) => !generator.includes(file));
    expect(missing).toEqual([]);
  });

  it('holds a real PNG in every file, not a zero-byte placeholder', () => {
    // The obvious failure mode of a generated-image set is a file that
    // exists and renders as nothing. Check the signature and a size floor
    // rather than the exact bytes, which are not reproducible across
    // Chromium builds.
    for (const file of COMMITTED_PNGS) {
      const bytes = readFileSync(join(REPO_ROOT, 'docs', 'images', file));
      expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(bytes.byteLength).toBeGreaterThan(4096);
    }
  });

  it('holds a real GIF in every animated file, under the README size budget', () => {
    // A 600 KB ceiling per file, because the front page loads both of them
    // before the reader has asked for anything.
    for (const file of COMMITTED_GIFS) {
      const bytes = readFileSync(join(REPO_ROOT, 'docs', 'images', file));
      expect(bytes.subarray(0, 6).toString('latin1')).toBe('GIF89a');
      expect(bytes.byteLength).toBeGreaterThan(4096);
      expect(bytes.byteLength).toBeLessThan(600 * 1024);
    }
  });

  it('animates every GIF, so a single-frame still cannot pass as one', () => {
    // Each frame of an animated GIF is preceded by a Graphic Control
    // Extension (0x21 0xF9 0x04), so one marker means one frame, which is
    // what a mis-saved GIF looks like.
    for (const file of COMMITTED_GIFS) {
      const bytes = readFileSync(join(REPO_ROOT, 'docs', 'images', file));
      let markers = 0;
      for (let at = 0; at < bytes.byteLength - 2; at += 1) {
        if (bytes[at] === 0x21 && bytes[at + 1] === 0xf9 && bytes[at + 2] === 0x04) {
          markers += 1;
        }
      }

      expect(markers).toBeGreaterThanOrEqual(2);
    }
  });

  it('loops every GIF, so the motion does not stop after one pass', () => {
    // The loop count lives in the NETSCAPE2.0 application extension; with
    // no such block a viewer plays the file once and leaves the last frame.
    for (const file of COMMITTED_GIFS) {
      const bytes = readFileSync(join(REPO_ROOT, 'docs', 'images', file));
      expect(bytes.toString('latin1')).toContain('NETSCAPE2.0');
    }
  });

  it('keeps the still walk strip as the fallback for the walk GIF', () => {
    // A reader whose viewer does not play a GIF still has to be able to see
    // that the rig moves, so the three stills are not replaced by the loop.
    const walk = ['generated-walk.png', 'generated-walk.gif'];

    for (const file of walk) {
      expect(existsSync(join(REPO_ROOT, 'docs', 'images', file))).toBe(true);
    }

    for (const readme of READMES) {
      const referenced = imageReferences(read(readme)).map(([, path]) => path);
      for (const file of walk) {
        expect(referenced).toContain(`docs/images/${file}`);
      }
    }
  });

  it('resolves every image path referenced from any README', () => {
    const broken: string[] = [];

    for (const file of READMES) {
      for (const [, path] of imageReferences(read(file))) {
        if (!existsSync(join(REPO_ROOT, path))) broken.push(`${file}: ${path}`);
      }
    }

    expect(broken).toEqual([]);
  });

  it('references the images relatively, so GitHub renders them', () => {
    // An absolute path or a raw.githubusercontent URL breaks on a fork and
    // on a local clone, which is where most of these are read.
    const offenders: string[] = [];

    for (const file of READMES) {
      for (const [, path] of imageReferences(read(file))) {
        if (!path.startsWith('docs/images/')) offenders.push(`${file}: ${path}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('gives every image alt text in every language', () => {
    // The alt text is the only version of these pictures a screen reader
    // gets, so an empty one is a defect rather than a style question.
    const offenders: string[] = [];

    for (const file of READMES) {
      for (const [alt, path] of imageReferences(read(file))) {
        if (alt.trim().length < 20) offenders.push(`${file}: ${path}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('shows the same images in every language', () => {
    // Translation parity for the pictures: a reader of any language sees
    // the same evidence, and renaming one image fails five assertions.
    const expected = COMMITTED_IMAGES.map((file) => `docs/images/${file}`);

    for (const file of READMES) {
      const referenced = [...new Set(imageReferences(read(file)).map(([, path]) => path))].sort();
      expect(referenced).toEqual(expected);
    }
  });
});

describe('the five READMEs stay at parity on the caveats', () => {
  // Each literal below is language-neutral — a version number, a tool name
  // or a path — which is what makes the four translations checkable.
  const READMES = ['README.md', 'README_ZH.md', 'README_CN.md', 'README_JP.md', 'README_KR.md'];

  it('records the single-platform verification in every language', () => {
    // The English README gained this row first and the translations did
    // not, which left four documents claiming broader verification than
    // was done. The exact build strings are the assertable part.
    for (const file of READMES) {
      const content = read(file);
      expect(content).toContain('win32 x64');
      expect(content).toContain('playwright-core 1.62.0');
      expect(content).toContain('Chromium 151.0.7922.34');
      expect(content).toContain('4.2.120');
    }
  });

  it('names the pinned optional dependencies in every language', () => {
    for (const file of READMES) {
      const content = read(file);
      expect(content).toContain('@esotericsoftware/spine-webgl');
      expect(content).toContain('playwright-core');
    }
  });

  it('states the Node floor in every language', () => {
    for (const file of READMES) {
      expect(/Node\.js 18/.test(read(file))).toBe(true);
    }
  });

  it('shows the mcp.json server shape in every language', () => {
    // Setup was the weakest part of the old README. These four literals are
    // the whole wiring: a translation that drops one leaves a reader with a
    // server that never starts.
    for (const file of READMES) {
      const content = read(file);
      expect(content).toContain('"spine-mcp"');
      expect(content).toContain('"./dist/server.js"');
      expect(content).toContain('SPINE_EXECUTABLE');
      expect(content).toContain('SPINE_USER_DATA');
    }
  });

  it('documents regenerating the images in every language', () => {
    for (const file of READMES) {
      expect(read(file)).toContain('npm run docs:images');
    }
  });
});

describe('the Chromium install command', () => {
  // This project depends on playwright-core, pinned to 1.62.0, and the full
  // playwright package is not installed. `npx playwright install` therefore
  // fetches playwright from the registry at whatever version resolves and
  // downloads the Chromium revision that version wants, defeating the pin.
  // The only correct spelling is `npx playwright-core install`.
  const SKIP = new Set(['node_modules', '.git', '.worktrees', 'dist', 'coverage', 'out']);

  function markdownFiles(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) markdownFiles(join(dir, entry.name), found);
      } else if (entry.name.endsWith('.md')) {
        found.push(join(dir, entry.name));
      }
    }

    return found;
  }

  const DOCS = markdownFiles(REPO_ROOT);

  it('finds the documents to check', () => {
    // A sanity floor, so the assertion below cannot pass vacuously.
    expect(DOCS.length).toBeGreaterThanOrEqual(25);
  });

  it('is never spelled as the full playwright package in any document', () => {
    const offenders = DOCS.filter((file) =>
      readFileSync(file, 'utf8').includes('npx playwright install'),
    ).map((file) => relative(REPO_ROOT, file));

    expect(offenders).toEqual([]);
  });
});

describe('the usage guide', () => {
  // docs/USAGE.md quotes command lines, flag names, defaults and error
  // strings out of the source. Every assertion below reads the source side
  // from the source, so editing the code fails here rather than letting the
  // guide describe a version of the tool that no longer exists.
  const READMES = ['README.md', 'README_ZH.md', 'README_CN.md', 'README_JP.md', 'README_KR.md'];
  const GUIDE_PATH = join(REPO_ROOT, 'docs', 'USAGE.md');

  it('exists', () => {
    expect(existsSync(GUIDE_PATH)).toBe(true);
  });

  // Read tolerantly: a missing guide has to fail the cases below as
  // assertions, not as a collection error that reports zero tests run.
  const USAGE_GUIDE = existsSync(GUIDE_PATH) ? readFileSync(GUIDE_PATH, 'utf8') : '';

  it('is linked from every README language', () => {
    // The link is the only way a reader of a translated README finds it, so
    // the literal path is asserted rather than the surrounding sentence.
    for (const file of READMES) {
      expect(read(file)).toContain('docs/USAGE.md');
    }
  });

  it('has no half-translated sibling', () => {
    // The guide is deliberately English-only. A docs/USAGE_ZH.md that lags
    // behind it is worse than no translation, so its appearance fails here
    // instead of quietly becoming four more documents to maintain.
    const siblings = readdirSync(join(REPO_ROOT, 'docs')).filter((entry) =>
      /^USAGE_.*\.md$/i.test(entry),
    );
    expect(siblings).toEqual([]);
  });

  it('resolves every relative link it carries', () => {
    // Links in docs/USAGE.md are resolved by GitHub relative to docs/, so
    // that is what they are resolved against here.
    const broken: string[] = [];

    for (const match of USAGE_GUIDE.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1]!;
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const path = target.split('#')[0]!;
      if (path.length === 0) continue;
      if (!existsSync(join(REPO_ROOT, 'docs', path))) broken.push(target);
    }

    expect(broken).toEqual([]);
  });

  it('reproduces the four ci-cli usage lines verbatim', () => {
    // The USAGE constant in src/ci-cli.ts is the authoritative flag list.
    // Comparing against it, rather than against a copy pasted into this
    // test, is what makes a new flag fail the suite.
    const cli = read('src', 'ci-cli.ts');
    const lines = [...cli.matchAll(/^ {2}node dist\/ci-cli\.js .*$/gm)].map(
      (match) => match[0]!,
    );

    expect(lines).toHaveLength(4);
    const missing = lines.filter((line) => !USAGE_GUIDE.includes(line));
    expect(missing).toEqual([]);
  });

  it('states the exit codes the CLI actually uses', () => {
    // A pipeline that treats 1 and 2 alike ships a broken asset the day a
    // path is mistyped, so the three meanings are spelled out in the guide.
    expect(USAGE_GUIDE).toContain('0 pass, 1 gate failed, 2 usage or operational error');
  });

  it('quotes the skeleton_document defaults that are in the source', () => {
    const source = read('src', 'tools', 'doc-tools.ts');
    const defaults: Array<[string, string]> = [
      ['probeRotationDegrees', 'probeRotationDegrees ?? 20'],
      ['maxProbes', 'maxProbes ?? 256'],
      ['probeWidth', 'probeWidth ?? 256'],
    ];

    for (const [name, expression] of defaults) {
      expect(source).toContain(expression);
      const value = expression.split('?? ')[1]!;
      // The guide's argument table carries the name and its default on one
      // row, which is the shape this asserts.
      expect(USAGE_GUIDE).toMatch(new RegExp(`\`${name}\`[^\\n]*\`${value}\``));
    }
  });

  it('names all five animation templates', () => {
    const source = read('src', 'animation-templates.ts');
    const declared = /export const TEMPLATE_NAMES = \[([^\]]+)\]/.exec(source);

    expect(declared).not.toBeNull();
    const names = [...declared![1]!.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]!);
    expect(names).toHaveLength(5);

    const missing = names.filter((name) => !USAGE_GUIDE.includes(`\`${name}\``));
    expect(missing).toEqual([]);
  });
});

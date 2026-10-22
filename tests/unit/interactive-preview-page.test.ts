import {
  InteractivePageInput,
  LICENSE_SENTENCE,
  PURCHASE_URL,
  buildInteractiveHtml,
  embedJson,
} from '../../src/interactive-preview-page';
import { RENDERABLE_ATLAS, RENDERABLE_SKELETON, toJsonText } from '../helpers/fixtures';

const RUNTIME_SOURCE = '/* spine-webgl stub */ var spine = { marker: "RUNTIME-MARKER" };';
const PAGE_DATA_URL = 'data:image/png;base64,AAAABBBB';

function input(overrides: Partial<InteractivePageInput> = {}): InteractivePageInput {
  return {
    skeletonJson: toJsonText(RENDERABLE_SKELETON),
    atlasText: RENDERABLE_ATLAS,
    images: { 'fixture.png': PAGE_DATA_URL },
    animation: 'spin',
    skin: null,
    premultipliedAlpha: false,
    scale: 1,
    background: [0, 0, 0, 0],
    width: 320,
    height: 240,
    title: 'hero.json',
    showBones: false,
    ...overrides,
  };
}

describe('embedJson', () => {
  it('cannot break out of a script element', () => {
    const embedded = embedJson({ text: '</script><script>alert(1)</script>' });
    expect(embedded).not.toContain('</script>');
    expect(embedded).not.toContain('<');
    expect(embedded).toContain('\\u003c');
  });

  it('escapes the line separators that are legal JSON but not legal JS', () => {
    const embedded = embedJson({ text: 'a\u2028b\u2029c' });
    expect(embedded).toContain('\\u2028');
    expect(embedded).toContain('\\u2029');
    expect(embedded).not.toMatch(/[\u2028\u2029]/);
  });

  it('stays parseable as JSON after escaping', () => {
    const value = { text: '<b>&</b>\u2028end' };
    expect(JSON.parse(embedJson(value))).toEqual(value);
  });
});

describe('buildInteractiveHtml', () => {
  const html = buildInteractiveHtml(RUNTIME_SOURCE, input());

  it('inlines the runtime source', () => {
    expect(html).toContain('RUNTIME-MARKER');
  });

  it('inlines the skeleton JSON, the atlas text and every page data URL', () => {
    // The payload is JSON-encoded inside the page, so assert on fragments
    // that survive that encoding.
    expect(html).toContain('renderable');
    expect(html).toContain('bounds: 0, 0, 64, 64');
    expect(html).toContain(PAGE_DATA_URL);
  });

  it('fetches nothing: the only remote URL is the licence link', () => {
    const urls = [...html.matchAll(/https?:\/\/[^\s"'<)]+/g)].map((match) => match[0]);
    expect(urls.length).toBeGreaterThan(0);
    expect([...new Set(urls)]).toEqual([PURCHASE_URL]);
  });

  it('states the distribution licence in the body and in a comment', () => {
    expect(html).toContain(LICENSE_SENTENCE);
    expect(html).toContain('your own Spine license');
    expect(html).toContain(`<a href="${PURCHASE_URL}">`);
  });

  it('carries every control, each one labelled', () => {
    for (const id of [
      'spine-canvas',
      'play-toggle',
      'timeline',
      'time-readout',
      'animation-select',
      'speed-select',
      'loop-toggle',
      'bones-toggle',
      'viewer-status',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }

    for (const id of ['timeline', 'animation-select', 'speed-select', 'loop-toggle', 'bones-toggle']) {
      expect(html).toContain(`for="${id}"`);
    }

    expect(html).toContain('aria-pressed=');
    expect(html).toContain('aria-label="Interactive Spine skeleton preview of hero.json"');
  });

  it('uses the requested canvas size and title', () => {
    expect(html).toContain('width="320" height="240"');
    expect(html).toContain('<h1>hero.json</h1>');
  });

  it('escapes a title that contains markup', () => {
    const escaped = buildInteractiveHtml(RUNTIME_SOURCE, input({ title: '<img src=x>' }));
    expect(escaped).toContain('&lt;img src=x&gt;');
    expect(escaped).not.toContain('<img src=x>');
  });

  it('starts the bones overlay off by default and on when asked', () => {
    expect(html).toContain('id="bones-toggle" type="checkbox">');
    const withBones = buildInteractiveHtml(RUNTIME_SOURCE, input({ showBones: true }));
    expect(withBones).toContain('id="bones-toggle" type="checkbox" checked>');
  });
});

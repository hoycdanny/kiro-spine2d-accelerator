import { byCodeUnit, canonicalJson, round } from '../../src/canonical-json';

describe('byCodeUnit', () => {
  it('orders by code unit, so uppercase precedes lowercase', () => {
    expect(['b', 'a', 'C', 'A'].sort(byCodeUnit)).toEqual(['A', 'C', 'a', 'b']);
  });

  it('reports equality as zero', () => {
    expect(byCodeUnit('head', 'head')).toBe(0);
    expect(byCodeUnit('a', 'b')).toBe(-1);
    expect(byCodeUnit('b', 'a')).toBe(1);
  });

  it('is a genuinely different comparator from localeCompare', () => {
    // The point of the module: a locale-sensitive comparator would order
    // the same keys differently, and key order decides the hashed bytes.
    // Asserted directly rather than through a child process, because LANG
    // and LC_ALL do not move Node's ICU on Windows.
    expect('Head'.localeCompare('head', 'tr-TR')).not.toBe(byCodeUnit('Head', 'head'));
  });
});

describe('round', () => {
  it('normalises negative zero to zero', () => {
    expect(Object.is(round(-0, 2), 0)).toBe(true);
  });

  it('rounds to the requested number of places', () => {
    expect(round(1 / 3, 4)).toBe(0.3333);
    expect(round(0.12345, 3)).toBe(0.123);
  });

  it('drops trailing zeros', () => {
    expect(round(2.5, 3)).toBe(2.5);
    expect(round(7, 4)).toBe(7);
  });
});

describe('canonicalJson', () => {
  it('sorts object keys recursively', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('preserves array order, because in skeleton data order is the data', () => {
    expect(canonicalJson({ list: [3, 1, 2] })).toBe('{"list":[3,1,2]}');
  });

  it('sorts keys inside array elements', () => {
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it('formats finite numbers to six decimal places', () => {
    expect(canonicalJson({ n: 1 / 3 })).toBe('{"n":0.333333}');
    expect(canonicalJson({ n: 1.0000004 })).toBe('{"n":1}');
  });

  it('turns non-finite numbers into null', () => {
    expect(canonicalJson({ a: NaN, b: Infinity, c: -Infinity })).toBe(
      '{"a":null,"b":null,"c":null}',
    );
  });

  it('passes other primitives through', () => {
    expect(canonicalJson({ s: 'x', t: true, n: null })).toBe(
      '{"n":null,"s":"x","t":true}',
    );
  });

  it('produces the same bytes regardless of insertion order', () => {
    const a = canonicalJson({ head: 1, hip: 2, torso: 3 });
    const b = canonicalJson({ torso: 3, head: 1, hip: 2 });
    expect(a).toBe(b);
  });

  it('orders dotted-case keys by code unit, not by locale', () => {
    // 'I' (U+0049), 'i' (U+0069), 'İ' (U+0130), 'ı' (U+0131). A Turkish
    // collation would interleave these differently; code-unit order is
    // fixed, so the hashed bytes mean the same thing on every machine.
    expect(canonicalJson({ ı: 1, İ: 2, i: 3, I: 4 })).toBe(
      '{"I":4,"i":3,"İ":2,"ı":1}',
    );
  });
});

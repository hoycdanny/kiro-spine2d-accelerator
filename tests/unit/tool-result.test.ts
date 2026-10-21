import {
  MAX_INLINE_DETAIL_CHARS,
  fromException,
  guardTool,
  jsonBlock,
  toToolResult,
} from '../../src/tool-result';
import { SpineErrorCode, err, ok } from '../../src/types';

describe('toToolResult', () => {
  it('returns a summary block followed by a JSON block on success', () => {
    const result = toToolResult(ok({ version: '4.2.37' }, 'Spine 4.2.37 found.'));
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(2);
    expect(result.content[0]?.text).toBe('Spine 4.2.37 found.');
    expect(JSON.parse(result.content[1]!.text)).toEqual({ version: '4.2.37' });
    expect(result.structuredContent).toEqual({ ok: true, data: { version: '4.2.37' } });
  });

  it('marks failures as errors and keeps code, message and hint', () => {
    const result = toToolResult(
      err(SpineErrorCode.CapabilityDenied, 'Export is blocked.', 'Purchase a license.'),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('CAPABILITY_DENIED: Export is blocked.');
    expect(result.content[0]?.text).toContain('Hint: Purchase a license.');
    expect(result.structuredContent).toEqual({
      ok: false,
      code: SpineErrorCode.CapabilityDenied,
      message: 'Export is blocked.',
      hint: 'Purchase a license.',
    });
  });

  it('includes details when present', () => {
    const result = toToolResult(
      err(SpineErrorCode.CliFailed, 'Export failed.', 'Check the log.', {
        commandLine: 'SpineTrial.com -i a.spine -e json',
      }),
    );
    expect(result.content[0]?.text).toContain('SpineTrial.com -i a.spine -e json');
    expect(result.structuredContent['details']).toEqual({
      commandLine: 'SpineTrial.com -i a.spine -e json',
    });
  });

  it('keeps oversized details out of the text but in the payload', () => {
    const big = { pixels: Array.from({ length: 2000 }, (_, index) => index) };
    const result = toToolResult(
      err(SpineErrorCode.GateFailed, 'Regression failed.', 'Look at the diffs.', big),
    );

    const text = result.content[0]!.text;
    expect(text).toContain('Regression failed.');
    expect(text).toContain('characters of structured detail omitted');
    expect(text.length).toBeLessThan(MAX_INLINE_DETAIL_CHARS + 400);
    // The data itself is still available to a machine caller.
    expect((result.structuredContent['details'] as typeof big).pixels).toHaveLength(2000);
  });
});

describe('guardTool', () => {
  it('passes successful results through', async () => {
    const result = await guardTool(() => ok({ a: 1 }, 'done'));
    expect(result.structuredContent).toEqual({ ok: true, data: { a: 1 } });
  });

  it('converts a thrown error into a structured failure', async () => {
    const result = await guardTool(() => {
      throw new Error('boom');
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent['code']).toBe(SpineErrorCode.CliFailed);
    expect(result.content[0]?.text).toContain('boom');
  });

  it('handles non-Error throws', () => {
    expect(fromException('plain string').message).toContain('plain string');
  });

  it('awaits async handlers', async () => {
    const result = await guardTool(async () => ok('v', 's'));
    expect(result.structuredContent).toEqual({ ok: true, data: 'v' });
  });
});

describe('jsonBlock', () => {
  it('pretty-prints with two-space indentation', () => {
    expect(jsonBlock({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

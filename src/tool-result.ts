// ============================================================
// Mapping between the internal result envelope and MCP tool results.
//
// Every tool answers with two blocks: a short human-readable summary and a
// JSON block carrying the machine-readable payload. Failures keep the same
// shape so an AI caller never has to guess whether a call succeeded.
// ============================================================

import { SpineErr, SpineErrorCode, SpineResult, err } from './types';

/**
 * The subset of the MCP `CallToolResult` shape this project produces.
 *
 * The index signature is required by the SDK's result type, which allows
 * arbitrary extra fields alongside `content`.
 */
export interface ToolResultPayload {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * Largest error detail block inlined into the human-readable text. Larger
 * payloads stay in `structuredContent` only.
 */
export const MAX_INLINE_DETAIL_CHARS = 1200;

/**
 * How many names a summary line spells out before falling back to a count.
 * The full lists travel in `structuredContent`, so a summary stays well
 * inside {@link MAX_INLINE_DETAIL_CHARS} no matter how many items there are.
 *
 * This and {@link nameList} live here, next to the budget they protect,
 * because more than one tool group needs them. Hoisting them out of
 * `tools/generate-tools.ts` was a deliberate tidy-up rather than something
 * a requirement asked for; the value is unchanged, so no message moved.
 */
export const MAX_NAMED_ITEMS = 5;

/** A few names inline, the remainder as a count. */
export function nameList(names: string[]): string {
  const shown = names.slice(0, MAX_NAMED_ITEMS).join(', ');
  const extra = names.length - MAX_NAMED_ITEMS;
  return extra > 0 ? `${shown} and ${extra} more` : shown;
}

/** Render a value as a stable, readable JSON block. */
export function jsonBlock(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Convert an internal result into an MCP tool result. */
export function toToolResult<T>(result: SpineResult<T>): ToolResultPayload {
  if (result.ok) {
    return {
      content: [
        { type: 'text', text: result.summary },
        { type: 'text', text: jsonBlock(result.data) },
      ],
      structuredContent: { ok: true, data: result.data as unknown } as Record<
        string,
        unknown
      >,
    };
  }

  const lines = [`${result.code}: ${result.message}`, `Hint: ${result.hint}`];

  if (result.details) {
    // Details are always in the structured payload. They are inlined into
    // the text only when small enough to read: a failing visual regression
    // carries per-pixel data, and dumping that into a chat transcript
    // buries the one line that says what to do.
    const rendered = jsonBlock(result.details);
    lines.push(
      rendered.length <= MAX_INLINE_DETAIL_CHARS
        ? rendered
        : `(${rendered.length} characters of structured detail omitted here; read it from the result payload)`,
    );
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    structuredContent: {
      ok: false,
      code: result.code,
      message: result.message,
      hint: result.hint,
      ...(result.details ? { details: result.details } : {}),
    },
    isError: true,
  };
}

/**
 * Wrap a tool handler so unexpected exceptions become structured failures
 * instead of transport-level errors.
 */
export async function guardTool<T>(
  handler: () => Promise<SpineResult<T>> | SpineResult<T>,
): Promise<ToolResultPayload> {
  try {
    return toToolResult(await handler());
  } catch (cause) {
    return toToolResult(fromException(cause));
  }
}

/** Convert a thrown value into a structured failure. */
export function fromException(cause: unknown): SpineErr {
  const message = cause instanceof Error ? cause.message : String(cause);
  return err(
    SpineErrorCode.CliFailed,
    `Unexpected failure: ${message}`,
    'This is likely a bug in the Spine Power execution layer. Re-run with the same inputs and report the message if it persists.',
  );
}

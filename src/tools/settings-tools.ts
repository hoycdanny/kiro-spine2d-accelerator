// ============================================================
// Group B — settings file generation.
//
//   export_settings_build : template diff, because the export settings
//                           schema is not documented
//   pack_settings_build   : full field-by-field generation, because the
//                           pack.json schema is documented
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';

import {
  BUILT_IN_EXPORT_TEMPLATES,
  BuiltExportSettings,
  applyExportOverrides,
  builtInTemplateRelativePath,
  explainExportSettings,
  isBuiltInTemplate,
  serializeExportSettings,
} from '../export-settings';
import { SpineHost } from '../host';
import {
  BuiltPackSettings,
  PackSettings,
  buildPackSettings,
  explainPackSettings,
  serializePackSettings,
} from '../pack-settings';
import { resolveWriteTarget } from '../path-safety';
import { guardTool } from '../tool-result';
import { SpineErrorCode, SpineResult, err, ok } from '../types';
import { readTextFile } from './data-tools';

/** Bundled pack settings template names. */
export const BUILT_IN_PACK_TEMPLATES = ['unity-default', 'web-pot', 'pixelart'] as const;

export type BuiltInPackTemplate = (typeof BUILT_IN_PACK_TEMPLATES)[number];

/** Relative path of a bundled pack template. */
export function builtInPackTemplateRelativePath(name: BuiltInPackTemplate): string {
  return `templates/pack-settings/${name}.pack.json`;
}

/**
 * Resolve a template reference: a bundled name, or a path.
 *
 * Bundled templates live inside the package, which is outside the
 * workspace, so they are read through `packageRoot` rather than the
 * workspace-relative reader.
 */
export function resolveTemplate(
  host: SpineHost,
  reference: string,
  kind: 'export' | 'pack',
): SpineResult<{ path: string; parsed: Record<string, unknown> }> {
  const builtIn =
    kind === 'export'
      ? isBuiltInTemplate(reference)
        ? builtInTemplateRelativePath(reference)
        : null
      : (BUILT_IN_PACK_TEMPLATES as readonly string[]).includes(reference)
        ? builtInPackTemplateRelativePath(reference as BuiltInPackTemplate)
        : null;

  let absolute: string;
  let text: string | null;

  if (builtIn !== null) {
    absolute = join(host.packageRoot, builtIn);
    text = host.readText(absolute);
    if (text === null) {
      return err(
        SpineErrorCode.InputMissing,
        `Bundled template not found: ${absolute}`,
        'The Power package looks incomplete. Reinstall it, or pass a path to your own template file.',
      );
    }
  } else {
    const file = readTextFile(host, reference, `${kind} settings template`);
    if (!file.ok) {
      const names =
        kind === 'export' ? BUILT_IN_EXPORT_TEMPLATES : BUILT_IN_PACK_TEMPLATES;
      return err(
        file.code,
        file.message,
        `${file.hint} Built-in template names: ${names.join(', ')}.`,
        file.details,
      );
    }
    absolute = file.data.absolute;
    text = file.data.text;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    return err(
      SpineErrorCode.ParseFailed,
      `Template is not valid JSON: ${absolute}`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return err(
      SpineErrorCode.ParseFailed,
      `Template must be a JSON object: ${absolute}`,
      'Settings files are flat JSON objects.',
    );
  }

  return ok(
    { path: absolute, parsed: parsed as Record<string, unknown> },
    `Loaded template ${absolute}.`,
  );
}

/** Payload returned by `export_settings_build`. */
export interface ExportSettingsBuildData {
  templatePath: string;
  outputPath: string | null;
  built: BuiltExportSettings;
  /** The file content that was written, or would be written. */
  content: string;
}

/** Build an export settings file from a template plus overrides. */
export function exportSettingsBuild(
  host: SpineHost,
  args: {
    template: string;
    overrides?: Record<string, unknown> | undefined;
    output?: string | undefined;
    allowNewKeys?: boolean | undefined;
  },
): SpineResult<ExportSettingsBuildData> {
  const template = resolveTemplate(host, args.template, 'export');
  if (!template.ok) return template;

  const built = applyExportOverrides(template.data.parsed, args.overrides ?? {}, {
    allowNewKeys: args.allowNewKeys ?? false,
  });
  if (!built.ok) return built;

  const content = serializeExportSettings(built.data.settings);
  let outputPath: string | null = null;

  if (args.output) {
    const target = resolveWriteTarget(args.output, host.workspaceRoot);
    if (!target.ok) return target;
    host.writeText(target.data, content);
    outputPath = target.data;
  }

  const summaryLines = [
    explainExportSettings(built.data),
    outputPath === null
      ? 'Not written to disk: pass `output` to save it.'
      : `Written to ${outputPath}.`,
    'Template provenance: the bundled export templates are shaped from the documented export dialog, not captured from a licensed export. Calibrate with spine_export_settings_capture before relying on them in CI — see templates/export-settings/README.md.',
  ];

  if (built.data.noopKeys.length > 0) {
    summaryLines.push(
      `Overrides that already matched the template: ${built.data.noopKeys.join(', ')}.`,
    );
  }

  return ok(
    { templatePath: template.data.path, outputPath, built: built.data, content },
    summaryLines.join('\n'),
  );
}

/** Payload returned by `pack_settings_build`. */
export interface PackSettingsBuildData {
  templatePath: string | null;
  outputPath: string | null;
  built: BuiltPackSettings;
  content: string;
}

/** Build a `pack.json` from a template (or Spine defaults) plus overrides. */
export function packSettingsBuild(
  host: SpineHost,
  args: {
    template?: string | undefined;
    overrides?: Record<string, unknown> | undefined;
    output?: string | undefined;
  },
): SpineResult<PackSettingsBuildData> {
  let base: Partial<PackSettings> = {};
  let templatePath: string | null = null;

  if (args.template) {
    const template = resolveTemplate(host, args.template, 'pack');
    if (!template.ok) return template;
    base = template.data.parsed as Partial<PackSettings>;
    templatePath = template.data.path;
  }

  const built = buildPackSettings(base, args.overrides ?? {});
  if (!built.ok) return built;

  const content = serializePackSettings(built.data.settings);
  let outputPath: string | null = null;

  if (args.output) {
    const target = resolveWriteTarget(args.output, host.workspaceRoot);
    if (!target.ok) return target;
    host.writeText(target.data, content);
    outputPath = target.data;
  }

  const summaryLines = [
    explainPackSettings(built.data),
    `Non-default settings: ${built.data.changedKeys.length === 0 ? 'none' : built.data.changedKeys.join(', ')}.`,
    outputPath === null
      ? 'Not written to disk: pass `output` to save it.'
      : `Written to ${outputPath}.`,
    'Reminder: a pack.json only takes effect when packing from image folders (the texture packer, or data export with the "Image folders" source). The -e json+pack / binary+pack shorthands ignore it.',
  ];

  return ok({ templatePath, outputPath, built: built.data, content }, summaryLines.join('\n'));
}

/** Register the settings generation tools. */
export function registerSettingsTools(server: McpServer, host: SpineHost): void {
  server.registerTool(
    'export_settings_build',
    {
      title: 'Build a Spine export settings file',
      description: [
        'Produce an export settings JSON for the Spine CLI `-e` parameter by applying a narrow diff to a known-good template.',
        `Built-in templates: ${BUILT_IN_EXPORT_TEMPLATES.join(', ')}; a path to your own template also works.`,
        'Override keys that the template does not contain are rejected, because Spine silently ignores unknown keys —',
        'a typo would otherwise produce a file that looks right and exports wrong.',
        'The export settings schema is not publicly documented, so the bundled templates are shaped from the documented dialog options',
        'and should be calibrated with spine_export_settings_capture against a real project before CI use.',
      ].join(' '),
      inputSchema: {
        template: z
          .string()
          .describe(
            `Built-in template name (${BUILT_IN_EXPORT_TEMPLATES.join(' | ')}) or a path to an export settings JSON file.`,
          ),
        overrides: z
          .record(z.unknown())
          .optional()
          .describe(
            'Field values to change. Keys must already exist in the template. Use dotted keys for one level of nesting, e.g. "packAtlas.premultiplyAlpha".',
          ),
        output: z
          .string()
          .optional()
          .describe(
            'Where to write the result, inside the workspace. Omit to preview without writing.',
          ),
        allowNewKeys: z
          .boolean()
          .optional()
          .describe(
            'Permit override keys that the template lacks. Only use this with a field name confirmed against a captured settings file.',
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => guardTool(() => exportSettingsBuild(host, args)),
  );

  server.registerTool(
    'pack_settings_build',
    {
      title: 'Build a Spine texture packer settings file',
      description: [
        'Produce a pack.json for the Spine texture packer. Every documented setting is validated by type, range and enum value,',
        'and unknown keys are rejected since Spine ignores them silently.',
        `Built-in templates: ${BUILT_IN_PACK_TEMPLATES.join(', ')}. Omit the template to start from Spine's documented defaults.`,
        'Also reports cross-field problems such as polygon packing without project context, zero padding with linear filtering,',
        'and a scaleSuffix list whose length does not match scale.',
      ].join(' '),
      inputSchema: {
        template: z
          .string()
          .optional()
          .describe(
            `Built-in template name (${BUILT_IN_PACK_TEMPLATES.join(' | ')}) or a path to a pack.json. Omit to use Spine's defaults.`,
          ),
        overrides: z
          .record(z.unknown())
          .optional()
          .describe('Settings to change, e.g. { "pot": true, "maxWidth": 1024 }.'),
        output: z
          .string()
          .optional()
          .describe(
            'Where to write the result, inside the workspace. Omit to preview without writing.',
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => guardTool(() => packSettingsBuild(host, args)),
  );
}

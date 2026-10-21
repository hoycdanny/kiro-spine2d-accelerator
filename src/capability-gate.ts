// ============================================================
// Capability gate.
//
// The Spine trial silently refuses to save, pack, or export. Rather than
// letting the CLI fail in a confusing way (or worse, appear to succeed),
// every write command passes through this gate first. When a capability is
// missing the caller gets a clear refusal plus the exact command line that
// would have run, so the work can be repeated once a license is in place.
// ============================================================

import { COMMAND_CAPABILITY, SpineCommand } from './cli-command';
import { CAPABILITY_LABELS } from './spine-env';
import {
  SpineCapabilityKey,
  SpineEdition,
  SpineEnvironment,
  SpineErr,
  SpineErrorCode,
  err,
} from './types';

/** The capability a command requires. */
export function capabilityFor(command: SpineCommand): SpineCapabilityKey {
  return COMMAND_CAPABILITY[command.kind];
}

/** Context included in a refusal, so the developer can act on it. */
export interface GateContext {
  /** Display-only command line that would have been executed. */
  commandLine?: string;
}

/**
 * Check a single capability.
 *
 * Returns null when the operation is allowed, or a structured refusal.
 */
export function requireCapability(
  env: SpineEnvironment,
  capability: SpineCapabilityKey,
  context: GateContext = {},
): SpineErr | null {
  if (env.capabilities[capability]) return null;

  const label = CAPABILITY_LABELS[capability];
  const reason =
    env.edition === SpineEdition.Trial
      ? 'The Spine trial does not permit saving projects, texture packing, or exporting data, images and video.'
      : 'The installed Spine edition could not be confirmed, so write operations are blocked.';

  const hint =
    env.edition === SpineEdition.Trial
      ? 'Purchase a Spine license (Essential or Professional) and install the licensed build. Read-only project info keeps working on the trial.'
      : 'Run spine_env_probe and confirm the installation, or pass an explicit executable path to the licensed build.';

  return err(
    SpineErrorCode.CapabilityDenied,
    `This installation cannot perform ${label}. ${reason}`,
    hint,
    {
      edition: env.edition,
      capability,
      ...(env.executable ? { executable: env.executable } : {}),
      ...(context.commandLine ? { wouldHaveRun: context.commandLine } : {}),
    },
  );
}

/**
 * Check every capability a batch of commands needs, reporting all missing
 * ones at once rather than failing on the first.
 */
export function requireCapabilitiesFor(
  env: SpineEnvironment,
  commands: SpineCommand[],
  context: GateContext = {},
): SpineErr | null {
  const missing = new Map<SpineCapabilityKey, string[]>();

  for (const command of commands) {
    const capability = capabilityFor(command);
    if (env.capabilities[capability]) continue;
    const kinds = missing.get(capability) ?? [];
    kinds.push(command.kind);
    missing.set(capability, kinds);
  }

  if (missing.size === 0) return null;

  const first = [...missing.keys()][0]!;
  const refusal = requireCapability(env, first, context);
  if (!refusal) return null;

  const labels = [...missing.entries()].map(
    ([capability, kinds]) => `${CAPABILITY_LABELS[capability]} (${kinds.join(', ')})`,
  );

  return err(refusal.code, `Blocked operations: ${labels.join('; ')}. ${refusal.message}`, refusal.hint, {
    ...refusal.details,
    blocked: labels,
  });
}

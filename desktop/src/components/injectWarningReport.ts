import type { InjectPlanSummary } from '../../electron/shared-types';

/** Plain-text report of every warning/blocked-tag category shown in the Inject dialog's review phase - path, category, reason - for pasting back when something is blocked. */
export function buildInjectWarningReport(plan: InjectPlanSummary): string {
  const lines: string[] = [
    `Inject warning report - "${plan.sourceMapName}" (${plan.mode === 'swap' ? 'swap mode' : 'add mode'})`,
    `${plan.counts.added} to add, ${plan.counts.swapped} to swap, ${plan.counts.reused} reused, ${plan.counts.blockedEmbedded + plan.counts.blockedOther} blocked`,
    '',
  ];
  for (const r of plan.refusedRoots) {
    lines.push(`REFUSED (root selection): "${r.path}" - ${r.reasons.join('; ')}`);
  }
  for (const b of plan.blockedEmbedded) {
    lines.push(`BLOCKED (embedded data): "${b.path}" (${b.group}) - ${b.reasons.join('; ')}`);
  }
  for (const b of plan.blockedOther) {
    lines.push(`BLOCKED (other): "${b.path}" (${b.group}) - ${b.reasons.join('; ')}`);
  }
  for (const c of plan.classConflicts ?? []) {
    lines.push(`CLASS CONFLICT: "${c.path}" is (${c.containerGroup}) in container, but exists as (${c.targetGroup}) in target map`);
  }
  for (const r of plan.externalRefStatuses) {
    lines.push(`EXTERNAL REFERENCE (${r.status}): "${r.path}" needs ${r.resourceMap}`);
  }
  if (lines.length === 3) lines.push('(no warnings or blocked tags)');
  return lines.join('\n');
}

import { planInjection } from '../../src/map/tag-injector';
import type { InjectionMode, InjectionPlan, InjectionTarget } from '../../src/map/tag-injector';
import type { OceContainer } from '../../src/map/container';

/**
 * Whole-map stress injections can exceed the game's 23 MiB tag space (SWAP of coldsnap into itself
 * needs ~29 MiB: swapped data is appended, the old copy stays), and `planInjection` refuses those.
 * This halves the root list until the plan fits, so the pointer checks still run on a valid-sized
 * output. Any other refusal is thrown. Generic - nothing keyed to a map.
 */
export function planThatFitsTagSpace(mode: InjectionMode, target: InjectionTarget, roots: number[], extract: (roots: number[]) => OceContainer): { container: OceContainer; plan: InjectionPlan; roots: number[] } {
  let current = roots;
  for (;;) {
    const container = extract(current);
    const plan = planInjection(mode, target, container);
    if (plan.kind === 'ok') return { container, plan, roots: current };
    if (!plan.reason.includes('tag space') || current.length <= 1) throw new Error(`plan refused: ${plan.reason}`);
    current = current.slice(0, Math.ceil(current.length / 2));
  }
}

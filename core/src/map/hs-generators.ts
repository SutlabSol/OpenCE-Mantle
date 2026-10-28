/**
 * Halo CE / H1 Campaign Mission Director, Multi-Shot Cutscene Director,
 * and Finite-Wave Firefight Survival HaloScript (.hsc) Generators.
 *
 * Adapted from Project Guilty Spark (`haloScript.ts` and `creatorStudio.ts`),
 * omitting the dedicated server `init.txt` exporter per user request.
 * Works seamlessly with OpenCE Mantle's built-in `compileHaloScript` in `hs-compiler.ts`.
 */

export interface MissionBeat {
  id: string;
  title: string;
  objective: string;
  trigger: 'manual' | 'triggerVolume' | 'encounterCleared' | 'timer';
  encounterName: string;
  triggerRef?: string;
  timerSeconds?: number;
}

export interface CameraShot {
  id: string;
  name: string;
  durationMs: number;
  cameraPosition: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
  subtitle: string;
  cameraMarker?: string;
}

export interface FirefightEnemyDef {
  id: string;
  label: string;
  actorVariantPath?: string;
}

export interface FirefightWaveGroup {
  enemyId: string;
  count: number;
}

export interface FirefightWave {
  name?: string;
  groups: FirefightWaveGroup[];
}

export interface FirefightConfig {
  schemaVersion: 1;
  rounds: number;
  maxAlive: number;
  intermissionMs: number;
  endless?: boolean;
  enemies: FirefightEnemyDef[];
  waves: FirefightWave[];
}

export interface ScriptExport {
  filename: string;
  content: string;
  dependencies: string[];
  warnings: string[];
  activation?: string;
  generatedOnly: true;
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,30}$/;
const TAG_RE = /^[A-Za-z_][A-Za-z0-9_/-]{0,30}$/;

const safeComment = (s: string): string =>
  s
    .replace(/[\r\n\0]/g, ' ')
    .replace(/[^\x20-\x7e]/g, '?')
    .slice(0, 110);

function ensureScriptName(name: string | undefined, label: string, allowPath = false): string {
  if (typeof name !== 'string' || !(allowPath ? TAG_RE : IDENT_RE).test(name)) {
    throw new Error(`${label} must be a valid Halo CE script identifier (1-31 ASCII characters).`);
  }
  return name;
}

const msToTicks = (ms: number): number => Math.max(1, Math.round((ms * 30) / 1000));

const scriptHeading = (title: string): string[] => [
  '; OpenCE Mantle generated HaloScript (.hsc)',
  `; ${safeComment(title)}`,
  '',
];

/**
 * Generates an ordered campaign mission beat script (`gs_mission.hsc`) with support for
 * manual boolean callbacks, timers, `volume_test_objects` trigger volumes, and guarded AI encounter waves.
 */
export function exportHaloCeMission(missions: MissionBeat[]): ScriptExport {
  if (!Array.isArray(missions) || !missions.length) {
    throw new Error('Add at least one mission beat.');
  }
  if (missions.length > 128) {
    throw new Error('Mission beat list exceeds 128 beats.');
  }

  const deps: string[] = [];
  const lines = scriptHeading('Mission Beat Director');
  const globals: string[] = [];
  const manualSetters: string[] = [];
  const scripted: string[] = ['(script dormant gs_mission', '  (sleep 1)'];

  missions.forEach((beat, i) => {
    scripted.push(`  ; ${i + 1}: ${safeComment(beat.title)} | ${safeComment(beat.objective)}`);
    switch (beat.trigger) {
      case 'manual': {
        const key = `gs_manual_${i + 1}_done`;
        globals.push(`(global boolean ${key} false)`);
        manualSetters.push(
          `(script static void gs_complete_${i + 1}`,
          `  (set ${key} true)`,
          ')',
          '',
        );
        scripted.push(`  ; Another HaloScript trigger must call (gs_complete_${i + 1}).`);
        scripted.push(`  (sleep_until ${key} 15)`);
        break;
      }
      case 'timer': {
        if (
          !Number.isInteger(beat.timerSeconds) ||
          beat.timerSeconds! < 1 ||
          beat.timerSeconds! > 600
        ) {
          throw new Error(`Beat ${i + 1} needs timerSeconds between 1 and 600.`);
        }
        scripted.push(`  (sleep ${msToTicks(beat.timerSeconds! * 1000)})`);
        break;
      }
      case 'triggerVolume': {
        const ref = ensureScriptName(beat.triggerRef, `Beat ${i + 1} trigger volume`);
        deps.push(`trigger_volume:${ref}`);
        scripted.push(`  (sleep_until (volume_test_objects ${ref} (players)) 15)`);
        break;
      }
      case 'encounterCleared': {
        const ref = ensureScriptName(beat.encounterName, `Beat ${i + 1} encounter`, true);
        deps.push(`ai_encounter:${ref}`);
        scripted.push(`  (ai_place ${ref})`);
        // Two-step guard: wait until AI actually spawns (> 0) before waiting for all AI to be cleared (= 0)
        scripted.push(`  (sleep_until (> (ai_living_count ${ref}) 0) 15)`);
        scripted.push(`  (sleep_until (= (ai_living_count ${ref}) 0) 15)`);
        break;
      }
    }
    scripted.push('  (print "objective complete")');
  });

  scripted.push(')', '');
  lines.push(...globals, '', ...manualSetters, ...scripted);

  return {
    filename: 'gs_mission.hsc',
    content: lines.join('\r\n'),
    dependencies: deps,
    activation: '(wake gs_mission)',
    warnings: [
      'Mission is a dormant script. Call (wake gs_mission) from your startup script (or enable auto-wake).',
      'Manual beats pause progression until another script calls their generated (gs_complete_N) helper.',
    ],
    generatedOnly: true,
  };
}

/**
 * Generates a Halo CE multi-shot cutscene camera script (`gs_cinematic.hsc`) using `camera_set` and tick sleeps.
 */
export function exportHaloCeCinematic(shots: CameraShot[]): ScriptExport {
  if (!Array.isArray(shots) || !shots.length) {
    throw new Error('Add at least one cinematic camera shot.');
  }
  if (shots.length > 256) {
    throw new Error('Cinematic shot list exceeds 256 shots.');
  }

  const deps: string[] = [];
  const lines = scriptHeading('Cinematic Camera Director');
  lines.push(
    '(script static void gs_cinematic',
    '  (cinematic_start)',
    '  (camera_control true)',
    '  (cinematic_show_letterbox true)',
  );

  shots.forEach((shot, i) => {
    const ref = ensureScriptName(shot.cameraMarker, `Shot ${i + 1} cutscene camera point`);
    const duration = Math.max(100, Math.min(600000, Math.round(shot.durationMs || 3000)));
    deps.push(`cutscene_camera_point:${ref}`);
    lines.push(`  ; ${i + 1}: ${safeComment(shot.name)} | ${safeComment(shot.subtitle)}`);
    lines.push(
      `  ; Camera XYZ=${shot.cameraPosition.join(',')} lookAt=${shot.lookAt.join(',')} FOV=${shot.fov}`,
    );
    lines.push(`  (camera_set ${ref} ${msToTicks(duration)})`);
    lines.push(`  (sleep ${msToTicks(duration)})`);
  });

  lines.push(
    '  (cinematic_show_letterbox false)',
    '  (camera_control false)',
    '  (cinematic_stop)',
    ')',
    '',
  );

  return {
    filename: 'gs_cinematic.hsc',
    content: lines.join('\r\n'),
    dependencies: deps,
    warnings: [
      'Cutscene camera point names are automatically registered in the scenario when you click "Setup Entities & Compile".',
    ],
    generatedOnly: true,
  };
}

/**
 * Generates a multi-round, multi-wave Firefight AI survival script (`gs_firefight.hsc`).
 */
export function exportHaloCeFirefight(config: FirefightConfig): ScriptExport {
  if (
    config.schemaVersion !== 1 ||
    !Array.isArray(config.waves) ||
    !config.waves.length ||
    config.waves.length > 32 ||
    !Array.isArray(config.enemies) ||
    !Number.isInteger(config.rounds) ||
    config.rounds < 1 ||
    config.rounds > 32 ||
    config.endless
  ) {
    throw new Error(
      'Finite waves (1-32), valid enemy definitions, and 1-32 rounds are required for HaloScript Firefight generation.',
    );
  }
  if (
    !Number.isInteger(config.maxAlive) ||
    config.maxAlive < 1 ||
    config.maxAlive > 32 ||
    !Number.isInteger(config.intermissionMs) ||
    config.intermissionMs < 0 ||
    config.intermissionMs > 600000
  ) {
    throw new Error('Invalid maxAlive (1..32) or intermissionMs (0..600000) configuration.');
  }

  const enemyIds = new Set(config.enemies.map((e) => e.id));
  const deps: string[] = [];
  const lines = scriptHeading('Firefight Wave Survival Director');

  for (let i = 0; i < config.waves.length; i++) {
    const wave = config.waves[i];
    const total = wave.groups.reduce((sum, g) => sum + g.count, 0);
    if (!wave.groups.length || wave.groups.length > 8 || total < 1 || total > config.maxAlive) {
      throw new Error(
        `Wave ${i + 1} must have 1-8 squad groups and 1-${config.maxAlive} total starting actors.`,
      );
    }
    const encounters = wave.groups.map((g, j) => {
      if (!enemyIds.has(g.enemyId) || !Number.isInteger(g.count) || g.count < 1 || g.count > 32) {
        throw new Error(`Wave ${i + 1} group ${j + 1} has an invalid enemy reference or count.`);
      }
      const ref = `gs_w${String(i + 1).padStart(2, '0')}_g${String(j + 1).padStart(2, '0')}`;
      deps.push(`ai_encounter:${ref}:expectedActors=${g.count}:enemy=${g.enemyId}`);
      return ref;
    });

    lines.push(`(script static void gs_wave_${String(i + 1).padStart(2, '0')}`);
    for (const ref of encounters) lines.push(`  (ai_place ${ref})`);
    for (const ref of encounters) lines.push(`  (sleep_until (> (ai_living_count ${ref}) 0) 15)`);
    for (const ref of encounters) lines.push(`  (sleep_until (= (ai_living_count ${ref}) 0) 15)`);
    lines.push(')', '');
  }

  lines.push('(script dormant gs_firefight', '  (sleep 30)');
  for (let r = 0; r < config.rounds; r++) {
    for (let w = 0; w < config.waves.length; w++) {
      lines.push(`  ; Round ${r + 1} - Wave ${w + 1}`);
      lines.push(`  (gs_wave_${String(w + 1).padStart(2, '0')})`);
      if (r !== config.rounds - 1 || w !== config.waves.length - 1) {
        lines.push(`  (sleep ${msToTicks(config.intermissionMs)})`);
      }
    }
  }
  lines.push('  (print "all firefight waves cleared")', ')', '');

  // Also include a startup script that wakes gs_firefight automatically
  lines.push(
    '(script startup gs_firefight_autostart',
    '  (wake gs_firefight)',
    ')',
    '',
  );

  return {
    filename: 'gs_firefight.hsc',
    content: lines.join('\r\n'),
    dependencies: deps,
    activation: '(wake gs_firefight)',
    warnings: [
      'Includes (script startup gs_firefight_autostart) so the Firefight waves begin automatically on map load.',
      'Ensure each gs_wXX_gYY encounter exists in the scenario with at least 1 spawned actor.',
    ],
    generatedOnly: true,
  };
}

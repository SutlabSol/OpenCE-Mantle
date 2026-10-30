import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TagEntrySummary } from '../../electron/shared-types';
import {
  HALOSCRIPT_SAMPLE_TEMPLATES,
  type HaloScriptSampleTemplate,
} from '../../../core/src/map/hs-decompiler';
import {
  buildRecordedFlightStreamFromWaypoints,
  lintHaloScript,
  type HaloScriptDiagnostic,
} from '../../../core/src/map/hs-compiler';
import {
  exportHaloCeCinematic,
  exportHaloCeFirefight,
  exportHaloCeMission,
} from '../../../core/src/map/hs-generators';

interface Props {
  onClose: () => void;
  onMapModified?: () => void;
  embedded?: boolean;
  allTags?: TagEntrySummary[];
}

type BuilderEventPreset =
  | 'triggered_cutscene_pelican_drop'
  | 'triggered_pelican_drop'
  | 'cutscene_aerial_insertion'
  | 'vehicle_reinforcement_drop'
  | 'units_fighting'
  | 'door_from_switch'
  | 'door_from_proximity'
  | 'cutscene_from_trigger'
  | 'custom_track';

type BuilderUnitRole =
  | 'unsc_pelican_tank'
  | 'unsc_pelican_marines'
  | 'cov_dropship_wraith'
  | 'cov_dropship_ghost'
  | 'cov_dropship_elites'
  | 'unsc_marine_squad'
  | 'cov_elite_squad'
  | 'cov_grunt_squad'
  | 'cov_hunter_pair'
  | 'cov_shade_turret'
  | 'unsc_scorpion'
  | 'cov_wraith'
  | 'unsc_warthog'
  | 'device_door_switch'
  | 'device_door_proximity'
  | 'cutscene_camera_rig';

type BuilderActionKind =
  | 'spawn_and_load'
  | 'fly_approach_s_turns'
  | 'follow_waypoint_path_ai'
  | 'teleport_to_waypoint'
  | 'wait_for_trigger'
  | 'wait_for_switch'
  | 'open_bay_doors'
  | 'unload_cargo_and_troops'
  | 'engage_ai_combat'
  | 'delay_seconds'
  | 'close_bay_doors'
  | 'fly_away_and_despawn'
  | 'enable_turret_autoboard'
  | 'migrate_to_encounter'
  | 'operate_device_door'
  | 'proximity_door_loop'
  | 'activate_hud_navpoint'
  | 'cutscene_camera_pan'
  | 'show_cutscene_title'
  | 'wait_until_wave_cleared';

interface BuilderWaypoint {
  id: string;
  name: string;
  xOffset: number;
  yOffset: number;
  zOffset: number;
}

interface BuilderCameraShotTiming {
  camName: string;
  /** Transition ticks passed to `(camera_set <camName> <moveTicks>)` (0 = instant cut, 30 ticks = 1.0s). */
  moveTicks: number;
  /** Hold/wait ticks passed to `(sleep <sleepTicks>)` after `camera_set` (30 ticks = 1.0s). */
  sleepTicks: number;
}

interface BuilderActionStep {
  id: string;
  kind: BuilderActionKind;
  waypointName?: string;
  triggerName?: string;
  targetName?: string;
  seconds?: number;
  /** Per-camera shot move/sleep ticks for `cutscene_camera_pan` (30 ticks = 1.0s). */
  cameraTimings?: BuilderCameraShotTiming[];
  /** Initial hold ticks on the first camera (`cam_1`) before transitioning to `cam_2`. */
  camInitialHoldTicks?: number;
  /** Per-step transition ticks (`(camera_set <cam> <ticks>)`, default 120 = 4.0s). */
  camStepMoveTicks?: number;
  /** Per-step sleep ticks (`(sleep <ticks>)`, default 120 = 4.0s). */
  camStepSleepTicks?: number;
  /** Explicit Halo tick count (`(sleep <ticks>)` or poll/lead/unload sleep ticks, 30 ticks = 1.0s). */
  sleepTicks?: number;
  /** Secondary sleep ticks (e.g., hover settle sleep on `fly_approach_s_turns`, default 45). */
  secondarySleepTicks?: number;
}

interface BuilderUnitTrack {
  id: string;
  label: string;
  sourceScriptName?: string;
  eventPreset?: BuilderEventPreset;
  visibleIn3d?: boolean;
  role: BuilderUnitRole;
  objectName: string;
  cargoObjectName: string;
  encounterName: string;
  driverEncounterName: string;
  team: 'human' | 'covenant';
  waypoints: BuilderWaypoint[];
  flightChain: string[];
  exitFlightChain?: string[];
  actions: BuilderActionStep[];
}

let cachedBuilderSession: {
  builderTracks: BuilderUnitTrack[];
  selectedTrackId: string;
  selectedWaypointId: string;
  hscSource: string;
  playerAnchor: { x: number; y: number; z: number; yaw: number };
} | null = null;

const BUILDER_EVENT_PRESET_LABELS: Record<BuilderEventPreset, string> = {
  triggered_cutscene_pelican_drop: '1. Trigger Zone -> Cutscene + Pelican Tank & Squad Drop',
  triggered_pelican_drop: '2. Trigger Zone -> Pelican / Covenant Dropship Ambush (No Cutscene)',
  cutscene_aerial_insertion: '3. Mission Start Cutscene + Aerial Insertion (Pelican + Camera Pan)',
  vehicle_reinforcement_drop: '4. Unit Reinforcement via Vehicle Drop (Friendly Pelican or Enemy Dropship)',
  units_fighting: '5. Units Fighting (Friendly Marines vs Enemy Covenant Battle)',
  door_from_switch: '6. A Door Activating from a Switch (Device Control -> Door)',
  door_from_proximity: '7. A Door Activating from a Unit Being Near (Proximity Sensor -> Door)',
  cutscene_from_trigger: '8. Cutscene from a Trigger Point (Trigger Volume -> Multi-Camera Pan)',
  custom_track: '9. Custom Script Track (Build from Scratch)',
};

const BUILDER_ROLE_LABELS: Record<BuilderUnitRole, string> = {
  unsc_pelican_tank: 'UNSC Pelican + Scorpion Tank + AI Driver',
  unsc_pelican_marines: 'UNSC Pelican + AI Marine Squad (4x)',
  cov_dropship_wraith: 'Covenant Spirit Dropship + Wraith + AI Driver',
  cov_dropship_ghost: 'Covenant Spirit Dropship + Ghost + AI Pilot',
  cov_dropship_elites: 'Covenant Spirit Dropship + AI Elite Squad (4x)',
  unsc_marine_squad: 'UNSC Marine Ground AI Squad (4x)',
  cov_elite_squad: 'Covenant Elite Ground AI Squad (4x)',
  cov_grunt_squad: 'Covenant Grunt Ground AI Squad (4x)',
  cov_hunter_pair: 'Covenant Hunter Pair (2x Heavy AI)',
  cov_shade_turret: 'Covenant Shade Plasma Turret + AI Gunner',
  unsc_scorpion: 'UNSC Scorpion Tank + AI Driver',
  cov_wraith: 'Covenant Wraith Tank + AI Driver',
  unsc_warthog: 'UNSC Warthog + AI Crew',
  device_door_switch: 'Device Door + Control Switch Pair',
  device_door_proximity: 'Automatic Proximity Door + Sensor Trigger',
  cutscene_camera_rig: 'Cinematic Camera Rig + Trigger Zone',
};

const BUILDER_ACTION_LABELS: Record<BuilderActionKind, string> = {
  spawn_and_load: '1. Spawn Unit, Cargo & Load AI Passengers',
  fly_approach_s_turns: '2a. Fly 3D Waypoint Path (Recorded Animation Stream -> LZ)',
  follow_waypoint_path_ai: '2b. Follow 3D Waypoint Path (AI Command List Patrol / Drive)',
  teleport_to_waypoint: '3. Move / Teleport to Waypoint Flag',
  wait_for_trigger: '4. Wait Until Player Enters Trigger Volume',
  wait_for_switch: '5. Wait Until Player Activates Device Switch',
  open_bay_doors: '6. Open Dropship Troop Bay Doors',
  unload_cargo_and_troops: '7. Drop Vehicle + AI Driver & Unload Troops at LZ',
  engage_ai_combat: '8. Activate AI Combat (Attack Enemy Team & Player)',
  delay_seconds: '9. Wait / Hold Position (Seconds)',
  close_bay_doors: '10. Close Dropship Troop Bay Doors',
  fly_away_and_despawn: '11. Fly Away Along Exit Path & Despawn Unit',
  enable_turret_autoboard: '12. Enable AI Turret / Vehicle Auto-Board (15m Radius)',
  migrate_to_encounter: '13. Migrate AI Squad to Target Encounter (ai_migrate)',
  operate_device_door: '14. Power & Open Scenario Door / Device Machine',
  proximity_door_loop: '15. Auto-Open Door When Unit/Player is Near Waypoint Trigger',
  activate_hud_navpoint: '16. Activate 3D HUD Navpoint Beacon on Waypoint',
  cutscene_camera_pan: '17. Cinematic Letterbox + Camera Pan Across Waypoints',
  show_cutscene_title: '18. Show Cutscene Chapter Title Card (cinematic_set_title)',
  wait_until_wave_cleared: '19. Wait Until AI Wave Cleared (ai_living_count <= N)',
};

export default function ScriptEditorDialog({ onClose, onMapModified, embedded = false, allTags = [] }: Props) {
  const [activeStudioTab, setActiveStudioTab] = useState<'code' | 'builder'>('builder');
  const [activePathMode, setActivePathMode] = useState<'entry' | 'exit'>('entry');
  const [selectedWaypointId, setSelectedWaypointId] = useState<string>(
    cachedBuilderSession?.selectedWaypointId ?? 'wp-2',
  );
  const [viewportHeight, setViewportHeight] = useState<number>(380);
  const [previewTick, setPreviewTick] = useState<number>(0);
  const [isPlayingPreview, setIsPlayingPreview] = useState<boolean>(false);
  const [lockPreviewToCutsceneCam, setLockPreviewToCutsceneCam] = useState<boolean>(false);
  const [playerAnchor, setPlayerAnchor] = useState<{ x: number; y: number; z: number; yaw: number }>(
    cachedBuilderSession?.playerAnchor ?? {
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
    },
  );
  const viewportMountRef = useRef<HTMLDivElement | null>(null);
  const bspPickHandlerRef = useRef<
    ((haloX: number, haloY: number, haloZ: number, insertCorner?: boolean, keepExactZ?: boolean) => void) | null
  >(null);
  const waypointGroupRef = useRef<THREE.Group | null>(null);
  const previewGroupRef = useRef<THREE.Group | null>(null);
  const threeCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const threeControlsRef = useRef<OrbitControls | null>(null);
  const [bspLoadedInfo, setBspLoadedInfo] = useState<string>('Loading 3D BSP mesh...');
  const [hscSource, setHscSource] = useState<string>(
    cachedBuilderSession?.hscSource ?? '; Loading decompiled HaloScript from scenario...\n',
  );
  const [scriptCount, setScriptCount] = useState<number>(0);
  const [globalCount, setGlobalCount] = useState<number>(0);
  const [syntaxNodeCount, setSyntaxNodeCount] = useState<number>(0);
  const [scenarioEntities, setScenarioEntities] = useState<{
    objectNames: string[];
    triggerVolumes: string[];
    cutsceneCameraPoints: string[];
    cutsceneFlags: string[];
    encounters: string[];
    recordedAnimations: string[];
  }>({
    objectNames: [],
    triggerVolumes: [],
    cutsceneCameraPoints: [],
    cutsceneFlags: [],
    encounters: [],
    recordedAnimations: [],
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(HALOSCRIPT_SAMPLE_TEMPLATES[0]!.id);
  const [diagnostics, setDiagnostics] = useState<HaloScriptDiagnostic[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);

  // Interactive 3D/Spatial Script Builder State (starts clean — 0 auto-assigned ships! User adds scripts from scratch or presets)
  const [newEventPreset, setNewEventPreset] = useState<BuilderEventPreset>('vehicle_reinforcement_drop');
  const [builderTracks, setBuilderTracks] = useState<BuilderUnitTrack[]>(
    cachedBuilderSession?.builderTracks ?? [],
  );
  const [selectedTrackId, setSelectedTrackId] = useState<string>(
    cachedBuilderSession?.selectedTrackId ?? '',
  );
  const selectedTrack = builderTracks.find((t) => t.id === selectedTrackId) ?? builderTracks[0];
  const builderWaypoints = selectedTrack?.waypoints ?? [];

  useEffect(() => {
    cachedBuilderSession = {
      builderTracks,
      selectedTrackId,
      selectedWaypointId,
      hscSource,
      playerAnchor,
    };
  }, [builderTracks, selectedTrackId, selectedWaypointId, hscSource, playerAnchor]);

  const updateSelectedTrack = (updater: (trk: BuilderUnitTrack) => BuilderUnitTrack) => {
    if (!selectedTrack) return;
    setBuilderTracks((prev) => prev.map((t) => (t.id === selectedTrack.id ? updater(t) : t)));
  };

  const setBuilderWaypoints = (updater: (prev: BuilderWaypoint[]) => BuilderWaypoint[]) => {
    if (!selectedTrack) return;
    setBuilderTracks((prev) =>
      prev.map((t) => (t.id === selectedTrack.id ? { ...t, waypoints: updater(t.waypoints) } : t)),
    );
  };

  const setSelectedFlightChain = (updater: (prev: string[]) => string[]) => {
    if (!selectedTrack) return;
    setBuilderTracks((prev) =>
      prev.map((t) => (t.id === selectedTrack.id ? { ...t, flightChain: updater(t.flightChain) } : t)),
    );
  };

  const setSelectedExitFlightChain = (updater: (prev: string[]) => string[]) => {
    if (!selectedTrack) return;
    setBuilderTracks((prev) =>
      prev.map((t) => {
        if (t.id !== selectedTrack.id) return t;
        const baseExit =
          t.exitFlightChain && t.exitFlightChain.length > 0
            ? t.exitFlightChain
            : [...t.flightChain].reverse();
        return { ...t, exitFlightChain: updater(baseExit) };
      }),
    );
  };

  const createTrackFromPreset = (preset: BuilderEventPreset, indexNum: number): BuilderUnitTrack => {
    const id = `evt_${indexNum}_${Date.now().toString(36).slice(-4)}`;
    const s = indexNum;
    if (preset === 'triggered_cutscene_pelican_drop') {
      const wps: BuilderWaypoint[] = [
        { id: `${id}-trig`, name: `wp_trig_${s}`, xOffset: 4, yOffset: 0, zOffset: 0.5 },
        { id: `${id}-wp1`, name: `wp_drop_${s}_start`, xOffset: -24, yOffset: -10, zOffset: 7.5 },
        { id: `${id}-wp2`, name: `wp_drop_${s}_turn1`, xOffset: -8, yOffset: -4, zOffset: 4.2 },
        { id: `${id}-wp3`, name: `wp_drop_${s}_lz`, xOffset: 10, yOffset: 2, zOffset: 1.5 },
        { id: `${id}-wp4`, name: `wp_drop_${s}_exit`, xOffset: 28, yOffset: 12, zOffset: 9.0 },
        { id: `${id}-cam1`, name: `cam_drop_${s}_1`, xOffset: -2, yOffset: -10, zOffset: 3.5 },
        { id: `${id}-cam2`, name: `cam_drop_${s}_2`, xOffset: 4, yOffset: -8, zOffset: 2.8 },
        { id: `${id}-cam3`, name: `cam_drop_${s}_3`, xOffset: 8, yOffset: -5, zOffset: 2.2 },
      ];
      return {
        id,
        label: `Triggered Cutscene + Pelican Drop #${s}`,
        eventPreset: preset,
        visibleIn3d: true,
        role: 'unsc_pelican_tank',
        objectName: `pelican_drop_${s}`,
        cargoObjectName: `scorpion_tank_${s}`,
        encounterName: `unsc_marines_${s}`,
        driverEncounterName: `unsc_crew_${s}`,
        team: 'human',
        waypoints: wps,
        flightChain: [wps[1]!.name, wps[2]!.name, wps[3]!.name],
        exitFlightChain: [wps[3]!.name, wps[4]!.name],
        actions: [
          { id: `${id}-a1`, kind: 'wait_for_trigger', triggerName: `trig_drop_${s}`, waypointName: wps[0]!.name },
          { id: `${id}-a2`, kind: 'spawn_and_load' },
          { id: `${id}-a3`, kind: 'cutscene_camera_pan', waypointName: wps[5]!.name, targetName: wps[7]!.name, seconds: 6 },
          { id: `${id}-a4`, kind: 'fly_approach_s_turns', waypointName: wps[3]!.name },
          { id: `${id}-a5`, kind: 'unload_cargo_and_troops' },
          { id: `${id}-a6`, kind: 'engage_ai_combat' },
          { id: `${id}-a7`, kind: 'delay_seconds', seconds: 3 },
          { id: `${id}-a8`, kind: 'fly_away_and_despawn' },
        ],
      };
    }
    if (preset === 'triggered_pelican_drop') {
      const wps: BuilderWaypoint[] = [
        { id: `${id}-trig`, name: `wp_trig_${s}`, xOffset: 5, yOffset: 0, zOffset: 0.5 },
        { id: `${id}-wp1`, name: `wp_drop_${s}_start`, xOffset: -22, yOffset: 8, zOffset: 7.0 },
        { id: `${id}-wp2`, name: `wp_drop_${s}_turn1`, xOffset: -8, yOffset: 6, zOffset: 4.0 },
        { id: `${id}-wp3`, name: `wp_drop_${s}_lz`, xOffset: 10, yOffset: 3, zOffset: 1.4 },
        { id: `${id}-wp4`, name: `wp_drop_${s}_exit`, xOffset: 28, yOffset: 12, zOffset: 8.5 },
      ];
      return {
        id,
        label: `Triggered Pelican / Dropship Drop #${s}`,
        eventPreset: preset,
        visibleIn3d: true,
        role: 'unsc_pelican_tank',
        objectName: `pelican_drop_${s}`,
        cargoObjectName: `scorpion_tank_${s}`,
        encounterName: `unsc_marines_${s}`,
        driverEncounterName: `unsc_crew_${s}`,
        team: 'human',
        waypoints: wps,
        flightChain: [wps[1]!.name, wps[2]!.name, wps[3]!.name],
        exitFlightChain: [wps[3]!.name, wps[4]!.name],
        actions: [
          { id: `${id}-a1`, kind: 'wait_for_trigger', triggerName: `trig_ambush_${s}`, waypointName: wps[0]!.name },
          { id: `${id}-a2`, kind: 'spawn_and_load' },
          { id: `${id}-a3`, kind: 'fly_approach_s_turns', waypointName: wps[3]!.name },
          { id: `${id}-a4`, kind: 'unload_cargo_and_troops' },
          { id: `${id}-a5`, kind: 'engage_ai_combat' },
          { id: `${id}-a6`, kind: 'delay_seconds', seconds: 3 },
          { id: `${id}-a7`, kind: 'fly_away_and_despawn' },
        ],
      };
    }
    if (preset === 'cutscene_aerial_insertion') {
      const wps: BuilderWaypoint[] = [
        { id: `${id}-wp1`, name: `wp_insert_${s}_start`, xOffset: -24, yOffset: -8, zOffset: 7.0 },
        { id: `${id}-wp2`, name: `wp_insert_${s}_turn`, xOffset: -10, yOffset: -4, zOffset: 3.8 },
        { id: `${id}-wp3`, name: `wp_insert_${s}_lz`, xOffset: 6, yOffset: 0, zOffset: 1.2 },
        { id: `${id}-wp4`, name: `wp_insert_${s}_exit`, xOffset: 24, yOffset: 10, zOffset: 8.5 },
        { id: `${id}-cam1`, name: `cam_insert_${s}_1`, xOffset: -4, yOffset: -10, zOffset: 3.2 },
        { id: `${id}-cam2`, name: `cam_insert_${s}_2`, xOffset: 2, yOffset: -8, zOffset: 2.6 },
        { id: `${id}-cam3`, name: `cam_insert_${s}_3`, xOffset: 6, yOffset: -5, zOffset: 2.0 },
      ];
      return {
        id,
        label: `Aerial Insertion Cutscene #${s}`,
        eventPreset: preset,
        visibleIn3d: true,
        role: 'unsc_pelican_marines',
        objectName: `pelican_insert_${s}`,
        cargoObjectName: `hog_insert_${s}`,
        encounterName: `unsc_marines_${s}`,
        driverEncounterName: `unsc_crew_${s}`,
        team: 'human',
        waypoints: wps,
        flightChain: [wps[0]!.name, wps[1]!.name, wps[2]!.name],
        exitFlightChain: [wps[2]!.name, wps[3]!.name],
        actions: [
          { id: `${id}-a1`, kind: 'spawn_and_load' },
          { id: `${id}-a2`, kind: 'cutscene_camera_pan', waypointName: wps[4]!.name, targetName: wps[6]!.name, seconds: 5 },
          { id: `${id}-a3`, kind: 'fly_approach_s_turns', waypointName: wps[2]!.name },
          { id: `${id}-a4`, kind: 'unload_cargo_and_troops' },
          { id: `${id}-a5`, kind: 'engage_ai_combat' },
          { id: `${id}-a6`, kind: 'fly_away_and_despawn' },
        ],
      };
    }
    if (preset === 'vehicle_reinforcement_drop') {
      const side = s % 2 === 0 ? -1 : 1;
      const wps: BuilderWaypoint[] = [
        { id: `${id}-wp1`, name: `wp_drop_${s}_start`, xOffset: -22, yOffset: 6 * side, zOffset: 6.5 },
        { id: `${id}-wp2`, name: `wp_drop_${s}_turn1`, xOffset: -10, yOffset: 10 * side, zOffset: 4.0 },
        { id: `${id}-wp3`, name: `wp_drop_${s}_lz`, xOffset: 8, yOffset: 4 * side, zOffset: 1.2 },
        { id: `${id}-wp4`, name: `wp_drop_${s}_exit`, xOffset: 26, yOffset: 12 * side, zOffset: 8.5 },
      ];
      return {
        id,
        label: `Vehicle Drop Reinforcement #${s}`,
        eventPreset: preset,
        visibleIn3d: true,
        role: 'unsc_pelican_tank',
        objectName: `pelican_drop_${s}`,
        cargoObjectName: `scorpion_tank_${s}`,
        encounterName: `unsc_marines_${s}`,
        driverEncounterName: `unsc_crew_${s}`,
        team: 'human',
        waypoints: wps,
        flightChain: [wps[0]!.name, wps[1]!.name, wps[2]!.name],
        exitFlightChain: [wps[2]!.name, wps[3]!.name],
        actions: [
          { id: `${id}-a1`, kind: 'spawn_and_load' },
          { id: `${id}-a2`, kind: 'fly_approach_s_turns', waypointName: wps[2]!.name },
          { id: `${id}-a3`, kind: 'unload_cargo_and_troops' },
          { id: `${id}-a4`, kind: 'engage_ai_combat' },
          { id: `${id}-a5`, kind: 'delay_seconds', seconds: 3 },
          { id: `${id}-a6`, kind: 'fly_away_and_despawn' },
        ],
      };
    }
    if (preset === 'units_fighting') {
      const wps: BuilderWaypoint[] = [
        { id: `${id}-wp1`, name: `wp_friendly_${s}`, xOffset: 5, yOffset: -4, zOffset: 0.5 },
        { id: `${id}-wp2`, name: `wp_enemy_${s}`, xOffset: 16, yOffset: 4, zOffset: 0.5 },
      ];
      return {
        id,
        label: `Units Fighting Battle #${s}`,
        eventPreset: preset,
        visibleIn3d: true,
        role: 'unsc_marine_squad',
        objectName: `battle_zone_${s}`,
        cargoObjectName: '',
        encounterName: `unsc_squad_${s}`,
        driverEncounterName: `cov_squad_${s}`,
        team: 'human',
        waypoints: wps,
        flightChain: [],
        actions: [
          { id: `${id}-a1`, kind: 'spawn_and_load' },
          { id: `${id}-a2`, kind: 'engage_ai_combat' },
        ],
      };
    }
    if (preset === 'door_from_switch') {
      const wps: BuilderWaypoint[] = [
        { id: `${id}-wp1`, name: `wp_switch_${s}`, xOffset: 4, yOffset: -2, zOffset: 0.5 },
        { id: `${id}-wp2`, name: `wp_door_${s}`, xOffset: 8, yOffset: 0, zOffset: 0.5 },
      ];
      return {
        id,
        label: `Door from Switch #${s}`,
        eventPreset: preset,
        visibleIn3d: true,
        role: 'device_door_switch',
        objectName: `door_machine_${s}`,
        cargoObjectName: `switch_control_${s}`,
        encounterName: '',
        driverEncounterName: '',
        team: 'human',
        waypoints: wps,
        flightChain: [],
        actions: [
          { id: `${id}-a1`, kind: 'wait_for_switch', triggerName: `trig_switch_${s}`, targetName: `switch_control_${s}` },
          { id: `${id}-a2`, kind: 'operate_device_door', targetName: `door_machine_${s}` },
        ],
      };
    }
    if (preset === 'door_from_proximity') {
      const wps: BuilderWaypoint[] = [
        { id: `${id}-wp1`, name: `wp_door_prox_${s}`, xOffset: 7, yOffset: 0, zOffset: 0.5 },
      ];
      return {
        id,
        label: `Proximity Door #${s}`,
        eventPreset: preset,
        visibleIn3d: true,
        role: 'device_door_proximity',
        objectName: `door_prox_${s}`,
        cargoObjectName: '',
        encounterName: '',
        driverEncounterName: '',
        team: 'human',
        waypoints: wps,
        flightChain: [],
        actions: [
          { id: `${id}-a1`, kind: 'proximity_door_loop', triggerName: `trig_door_prox_${s}`, targetName: `door_prox_${s}`, waypointName: wps[0]!.name },
        ],
      };
    }
    if (preset === 'cutscene_from_trigger') {
      const wps: BuilderWaypoint[] = [
        { id: `${id}-wp1`, name: `wp_trig_zone_${s}`, xOffset: 6, yOffset: 0, zOffset: 0.5 },
        { id: `${id}-cam1`, name: `cam_trig_${s}_1`, xOffset: 0, yOffset: -8, zOffset: 3.2 },
        { id: `${id}-cam2`, name: `cam_trig_${s}_2`, xOffset: 5, yOffset: -5, zOffset: 2.8 },
        { id: `${id}-cam3`, name: `cam_trig_${s}_3`, xOffset: 10, yOffset: 4, zOffset: 3.5 },
      ];
      return {
        id,
        label: `Trigger Cutscene #${s}`,
        eventPreset: preset,
        visibleIn3d: true,
        role: 'cutscene_camera_rig',
        objectName: `cutscene_rig_${s}`,
        cargoObjectName: '',
        encounterName: '',
        driverEncounterName: '',
        team: 'human',
        waypoints: wps,
        flightChain: [wps[1]!.name, wps[2]!.name, wps[3]!.name],
        actions: [
          { id: `${id}-a1`, kind: 'wait_for_trigger', triggerName: `trig_cutscene_${s}`, waypointName: wps[0]!.name },
          { id: `${id}-a2`, kind: 'cutscene_camera_pan', waypointName: wps[1]!.name, targetName: wps[3]!.name, seconds: 5 },
        ],
      };
    }
    // Custom track from scratch
    const wps: BuilderWaypoint[] = [
      { id: `${id}-wp1`, name: `wp_${s}_start`, xOffset: -16, yOffset: 0, zOffset: 5.0 },
      { id: `${id}-wp2`, name: `wp_${s}_lz`, xOffset: 6, yOffset: 0, zOffset: 1.0 },
    ];
    return {
      id,
      label: `Custom Script Event #${s}`,
      eventPreset: 'custom_track',
      visibleIn3d: true,
      role: 'unsc_pelican_marines',
      objectName: `unit_${s}`,
      cargoObjectName: `cargo_${s}`,
      encounterName: `squad_${s}`,
      driverEncounterName: `crew_${s}`,
      team: 'human',
      waypoints: wps,
      flightChain: wps.map((w) => w.name),
      actions: [
        { id: `${id}-a1`, kind: 'spawn_and_load' },
      ],
    };
  };

  const stripTopLevelScriptsByName = (src: string, shouldRemove: (scriptName: string) => boolean): string => {
    const spansToRemove: Array<{ start: number; end: number }> = [];
    let i = 0;
    while (i < src.length) {
      if (src[i] === ';') {
        while (i < src.length && src[i] !== '\n') i++;
        continue;
      }
      if (src[i] === '"') {
        i++;
        while (i < src.length && src[i] !== '"') {
          if (src[i] === '\\') i++;
          i++;
        }
        i++;
        continue;
      }
      if (src[i] === '(') {
        const blockStart = i;
        let depth = 0;
        let inStr = false;
        while (i < src.length) {
          const ch = src[i];
          if (!inStr && ch === ';') {
            while (i < src.length && src[i] !== '\n') i++;
            continue;
          }
          if (ch === '"') {
            inStr = !inStr;
          } else if (!inStr) {
            if (ch === '(') depth++;
            else if (ch === ')') {
              depth--;
              if (depth === 0) {
                i++;
                break;
              }
            }
          }
          i++;
        }
        const blockText = src.slice(blockStart, i);
        const m = blockText.match(
          /^\(\s*script\s+(?:startup|dormant|continuous|static|stub)\s+(?:(?:void|boolean|real|short|long|string|unit|object)\s+)?([A-Za-z0-9_.-]+)/i,
        );
        if (m && shouldRemove(m[1]!)) {
          spansToRemove.push({ start: blockStart, end: i });
        }
        continue;
      }
      i++;
    }
    if (spansToRemove.length === 0) return src;
    let out = '';
    let cursor = 0;
    for (const sp of spansToRemove) {
      out += src.slice(cursor, sp.start);
      cursor = sp.end;
    }
    out += src.slice(cursor);
    return out.replace(/\n{3,}/g, '\n\n').trim();
  };

  const generateHscFromBuilder = (
    tracksToCompile: BuilderUnitTrack[] = builderTracks,
    extraRemovedScriptNames: string[] = [],
  ): string => {
    const managedNames = new Set<string>([
      'init_builder_team_allegiances',
      'init_builder_events',
      'launch_interactive_builder_mission',
      'launch_interactive_builder_miss',
      ...extraRemovedScriptNames,
    ]);
    for (const trk of builderTracks) {
      if (trk.sourceScriptName) managedNames.add(trk.sourceScriptName);
    }
    for (const trk of tracksToCompile) {
      if (trk.sourceScriptName) managedNames.add(trk.sourceScriptName);
    }

    // Preserve any existing custom scripts in hscSource that are outside our 3D builder tracks,
    // while stripping decompiler top-level summary directives so deleted tracks' waypoints/paths never come back!
    const strippedRegion = hscSource
      .replace(/; === @begin_3d_builder_scripts ===[\s\S]*?; === @end_3d_builder_scripts ===\s*/g, '')
      .replace(/^;\s*No compiled HaloScript syntax nodes found in this scenario\.\s*$/gm, '')
      .replace(/^;\s*Loading decompiled HaloScript from scenario\.\.\.\s*$/gm, '')
      .replace(/^;\s*={10,}\s*$/gm, '')
      .replace(/^;\s*Decompiled HaloScript[\s\S]*?$/gm, '')
      .replace(/^;\s*Scripts:\s*\d+\s*\|\s*Globals:\s*\d+\s*\|\s*Syntax Nodes:\s*\d+\s*$/gm, '')
      .replace(/^;\s*---\s*(?:Scenario|Scripts)[\s\S]*?---\s*$/gm, '')
      .replace(/^;\s*@(?:waypoint|flight_path|camera_pos|trigger_pos|command_list_path|object_pos|object_type|encounter_pos)\b.*$/gm, '');
    const existingClean = stripTopLevelScriptsByName(
      strippedRegion,
      (sName) =>
        managedNames.has(sName) ||
        /^run_evt_\d+_/i.test(sName) ||
        /^launch_interactive_builder/i.test(sName),
    ).trim();

    if (tracksToCompile.length === 0) {
      return existingClean ? `${existingClean}\n` : '; No compiled HaloScript syntax nodes found in this scenario.\n';
    }

    const lines: string[] = [];
    if (existingClean) {
      lines.push(existingClean, '');
    }
    lines.push(
      '; === @begin_3d_builder_scripts ===',
      '; ============================================================================',
      '; Generated by OpenCE Mantle — Interactive 3D Script Event Builder',
      '; Each 3D Script Event Instance below has its own dedicated waypoints & paths.',
      '; ============================================================================',
    );

    const humanEncounters = new Set<string>();
    const covEncounters = new Set<string>();
    for (const trk of tracksToCompile) {
      if (trk.eventPreset === 'units_fighting') {
        if (trk.encounterName) humanEncounters.add(trk.encounterName);
        if (trk.driverEncounterName) covEncounters.add(trk.driverEncounterName);
      } else if (trk.team === 'human') {
        if (trk.encounterName) humanEncounters.add(trk.encounterName);
        if (trk.driverEncounterName) humanEncounters.add(trk.driverEncounterName);
      } else {
        if (trk.encounterName) covEncounters.add(trk.encounterName);
        if (trk.driverEncounterName) covEncounters.add(trk.driverEncounterName);
      }
    }

    // Emit per-track waypoints, dedicated flight paths, AI command list paths, camera points, trigger volumes, and object/encounter coordinates
    tracksToCompile.forEach((trk, idx) => {
      const safeId = trk.id
        .replace(/^(?:run_evt_\d+_)+/i, '')
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .slice(0, 14);
      const animIn = `fly_${safeId}_in`;
      const animOut = `fly_${safeId}_out`;
      const cmdListName = `cmd_${safeId}_path`;

      lines.push(`; --- @begin_track ${trk.id} (${trk.label}) ---`);
      const lzFocalWp =
        trk.waypoints.find((w) => w.name.includes('_lz')) ??
        trk.waypoints.filter((w) => !w.name.startsWith('cam_') && !w.name.includes('trig')).slice(-1)[0] ??
        trk.waypoints[trk.waypoints.length - 1];
      for (let wIdx = 0; wIdx < trk.waypoints.length; wIdx++) {
        const wp = trk.waypoints[wIdx]!;
        const wx = (playerAnchor.x + wp.xOffset).toFixed(4);
        const wy = (playerAnchor.y + wp.yOffset).toFixed(4);
        const wz = (playerAnchor.z + wp.zOffset).toFixed(4);
        if (wp.name.startsWith('cam_')) {
          const targetWp = lzFocalWp && lzFocalWp !== wp ? lzFocalWp : trk.waypoints[wIdx + 1] ?? wp;
          const dxCam = targetWp.xOffset - wp.xOffset;
          const dyCam = targetWp.yOffset - wp.yOffset;
          const dzCam = targetWp.zOffset - wp.zOffset;
          const camYaw = (dxCam !== 0 || dyCam !== 0 ? Math.atan2(dyCam, dxCam) : playerAnchor.yaw).toFixed(4);
          const horizDist = Math.hypot(dxCam, dyCam);
          const camPitch = (
            horizDist > 0.1 ? Math.max(-1.2, Math.min(1.2, Math.atan2(dzCam, horizDist))) : -0.15
          ).toFixed(4);
          lines.push(`; @camera_pos ${wp.name} ${wx},${wy},${wz},${camYaw},${camPitch}`);
        } else {
          const nextWp = trk.waypoints[wIdx + 1] ?? trk.waypoints[wIdx - 1] ?? wp;
          const wpYaw =
            nextWp !== wp
              ? Math.atan2(nextWp.yOffset - wp.yOffset, nextWp.xOffset - wp.xOffset).toFixed(4)
              : playerAnchor.yaw.toFixed(4);
          lines.push(`; @waypoint ${wp.name} ${wx},${wy},${wz},${wpYaw}`);
        }
      }

      // Emit explicit @object_type bindings so friendly Pelicans NEVER spawn as Covenant C-Dropships (and vice versa)
      if (trk.objectName) {
        if (trk.role.startsWith('unsc_pelican')) {
          lines.push(`; @object_type ${trk.objectName} pelican`);
        } else if (trk.role.startsWith('cov_dropship')) {
          lines.push(`; @object_type ${trk.objectName} c_dropship`);
        } else if (trk.role === 'unsc_scorpion') {
          lines.push(`; @object_type ${trk.objectName} scorpion`);
        } else if (trk.role === 'cov_wraith') {
          lines.push(`; @object_type ${trk.objectName} wraith`);
        } else if (trk.role === 'unsc_warthog') {
          lines.push(`; @object_type ${trk.objectName} warthog`);
        } else if (trk.role === 'cov_shade_turret') {
          lines.push(`; @object_type ${trk.objectName} turret`);
        }
      }
      if (trk.cargoObjectName) {
        if (trk.role === 'unsc_pelican_tank') {
          lines.push(`; @object_type ${trk.cargoObjectName} scorpion`);
        } else if (trk.role === 'cov_dropship_wraith') {
          lines.push(`; @object_type ${trk.cargoObjectName} wraith`);
        } else if (trk.role === 'cov_dropship_ghost') {
          lines.push(`; @object_type ${trk.cargoObjectName} ghost`);
        } else if (trk.role === 'unsc_pelican_marines') {
          lines.push(`; @object_type ${trk.cargoObjectName} warthog`);
        }
      }

      // Resolve ordered 3D Entry Waypoint Chain for THIS track
      // IMPORTANT: Never include ground patrol (wp_patrol*), migration (wp_mig*), trigger (wp_trig*), camera (cam_*), or _exit waypoints in the inbound air flight path!
      // Note: Do NOT exclude the LZ waypoint even though exitFlightChain starts at the LZ waypoint for handoff!
      const isGroundOrAuxWp = (name: string) =>
        name.startsWith('cam_') ||
        name.startsWith('wp_trig') ||
        name.includes('_trig') ||
        name.startsWith('wp_patrol') ||
        name.includes('_patrol') ||
        name.startsWith('wp_mig') ||
        name.includes('_mig') ||
        name.includes('_exit');
      const chainPts: Array<{ x: number; y: number; z: number; name: string }> = [];
      const seenNames = new Set<string>();
      for (const nm of trk.flightChain) {
        const found = trk.waypoints.find((w) => w.name === nm);
        if (found && !isGroundOrAuxWp(found.name) && !seenNames.has(found.name)) {
          seenNames.add(found.name);
          chainPts.push({
            name: found.name,
            x: Number((playerAnchor.x + found.xOffset).toFixed(4)),
            y: Number((playerAnchor.y + found.yOffset).toFixed(4)),
            z: Number((playerAnchor.z + found.zOffset).toFixed(4)),
          });
        }
      }
      // Only fall back to scanning remaining non-ground/non-aux waypoints if flightChain was empty
      if (chainPts.length === 0) {
        for (const wp of trk.waypoints) {
          if (!isGroundOrAuxWp(wp.name) && !seenNames.has(wp.name)) {
            seenNames.add(wp.name);
            chainPts.push({
              name: wp.name,
              x: Number((playerAnchor.x + wp.xOffset).toFixed(4)),
              y: Number((playerAnchor.y + wp.yOffset).toFixed(4)),
              z: Number((playerAnchor.z + wp.zOffset).toFixed(4)),
            });
          }
        }
      }

      // Resolve ordered 3D Departure / Exit Waypoint Chain for THIS track.
      // Guarantee that exitChainPts begins at the exact final LZ waypoint of chainPts so departure starts where inbound flight ended!
      const exitChainPts: Array<{ x: number; y: number; z: number; name: string }> = [];
      const finalInboundPt = chainPts[chainPts.length - 1];
      if (finalInboundPt) {
        exitChainPts.push({ ...finalInboundPt });
      }
      for (const nm of trk.exitFlightChain ?? []) {
        const found = trk.waypoints.find((w) => w.name === nm);
        if (found && (!finalInboundPt || found.name !== finalInboundPt.name)) {
          exitChainPts.push({
            name: found.name,
            x: Number((playerAnchor.x + found.xOffset).toFixed(4)),
            y: Number((playerAnchor.y + found.yOffset).toFixed(4)),
            z: Number((playerAnchor.z + found.zOffset).toFixed(4)),
          });
        }
      }
      if (exitChainPts.length < 2) {
        const fallbackExitWp = trk.waypoints.find((w) => w.name.includes('_exit'));
        if (fallbackExitWp && (!finalInboundPt || fallbackExitWp.name !== finalInboundPt.name)) {
          exitChainPts.push({
            name: fallbackExitWp.name,
            x: Number((playerAnchor.x + fallbackExitWp.xOffset).toFixed(4)),
            y: Number((playerAnchor.y + fallbackExitWp.yOffset).toFixed(4)),
            z: Number((playerAnchor.z + fallbackExitWp.zOffset).toFixed(4)),
          });
        }
      }

      const needsFlight =
        trk.role.includes('pelican') ||
        trk.role.includes('dropship') ||
        trk.actions.some((a) => a.kind === 'fly_approach_s_turns' || a.kind === 'fly_away_and_despawn');

      const isGroundAiOrVehicle =
        !needsFlight &&
        (trk.role === 'unsc_marine_squad' ||
          trk.role === 'cov_elite_squad' ||
          trk.role === 'cov_grunt_squad' ||
          trk.role === 'cov_hunter_pair' ||
          trk.role === 'unsc_scorpion' ||
          trk.role === 'cov_wraith' ||
          trk.role === 'unsc_warthog');

      const cleanFlightNames = chainPts.map((p) => p.name);
      const startWp =
        trk.waypoints.find((w) => w.name === cleanFlightNames[0]) ?? trk.waypoints[0];
      const lzWp =
        trk.waypoints.find((w) => w.name === cleanFlightNames[cleanFlightNames.length - 1]) ??
        trk.waypoints.find((w) => w.name.includes('_lz') || w.name.includes('_hover')) ??
        startWp;

      const groundPatrolWps = trk.waypoints.filter(
        (w) =>
          w.name.startsWith('wp_patrol') ||
          w.name.includes('_patrol') ||
          w.name.startsWith('wp_mig') ||
          w.name.includes('_mig') ||
          (!cleanFlightNames.includes(w.name) &&
            !(trk.exitFlightChain ?? []).includes(w.name) &&
            !w.name.startsWith('cam_') &&
            !w.name.includes('trig')),
      );
      const patrolChainPts: Array<{ x: number; y: number; z: number }> = [];
      if (needsFlight) {
        if (lzWp && groundPatrolWps.length > 0) {
          patrolChainPts.push({
            x: Number((playerAnchor.x + lzWp.xOffset).toFixed(4)),
            y: Number((playerAnchor.y + lzWp.yOffset).toFixed(4)),
            z: Number((playerAnchor.z + Math.min(lzWp.zOffset, 1.0)).toFixed(4)),
          });
        }
        for (const pw of groundPatrolWps) {
          patrolChainPts.push({
            x: Number((playerAnchor.x + pw.xOffset).toFixed(4)),
            y: Number((playerAnchor.y + pw.yOffset).toFixed(4)),
            z: Number((playerAnchor.z + Math.min(pw.zOffset, 1.5)).toFixed(4)),
          });
        }
      } else {
        patrolChainPts.push(...chainPts);
        for (const pw of groundPatrolWps) {
          if (!trk.flightChain.includes(pw.name)) {
            patrolChainPts.push({
              x: Number((playerAnchor.x + pw.xOffset).toFixed(4)),
              y: Number((playerAnchor.y + pw.yOffset).toFixed(4)),
              z: Number((playerAnchor.z + Math.min(pw.zOffset, 1.5)).toFixed(4)),
            });
          }
        }
      }

      const needsAiCommandList =
        trk.actions.some((a) => a.kind === 'follow_waypoint_path_ai') ||
        groundPatrolWps.length > 0 ||
        (isGroundAiOrVehicle && trk.eventPreset !== 'units_fighting' && patrolChainPts.length >= 2);

      if (needsFlight && chainPts.length >= 2) {
        lines.push(`; @flight_path ${animIn} ${chainPts.map((p) => `${p.x},${p.y},${p.z}`).join(';')}`);
        if (exitChainPts.length >= 2) {
          lines.push(`; @flight_path ${animOut} ${exitChainPts.map((p) => `${p.x},${p.y},${p.z}`).join(';')}`);
        } else {
          const revPts = [...chainPts].reverse().map((p, i) => `${p.x},${p.y},${(p.z + i * 1.5).toFixed(4)}`);
          lines.push(`; @flight_path ${animOut} ${revPts.join(';')}`);
        }
      }

      if (needsAiCommandList && patrolChainPts.length >= 1) {
        lines.push(
          `; @command_list_path ${cmdListName} ${patrolChainPts.map((p) => `${p.x},${p.y},${p.z}`).join(';')}`,
        );
      }

      if (trk.eventPreset === 'units_fighting') {
        const wpFriendly = trk.waypoints[0];
        const wpEnemy = trk.waypoints[1] ?? trk.waypoints[0];
        if (wpFriendly && trk.encounterName) {
          lines.push(
            `; @encounter_pos ${trk.encounterName} ${(playerAnchor.x + wpFriendly.xOffset).toFixed(4)},${(playerAnchor.y + wpFriendly.yOffset).toFixed(4)},${(playerAnchor.z + wpFriendly.zOffset).toFixed(4)}`,
          );
        }
        if (wpEnemy && trk.driverEncounterName) {
          lines.push(
            `; @encounter_pos ${trk.driverEncounterName} ${(playerAnchor.x + wpEnemy.xOffset).toFixed(4)},${(playerAnchor.y + wpEnemy.yOffset).toFixed(4)},${(playerAnchor.z + wpEnemy.zOffset).toFixed(4)}`,
          );
        }
      } else if (trk.eventPreset === 'door_from_switch') {
        const wpSw = trk.waypoints[0];
        const wpDoor = trk.waypoints[1] ?? trk.waypoints[0];
        if (wpSw) {
          const sx = (playerAnchor.x + wpSw.xOffset).toFixed(4);
          const sy = (playerAnchor.y + wpSw.yOffset).toFixed(4);
          const sz = (playerAnchor.z + wpSw.zOffset).toFixed(4);
          if (trk.cargoObjectName) lines.push(`; @object_pos ${trk.cargoObjectName} ${sx},${sy},${sz}`);
          const trigAct = trk.actions.find((a) => a.triggerName);
          if (trigAct?.triggerName) lines.push(`; @trigger_pos ${trigAct.triggerName} ${sx},${sy},${sz},4.0,4.0,3.5`);
        }
        if (wpDoor && trk.objectName) {
          lines.push(
            `; @object_pos ${trk.objectName} ${(playerAnchor.x + wpDoor.xOffset).toFixed(4)},${(playerAnchor.y + wpDoor.yOffset).toFixed(4)},${(playerAnchor.z + wpDoor.zOffset).toFixed(4)}`,
          );
        }
      } else if (trk.eventPreset === 'door_from_proximity') {
        const wpDoor = trk.waypoints[0];
        if (wpDoor) {
          const dx = (playerAnchor.x + wpDoor.xOffset).toFixed(4);
          const dy = (playerAnchor.y + wpDoor.yOffset).toFixed(4);
          const dz = (playerAnchor.z + wpDoor.zOffset).toFixed(4);
          if (trk.objectName) lines.push(`; @object_pos ${trk.objectName} ${dx},${dy},${dz}`);
          const trigAct = trk.actions.find((a) => a.triggerName);
          if (trigAct?.triggerName) lines.push(`; @trigger_pos ${trigAct.triggerName} ${dx},${dy},${dz},7.0,7.0,4.0`);
        }
      } else if (trk.eventPreset === 'cutscene_from_trigger') {
        const wpTrig = trk.waypoints[0];
        if (wpTrig) {
          const tx = (playerAnchor.x + wpTrig.xOffset).toFixed(4);
          const ty = (playerAnchor.y + wpTrig.yOffset).toFixed(4);
          const tz = (playerAnchor.z + wpTrig.zOffset).toFixed(4);
          const trigAct = trk.actions.find((a) => a.triggerName);
          if (trigAct?.triggerName) lines.push(`; @trigger_pos ${trigAct.triggerName} ${tx},${ty},${tz},6.0,6.0,4.0`);
        }
      } else {
        // Also emit @trigger_pos for any track that uses a wait_for_trigger action (e.g. Triggered Cutscene + Pelican Drop)
        const trigAct = trk.actions.find((a) => a.kind === 'wait_for_trigger');
        if (trigAct) {
          const trigName = trigAct.triggerName || `trig_${safeId}`;
          const explicitTrigWp =
            trk.waypoints.find((w) => w.name === trigAct.waypointName && !trk.flightChain.includes(w.name)) ??
            trk.waypoints.find((w) => w.name.includes('trig'));
          const fallbackTrigWp =
            trk.waypoints.find((w) => !trk.flightChain.includes(w.name) && !w.name.startsWith('cam_')) ??
            { xOffset: 4, yOffset: 0, zOffset: 0.5 };
          const wpTrig = explicitTrigWp ?? fallbackTrigWp;
          const tx = (playerAnchor.x + wpTrig.xOffset).toFixed(4);
          const ty = (playerAnchor.y + wpTrig.yOffset).toFixed(4);
          const tz = (playerAnchor.z + wpTrig.zOffset).toFixed(4);
          lines.push(`; @trigger_pos ${trigName} ${tx},${ty},${tz},6.5,6.5,4.0`);
        }
        const isDropshipRole = trk.role.includes('pelican') || trk.role.includes('dropship');
        const primaryWp = isDropshipRole || needsAiCommandList ? startWp : lzWp;
        if (primaryWp && trk.objectName) {
          const px = (playerAnchor.x + primaryWp.xOffset).toFixed(4);
          const py = (playerAnchor.y + primaryWp.yOffset).toFixed(4);
          const pz = (playerAnchor.z + primaryWp.zOffset).toFixed(4);
          lines.push(`; @object_pos ${trk.objectName} ${px},${py},${pz}`);
        }
        const encAnchorWp = needsAiCommandList ? startWp : lzWp;
        if (encAnchorWp) {
          const lx = (playerAnchor.x + encAnchorWp.xOffset).toFixed(4);
          const ly = (playerAnchor.y + encAnchorWp.yOffset).toFixed(4);
          const lz = (playerAnchor.z + Math.min(encAnchorWp.zOffset, 1.5)).toFixed(4);
          if (trk.cargoObjectName) {
            lines.push(`; @object_pos ${trk.cargoObjectName} ${lx},${ly},${lz}`);
          }
          if (trk.encounterName) {
            lines.push(`; @encounter_pos ${trk.encounterName} ${lx},${ly},${lz}`);
          }
          if (trk.driverEncounterName) {
            lines.push(`; @encounter_pos ${trk.driverEncounterName} ${lx},${ly},${lz}`);
          }
        }
        // Emit @encounter_pos for any migrate_to_encounter destination waypoint so the target encounter has 3D firing positions at the arrow tip
        for (const act of trk.actions) {
          if (act.kind === 'migrate_to_encounter') {
            const dstEnc = act.targetName || `${trk.team === 'covenant' ? 'cov' : 'unsc'}_mig_zone_${idx + 1}`;
            const migWp =
              (act.waypointName ? trk.waypoints.find((w) => w.name === act.waypointName) : undefined) ??
              trk.waypoints.find((w) => w.name.startsWith('wp_mig') || w.name.includes('_mig')) ??
              groundPatrolWps[groundPatrolWps.length - 1];
            const otherTrackHasEnc = tracksToCompile.some(
              (other) => other.id !== trk.id && (other.encounterName === dstEnc || other.driverEncounterName === dstEnc),
            );
            if (migWp && !otherTrackHasEnc) {
              const mx = (playerAnchor.x + migWp.xOffset).toFixed(4);
              const my = (playerAnchor.y + migWp.yOffset).toFixed(4);
              const mz = (playerAnchor.z + Math.min(migWp.zOffset, 1.5)).toFixed(4);
              lines.push(`; @encounter_pos ${dstEnc} ${mx},${my},${mz}`);
            }
          }
        }
      }
      for (const act of trk.actions) {
        if (act.kind === 'show_cutscene_title') {
          const titleNm = act.targetName || `chapter_${idx + 1}`;
          const upSecs = Math.max(1, Number((act.seconds ?? 4).toFixed(1)));
          lines.push(`; @cutscene_title ${titleNm} 1.5,${upSecs},1.5`);
        }
      }

      const fnSuffix = safeId.replace(/^evt_\d+_/i, '') || safeId;
      const fnName = `run_evt_${idx + 1}_${fnSuffix}`;
      const chainStartWp = chainPts[0]?.name || trk.flightChain[0] || trk.waypoints[0]?.name || `wp_${safeId}_start`;
      const hasSpawnAndLoad = trk.actions.some((a) => a.kind === 'spawn_and_load');
      const hasFlightInTrack = trk.actions.some((a) => a.kind === 'fly_approach_s_turns');
      const camActionIdx = trk.actions.findIndex((a) => a.kind === 'cutscene_camera_pan');
      const flyActionIdx = trk.actions.findIndex((a) => a.kind === 'fly_approach_s_turns');
      const deferCinematicStopToFlightEnd =
        hasFlightInTrack && camActionIdx >= 0 && flyActionIdx > camActionIdx;
      let flightStartedDuringCutscene = false;
      let cinematicOpenDuringFlight = false;
      lines.push(`(script dormant ${fnName}`);

      for (const act of trk.actions) {
        if (act.kind === 'spawn_and_load') {
          if (trk.eventPreset === 'units_fighting') {
            if (trk.encounterName) lines.push(`  (ai_place ${trk.encounterName})`);
            if (trk.driverEncounterName) lines.push(`  (ai_place ${trk.driverEncounterName})`);
          } else if (trk.role === 'unsc_pelican_tank') {
            lines.push(`  (object_create_anew ${trk.objectName})`);
            lines.push(`  (object_teleport ${trk.objectName} ${chainStartWp})`);
            lines.push(`  (object_create_anew ${trk.cargoObjectName})`);
            lines.push(`  (unit_enter_vehicle ${trk.cargoObjectName} ${trk.objectName} "cargo")`);
            lines.push(`  (ai_place ${trk.driverEncounterName})`);
            lines.push(`  (vehicle_load_magic ${trk.cargoObjectName} "scorpion-driver" (ai_actors ${trk.driverEncounterName}))`);
            lines.push(`  (ai_vehicle_encounter ${trk.cargoObjectName} ${trk.driverEncounterName})`);
            if (trk.encounterName) {
              lines.push(`  (ai_place ${trk.encounterName})`);
              lines.push(`  (ai_braindead ${trk.encounterName} true)`);
              lines.push(`  (vehicle_load_magic ${trk.objectName} "rider" (ai_actors ${trk.encounterName}))`);
            }
          } else if (trk.role === 'unsc_pelican_marines') {
            lines.push(`  (object_create_anew ${trk.objectName})`);
            lines.push(`  (object_teleport ${trk.objectName} ${chainStartWp})`);
            lines.push(`  (ai_place ${trk.encounterName})`);
            lines.push(`  (ai_braindead ${trk.encounterName} true)`);
            lines.push(`  (vehicle_load_magic ${trk.objectName} "rider" (ai_actors ${trk.encounterName}))`);
          } else if (trk.role === 'cov_dropship_wraith') {
            lines.push(`  (object_create_anew ${trk.objectName})`);
            lines.push(`  (object_teleport ${trk.objectName} ${chainStartWp})`);
            lines.push(`  (unit_close ${trk.objectName})`);
            lines.push(`  (object_create_anew ${trk.cargoObjectName})`);
            lines.push(`  (unit_enter_vehicle ${trk.cargoObjectName} ${trk.objectName} "cargo_wraith")`);
            lines.push(`  (ai_place ${trk.driverEncounterName})`);
            lines.push(`  (vehicle_load_magic ${trk.cargoObjectName} "wraith-driver" (ai_actors ${trk.driverEncounterName}))`);
            lines.push(`  (ai_vehicle_encounter ${trk.cargoObjectName} ${trk.driverEncounterName})`);
            if (trk.encounterName) {
              lines.push(`  (ai_place ${trk.encounterName})`);
              lines.push(`  (ai_braindead ${trk.encounterName} true)`);
              lines.push(`  (vehicle_load_magic ${trk.objectName} "passenger" (ai_actors ${trk.encounterName}))`);
            }
          } else if (trk.role === 'cov_dropship_ghost') {
            lines.push(`  (object_create_anew ${trk.objectName})`);
            lines.push(`  (object_teleport ${trk.objectName} ${chainStartWp})`);
            lines.push(`  (unit_close ${trk.objectName})`);
            lines.push(`  (object_create_anew ${trk.cargoObjectName})`);
            lines.push(`  (unit_enter_vehicle ${trk.cargoObjectName} ${trk.objectName} "cargo_ghost01")`);
            lines.push(`  (ai_place ${trk.driverEncounterName})`);
            lines.push(`  (vehicle_load_magic ${trk.cargoObjectName} "G-driver" (ai_actors ${trk.driverEncounterName}))`);
            lines.push(`  (ai_vehicle_encounter ${trk.cargoObjectName} ${trk.driverEncounterName})`);
          } else if (trk.role === 'cov_dropship_elites') {
            lines.push(`  (object_create_anew ${trk.objectName})`);
            lines.push(`  (object_teleport ${trk.objectName} ${chainStartWp})`);
            lines.push(`  (unit_close ${trk.objectName})`);
            lines.push(`  (ai_place ${trk.encounterName})`);
            lines.push(`  (ai_braindead ${trk.encounterName} true)`);
            lines.push(`  (vehicle_load_magic ${trk.objectName} "passenger" (ai_actors ${trk.encounterName}))`);
          } else if (
            trk.role === 'unsc_scorpion' ||
            trk.role === 'cov_wraith' ||
            trk.role === 'unsc_warthog' ||
            trk.role === 'cov_shade_turret'
          ) {
            lines.push(`  (object_create_anew ${trk.objectName})`);
            lines.push(`  (ai_place ${trk.driverEncounterName})`);
            const seat =
              trk.role === 'cov_wraith'
                ? 'wraith-driver'
                : trk.role === 'unsc_scorpion'
                  ? 'scorpion-driver'
                  : trk.role === 'cov_shade_turret'
                    ? 'G-driver'
                    : 'W-driver';
            lines.push(`  (vehicle_load_magic ${trk.objectName} "${seat}" (ai_actors ${trk.driverEncounterName}))`);
            lines.push(`  (ai_vehicle_encounter ${trk.objectName} ${trk.driverEncounterName})`);
            if (needsAiCommandList) {
              lines.push(`  (ai_command_list ${trk.driverEncounterName} ${cmdListName})`);
            } else {
              lines.push(`  (ai_follow_target_players ${trk.driverEncounterName})`);
            }
            lines.push(`  (ai_vehicle_enterable_distance ${trk.objectName} 12.0)`);
          } else if (trk.encounterName) {
            lines.push(`  (ai_place ${trk.encounterName})`);
            if (needsAiCommandList) {
              lines.push(`  (ai_command_list ${trk.encounterName} ${cmdListName})`);
            }
          }
        } else if (act.kind === 'fly_approach_s_turns') {
          if (!flightStartedDuringCutscene) {
            if (!hasSpawnAndLoad) {
              lines.push(`  (object_teleport ${trk.objectName} ${chainStartWp})`);
            }
            lines.push(`  (recording_play_and_hover ${trk.objectName} ${animIn})`);
          }
          const settleTicks = Math.max(15, Math.round(act.secondarySleepTicks ?? 30));
          lines.push(`  (sleep (recording_time ${trk.objectName}))`);
          lines.push(`  (vehicle_hover ${trk.objectName} true)`);
          if (trk.role.startsWith('cov_dropship')) {
            lines.push(`  (unit_open ${trk.objectName})`);
          }
          lines.push(`  (sleep ${settleTicks})`);
          if (cinematicOpenDuringFlight) {
            lines.push('  (camera_control false)');
            lines.push('  (cinematic_show_letterbox false)');
            lines.push('  (cinematic_stop)');
            cinematicOpenDuringFlight = false;
          }
        } else if (act.kind === 'follow_waypoint_path_ai') {
          const targetEncs = Array.from(new Set([trk.driverEncounterName, trk.encounterName].filter(Boolean)));
          if (targetEncs.length === 0) targetEncs.push(`squad_${safeId}`);
          for (const targetEnc of targetEncs) {
            lines.push(`  (ai_force_active ${targetEnc} true)`);
            lines.push(`  (ai_command_list ${targetEnc} ${cmdListName})`);
          }
        } else if (act.kind === 'teleport_to_waypoint') {
          const wp = act.waypointName || trk.waypoints[0]?.name || 'wp_1';
          lines.push(`  (object_teleport ${trk.objectName} ${wp})`);
        } else if (act.kind === 'wait_for_trigger') {
          const trig = act.triggerName || `trig_${safeId}`;
          const pollTicks = Math.max(1, Math.round(act.sleepTicks ?? 15));
          lines.push(`  (sleep_until (volume_test_objects ${trig} (players)) ${pollTicks})`);
        } else if (act.kind === 'wait_for_switch') {
          const swName = act.targetName || trk.cargoObjectName || `switch_control_${idx + 1}`;
          const trigName = act.triggerName || `trig_switch_${idx + 1}`;
          const doorName = trk.objectName || `door_machine_${idx + 1}`;
          lines.push(`  (object_create_anew ${doorName})`);
          lines.push(`  (object_create_anew ${swName})`);
          lines.push(`  (device_set_power ${doorName} 1.0)`);
          lines.push(`  (device_set_position ${doorName} 0.0)`);
          lines.push(`  (device_set_power ${swName} 1.0)`);
          lines.push(`  (device_set_position ${swName} 0.0)`);
          lines.push(
            `  (sleep_until (or (> (device_get_position ${swName}) 0.0) (volume_test_objects ${trigName} (players))) 10)`,
          );
          lines.push(`  (device_set_position ${swName} 1.0)`);
        } else if (act.kind === 'open_bay_doors') {
          const doorTicks = Math.max(1, Math.round(act.sleepTicks ?? 45));
          lines.push(`  (unit_open ${trk.objectName})`);
          lines.push(`  (sleep ${doorTicks})`);
        } else if (act.kind === 'unload_cargo_and_troops') {
          const unloadWaitTicks = Math.max(1, Math.round(act.sleepTicks ?? 25));
          if (trk.role === 'unsc_pelican_tank') {
            lines.push(`  (unit_exit_vehicle ${trk.cargoObjectName})`);
            lines.push(`  (sleep ${unloadWaitTicks})`);
            if (trk.encounterName) {
              lines.push(`  (ai_braindead ${trk.encounterName} false)`);
              lines.push(`  (vehicle_unload ${trk.objectName} "rider")`);
              lines.push(`  (vehicle_unload ${trk.objectName} "")`);
            }
            lines.push(`  (ai_force_active ${trk.driverEncounterName} true)`);
            lines.push(`  (ai_follow_target_players ${trk.driverEncounterName})`);
          } else if (trk.role === 'unsc_pelican_marines') {
            lines.push(`  (ai_braindead ${trk.encounterName} false)`);
            lines.push(`  (vehicle_unload ${trk.objectName} "rider")`);
            lines.push(`  (vehicle_unload ${trk.objectName} "")`);
            lines.push(`  (ai_follow_target_players ${trk.encounterName})`);
          } else if (trk.role === 'cov_dropship_wraith' || trk.role === 'cov_dropship_ghost') {
            lines.push(`  (unit_exit_vehicle ${trk.cargoObjectName})`);
            lines.push(`  (sleep ${unloadWaitTicks})`);
            if (trk.encounterName) {
              lines.push(`  (ai_braindead ${trk.encounterName} false)`);
              lines.push(`  (vehicle_unload ${trk.objectName} "")`);
            }
            lines.push(`  (ai_force_active ${trk.driverEncounterName} true)`);
            lines.push(`  (ai_follow_target_players ${trk.driverEncounterName})`);
          } else if (trk.role === 'cov_dropship_elites') {
            lines.push(`  (ai_braindead ${trk.encounterName} false)`);
            lines.push('  (begin_random');
            for (const s of [
              'cd-passengerl01',
              'cd-passengerl02',
              'cd-passengerl03',
              'cd-passengerl04',
              'cd-passengerr01',
              'cd-passengerr02',
              'cd-passengerr03',
              'cd-passengerr04',
            ]) {
              lines.push(`    (begin (vehicle_unload ${trk.objectName} "${s}") (sleep 5))`);
            }
            lines.push('  )');
            lines.push(`  (vehicle_unload ${trk.objectName} "")`);
          }
        } else if (act.kind === 'engage_ai_combat') {
          if (trk.eventPreset === 'units_fighting') {
            const fEnc = trk.encounterName;
            const eEnc = trk.driverEncounterName;
            if (fEnc) {
              lines.push(`  (ai_force_active ${fEnc} true)`);
              lines.push(`  (ai_follow_target_players ${fEnc})`);
              if (eEnc) lines.push(`  (ai_magically_see_encounter ${fEnc} ${eEnc})`);
              lines.push(`  (ai_attack ${fEnc})`);
            }
            if (eEnc) {
              lines.push(`  (ai_force_active ${eEnc} true)`);
              lines.push(`  (ai_magically_see_players ${eEnc})`);
              if (fEnc) lines.push(`  (ai_magically_see_encounter ${eEnc} ${fEnc})`);
              lines.push(`  (ai_attack ${eEnc})`);
            }
          } else {
            const myEncs = Array.from(new Set([trk.encounterName, trk.driverEncounterName].filter(Boolean)));
            for (const myEnc of myEncs) {
              lines.push(`  (ai_force_active ${myEnc} true)`);
              lines.push(`  (ai_follow_target_players ${myEnc})`);
              if (trk.team === 'covenant') {
                lines.push(`  (ai_magically_see_players ${myEnc})`);
                for (const hEnc of humanEncounters) {
                  lines.push(`  (ai_magically_see_encounter ${myEnc} ${hEnc})`);
                }
              } else {
                for (const cEnc of covEncounters) {
                  lines.push(`  (ai_magically_see_encounter ${myEnc} ${cEnc})`);
                }
              }
              lines.push(`  (ai_attack ${myEnc})`);
            }
            // If this is a dropship track with ground patrol/migration waypoints, immediately issue the command list right after unloading at the LZ
            if (needsFlight && needsAiCommandList && patrolChainPts.length >= 1) {
              for (const myEnc of myEncs) {
                lines.push(`  (ai_command_list ${myEnc} ${cmdListName})`);
              }
            }
          }
        } else if (act.kind === 'delay_seconds') {
          const ticks = Math.max(
            1,
            Math.round(act.sleepTicks !== undefined ? act.sleepTicks : (act.seconds ?? 3) * 30),
          );
          lines.push(`  (sleep ${ticks})`);
        } else if (act.kind === 'close_bay_doors') {
          lines.push(`  (unit_close ${trk.objectName})`);
        } else if (act.kind === 'fly_away_and_despawn') {
          if (trk.role.startsWith('cov_dropship')) {
            lines.push(`  (unit_close ${trk.objectName})`);
          }
          lines.push(`  (vehicle_hover ${trk.objectName} false)`);
          lines.push(`  (object_set_collideable ${trk.objectName} false)`);
          lines.push(`  (recording_play_and_delete ${trk.objectName} ${animOut})`);
          lines.push(`  (sleep (recording_time ${trk.objectName}))`);
          lines.push('  (sleep 30)');
          lines.push(`  (object_destroy ${trk.objectName})`);
        } else if (act.kind === 'enable_turret_autoboard') {
          const vehTarget = trk.cargoObjectName || trk.objectName;
          lines.push(`  (ai_vehicle_enterable_distance ${vehTarget} 15.0)`);
          lines.push(`  (ai_vehicle_enterable_team ${vehTarget} ${trk.team})`);
        } else if (act.kind === 'migrate_to_encounter') {
          const dstEnc = act.targetName || `${trk.team === 'covenant' ? 'cov' : 'unsc'}_mig_zone_${idx + 1}`;
          if (trk.encounterName) {
            lines.push(`  (ai_migrate ${trk.encounterName} ${dstEnc})`);
          }
          if (trk.driverEncounterName && trk.driverEncounterName !== dstEnc) {
            lines.push(`  (ai_migrate ${trk.driverEncounterName} ${dstEnc})`);
          }
          lines.push(`  (ai_force_active ${dstEnc} true)`);
          if (needsAiCommandList && patrolChainPts.length >= 1) {
            lines.push(`  (ai_command_list ${dstEnc} ${cmdListName})`);
          }
          lines.push(`  (ai_follow_target_players ${dstEnc})`);
        } else if (act.kind === 'operate_device_door') {
          const doorName = act.targetName || trk.objectName || 'door_machine_1';
          lines.push(`  (object_create_anew ${doorName})`);
          lines.push(`  (device_set_never_appears_locked ${doorName} true)`);
          lines.push(`  (device_set_power ${doorName} 1.0)`);
          lines.push(`  (device_set_position ${doorName} 1.0)`);
        } else if (act.kind === 'proximity_door_loop') {
          const doorName = act.targetName || trk.objectName || 'door_prox_1';
          const trigName = act.triggerName || `trig_door_prox_${idx + 1}`;
          lines.push(`  (object_create_anew ${doorName})`);
          lines.push(`  (device_set_never_appears_locked ${doorName} true)`);
          lines.push(`  (device_set_power ${doorName} 1.0)`);
          lines.push(`  (sleep_until (volume_test_objects ${trigName} (players)) 15)`);
          lines.push(`  (device_set_position ${doorName} 1.0)`);
        } else if (act.kind === 'activate_hud_navpoint') {
          const wp = act.waypointName || trk.waypoints[0]?.name || 'wp_1';
          lines.push(`  (activate_team_nav_point_flag default player ${wp} 0.6)`);
        } else if (act.kind === 'cutscene_camera_pan') {
          // If this track also includes a Pelican/Dropship flight approach, start the flight right as the cutscene begins so the camera films it live!
          if (hasFlightInTrack && !flightStartedDuringCutscene && trk.objectName) {
            if (!hasSpawnAndLoad) {
              lines.push(`  (object_teleport ${trk.objectName} ${chainStartWp})`);
            }
            lines.push(`  (recording_play_and_hover ${trk.objectName} ${animIn})`);
            flightStartedDuringCutscene = true;
          }
          const trackCams = trk.waypoints.filter((w) => w.name.startsWith('cam_')).map((w) => w.name);
          const camList =
            trackCams.length >= 2
              ? trackCams
              : [
                  act.waypointName || trackCams[0] || 'cam_intro_1',
                  ...(act.targetName && act.targetName !== (act.waypointName || trackCams[0]) ? [act.targetName] : []),
                ];
          const defaultStepMoveTicks = Math.max(
            15,
            Math.round(act.camStepMoveTicks ?? (act.seconds ?? 4) * 30),
          );
          const defaultStepSleepTicks = Math.max(
            15,
            Math.round(act.camStepSleepTicks ?? defaultStepMoveTicks),
          );
          const defaultInitHoldTicks = Math.max(0, Math.round(act.camInitialHoldTicks ?? 30));

          lines.push('  (cinematic_start)');
          lines.push('  (cinematic_show_letterbox true)');
          lines.push('  (camera_control true)');
          for (let cIdx = 0; cIdx < camList.length; cIdx++) {
            const camNm = camList[cIdx]!;
            const customShot = act.cameraTimings?.find((ct) => ct.camName === camNm) ?? act.cameraTimings?.[cIdx];
            const moveTicks =
              customShot !== undefined
                ? Math.max(0, Math.round(customShot.moveTicks))
                : cIdx === 0
                  ? 0
                  : defaultStepMoveTicks;
            const rawSleepTicks =
              customShot !== undefined
                ? Math.max(0, Math.round(customShot.sleepTicks))
                : cIdx === 0
                  ? camList.length <= 1
                    ? defaultStepSleepTicks
                    : defaultInitHoldTicks
                  : defaultStepSleepTicks;
            // In HaloScript, (camera_set <cam> <moveTicks>) is non-blocking; if (sleep <N>) is smaller than <moveTicks>,
            // the camera gets cut off mid-pan before ever reaching <cam>. Always enforce sleepTicks >= moveTicks!
            const sleepTicks = moveTicks > 0 ? Math.max(moveTicks, rawSleepTicks) : rawSleepTicks;
            lines.push(`  (camera_set ${camNm} ${moveTicks})`);
            if (sleepTicks > 0) {
              lines.push(`  (sleep ${sleepTicks})`);
            }
          }
          if (deferCinematicStopToFlightEnd) {
            cinematicOpenDuringFlight = true;
          } else {
            lines.push('  (camera_control false)');
            lines.push('  (cinematic_show_letterbox false)');
            lines.push('  (cinematic_stop)');
          }
        } else if (act.kind === 'show_cutscene_title') {
          const titleNm = act.targetName || `chapter_${idx + 1}`;
          lines.push(`  (cinematic_set_title ${titleNm})`);
        } else if (act.kind === 'wait_until_wave_cleared') {
          const waveEnc = act.targetName || trk.encounterName || trk.driverEncounterName || `squad_${idx + 1}`;
          const maxSurvivors = Math.max(0, Math.round(act.sleepTicks ?? 0));
          lines.push(`  (sleep_until (<= (ai_living_count ${waveEnc}) ${maxSurvivors}) 15)`);
        }
      }

      if (cinematicOpenDuringFlight) {
        lines.push('  (camera_control false)');
        lines.push('  (cinematic_show_letterbox false)');
        lines.push('  (cinematic_stop)');
        cinematicOpenDuringFlight = false;
      }

      lines.push(')');
      lines.push(`; --- @end_track ${trk.id} ---`, '');
    });

    lines.push(
      '(script static void init_builder_team_allegiances',
      '  (ai true)',
      '  (ai_allegiance player human)',
      '  (ai_allegiance human player)',
      '  (ai_allegiance default human)',
      '  (ai_allegiance human default)',
      '  (ai_allegiance default player)',
      '  (ai_allegiance player default)',
      '  (ai_allegiance_remove human covenant)',
      '  (ai_allegiance_remove covenant human)',
      '  (ai_allegiance_remove player covenant)',
      '  (ai_allegiance_remove covenant player)',
      '  (ai_allegiance_remove default covenant)',
      '  (ai_allegiance_remove covenant default)',
      ')',
      '',
      '(script startup init_builder_events',
      '  (init_builder_team_allegiances)',
    );
    tracksToCompile.forEach((trk, idx) => {
      const safeId = trk.id
        .replace(/^(?:run_evt_\d+_)+/i, '')
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .slice(0, 14);
      const fnSuffix = safeId.replace(/^evt_\d+_/i, '') || safeId;
      const fnName = `run_evt_${idx + 1}_${fnSuffix}`;
      lines.push(`  (wake ${fnName})`);
    });
    lines.push(')', '; === @end_3d_builder_scripts ===', '');

    return lines.join('\n');
  };

  const selectedTemplate: HaloScriptSampleTemplate =
    HALOSCRIPT_SAMPLE_TEMPLATES.find((t) => t.id === selectedTemplateId) ?? HALOSCRIPT_SAMPLE_TEMPLATES[0]!;

  const reconstructTrackFromDecompiledScript = (
    s: { name: string; scriptType: string; bodySource: string },
    idxNum: number,
    anchor: { x: number; y: number; z: number },
    wpCoords: Map<string, { x: number; y: number; z: number }>,
    camCoords: Map<string, { x: number; y: number; z: number }>,
    trigCoords: Map<string, { x: number; y: number; z: number }>,
    flightPaths: Map<string, Array<{ x: number; y: number; z: number }>>,
    cmdPaths: Map<string, Array<{ x: number; y: number; z: number }>>,
  ): BuilderUnitTrack => {
    const body = s.bodySource;
    const strippedId = s.name
      .replace(/^(?:run_evt_\d+_)+/i, '')
      .replace(/^(?:evt_\d+_)+/i, '')
      .replace(/[^a-zA-Z0-9_]/g, '_');
    const trackId = (`evt_${idxNum}_${strippedId || idxNum}`).slice(0, 14);
    const toOff = (pt: { x: number; y: number; z: number }) => ({
      xOffset: Number((pt.x - anchor.x).toFixed(2)),
      yOffset: Number((pt.y - anchor.y).toFixed(2)),
      zOffset: Number((pt.z - anchor.z).toFixed(2)),
    });

    // Extract referenced entities from script body
    const recPlayMatch = /\(\s*recording_play(?:_and_hover)?\s+([A-Za-z0-9_.-]+)\s+([A-Za-z0-9_.-]+)\s*\)/i.exec(body);
    const recOutMatch = /\(\s*recording_play_and_delete\s+([A-Za-z0-9_.-]+)\s+([A-Za-z0-9_.-]+)\s*\)/i.exec(body);
    const teleMatch = /\(\s*object_teleport\s+([A-Za-z0-9_.-]+)\s+([A-Za-z0-9_.-]+)\s*\)/i.exec(body);
    const cmdListMatch = /\(\s*ai_command_list\s+([A-Za-z0-9_.-/]+)\s+([A-Za-z0-9_.-]+)\s*\)/i.exec(body);
    const trigMatch = /\(\s*volume_test_objects\s+([A-Za-z0-9_.-]+)/i.exec(body);
    const trigPollMatch = /\(\s*sleep_until\s+\(\s*volume_test_objects\s+([A-Za-z0-9_.-]+)[\s\S]*?\)\s*(\d+)?\s*\)/i.exec(body);
    const switchMatch = /\(\s*device_get_position\s+([A-Za-z0-9_.-]+)\s*\)/i.exec(body);
    const doorMatch = /\(\s*device_set_position\s+([A-Za-z0-9_.-]+)\s+1(?:\.0)?\s*\)/i.exec(body);
    const navMatch = /\(\s*activate_team_nav_point_flag\s+\S+\s+\S+\s+([A-Za-z0-9_.-]+)/i.exec(body);

    const objCreates: string[] = [];
    const objRegex = /\(\s*object_create(?:_anew)?\s+([A-Za-z0-9_.-]+)\s*\)/gi;
    let om: RegExpExecArray | null;
    while ((om = objRegex.exec(body)) !== null) {
      if (!objCreates.includes(om[1]!)) objCreates.push(om[1]!);
    }

    const aiPlaces: string[] = [];
    const aiRegex = /\(\s*ai_place\s+([A-Za-z0-9_.-/]+)\s*\)/gi;
    let am: RegExpExecArray | null;
    while ((am = aiRegex.exec(body)) !== null) {
      const baseEnc = am[1]!.split('/')[0]!;
      if (!aiPlaces.includes(baseEnc)) aiPlaces.push(baseEnc);
    }

    // Parse each (camera_set <camName> <moveTicks>) and optional immediately-following (sleep <sleepTicks>)
    const camSets: string[] = [];
    const parsedCameraTimings: BuilderCameraShotTiming[] = [];
    const camShotRegex = /\(\s*camera_set\s+([A-Za-z0-9_.-]+)\s+(\d+)\s*\)(?:\s*\(\s*sleep\s+(\d+)\s*\))?/gi;
    let cm: RegExpExecArray | null;
    while ((cm = camShotRegex.exec(body)) !== null) {
      const camNm = cm[1]!;
      const moveTicks = Number.parseInt(cm[2]!, 10);
      const rawSleepTicks = cm[3] !== undefined ? Number.parseInt(cm[3], 10) : 0;
      // Repair any legacy truncated sleep (< moveTicks) so the camera completes its full travel to each waypoint
      const sleepTicks = moveTicks > 0 ? Math.max(moveTicks, rawSleepTicks) : rawSleepTicks;
      if (!camSets.includes(camNm)) camSets.push(camNm);
      parsedCameraTimings.push({ camName: camNm, moveTicks, sleepTicks });
    }
    const camInitialHoldTicks = parsedCameraTimings[0]?.sleepTicks ?? 0;
    const camStepMoveTicks =
      parsedCameraTimings.slice(1).find((c) => c.moveTicks > 0)?.moveTicks ??
      (parsedCameraTimings[0]?.moveTicks && parsedCameraTimings[0].moveTicks > 0
        ? parsedCameraTimings[0].moveTicks
        : 120);
    const camStepSleepTicks =
      parsedCameraTimings.slice(1).find((c) => c.sleepTicks > 0)?.sleepTicks ??
      (parsedCameraTimings.length === 1 && parsedCameraTimings[0]!.sleepTicks > 0
        ? parsedCameraTimings[0]!.sleepTicks
        : camStepMoveTicks);

    // Parse approach, unload, and departure sleep ticks
    const approachSleepMatch =
      /\(\s*sleep\s+\(\s*max\s+0\s+\(\s*-\s+\(\s*recording_time\s+[^\s)]+\s*\)\s*(\d+)\s*\)\s*\)\s*\)(?:\s*\(\s*unit_open\s+[^\s)]+\s*\))?(?:\s*\(\s*sleep\s+(\d+)\s*\))?/i.exec(
        body,
      );
    const approachLeadTicks = approachSleepMatch?.[1] ? Number.parseInt(approachSleepMatch[1], 10) : 45;
    const approachSettleTicks = approachSleepMatch?.[2] ? Number.parseInt(approachSleepMatch[2], 10) : 45;

    const unloadSleepMatch = /\(\s*unit_exit_vehicle\s+[^\s)]+\s*\)\s*\(\s*sleep\s+(\d+)\s*\)/i.exec(body);
    const unloadWaitTicks = unloadSleepMatch?.[1] ? Number.parseInt(unloadSleepMatch[1], 10) : 25;

    const exitSleepMatch = /\(\s*sleep\s+\(\s*max\s+(\d+)\s+\(\s*recording_time/i.exec(body);
    const minOutTicks = exitSleepMatch?.[1] ? Number.parseInt(exitSleepMatch[1], 10) : 210;

    const primaryObj =
      recPlayMatch?.[1] ??
      teleMatch?.[1] ??
      doorMatch?.[1] ??
      objCreates[0] ??
      `unit_${idxNum}`;
    const cargoObj =
      switchMatch?.[1] ??
      (objCreates.length > 1 ? objCreates.find((o) => o !== primaryObj) ?? '' : '');

    // Determine role and preset
    const lowerBody = body.toLowerCase();
    const lowerObj = primaryObj.toLowerCase();
    let role: BuilderUnitRole = 'unsc_pelican_marines';
    let preset: BuilderEventPreset = 'custom_track';
    let team: 'human' | 'covenant' =
      lowerObj.includes('cov') || lowerObj.includes('dropship') || lowerObj.includes('wraith') || lowerBody.includes('cargo_wraith') || lowerBody.includes('cd-passenger')
        ? 'covenant'
        : 'human';

    if (lowerBody.includes('cargo_wraith') || (lowerObj.includes('dropship') && lowerBody.includes('wraith'))) {
      role = 'cov_dropship_wraith';
      preset = trigMatch && camSets.length > 0 ? 'triggered_cutscene_pelican_drop' : trigMatch ? 'triggered_pelican_drop' : 'vehicle_reinforcement_drop';
      team = 'covenant';
    } else if (lowerBody.includes('cargo_ghost')) {
      role = 'cov_dropship_ghost';
      preset = trigMatch ? 'triggered_pelican_drop' : 'vehicle_reinforcement_drop';
      team = 'covenant';
    } else if (lowerObj.includes('dropship') || lowerBody.includes('cd-passenger')) {
      role = 'cov_dropship_elites';
      preset = trigMatch && camSets.length > 0 ? 'triggered_cutscene_pelican_drop' : camSets.length > 0 ? 'cutscene_aerial_insertion' : 'vehicle_reinforcement_drop';
      team = 'covenant';
    } else if (lowerBody.includes('"cargo"') || lowerBody.includes('scorpion-driver')) {
      role = 'unsc_pelican_tank';
      preset = trigMatch && camSets.length > 0 ? 'triggered_cutscene_pelican_drop' : trigMatch ? 'triggered_pelican_drop' : 'vehicle_reinforcement_drop';
      team = 'human';
    } else if (recPlayMatch || lowerObj.includes('pelican')) {
      role = 'unsc_pelican_marines';
      preset = trigMatch && camSets.length > 0 ? 'triggered_cutscene_pelican_drop' : camSets.length > 0 ? 'cutscene_aerial_insertion' : 'vehicle_reinforcement_drop';
      team = 'human';
    } else if (switchMatch && doorMatch) {
      role = 'device_door_switch';
      preset = 'door_from_switch';
    } else if (doorMatch && trigMatch) {
      role = 'device_door_proximity';
      preset = 'door_from_proximity';
    } else if (camSets.length > 0 && !recPlayMatch) {
      role = 'cutscene_camera_rig';
      preset = 'cutscene_from_trigger';
    } else if (aiPlaces.length >= 2 && lowerBody.includes('ai_magically_see_encounter')) {
      role = 'unsc_marine_squad';
      preset = 'units_fighting';
    } else if (lowerObj.includes('wraith')) {
      role = 'cov_wraith';
      team = 'covenant';
    } else if (lowerObj.includes('scorpion') || lowerObj.includes('tank')) {
      role = 'unsc_scorpion';
    } else if (lowerObj.includes('hog') || lowerObj.includes('warthog')) {
      role = 'unsc_warthog';
    } else if (aiPlaces.some((e) => /cov|elite|grunt/i.test(e))) {
      role = 'cov_elite_squad';
      team = 'covenant';
    } else if (aiPlaces.length > 0) {
      role = 'unsc_marine_squad';
    }

    const waypoints: BuilderWaypoint[] = [];
    const flightChain: string[] = [];
    const exitFlightChain: string[] = [];

    // 0. Always include any referenced trigger volume (@trigger_pos) as a dedicated trigger waypoint
    const trigWpName = `wp_trig_${idxNum}`;
    if (trigMatch?.[1] && !switchMatch && preset !== 'door_from_proximity') {
      const tCoord = trigCoords.get(trigMatch[1]);
      const animInName0 = recPlayMatch?.[2];
      const animPts0 = animInName0 ? flightPaths.get(animInName0) : undefined;
      const isCorruptedSkyTrigger =
        tCoord !== undefined &&
        animPts0 !== undefined &&
        animPts0.length >= 2 &&
        Math.hypot(tCoord.x - animPts0[0]!.x, tCoord.y - animPts0[0]!.y, tCoord.z - animPts0[0]!.z) < 1.5;
      const trigOff =
        tCoord && !isCorruptedSkyTrigger ? toOff(tCoord) : { xOffset: 4, yOffset: 0, zOffset: 0.5 };
      waypoints.push({ id: `${trackId}-trig`, name: trigWpName, ...trigOff });
    }

    // 1. Populate waypoints from recorded animation flight path (and recover any extra @waypoint turn flags)
    const animInName = recPlayMatch?.[2];
    const animPts = animInName ? flightPaths.get(animInName) : undefined;
    const namedTurnEntries = Array.from(wpCoords.entries())
      .filter(
        ([fn]) =>
          fn.toLowerCase().startsWith(`wp_${trackId.toLowerCase()}_turn_`) &&
          !fn.toLowerCase().includes('_exit_turn_'),
      )
      .sort((a, b) => {
        const na = Number.parseInt(a[0].replace(/^.*_turn_/i, ''), 10) || 0;
        const nb = Number.parseInt(b[0].replace(/^.*_turn_/i, ''), 10) || 0;
        return na - nb;
      });
    const startFlagName = teleMatch?.[2] ?? `wp_${trackId}_start`;
    const lzFlagName = `wp_${trackId}_lz`;
    const hasCompleteNamedChain =
      wpCoords.has(startFlagName) &&
      wpCoords.has(lzFlagName) &&
      namedTurnEntries.length + 2 > (animPts?.length ?? 0);

    if (hasCompleteNamedChain) {
      const fullNamedChain: Array<[string, { x: number; y: number; z: number }]> = [
        [startFlagName, wpCoords.get(startFlagName)!],
        ...namedTurnEntries,
        [lzFlagName, wpCoords.get(lzFlagName)!],
      ];
      fullNamedChain.forEach(([wpName, pt], idx) => {
        const off = toOff(pt);
        waypoints.push({
          id: `${trackId}-wp-${idx + 1}`,
          name: wpName,
          ...off,
        });
        flightChain.push(wpName);
      });
    } else if (animPts && animPts.length >= 2) {
      // Repair any legacy flight_path that accidentally included a ground patrol/migration point after the LZ
      const patrolCoords = Array.from(wpCoords.entries())
        .filter(([fn]) => fn.toLowerCase().includes('patrol') || fn.toLowerCase().includes('mig'))
        .map(([, c]) => c);
      const cleanedAnimPts =
        animPts.length >= 3
          ? animPts.filter((pt, idx) => {
              if (idx < 2) return true;
              return !patrolCoords.some((pc) => Math.hypot(pc.x - pt.x, pc.y - pt.y, pc.z - pt.z) < 0.25);
            })
          : animPts;
      const finalAnimPts = cleanedAnimPts.length >= 2 ? cleanedAnimPts : animPts;
      finalAnimPts.forEach((pt, idx) => {
        const wpName =
          idx === 0 && teleMatch?.[2]
            ? teleMatch[2]
            : idx === 0
              ? `wp_${trackId}_start`
              : idx === finalAnimPts.length - 1
                ? `wp_${trackId}_lz`
                : `wp_${trackId}_turn_${idx}`;
        const off = toOff(pt);
        waypoints.push({
          id: `${trackId}-wp-${idx + 1}`,
          name: wpName,
          ...off,
        });
        flightChain.push(wpName);
      });
    }

    // 1b. Populate departure/exit flight path if present
    const animOutName = recOutMatch?.[2];
    const animOutPts = animOutName ? flightPaths.get(animOutName) : undefined;
    if (animOutPts && animOutPts.length >= 2) {
      animOutPts.forEach((pt, idx) => {
        if (idx === 0 && flightChain.length > 0) {
          exitFlightChain.push(flightChain[flightChain.length - 1]!);
          return;
        }
        const wpName =
          idx === animOutPts.length - 1
            ? `wp_${trackId}_exit`
            : `wp_${trackId}_exit_turn_${idx}`;
        const off = toOff(pt);
        if (!waypoints.some((w) => w.name === wpName)) {
          waypoints.push({
            id: `${trackId}-wp-exit-${idx + 1}`,
            name: wpName,
            ...off,
          });
        }
        exitFlightChain.push(wpName);
      });
    }

    // 2. Populate waypoints from AI Command List path & ground patrol/migration @waypoint directives
    const cmdName = cmdListMatch?.[2];
    const cmdPts = cmdName ? cmdPaths.get(cmdName) : undefined;
    if (flightChain.length === 0 && cmdPts && cmdPts.length >= 1) {
      cmdPts.forEach((pt, idx) => {
        const wpName = `wp_${trackId}_${idx + 1}`;
        const off = toOff(pt);
        waypoints.push({
          id: `${trackId}-wp-${idx + 1}`,
          name: wpName,
          ...off,
        });
        flightChain.push(wpName);
      });
    } else if (flightChain.length > 0 && cmdPts && cmdPts.length >= 2) {
      cmdPts.slice(1).forEach((pt, idx) => {
        const wpName = `wp_patrol_${idx + 1}`;
        const off = toOff(pt);
        if (!waypoints.some((w) => Math.hypot(w.xOffset - off.xOffset, w.yOffset - off.yOffset) < 0.25)) {
          waypoints.push({
            id: `${trackId}-patrol-${idx + 1}`,
            name: wpName,
            ...off,
          });
        }
      });
    }
    for (const [wpNm, pt] of wpCoords.entries()) {
      if ((wpNm.startsWith('wp_patrol') || wpNm.startsWith('wp_mig')) && !waypoints.some((w) => w.name === wpNm)) {
        waypoints.push({
          id: `${trackId}-${wpNm}`,
          name: wpNm,
          ...toOff(pt),
        });
      }
    }

    // 3. Include any explicitly referenced cutscene flags (@waypoint)
    for (const flagNm of [teleMatch?.[2], navMatch?.[1]].filter(Boolean) as string[]) {
      if (!waypoints.some((w) => w.name === flagNm)) {
        const c = wpCoords.get(flagNm);
        const off = c ? toOff(c) : { xOffset: -14, yOffset: idxNum * 4, zOffset: 5.0 };
        waypoints.push({ id: `${trackId}-flag-${flagNm}`, name: flagNm, ...off });
        flightChain.push(flagNm);
      }
    }

    // 5. Include any referenced camera points (@camera_pos)
    for (const camNm of camSets) {
      if (!waypoints.some((w) => w.name === camNm)) {
        const c = camCoords.get(camNm);
        const off = c ? toOff(c) : { xOffset: -4, yOffset: -6, zOffset: 3.0 };
        waypoints.push({ id: `${trackId}-cam-${camNm}`, name: camNm, ...off });
        if (!recPlayMatch) flightChain.push(camNm);
      }
    }

    // 6. Ensure every track has at least 2 editable 3D waypoints so it is visible & interactive in the 3D Builder
    if (waypoints.length === 0) {
      const allWps = Array.from(wpCoords.entries());
      if (allWps.length >= 2 && idxNum === 1) {
        for (let i = 0; i < Math.min(4, allWps.length); i++) {
          const [nm, pt] = allWps[i]!;
          waypoints.push({ id: `${trackId}-wp-${i + 1}`, name: nm, ...toOff(pt) });
          flightChain.push(nm);
        }
      } else {
        const w1 = `wp_${trackId}_start`;
        const w2 = `wp_${trackId}_lz`;
        waypoints.push(
          { id: `${trackId}-wp1`, name: w1, xOffset: -16, yOffset: (idxNum - 1) * 6, zOffset: recPlayMatch ? 6.0 : 0.6 },
          { id: `${trackId}-wp2`, name: w2, xOffset: 8, yOffset: (idxNum - 1) * 6, zOffset: 1.0 },
        );
        flightChain.push(w1, w2);
      }
    } else if (flightChain.length === 1 && (recPlayMatch || role.includes('pelican') || role.includes('dropship'))) {
      const w0 = waypoints.find((w) => w.name === flightChain[0]) ?? waypoints[0]!;
      const lzName = `wp_${trackId}_lz`;
      waypoints.push({
        id: `${trackId}-wp-lz`,
        name: lzName,
        xOffset: Number((w0.xOffset + 20).toFixed(2)),
        yOffset: w0.yOffset,
        zOffset: 1.2,
      });
      flightChain.push(lzName);
    }

    // Reconstruct Action Steps sorted by their actual appearance position in the script body
    const timedActions: Array<{ pos: number; step: BuilderActionStep }> = [];
    const consumedSleepRanges: Array<[number, number]> = [];
    const markRange = (m: RegExpExecArray | null) => {
      if (m && m.index !== undefined) {
        consumedSleepRanges.push([m.index, m.index + m[0].length]);
      }
    };

    const firstSpawnPos = (() => {
      const m1 = /\(\s*object_create(?:_anew)?\b/i.exec(body);
      const m2 = /\(\s*ai_place\b/i.exec(body);
      if (m1 && m2) return Math.min(m1.index, m2.index);
      return m1?.index ?? m2?.index ?? -1;
    })();
    if (firstSpawnPos >= 0 && !switchMatch && preset !== 'door_from_proximity') {
      timedActions.push({
        pos: firstSpawnPos,
        step: { id: `${trackId}-a-spawn`, kind: 'spawn_and_load' },
      });
    }
    if (trigMatch && !switchMatch && preset !== 'door_from_proximity') {
      const pollTicks = trigPollMatch?.[2] ? Number.parseInt(trigPollMatch[2], 10) : 15;
      timedActions.push({
        pos: trigPollMatch?.index ?? trigMatch.index ?? 0,
        step: {
          id: `${trackId}-a-trig`,
          kind: 'wait_for_trigger',
          triggerName: trigMatch[1],
          waypointName: trigWpName,
          sleepTicks: pollTicks,
        },
      });
    }
    if (switchMatch) {
      timedActions.push({
        pos: switchMatch.index ?? 0,
        step: {
          id: `${trackId}-a-sw`,
          kind: 'wait_for_switch',
          triggerName: trigMatch?.[1] ?? `trig_switch_${idxNum}`,
          targetName: switchMatch[1],
        },
      });
    }
    if (camSets.length > 0) {
      const cinBlockMatch = /\(\s*cinematic_start\s*\)[\s\S]*?\(\s*cinematic_stop\s*\)/i.exec(body);
      markRange(cinBlockMatch);
      const firstCamMatch = /\(\s*camera_set\b/i.exec(body);
      timedActions.push({
        pos: cinBlockMatch?.index ?? firstCamMatch?.index ?? 0,
        step: {
          id: `${trackId}-a-cam`,
          kind: 'cutscene_camera_pan',
          waypointName: camSets[0],
          targetName: camSets[camSets.length - 1] ?? camSets[0],
          seconds: Number((camStepMoveTicks / 30).toFixed(2)),
          camInitialHoldTicks,
          camStepMoveTicks,
          camStepSleepTicks,
          cameraTimings: parsedCameraTimings,
        },
      });
    }
    if (recPlayMatch) {
      markRange(approachSleepMatch);
      timedActions.push({
        pos: approachSleepMatch?.index ?? (recPlayMatch.index ?? 0) + 1,
        step: {
          id: `${trackId}-a-fly`,
          kind: 'fly_approach_s_turns',
          waypointName: flightChain[flightChain.length - 1] ?? waypoints[waypoints.length - 1]?.name,
          sleepTicks: approachLeadTicks,
          secondarySleepTicks: approachSettleTicks,
        },
      });
    } else if (teleMatch) {
      timedActions.push({
        pos: teleMatch.index ?? 0,
        step: {
          id: `${trackId}-a-tele`,
          kind: 'teleport_to_waypoint',
          waypointName: teleMatch[2],
        },
      });
    }
    if (cmdListMatch) {
      timedActions.push({
        pos: cmdListMatch.index ?? 0,
        step: {
          id: `${trackId}-a-cmd`,
          kind: 'follow_waypoint_path_ai',
          targetName: cmdListMatch[2],
        },
      });
    }
    if (lowerBody.includes('vehicle_unload') || lowerBody.includes('unit_exit_vehicle')) {
      markRange(unloadSleepMatch);
      const unloadPosMatch = /\(\s*(?:unit_exit_vehicle|vehicle_unload)\b/i.exec(body);
      timedActions.push({
        pos: unloadPosMatch?.index ?? 0,
        step: {
          id: `${trackId}-a-unload`,
          kind: 'unload_cargo_and_troops',
          sleepTicks: unloadWaitTicks,
        },
      });
    }
    if (lowerBody.includes('ai_attack') || lowerBody.includes('ai_follow_target_players') || lowerBody.includes('ai_magically_see')) {
      const combatMatch = /\(\s*(?:ai_attack|ai_magically_see_encounter|ai_magically_see_players)\b/i.exec(body) ?? /\(\s*ai_follow_target_players\b/i.exec(body);
      timedActions.push({
        pos: combatMatch?.index ?? 0,
        step: { id: `${trackId}-a-combat`, kind: 'engage_ai_combat' },
      });
    }
    if (doorMatch && preset === 'door_from_proximity') {
      timedActions.push({
        pos: doorMatch.index ?? 0,
        step: {
          id: `${trackId}-a-prox`,
          kind: 'proximity_door_loop',
          triggerName: trigMatch?.[1] ?? `trig_door_prox_${idxNum}`,
          targetName: doorMatch[1],
        },
      });
    } else if (doorMatch) {
      timedActions.push({
        pos: doorMatch.index ?? 0,
        step: {
          id: `${trackId}-a-door`,
          kind: 'operate_device_door',
          targetName: doorMatch[1],
        },
      });
    }
    if (navMatch) {
      timedActions.push({
        pos: navMatch.index ?? 0,
        step: {
          id: `${trackId}-a-nav`,
          kind: 'activate_hud_navpoint',
          waypointName: navMatch[1],
        },
      });
    }
    if (recOutMatch) {
      markRange(exitSleepMatch);
      timedActions.push({
        pos: recOutMatch.index ?? 0,
        step: {
          id: `${trackId}-a-exit`,
          kind: 'fly_away_and_despawn',
          sleepTicks: minOutTicks,
        },
      });
    }
    const titleRegex = /\(\s*cinematic_set_title\s+([A-Za-z0-9_.-]+)\s*\)/gi;
    let tm: RegExpExecArray | null;
    let titleIdxNum = 1;
    while ((tm = titleRegex.exec(body)) !== null) {
      timedActions.push({
        pos: tm.index,
        step: {
          id: `${trackId}-a-title-${titleIdxNum++}`,
          kind: 'show_cutscene_title',
          targetName: tm[1]!,
          seconds: 4,
        },
      });
    }
    const waveClearRegex = /\(\s*sleep_until\s+\(\s*<=?\s*\(\s*ai_living_count\s+([A-Za-z0-9_.-/]+)\s*\)\s*(\d+)\s*\)/gi;
    let wm: RegExpExecArray | null;
    let waveIdxNum = 1;
    while ((wm = waveClearRegex.exec(body)) !== null) {
      timedActions.push({
        pos: wm.index,
        step: {
          id: `${trackId}-a-wave-${waveIdxNum++}`,
          kind: 'wait_until_wave_cleared',
          targetName: wm[1]!,
          sleepTicks: Number.parseInt(wm[2]!, 10),
        },
      });
    }

    // Also capture any standalone `(sleep <N>)` delays that are outside of camera/approach/unload/exit blocks
    const standaloneSleepRegex = /\(\s*sleep\s+(\d+)\s*\)/gi;
    let sm: RegExpExecArray | null;
    let sleepIdx = 1;
    while ((sm = standaloneSleepRegex.exec(body)) !== null) {
      const sPos = sm.index;
      const inConsumed = consumedSleepRanges.some(([start, end]) => sPos >= start && sPos <= end);
      if (inConsumed) continue;
      const ticks = Number.parseInt(sm[1]!, 10);
      if (ticks <= 5) continue; // ignore 5-tick begin_random unload sleeps
      timedActions.push({
        pos: sPos,
        step: {
          id: `${trackId}-a-delay-${sleepIdx++}`,
          kind: 'delay_seconds',
          sleepTicks: ticks,
          seconds: Number((ticks / 30).toFixed(2)),
        },
      });
    }

    timedActions.sort((a, b) => a.pos - b.pos);
    const actions: BuilderActionStep[] = timedActions.map((ta) => ta.step);
    if (actions.length === 0) {
      actions.push({ id: `${trackId}-a-default`, kind: 'spawn_and_load' });
    }

    const hasCargoDriver =
      role === 'unsc_pelican_tank' ||
      role === 'cov_dropship_wraith' ||
      role === 'cov_dropship_ghost' ||
      role === 'unsc_scorpion' ||
      role === 'cov_wraith' ||
      role === 'unsc_warthog';

    const driverEnc =
      preset === 'units_fighting'
        ? (aiPlaces[1] ?? `cov_squad_${idxNum}`)
        : hasCargoDriver
          ? (aiPlaces[0] ?? `vehicle_crew_${idxNum}`)
          : '';
    const infEnc =
      preset === 'units_fighting'
        ? (aiPlaces[0] ?? `unsc_squad_${idxNum}`)
        : hasCargoDriver
          ? (aiPlaces[1] ?? '')
          : (aiPlaces[0] ?? `squad_${idxNum}`);

    const cleanScriptName = s.name.replace(/\s*\([^)]*\)\s*$/g, '');
    const resolvedFlightChain =
      flightChain.length > 0
        ? flightChain
        : waypoints.filter((w) => !w.name.includes('trig') && !w.name.startsWith('cam_')).map((w) => w.name);
    return {
      id: trackId,
      label: `${cleanScriptName} (${s.scriptType})`,
      sourceScriptName: cleanScriptName,
      eventPreset: preset,
      visibleIn3d: true,
      role,
      objectName: primaryObj,
      cargoObjectName: cargoObj,
      encounterName: infEnc,
      driverEncounterName: driverEnc,
      team,
      waypoints,
      flightChain: resolvedFlightChain,
      exitFlightChain:
        exitFlightChain.length >= 2
          ? exitFlightChain
          : role.includes('pelican') || role.includes('dropship')
            ? [...resolvedFlightChain].reverse()
            : [],
      actions,
    };
  };

  const extractScriptsFromHscSource = (src: string): Array<{ name: string; scriptType: string; bodySource: string }> => {
    const out: Array<{ name: string; scriptType: string; bodySource: string }> = [];
    let i = 0;
    while (i < src.length) {
      if (src[i] === ';') {
        while (i < src.length && src[i] !== '\n') i++;
        continue;
      }
      if (src[i] === '"') {
        i++;
        while (i < src.length && src[i] !== '"') {
          if (src[i] === '\\') i++;
          i++;
        }
        i++;
        continue;
      }
      if (src[i] === '(') {
        const blockStart = i;
        let depth = 0;
        let inStr = false;
        while (i < src.length) {
          const ch = src[i];
          if (!inStr && ch === ';') {
            while (i < src.length && src[i] !== '\n') i++;
            continue;
          }
          if (ch === '"') {
            inStr = !inStr;
          } else if (!inStr) {
            if (ch === '(') depth++;
            else if (ch === ')') {
              depth--;
              if (depth === 0) {
                i++;
                break;
              }
            }
          }
          i++;
        }
        const blockText = src.slice(blockStart, i);
        const m = blockText.match(
          /^\(\s*script\s+(startup|dormant|continuous|static|stub)\s+(?:(?:void|boolean|real|short|long|string|unit|object)\s+)?([A-Za-z0-9_.-]+)([\s\S]*)\)\s*$/i,
        );
        if (m) {
          out.push({
            scriptType: m[1]!.toLowerCase(),
            name: m[2]!,
            bodySource: m[3]!.trim(),
          });
        }
        continue;
      }
      i++;
    }
    return out;
  };

  const parseScenarioCoordComments = (src: string) => {
    const wpCoords = new Map<string, { x: number; y: number; z: number }>();
    const camCoords = new Map<string, { x: number; y: number; z: number }>();
    const trigCoords = new Map<string, { x: number; y: number; z: number }>();
    const flightPaths = new Map<string, Array<{ x: number; y: number; z: number }>>();
    const cmdPaths = new Map<string, Array<{ x: number; y: number; z: number }>>();

    let m: RegExpExecArray | null;
    const wpRegex = /^\s*;\s*@waypoint\s+([A-Za-z0-9_.-]+)\s+([^\r\n]+)$/gm;
    while ((m = wpRegex.exec(src)) !== null) {
      const c = m[2]!.trim().split(',').map((s) => Number.parseFloat(s.trim()));
      if (c.length >= 3 && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Number.isFinite(c[2])) {
        wpCoords.set(m[1]!.trim(), { x: c[0]!, y: c[1]!, z: c[2]! });
      }
    }
    const camRegex = /^\s*;\s*@camera_pos\s+([A-Za-z0-9_.-]+)\s+([^\r\n]+)$/gm;
    while ((m = camRegex.exec(src)) !== null) {
      const c = m[2]!.trim().split(',').map((s) => Number.parseFloat(s.trim()));
      if (c.length >= 3 && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Number.isFinite(c[2])) {
        camCoords.set(m[1]!.trim(), { x: c[0]!, y: c[1]!, z: c[2]! });
      }
    }
    const trigRegex = /^\s*;\s*@trigger_pos\s+([A-Za-z0-9_.-]+)\s+([^\r\n]+)$/gm;
    while ((m = trigRegex.exec(src)) !== null) {
      const c = m[2]!.trim().split(',').map((s) => Number.parseFloat(s.trim()));
      if (c.length >= 3 && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Number.isFinite(c[2])) {
        trigCoords.set(m[1]!.trim(), { x: c[0]!, y: c[1]!, z: c[2]! });
      }
    }
    const fpRegex = /^\s*;\s*@flight_path\s+([A-Za-z0-9_.-]+)\s+([^\r\n]+)$/gm;
    while ((m = fpRegex.exec(src)) !== null) {
      const pts: Array<{ x: number; y: number; z: number }> = [];
      for (const part of m[2]!.trim().split(';')) {
        const c = part.split(',').map((s) => Number.parseFloat(s.trim()));
        if (c.length >= 3 && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Number.isFinite(c[2])) {
          pts.push({ x: c[0]!, y: c[1]!, z: c[2]! });
        }
      }
      if (pts.length >= 2) flightPaths.set(m[1]!.trim(), pts);
    }
    const clRegex = /^\s*;\s*@command_list_path\s+([A-Za-z0-9_.-]+)\s+([^\r\n]+)$/gm;
    while ((m = clRegex.exec(src)) !== null) {
      const pts: Array<{ x: number; y: number; z: number }> = [];
      for (const part of m[2]!.trim().split(';')) {
        const c = part.split(',').map((s) => Number.parseFloat(s.trim()));
        if (c.length >= 3 && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Number.isFinite(c[2])) {
          pts.push({ x: c[0]!, y: c[1]!, z: c[2]! });
        }
      }
      if (pts.length >= 1) cmdPaths.set(m[1]!.trim(), pts);
    }
    return { wpCoords, camCoords, trigCoords, flightPaths, cmdPaths };
  };

  const syncBuilderTracksFromHscSource = (
    src: string,
    anchor: { x: number; y: number; z: number } = playerAnchor,
  ) => {
    const isInternalHelperScript = (name: string) =>
      name === 'init_builder_team_allegiances' ||
      name === 'init_builder_events' ||
      /^launch_interactive_builder/i.test(name) ||
      /launch_interactive_builder/i.test(name) ||
      /^activate_bsp_\d+$/i.test(name) ||
      name === 'init_multi_bsp_manager' ||
      name === 'monitor_bsp_transitions' ||
      name === 'monitor_multi_bsp_trigger' ||
      name === 'init_merged_bsp_activation';

    const { wpCoords, camCoords, trigCoords, flightPaths, cmdPaths } = parseScenarioCoordComments(src);
    const extracted = extractScriptsFromHscSource(src).filter((s) => !isInternalHelperScript(s.name));
    if (extracted.length > 0) {
      const reconstructed = extracted.map((s, idx) =>
        reconstructTrackFromDecompiledScript(
          s,
          idx + 1,
          anchor,
          wpCoords,
          camCoords,
          trigCoords,
          flightPaths,
          cmdPaths,
        ),
      );
      setBuilderTracks(reconstructed);
      if (!reconstructed.some((t) => t.id === selectedTrackId)) {
        setSelectedTrackId(reconstructed[0]!.id);
      }
    }
  };

  const loadFromMap = async () => {
    if (!window.opence.decompileHaloScript) return;
    setIsBusy(true);
    const [res, objRes] = await Promise.all([
      window.opence.decompileHaloScript(),
      window.opence.getScenarioObjects?.() ?? Promise.resolve(null),
    ]);
    setIsBusy(false);
    if (res.ok) {
      setHscSource(res.hscSource);
      setScriptCount(res.scriptCount);
      setGlobalCount(res.globalCount);
      setSyntaxNodeCount(res.syntaxNodeCount);
      setScenarioEntities(res.scenarioEntities);
      setDiagnostics([]);

      let anchor = playerAnchor;
      const placedObjects = objRes && 'ok' in objRes && objRes.ok ? (objRes.summary?.objects ?? []) : [];
      if (placedObjects.length > 0) {
        const sp = placedObjects.find((o: { kind: string }) => o.kind === 'spawn') ?? placedObjects[0]!;
        anchor = {
          x: sp.position[0],
          y: sp.position[1],
          z: sp.position[2],
          yaw: sp.rotation?.[0] ?? 0,
        };
        setPlayerAnchor(anchor);
      }

      const { wpCoords, camCoords, trigCoords, flightPaths, cmdPaths } = parseScenarioCoordComments(res.hscSource);

      const rawDecompiledScripts =
        res.scripts && res.scripts.length > 0
          ? res.scripts.map((s) => ({
              name: s.name,
              scriptType: s.scriptType,
              bodySource: s.bodySource ?? (s as { bodyText?: string }).bodyText ?? '',
            }))
          : extractScriptsFromHscSource(res.hscSource);

      // Reconstruct 3D Builder script instances from the map's decompiled scripts so existing map scripts immediately appear!
      const isInternalHelperScript = (name: string) =>
        name === 'init_builder_team_allegiances' ||
        name === 'init_builder_events' ||
        /^launch_interactive_builder/i.test(name) ||
        /launch_interactive_builder/i.test(name) ||
        /^activate_bsp_\d+$/i.test(name) ||
        name === 'init_multi_bsp_manager' ||
        name === 'monitor_bsp_transitions' ||
        name === 'monitor_multi_bsp_trigger' ||
        name === 'init_merged_bsp_activation';

      const scriptsToImport = rawDecompiledScripts.filter((s) => !isInternalHelperScript(s.name));

      if (scriptsToImport.length > 0) {
        const reconstructed = scriptsToImport.map((s, idx) =>
          reconstructTrackFromDecompiledScript(
            s,
            idx + 1,
            anchor,
            wpCoords,
            camCoords,
            trigCoords,
            flightPaths,
            cmdPaths,
          ),
        );
        // Also keep any uncompiled tracks from cachedBuilderSession that the user added before switching tabs
        const existingIds = new Set(reconstructed.map((t) => t.id));
        const uncompiledCached = (cachedBuilderSession?.builderTracks ?? []).filter(
          (t) => !t.sourceScriptName && !existingIds.has(t.id),
        );
        const merged = [...reconstructed, ...uncompiledCached];
        setBuilderTracks(merged);
        const keepSelected = merged.find((t) => t.id === cachedBuilderSession?.selectedTrackId) ?? merged[0]!;
        setSelectedTrackId(keepSelected.id);
        if (keepSelected.waypoints[0]) {
          setSelectedWaypointId(keepSelected.waypoints[0].id);
        }
      } else if (cachedBuilderSession && cachedBuilderSession.builderTracks.length > 0 && res.scriptCount === 0) {
        // Keep in-progress uncompiled tracks when returning to the tab
        setBuilderTracks(cachedBuilderSession.builderTracks);
        setSelectedTrackId(cachedBuilderSession.selectedTrackId || cachedBuilderSession.builderTracks[0]!.id);
      } else {
        setBuilderTracks([]);
        setSelectedTrackId('');
      }
    } else {
      setStatusMessage(`Failed to decompile scripts: ${res.message}`);
    }
  };

  useEffect(() => {
    void loadFromMap();
  }, []);

  // Keep click-to-place callback fresh for 3D BSP terrain picking (and Shift+Click to insert a flight path corner waypoint)
  useEffect(() => {
    bspPickHandlerRef.current = (
      haloX: number,
      haloY: number,
      haloZ: number,
      insertCorner = false,
      keepExactZ = false,
    ) => {
      if (!selectedTrack) return;
      const dx = Number((haloX - playerAnchor.x).toFixed(2));
      const dy = Number((haloY - playerAnchor.y).toFixed(2));
      const terrainZ = Number((haloZ - playerAnchor.z + 1.2).toFixed(2));
      const lzTerrainZ = Number((haloZ - playerAnchor.z + 0.6).toFixed(2));

      if (insertCorner) {
        const safeId = selectedTrack.id.replace(/[^a-zA-Z0-9_]/g, '_');
        const isExitMode = activePathMode === 'exit';
        const prefix = isExitMode ? `wp_${safeId}_exit_turn_` : `wp_${safeId}_turn_`;
        const nextNum = selectedTrack.waypoints.filter((w) => w.name.startsWith(prefix)).length + 1;
        const newWpId = `wp-${Date.now()}`;
        const newWpName = `${prefix}${nextNum}`;
        const newZ = Number((terrainZ + 2.8).toFixed(2));
        updateSelectedTrack((trk) => {
          if (isExitMode) {
            const baseExit =
              trk.exitFlightChain && trk.exitFlightChain.length > 0
                ? [...trk.exitFlightChain]
                : [...trk.flightChain].reverse();
            const insertAt = Math.max(1, baseExit.length - 1);
            baseExit.splice(insertAt, 0, newWpName);
            return {
              ...trk,
              waypoints: [...trk.waypoints, { id: newWpId, name: newWpName, xOffset: dx, yOffset: dy, zOffset: newZ }],
              exitFlightChain: baseExit,
            };
          }
          const nextChain = [...trk.flightChain];
          const insertAt = Math.max(1, nextChain.length - 1);
          nextChain.splice(insertAt, 0, newWpName);
          return {
            ...trk,
            waypoints: [...trk.waypoints, { id: newWpId, name: newWpName, xOffset: dx, yOffset: dy, zOffset: newZ }],
            flightChain: nextChain,
          };
        });
        setSelectedWaypointId(newWpId);
        return;
      }

      setBuilderWaypoints((prev) => {
        const targetId = selectedWaypointId || prev[prev.length - 1]?.id;
        return prev.map((w) => {
          if (w.id !== targetId) return w;
          if (keepExactZ) {
            return {
              ...w,
              xOffset: dx,
              yOffset: dy,
            };
          }
          const isLz = w.name.endsWith('_lz') || w.name.includes('_lz_');
          const keepAirZ =
            !isLz &&
            w.zOffset > 1.8 &&
            (w.name.includes('turn') || w.name.includes('start') || w.name.includes('air') || w.name.includes('exit') || w.name.startsWith('cam_'));
          return {
            ...w,
            xOffset: dx,
            yOffset: dy,
            zOffset: keepAirZ ? w.zOffset : isLz ? lzTerrainZ : terrainZ,
          };
        });
      });
    };
  }, [playerAnchor, selectedWaypointId, selectedTrack, activePathMode]);

  // Initialize & render real Three.js 3D BSP Map + Placed Objects + 3D Waypoints & S-Turn Flight Splines
  useEffect(() => {
    if (activeStudioTab !== 'builder') return;
    const mount = viewportMountRef.current;
    if (!mount) return;

    const width = Math.max(320, mount.clientWidth || 720);
    const height = Math.max(220, mount.clientHeight || 300);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090d14);

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.2, 4000);
    camera.position.set(0, 35, 45);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.mouseButtons = {
      LEFT: -1 as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };

    scene.add(new THREE.AmbientLight(0xffffff, 0.72));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
    dirLight.position.set(60, 120, 80);
    scene.add(dirLight);

    const grid = new THREE.GridHelper(200, 40, 0x1e293b, 0x0f172a);
    scene.add(grid);

    const bspGroup = new THREE.Group();
    scene.add(bspGroup);

    const scenarioObjGroup = new THREE.Group();
    scene.add(scenarioObjGroup);

    const wpGroup = new THREE.Group();
    scene.add(wpGroup);
    waypointGroupRef.current = wpGroup;

    const prevGroup = new THREE.Group();
    scene.add(prevGroup);
    previewGroupRef.current = prevGroup;
    threeCameraRef.current = camera;
    threeControlsRef.current = controls;

    let disposed = false;

    const populateScenarioObjGroup = (
      placedObjects: Array<{
        kind: string;
        position: [number, number, number];
        rotation?: [number, number, number];
        extents?: [number, number, number];
      }>,
    ) => {
      while (scenarioObjGroup.children.length > 0) {
        scenarioObjGroup.remove(scenarioObjGroup.children[0]!);
      }
      if (placedObjects.length === 0) return;
      const boxGeom = new THREE.BoxGeometry(1.4, 0.9, 2.2);
      const cylGeom = new THREE.CylinderGeometry(0.45, 0.45, 1.4, 10);
      const sphGeom = new THREE.SphereGeometry(0.55, 10, 10);
      const coneGeom = new THREE.ConeGeometry(0.6, 1.3, 8);
      const colorByKind: Record<string, number> = {
        vehicle: 0x38bdf8,
        biped: 0xf43f5e,
        actor_starting_location: 0xfb923c,
        weapon: 0xa78bfa,
        equipment: 0x2dd4bf,
        scenery: 0x94a3b8,
        machine: 0xe879f9,
        spawn: 0x4ade80,
        netgame_flag: 0xfacc15,
        cutscene_flag: 0xfbbf24,
        cutscene_camera_point: 0xc084fc,
        trigger_volume: 0x22c55e,
      };

      for (const obj of placedObjects) {
        const objKind = obj.kind as string;
        if (objKind === 'decal' || objKind === 'detail_object') continue;
        const [hx, hy, hz] = obj.position;
        const tx = hx;
        const ty = hz;
        const tz = -hy;
        const col = colorByKind[objKind] ?? 0x64748b;

        if (objKind === 'trigger_volume') {
          const [ex, ey, ez] = obj.extents ?? [10, 10, 5];
          const tvGeom = new THREE.BoxGeometry(Math.max(0.5, ex), Math.max(0.5, ez), Math.max(0.5, ey));
          const tvMesh = new THREE.Mesh(
            tvGeom,
            new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.18, depthWrite: false }),
          );
          tvMesh.position.set(tx + ex * 0.5, ty + ez * 0.5, tz - ey * 0.5);
          const tvEdges = new THREE.LineSegments(
            new THREE.EdgesGeometry(tvGeom),
            new THREE.LineBasicMaterial({ color: 0x4ade80 }),
          );
          tvMesh.add(tvEdges);
          scenarioObjGroup.add(tvMesh);
          continue;
        }

        const geom =
          objKind === 'vehicle' || objKind === 'machine'
            ? boxGeom
            : objKind === 'biped' || objKind === 'spawn' || objKind === 'actor_starting_location' || objKind === 'firing_position'
              ? cylGeom
              : objKind === 'cutscene_camera_point' || objKind === 'cutscene_camera'
                ? coneGeom
                : sphGeom;
        const mesh = new THREE.Mesh(geom, new THREE.MeshLambertMaterial({ color: col }));
        mesh.position.set(tx, ty + 0.65, tz);
        mesh.rotation.y = obj.rotation?.[0] ?? 0;
        scenarioObjGroup.add(mesh);
      }
    };

    const handleScenarioUpdatedInViewport = () => {
      void (async () => {
        const objRes = await window.opence.getScenarioObjects?.();
        if (disposed) return;
        const placedObjects = objRes?.ok ? (objRes.summary?.objects ?? []) : [];
        populateScenarioObjGroup(placedObjects);
      })();
    };
    window.addEventListener('opence:scenario-updated', handleScenarioUpdatedInViewport);

    void (async () => {
      try {
        const [bspRes, objRes] = await Promise.all([
          window.opence.getBspRenderMesh?.(0),
          window.opence.getScenarioObjects?.(),
        ]);
        if (disposed) return;

        let anchor = { x: 0, y: 0, z: 0, yaw: 0 };
        const placedObjects = objRes?.ok ? (objRes.summary?.objects ?? []) : [];
        if (placedObjects.length > 0) {
          const sp = placedObjects.find((o) => o.kind === 'spawn') ?? placedObjects[0]!;
          anchor = {
            x: sp.position[0],
            y: sp.position[1],
            z: sp.position[2],
            yaw: sp.rotation?.[0] ?? 0,
          };
          setPlayerAnchor(anchor);
          populateScenarioObjGroup(placedObjects);
        }

        if (bspRes?.ok && bspRes.mesh.submeshes.length > 0) {
          let totalTris = 0;
          let sumX = 0;
          let sumY = 0;
          let sumZ = 0;
          let vTotal = 0;
          for (let sIdx = 0; sIdx < bspRes.mesh.submeshes.length; sIdx++) {
            const sub = bspRes.mesh.submeshes[sIdx]!;
            const vCount = Math.floor(sub.vertices.length / 8);
            if (vCount < 3 || sub.indices.length < 3) continue;
            const geom = new THREE.BufferGeometry();
            // Convert Halo stride-8 [x, y, z, nx, ny, nz, u, v] (Z-up) -> Three.js (x, z, -y) (Y-up)
            const pos = new Float32Array(vCount * 3);
            const norm = new Float32Array(vCount * 3);
            for (let v = 0; v < vCount; v++) {
              const base = v * 8;
              const hx = sub.vertices[base + 0]!;
              const hy = sub.vertices[base + 1]!;
              const hz = sub.vertices[base + 2]!;
              const hnx = sub.vertices[base + 3]!;
              const hny = sub.vertices[base + 4]!;
              const hnz = sub.vertices[base + 5]!;
              const p3 = v * 3;
              pos[p3 + 0] = hx;
              pos[p3 + 1] = hz;
              pos[p3 + 2] = -hy;
              norm[p3 + 0] = hnx;
              norm[p3 + 1] = hnz;
              norm[p3 + 2] = -hny;
              sumX += hx;
              sumY += hy;
              sumZ += hz;
            }
            vTotal += vCount;
            geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geom.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
            geom.setIndex(new THREE.BufferAttribute(sub.indices, 1));
            const hue = ((((sub as { shaderIndex?: number }).shaderIndex ?? sIdx + 1) * 37) % 360) / 360;
            const col = new THREE.Color().setHSL(hue, 0.24, 0.38);
            const mat = new THREE.MeshLambertMaterial({
              color: col,
              side: THREE.DoubleSide,
            });
            const m = new THREE.Mesh(geom, mat);
            bspGroup.add(m);
            totalTris += Math.floor(sub.indices.length / 3);
          }

          if (anchor.x === 0 && anchor.y === 0 && anchor.z === 0 && vTotal > 0) {
            anchor = { x: sumX / vTotal, y: sumY / vTotal, z: sumZ / vTotal, yaw: 0 };
            setPlayerAnchor(anchor);
          }

          setBspLoadedInfo(
            `3D BSP (${bspRes.mesh.submeshes.length} surfaces, ${totalTris.toLocaleString()} tris) + ${placedObjects.length} Objects • WASD/Space/C Fly • R-Drag Orbit / M-Drag Pan • L-Click Place/Drag Waypoint`,
          );
          const tx = anchor.x;
          const ty = anchor.z;
          const tz = -anchor.y;
          controls.target.set(tx, ty + 2, tz);
          camera.position.set(tx - 32, ty + 28, tz + 38);
          controls.update();
        } else {
          setBspLoadedInfo(
            `3D Grid Mode (${placedObjects.length} objects) • WASD/Space/C Fly • L-Click to place waypoint • R-Drag Orbit / M-Drag Pan / Scroll Zoom`,
          );
        }
      } catch (err) {
        console.error('3D Script Builder viewport load error:', err);
        if (!disposed) setBspLoadedInfo('3D Viewport Ready • WASD/Space/C Fly • R-Drag Orbit / M-Drag Pan / Scroll Zoom');
      }
    })();

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    let draggingWaypointId: string | null = null;
    let dragPlaneY = 0;

    const pick3dPointForRay = (planeY: number, useHorizontalPlaneOnly = false) => {
      if (!useHorizontalPlaneOnly) {
        const hits = raycaster.intersectObjects(bspGroup.children, true);
        if (hits.length > 0) {
          const pt = hits[0]!.point;
          return { haloX: pt.x, haloY: -pt.z, haloZ: pt.y };
        }
      }
      const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
      const targetPt = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(dragPlane, targetPt)) {
        return { haloX: targetPt.x, haloY: -targetPt.z, haloZ: targetPt.y };
      }
      if (raycaster.ray.intersectPlane(groundPlane, targetPt)) {
        return { haloX: targetPt.x, haloY: -targetPt.z, haloZ: targetPt.y };
      }
      return null;
    };

    const handlePointerDown = (e: MouseEvent) => {
      // Prevent middle-mouse button (scroll wheel click/drag) from triggering browser autoscroll on parent containers!
      if (e.button === 1) {
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      // 1. Check if user clicked directly on a 3D Waypoint Marker sphere to select & drag it
      if (!e.shiftKey && wpGroup.children.length > 0) {
        const wpHits = raycaster.intersectObjects(wpGroup.children, true);
        const hitMarker = wpHits.find((h) => h.object.userData?.waypointId);
        if (hitMarker?.object.userData?.waypointId) {
          const wpId = hitMarker.object.userData.waypointId as string;
          setSelectedWaypointId(wpId);
          draggingWaypointId = wpId;
          dragPlaneY = hitMarker.object.position.y;
          renderer.domElement.style.cursor = 'grabbing';
          return;
        }
      }

      // 2. Otherwise place/move the selected waypoint (or Shift+Click to insert a new flight corner waypoint) on the 3D BSP
      const picked = pick3dPointForRay(0, false);
      if (picked) {
        bspPickHandlerRef.current?.(picked.haloX, picked.haloY, picked.haloZ, e.shiftKey, false);
      }
    };

    const handlePointerMove = (e: MouseEvent) => {
      if (!draggingWaypointId) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const picked = pick3dPointForRay(dragPlaneY, true);
      if (picked) {
        bspPickHandlerRef.current?.(picked.haloX, picked.haloY, picked.haloZ, false, true);
      }
    };

    const handlePointerUp = () => {
      if (draggingWaypointId) {
        draggingWaypointId = null;
        renderer.domElement.style.cursor = 'crosshair';
      }
    };

    const handleAuxClick = (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleWheelStopScroll = (e: WheelEvent) => {
      e.stopPropagation();
    };

    // WASD + Space/E (up) + C/Q (down) + Shift (sprint) fly camera inside the 3D Script Builder
    const flyKeys = new Set<string>();
    const isInputFocused = () => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || (el as HTMLElement).isContentEditable;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isInputFocused()) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (
        e.code === 'KeyW' ||
        e.code === 'KeyA' ||
        e.code === 'KeyS' ||
        e.code === 'KeyD' ||
        e.code === 'Space' ||
        e.code === 'KeyC' ||
        e.code === 'KeyE' ||
        e.code === 'KeyQ' ||
        e.code === 'ShiftLeft' ||
        e.code === 'ShiftRight'
      ) {
        if (e.code === 'Space') {
          e.preventDefault();
        }
        flyKeys.add(e.code);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      flyKeys.delete(e.code);
    };

    const handleWindowBlur = () => {
      flyKeys.clear();
    };

    renderer.domElement.addEventListener('mousedown', handlePointerDown);
    renderer.domElement.addEventListener('auxclick', handleAuxClick);
    renderer.domElement.addEventListener('wheel', handleWheelStopScroll, { passive: true });
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);

    const resizeObserver = new ResizeObserver(() => {
      if (!mount || disposed) return;
      const w = Math.max(320, mount.clientWidth);
      const h = Math.max(220, mount.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(mount);

    let rafId = 0;
    let lastTime = performance.now();
    const fwdVec = new THREE.Vector3();
    const rightVec = new THREE.Vector3();
    const upVec = new THREE.Vector3(0, 1, 0);
    const moveDelta = new THREE.Vector3();

    const animate = () => {
      if (disposed) return;
      rafId = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      if (flyKeys.size > 0 && !isInputFocused()) {
        camera.getWorldDirection(fwdVec);
        rightVec.crossVectors(fwdVec, upVec).normalize();
        moveDelta.set(0, 0, 0);
        if (flyKeys.has('KeyW')) moveDelta.add(fwdVec);
        if (flyKeys.has('KeyS')) moveDelta.sub(fwdVec);
        if (flyKeys.has('KeyD')) moveDelta.add(rightVec);
        if (flyKeys.has('KeyA')) moveDelta.sub(rightVec);
        if (flyKeys.has('Space') || flyKeys.has('KeyE')) moveDelta.add(upVec);
        if (flyKeys.has('KeyC') || flyKeys.has('KeyQ')) moveDelta.sub(upVec);

        if (moveDelta.lengthSq() > 1e-6) {
          const isFast = flyKeys.has('ShiftLeft') || flyKeys.has('ShiftRight');
          const flySpeed = (isFast ? 72 : 28) * dt;
          moveDelta.normalize().multiplyScalar(flySpeed);
          camera.position.add(moveDelta);
          controls.target.add(moveDelta);
        }
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      window.removeEventListener('opence:scenario-updated', handleScenarioUpdatedInViewport);
      renderer.domElement.removeEventListener('mousedown', handlePointerDown);
      renderer.domElement.removeEventListener('auxclick', handleAuxClick);
      renderer.domElement.removeEventListener('wheel', handleWheelStopScroll);
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
      controls.dispose();
      renderer.dispose();
    };
  }, [activeStudioTab]);

  // Synchronize 3D Waypoints, Player Spawn Beacon, and S-Turn Flight Path Curves inside the Three.js scene
  useEffect(() => {
    const grp = waypointGroupRef.current;
    if (!grp) return;
    while (grp.children.length > 0) {
      grp.remove(grp.children[0]!);
    }

    const toThree = (hx: number, hy: number, hz: number) => new THREE.Vector3(hx, hz, -hy);

    // 1. Player Spawn Marker (Green Cylinder + Sphere Beacon)
    const spPos = toThree(playerAnchor.x, playerAnchor.y, playerAnchor.z);
    const spMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 0.9, 3.2, 16),
      new THREE.MeshBasicMaterial({ color: 0x4ade80 }),
    );
    spMesh.position.copy(spPos).add(new THREE.Vector3(0, 1.6, 0));
    grp.add(spMesh);

    // 2. Render each visible Script Event Instance's Waypoints & Flight Path (active track bright, other visible tracks dimmed)
    for (const trk of builderTracks) {
      if (trk.visibleIn3d === false) continue;
      const isActTrack = trk.id === selectedTrack?.id;
      const trackColor = trk.team === 'covenant' ? 0xf87171 : 0x38bdf8;
      const opacity = isActTrack ? 1.0 : 0.35;

      for (const wp of trk.waypoints) {
        const isSel = isActTrack && wp.id === selectedWaypointId;
        const isCam = wp.name.startsWith('cam_');
        const baseColor = isSel ? 0x22c55e : isCam ? 0xc084fc : isActTrack ? trackColor : 0x64748b;
        const wPos = toThree(
          playerAnchor.x + wp.xOffset,
          playerAnchor.y + wp.yOffset,
          playerAnchor.z + wp.zOffset,
        );
        const pole = new THREE.Mesh(
          isCam
            ? new THREE.ConeGeometry(isSel ? 1.1 : 0.8, 2.0, 10)
            : new THREE.SphereGeometry(isSel ? 1.45 : isActTrack ? 1.05 : 0.75, 16, 16),
          new THREE.MeshBasicMaterial({ color: baseColor, transparent: !isActTrack, opacity }),
        );
        pole.position.copy(wPos);
        if (isActTrack) {
          pole.userData = { waypointId: wp.id, waypointName: wp.name, trackId: trk.id };
        }
        grp.add(pole);

        // Vertical drop line to ground
        const groundPos = toThree(playerAnchor.x + wp.xOffset, playerAnchor.y + wp.yOffset, playerAnchor.z);
        const lineGeom = new THREE.BufferGeometry().setFromPoints([groundPos, wPos]);
        grp.add(
          new THREE.Line(
            lineGeom,
            new THREE.LineBasicMaterial({ color: baseColor, transparent: true, opacity: isActTrack ? 0.75 : 0.25 }),
          ),
        );
      }

      if (trk.flightChain.length >= 2) {
        const pts: THREE.Vector3[] = [];
        for (const nm of trk.flightChain) {
          const found = trk.waypoints.find((w) => w.name === nm);
          if (found) {
            pts.push(
              toThree(
                playerAnchor.x + found.xOffset,
                playerAnchor.y + found.yOffset,
                playerAnchor.z + found.zOffset,
              ),
            );
          }
        }
        if (pts.length >= 2) {
          const curve = new THREE.CatmullRomCurve3(pts);
          const tube = new THREE.Mesh(
            new THREE.TubeGeometry(curve, Math.max(32, pts.length * 16), isActTrack ? 0.32 : 0.18, 8, false),
            new THREE.MeshBasicMaterial({ color: trackColor, transparent: !isActTrack, opacity }),
          );
          grp.add(tube);

          const arrowSteps = Math.max(3, pts.length + 1);
          for (let i = 1; i < arrowSteps; i++) {
            const t = i / arrowSteps;
            const pos = curve.getPointAt(t);
            const tangent = curve.getTangentAt(t).normalize();
            const cone = new THREE.Mesh(
              new THREE.ConeGeometry(isActTrack ? 0.65 : 0.45, 1.8, 10),
              new THREE.MeshBasicMaterial({ color: trackColor, transparent: !isActTrack, opacity }),
            );
            cone.position.copy(pos);
            cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
            grp.add(cone);
          }
        }
      }

      // Render Departure / Exit Flight Path spline (amber gold) if present
      if (trk.exitFlightChain && trk.exitFlightChain.length >= 2) {
        const exitPts: THREE.Vector3[] = [];
        for (const nm of trk.exitFlightChain) {
          const found = trk.waypoints.find((w) => w.name === nm);
          if (found) {
            exitPts.push(
              toThree(
                playerAnchor.x + found.xOffset,
                playerAnchor.y + found.yOffset,
                playerAnchor.z + found.zOffset,
              ),
            );
          }
        }
        if (exitPts.length >= 2) {
          const exitColor = 0xf59e0b;
          const exitCurve = new THREE.CatmullRomCurve3(exitPts);
          const exitTube = new THREE.Mesh(
            new THREE.TubeGeometry(exitCurve, Math.max(24, exitPts.length * 16), isActTrack ? 0.26 : 0.14, 8, false),
            new THREE.MeshBasicMaterial({ color: exitColor, transparent: true, opacity: isActTrack ? 0.85 : 0.3 }),
          );
          grp.add(exitTube);

          const exitArrowSteps = Math.max(3, exitPts.length + 1);
          for (let i = 1; i < exitArrowSteps; i++) {
            const t = i / exitArrowSteps;
            const pos = exitCurve.getPointAt(t);
            const tangent = exitCurve.getTangentAt(t).normalize();
            const cone = new THREE.Mesh(
              new THREE.ConeGeometry(isActTrack ? 0.55 : 0.38, 1.6, 10),
              new THREE.MeshBasicMaterial({ color: exitColor, transparent: true, opacity: isActTrack ? 0.9 : 0.3 }),
            );
            cone.position.copy(pos);
            cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
            grp.add(cone);
          }
        }
      }

      // Render Cutscene Camera Path spline (purple 0xc084fc) connecting all cam_* waypoints in order
      const camWps = trk.waypoints.filter((w) => w.name.startsWith('cam_'));
      if (camWps.length >= 2) {
        const camPts = camWps.map((w) =>
          toThree(
            playerAnchor.x + w.xOffset,
            playerAnchor.y + w.yOffset,
            playerAnchor.z + w.zOffset,
          ),
        );
        const camColor = 0xc084fc;
        const camCurve = new THREE.CatmullRomCurve3(camPts);
        const camTube = new THREE.Mesh(
          new THREE.TubeGeometry(camCurve, Math.max(24, camPts.length * 16), isActTrack ? 0.24 : 0.14, 8, false),
          new THREE.MeshBasicMaterial({ color: camColor, transparent: true, opacity: isActTrack ? 0.9 : 0.35 }),
        );
        grp.add(camTube);

        const camArrowSteps = Math.max(3, camPts.length + 1);
        for (let i = 1; i < camArrowSteps; i++) {
          const t = i / camArrowSteps;
          const pos = camCurve.getPointAt(t);
          const tangent = camCurve.getTangentAt(t).normalize();
          const cone = new THREE.Mesh(
            new THREE.ConeGeometry(isActTrack ? 0.5 : 0.35, 1.5, 10),
            new THREE.MeshBasicMaterial({ color: camColor, transparent: true, opacity: isActTrack ? 0.95 : 0.35 }),
          );
          cone.position.copy(pos);
          cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
          grp.add(cone);
        }
      }

      // Option 1 (Phase B) & Stretch 2: 3D AI Command List (`ai_command_list`) Ground Patrol Path Visualization (lime green)
      const isDropshipTrack = trk.role.includes('pelican') || trk.role.includes('dropship');
      const groundPatrolWpsFor3d = trk.waypoints.filter(
        (w) =>
          w.name.startsWith('wp_patrol') ||
          (!trk.flightChain.includes(w.name) &&
            !(trk.exitFlightChain ?? []).includes(w.name) &&
            !w.name.startsWith('cam_') &&
            !w.name.includes('trig')),
      );
      const hasAiPatrolAction =
        trk.actions.some((a) => a.kind === 'follow_waypoint_path_ai') || groundPatrolWpsFor3d.length > 0;
      if (hasAiPatrolAction) {
        const patrolPts: THREE.Vector3[] = [];
        if (isDropshipTrack) {
          const lzWp =
            trk.waypoints.find((w) => w.name === trk.flightChain[trk.flightChain.length - 1]) ??
            trk.waypoints[trk.waypoints.length - 1];
          if (lzWp && groundPatrolWpsFor3d.length > 0) {
            patrolPts.push(
              toThree(
                playerAnchor.x + lzWp.xOffset,
                playerAnchor.y + lzWp.yOffset,
                playerAnchor.z + Math.min(lzWp.zOffset, 1.0),
              ),
            );
          }
          for (const pw of groundPatrolWpsFor3d) {
            patrolPts.push(
              toThree(
                playerAnchor.x + pw.xOffset,
                playerAnchor.y + pw.yOffset,
                playerAnchor.z + Math.min(pw.zOffset, 1.5),
              ),
            );
          }
        } else {
          for (const nm of trk.flightChain) {
            const found = trk.waypoints.find((w) => w.name === nm);
            if (found) {
              patrolPts.push(
                toThree(
                  playerAnchor.x + found.xOffset,
                  playerAnchor.y + found.yOffset,
                  playerAnchor.z + 0.65,
                ),
              );
            }
          }
          for (const pw of groundPatrolWpsFor3d) {
            patrolPts.push(
              toThree(
                playerAnchor.x + pw.xOffset,
                playerAnchor.y + pw.yOffset,
                playerAnchor.z + Math.min(pw.zOffset, 1.5),
              ),
            );
          }
        }
        if (patrolPts.length >= 2) {
          const patrolColor = 0x84cc16;
          const patrolCurve = new THREE.CatmullRomCurve3(patrolPts);
          const patrolTube = new THREE.Mesh(
            new THREE.TubeGeometry(patrolCurve, Math.max(24, patrolPts.length * 14), isActTrack ? 0.24 : 0.14, 8, false),
            new THREE.MeshBasicMaterial({ color: patrolColor, transparent: true, opacity: isActTrack ? 0.95 : 0.4 }),
          );
          grp.add(patrolTube);
        }
      }

      // Option 1 (Phase B): 3D AI Migration Arrows (`ai_migrate`) linking this track's LZ to destination encounter or `wp_mig*` waypoint
      for (const act of trk.actions) {
        if (act.kind !== 'migrate_to_encounter') continue;
        const targetEnc = (act.targetName || '').trim();
        const destTrack = targetEnc
          ? builderTracks.find(
              (other) => other.id !== trk.id && (other.encounterName === targetEnc || other.driverEncounterName === targetEnc),
            )
          : undefined;
        const srcWp =
          trk.waypoints.find((w) => w.name.includes('_lz') || w.name.includes('_hover')) ??
          trk.waypoints.find((w) => w.name === trk.flightChain[trk.flightChain.length - 1]) ??
          trk.waypoints[Math.min(trk.waypoints.length - 1, 1)];
        const localMigWp =
          (act.waypointName ? trk.waypoints.find((w) => w.name === act.waypointName) : undefined) ??
          trk.waypoints.find((w) => w.name.startsWith('wp_mig') || w.name.includes('_mig')) ??
          trk.waypoints.find((w) => w.name.startsWith('wp_patrol'));
        const dstWp =
          localMigWp ??
          destTrack?.waypoints.find((w) => w.name.includes('_lz') || w.name.includes('_hover') || w.name.includes('trig')) ??
          destTrack?.waypoints[0];
        const dstAnchor = localMigWp ? playerAnchor : playerAnchor;
        if (!srcWp || !dstWp || srcWp.id === dstWp.id) continue;

        const pStart = toThree(
          playerAnchor.x + srcWp.xOffset,
          playerAnchor.y + srcWp.yOffset,
          playerAnchor.z + srcWp.zOffset,
        );
        const pEnd = toThree(
          dstAnchor.x + dstWp.xOffset,
          dstAnchor.y + dstWp.yOffset,
          dstAnchor.z + dstWp.zOffset,
        );
        const mid = pStart.clone().lerp(pEnd, 0.5);
        mid.y += Math.max(6, pStart.distanceTo(pEnd) * 0.18);

        const migColor = 0x10b981;
        const migCurve = new THREE.QuadraticBezierCurve3(pStart, mid, pEnd);
        const migTube = new THREE.Mesh(
          new THREE.TubeGeometry(migCurve, 28, isActTrack ? 0.28 : 0.16, 8, false),
          new THREE.MeshBasicMaterial({ color: migColor, transparent: true, opacity: isActTrack ? 0.95 : 0.45 }),
        );
        grp.add(migTube);

        for (const t of [0.35, 0.7]) {
          const pos = migCurve.getPointAt(t);
          const tangent = migCurve.getTangentAt(t).normalize();
          const cone = new THREE.Mesh(
            new THREE.ConeGeometry(isActTrack ? 0.65 : 0.42, 1.8, 10),
            new THREE.MeshBasicMaterial({ color: migColor, transparent: true, opacity: isActTrack ? 0.95 : 0.45 }),
          );
          cone.position.copy(pos);
          cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
          grp.add(cone);
        }
      }
    }
  }, [builderTracks, selectedTrack, playerAnchor, selectedWaypointId, activeStudioTab]);

  // Compute real-time 30 Hz flight physics trajectory (inbound -> LZ hover/unload -> outbound departure + ground AI march) + cutscene camera schedule for the Live 3D Preview Scrubber
  const flightPreviewSim = useMemo(() => {
    if (!selectedTrack) return null;
    try {
      const isGroundOrAuxWp = (name: string) =>
        name.startsWith('cam_') ||
        name.startsWith('wp_trig') ||
        name.includes('_trig') ||
        name.startsWith('wp_patrol') ||
        name.includes('_patrol') ||
        name.startsWith('wp_mig') ||
        name.includes('_mig') ||
        name.includes('_exit');
      const chainWps: Array<{ x: number; y: number; z: number; name: string }> = [];
      const seenIn = new Set<string>();
      for (const nm of selectedTrack.flightChain) {
        const w = selectedTrack.waypoints.find((wp) => wp.name === nm);
        if (w && !isGroundOrAuxWp(w.name) && !seenIn.has(w.name)) {
          seenIn.add(w.name);
          chainWps.push({
            name: w.name,
            x: playerAnchor.x + w.xOffset,
            y: playerAnchor.y + w.yOffset,
            z: playerAnchor.z + w.zOffset,
          });
        }
      }
      const entrySim = chainWps.length >= 2 ? buildRecordedFlightStreamFromWaypoints(chainWps, false) : null;

      // Build departure/exit chain starting from the exact final inbound LZ waypoint
      const exitWps: Array<{ x: number; y: number; z: number; name: string }> = [];
      const lzPt = chainWps[chainWps.length - 1];
      if (lzPt) exitWps.push({ ...lzPt });
      for (const nm of selectedTrack.exitFlightChain ?? []) {
        const w = selectedTrack.waypoints.find((wp) => wp.name === nm);
        if (w && (!lzPt || w.name !== lzPt.name)) {
          exitWps.push({
            name: w.name,
            x: playerAnchor.x + w.xOffset,
            y: playerAnchor.y + w.yOffset,
            z: playerAnchor.z + w.zOffset,
          });
        }
      }
      if (exitWps.length < 2 && lzPt) {
        const fallbackExit = selectedTrack.waypoints.find((wp) => wp.name.includes('_exit'));
        if (fallbackExit && fallbackExit.name !== lzPt.name) {
          exitWps.push({
            name: fallbackExit.name,
            x: playerAnchor.x + fallbackExit.xOffset,
            y: playerAnchor.y + fallbackExit.yOffset,
            z: playerAnchor.z + fallbackExit.zOffset,
          });
        }
      }
      const hasDepartAction = selectedTrack.actions.some((a) => a.kind === 'fly_away_and_despawn');
      const exitSim =
        hasDepartAction && exitWps.length >= 2 ? buildRecordedFlightStreamFromWaypoints(exitWps, true) : null;

      // Ground patrol / migration route starting from LZ
      const patrolWps: Array<{ x: number; y: number; z: number; name: string }> = [];
      if (lzPt) {
        patrolWps.push({ ...lzPt, z: playerAnchor.z + 0.6 });
      }
      for (const w of selectedTrack.waypoints) {
        if (
          w.name.startsWith('wp_patrol') ||
          w.name.includes('_patrol') ||
          w.name.startsWith('wp_mig') ||
          w.name.includes('_mig')
        ) {
          patrolWps.push({
            name: w.name,
            x: playerAnchor.x + w.xOffset,
            y: playerAnchor.y + w.yOffset,
            z: playerAnchor.z + Math.min(w.zOffset, 1.5),
          });
        }
      }

      // Stitch combined trajectory samples (every 2 ticks): Inbound -> 75-tick LZ Hover/Unload -> Outbound Departure
      const combinedSamples: Array<{ tick: number; x: number; y: number; z: number }> = [];
      const entrySamples = entrySim?.trajectorySamples ?? [];
      for (const s of entrySamples) {
        combinedSamples.push({ ...s });
      }
      const entryEndTick = entrySim?.totalTicks ?? 0;
      const hoverTicks = entrySamples.length > 0 ? 76 : 0;
      const hoverSamplePos = entrySamples[entrySamples.length - 1] ?? lzPt ?? { x: playerAnchor.x, y: playerAnchor.y, z: playerAnchor.z };
      for (let ht = 2; ht <= hoverTicks; ht += 2) {
        combinedSamples.push({
          tick: entryEndTick + ht,
          x: hoverSamplePos.x,
          y: hoverSamplePos.y,
          z: hoverSamplePos.z,
        });
      }
      const exitStartTick = entryEndTick + hoverTicks;
      const exitSamples = exitSim?.trajectorySamples ?? [];
      for (let i = 1; i < exitSamples.length; i++) {
        const es = exitSamples[i]!;
        combinedSamples.push({
          tick: exitStartTick + es.tick,
          x: es.x,
          y: es.y,
          z: es.z,
        });
      }

      const camWps = selectedTrack.waypoints
        .filter((w) => w.name.startsWith('cam_'))
        .map((w) => ({
          name: w.name,
          x: playerAnchor.x + w.xOffset,
          y: playerAnchor.y + w.yOffset,
          z: playerAnchor.z + w.zOffset,
        }));
      const camAct = selectedTrack.actions.find((a) => a.kind === 'cutscene_camera_pan');
      const defaultMove = Math.max(15, Math.round(camAct?.camStepMoveTicks ?? (camAct?.seconds ?? 4) * 30));
      const defaultSleep = Math.max(15, Math.round(camAct?.camStepSleepTicks ?? defaultMove));
      const initHold = Math.max(0, Math.round(camAct?.camInitialHoldTicks ?? 30));

      interface CamSegment {
        camIdx: number;
        camName: string;
        startTick: number;
        moveTicks: number;
        holdTicks: number;
        endTick: number;
        fromPos: { x: number; y: number; z: number };
        toPos: { x: number; y: number; z: number };
      }
      const camSegments: CamSegment[] = [];
      let curTick = 0;
      for (let i = 0; i < camWps.length; i++) {
        const cw = camWps[i]!;
        const prevCw = i > 0 ? camWps[i - 1]! : cw;
        const custom = camAct?.cameraTimings?.find((ct) => ct.camName === cw.name) ?? camAct?.cameraTimings?.[i];
        const distMoveTicks = (() => {
          if (i === 0) return 0;
          const dist = Math.hypot(cw.x - prevCw.x, cw.y - prevCw.y, cw.z - prevCw.z);
          return Math.max(defaultMove, Math.min(900, Math.round((dist / 6.0) * 30)));
        })();
        const moveTicks =
          custom !== undefined ? Math.max(0, Math.round(custom.moveTicks)) : i === 0 ? 0 : distMoveTicks;
        const rawSleep =
          custom !== undefined
            ? Math.max(0, Math.round(custom.sleepTicks))
            : i === 0
              ? camWps.length <= 1
                ? defaultSleep
                : Math.max(45, initHold)
              : defaultSleep;
        const holdTicks = i === 0 ? Math.max(15, rawSleep) : Math.max(0, rawSleep);
        const span = Math.max(1, moveTicks + holdTicks);
        camSegments.push({
          camIdx: i,
          camName: cw.name,
          startTick: curTick,
          moveTicks,
          holdTicks,
          endTick: curTick + span,
          fromPos: { x: prevCw.x, y: prevCw.y, z: prevCw.z },
          toPos: { x: cw.x, y: cw.y, z: cw.z },
        });
        curTick += span;
      }

      const totalFlightTicks = entryEndTick + hoverTicks + (exitSim?.totalTicks ?? 0);
      const totalCamTicks = curTick;
      const maxTicks = Math.max(totalFlightTicks, totalCamTicks, 180);
      return {
        entrySim,
        exitSim,
        combinedSamples,
        entryEndTick,
        exitStartTick,
        patrolWps,
        camWps,
        camSegments,
        totalFlightTicks,
        totalCamTicks,
        maxTicks,
      };
    } catch {
      return null;
    }
  }, [selectedTrack, playerAnchor]);

  // Advance previewTick at 30 Hz when Play Preview is active
  useEffect(() => {
    if (!isPlayingPreview || !flightPreviewSim) return;
    let raf = 0;
    let lastTs = performance.now();
    let accumTicks = 0;
    const maxT = flightPreviewSim.maxTicks;
    const step = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - lastTs) / 1000));
      lastTs = now;
      accumTicks += dt * 30;
      if (accumTicks >= 1) {
        const inc = Math.floor(accumTicks);
        accumTicks -= inc;
        setPreviewTick((prev) => {
          if (prev + inc >= maxT) {
            return 0;
          }
          return prev + inc;
        });
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [isPlayingPreview, flightPreviewSim?.maxTicks]);

  // Render live 3D Dropship preview mesh + interpolated Cutscene Camera indicator at previewTick
  useEffect(() => {
    const pGrp = previewGroupRef.current;
    if (!pGrp) return;
    while (pGrp.children.length > 0) {
      pGrp.remove(pGrp.children[0]!);
    }
    if (!flightPreviewSim || !selectedTrack) return;

    const toThree = (hx: number, hy: number, hz: number) => new THREE.Vector3(hx, hz, -hy);
    const samples = flightPreviewSim.combinedSamples ?? flightPreviewSim.entrySim?.trajectorySamples ?? [];
    let shipWorldPos: { x: number; y: number; z: number } | null = null;
    let shipNextPos: { x: number; y: number; z: number } | null = null;

    if (samples.length > 0) {
      // trajectorySamples is recorded every 2 simulation ticks (tick % 2 === 0)
      const sIdx = Math.max(0, Math.min(samples.length - 1, Math.round(previewTick / 2)));
      shipWorldPos = samples[sIdx]!;
      shipNextPos = samples[Math.min(samples.length - 1, sIdx + 3)] ?? samples[Math.max(0, sIdx - 3)] ?? shipWorldPos;

      const shipThree = toThree(shipWorldPos.x, shipWorldPos.y, shipWorldPos.z);
      const nextThree = toThree(shipNextPos.x, shipNextPos.y, shipNextPos.z);
      const shipGroup = new THREE.Group();
      shipGroup.position.copy(shipThree);

      const dir = nextThree.clone().sub(shipThree);
      if (dir.lengthSq() > 1e-4) {
        dir.normalize();
        const yaw = Math.atan2(dir.x, dir.z);
        const pitch = -Math.asin(Math.max(-0.85, Math.min(0.85, dir.y)));
        shipGroup.rotation.order = 'YXZ';
        shipGroup.rotation.y = yaw;
        shipGroup.rotation.x = pitch;
      }

      const shipCol = selectedTrack.team === 'covenant' ? 0xf87171 : 0x38bdf8;
      // Fuselage + Wings + Nose Beacon representing live Pelican/Dropship position
      const bodyMesh = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 1.35, 5.2),
        new THREE.MeshLambertMaterial({ color: shipCol }),
      );
      const wingMesh = new THREE.Mesh(
        new THREE.BoxGeometry(6.4, 0.35, 1.8),
        new THREE.MeshLambertMaterial({ color: 0xe2e8f0 }),
      );
      const noseCone = new THREE.Mesh(
        new THREE.ConeGeometry(1.1, 2.2, 8),
        new THREE.MeshBasicMaterial({ color: 0x4ade80 }),
      );
      noseCone.rotation.x = Math.PI * 0.5;
      noseCone.position.set(0, 0, 3.4);
      shipGroup.add(bodyMesh, wingMesh, noseCone);
      pGrp.add(shipGroup);

      // Show unloaded Cargo & AI Squad marching along ground patrol route after LZ arrival!
      if (previewTick >= (flightPreviewSim.entryEndTick || 0) && (flightPreviewSim.patrolWps?.length ?? 0) >= 1) {
        const pWps = flightPreviewSim.patrolWps!;
        const elapsedSinceDrop = Math.max(0, previewTick - (flightPreviewSim.entryEndTick || 0) - 25);
        const marchAlpha = Math.min(1, elapsedSinceDrop / 180);
        const p0 = pWps[0]!;
        const p1 = pWps[pWps.length - 1]!;
        const gx = p0.x + (p1.x - p0.x) * marchAlpha;
        const gy = p0.y + (p1.y - p0.y) * marchAlpha;
        const gz = p0.z + (p1.z - p0.z) * marchAlpha;
        const squadMesh = new THREE.Mesh(
          new THREE.BoxGeometry(2.0, 1.1, 2.8),
          new THREE.MeshLambertMaterial({ color: 0x22c55e }),
        );
        squadMesh.position.copy(toThree(gx, gy, gz));
        pGrp.add(squadMesh);
      }
    }

    // Interpolate active Cutscene Camera position at previewTick
    const segs = flightPreviewSim.camSegments;
    if (segs.length > 0) {
      const activeSeg =
        segs.find((s) => previewTick >= s.startTick && previewTick <= s.endTick) ??
        (previewTick > segs[segs.length - 1]!.endTick ? segs[segs.length - 1]! : segs[0]!);
      const localT = Math.max(0, previewTick - activeSeg.startTick);
      const rawAlpha = activeSeg.moveTicks > 0 ? Math.min(1, localT / activeSeg.moveTicks) : 1;
      // Smooth cosine ease-in-out matching Halo camera_set interpolation
      const alpha = 0.5 - 0.5 * Math.cos(Math.PI * rawAlpha);
      const camHx = activeSeg.fromPos.x + (activeSeg.toPos.x - activeSeg.fromPos.x) * alpha;
      const camHy = activeSeg.fromPos.y + (activeSeg.toPos.y - activeSeg.fromPos.y) * alpha;
      const camHz = activeSeg.fromPos.z + (activeSeg.toPos.z - activeSeg.fromPos.z) * alpha;
      const camThree = toThree(camHx, camHy, camHz);

      const lookTargetThree = shipWorldPos
        ? toThree(shipWorldPos.x, shipWorldPos.y, shipWorldPos.z)
        : toThree(playerAnchor.x, playerAnchor.y, playerAnchor.z + 1.5);

      if (!lockPreviewToCutsceneCam) {
        const camMarker = new THREE.Mesh(
          new THREE.SphereGeometry(1.3, 14, 14),
          new THREE.MeshBasicMaterial({ color: 0xe879f9 }),
        );
        camMarker.position.copy(camThree);
        pGrp.add(camMarker);

        // Sightline from active cutscene camera to Pelican / target
        const sightGeom = new THREE.BufferGeometry().setFromPoints([camThree, lookTargetThree]);
        pGrp.add(
          new THREE.Line(
            sightGeom,
            new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.85 }),
          ),
        );
      } else if (threeCameraRef.current && threeControlsRef.current) {
        threeCameraRef.current.position.copy(camThree);
        threeControlsRef.current.target.copy(lookTargetThree);
        threeControlsRef.current.update();
      }
    }
  }, [previewTick, flightPreviewSim, selectedTrack, playerAnchor, lockPreviewToCutsceneCam, activeStudioTab]);

  // Inspect tags present in the map for AI & Dropship spawning
  const aiTagReadiness = (() => {
    const hasTag = (cls: string, kw: string) =>
      allTags.some((t) => t.primaryClassName === cls && t.path.toLowerCase().includes(kw));
    return [
      {
        label: 'UNSC Marine AI (actor_variant + biped)',
        ok: hasTag('actor_variant', 'marine') && hasTag('biped', 'marine'),
        hint: 'characters\\marine\\... or characters\\marine_armored\\... (.actor_variant + .biped)',
      },
      {
        label: 'Covenant Elite AI (actor_variant + biped)',
        ok: hasTag('actor_variant', 'elite') && hasTag('biped', 'elite'),
        hint: 'characters\\elite\\... (.actor_variant + .biped + plasma rifle)',
      },
      {
        label: 'Covenant Grunt AI (actor_variant + biped)',
        ok: hasTag('actor_variant', 'grunt') && hasTag('biped', 'grunt'),
        hint: 'characters\\grunt\\... (.actor_variant + .biped + plasma pistol)',
      },
      {
        label: 'UNSC Pelican + Scorpion Tank',
        ok: hasTag('vehicle', 'pelican') && hasTag('vehicle', 'scorpion'),
        hint: 'vehicles\\pelican\\pelican + vehicles\\scorpion\\scorpion_mp',
      },
      {
        label: 'Covenant Spirit Dropship + Wraith',
        ok: hasTag('vehicle', 'c_dropship') && hasTag('vehicle', 'wraith'),
        hint: 'vehicles\\c_dropship\\c_dropship + vehicles\\wraith\\wraith',
      },
    ];
  })();

  const handleLint = () => {
    const diags = lintHaloScript(hscSource);
    setDiagnostics(diags);
    if (diags.length === 0) {
      setStatusMessage('Syntax check passed: 0 errors, 0 warnings (OpenCE compatible).');
    } else {
      const errs = diags.filter((d) => d.severity === 'error').length;
      const warns = diags.filter((d) => d.severity === 'warning').length;
      setStatusMessage(`Found ${errs} error(s) and ${warns} warning(s).`);
    }
  };

  const handleAutoSetupEntities = async (template: HaloScriptSampleTemplate) => {
    if (!window.opence.setupScenarioScriptEntities) return;
    setIsBusy(true);
    setStatusMessage(null);
    const res = await window.opence.setupScenarioScriptEntities({
      objectNames: template.requiredObjectNames,
      triggerVolumes: template.requiredTriggerVolumes,
      cameraPoints: template.requiredCameraPoints,
    });
    setIsBusy(false);
    if (res.ok) {
      const parts: string[] = [];
      if (res.addedObjectNames.length > 0) parts.push(`+${res.addedObjectNames.length} object names (${res.addedObjectNames.join(', ')})`);
      if (res.addedTriggerVolumes.length > 0) parts.push(`+${res.addedTriggerVolumes.length} trigger volumes (${res.addedTriggerVolumes.join(', ')})`);
      if (res.addedCameraPoints.length > 0) parts.push(`+${res.addedCameraPoints.length} camera points (${res.addedCameraPoints.join(', ')})`);
      setStatusMessage(
        parts.length > 0
          ? `Auto-configured scenario entities in front of Player Spawn: ${parts.join(', ')}. View & move them in the 3D Viewport (Outliner -> Trigger Volumes / Cutscene Cameras / Vehicles).`
          : 'All required object names, trigger volumes, and camera points are configured in front of Player Spawn! View & move them in the 3D Viewport.',
      );
      window.dispatchEvent(new CustomEvent('opence:scenario-updated'));
      onMapModified?.();
      const refresh = await window.opence.decompileHaloScript?.();
      if (refresh?.ok) {
        setScenarioEntities(refresh.scenarioEntities);
      }
    } else {
      setStatusMessage(`Failed to setup scenario entities: ${res.message}`);
    }
  };

  const handleCompileIntoScenario = async () => {
    if (!window.opence.compileHaloScript) return;
    setIsBusy(true);
    setStatusMessage(null);
    const res = await window.opence.compileHaloScript(hscSource);
    setIsBusy(false);
    if (res.ok) {
      setScriptCount(res.compiledScripts);
      setGlobalCount(res.compiledGlobals);
      setSyntaxNodeCount(res.syntaxNodesUsed);
      setDiagnostics(res.diagnostics);
      syncBuilderTracksFromHscSource(hscSource, playerAnchor);
      setStatusMessage(
        `Compiled ${res.compiledScripts} script(s) & ${res.compiledGlobals} global(s) (${res.syntaxNodesUsed} syntax nodes) into scenario in-memory & synced 3D Builder timings! Press Ctrl+S to save map.`,
      );
      window.dispatchEvent(new CustomEvent('opence:scenario-updated'));
      onMapModified?.();
    } else {
      setDiagnostics(res.diagnostics ?? []);
      setStatusMessage(`Compile failed: ${res.message}`);
    }
  };

  const handleDownloadHsc = () => {
    const outHsc =
      activeStudioTab === 'builder' && builderTracks.length > 0 ? generateHscFromBuilder(builderTracks) : hscSource;
    if (outHsc !== hscSource) setHscSource(outHsc);
    const blob = new Blob([outHsc], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'scenario_scripts.hsc';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Parse top-level (script ...) blocks with their character start/end spans so user can delete individual scripts in 1 click
  const parsedScriptBlocks = (() => {
    const result: Array<{ name: string; scriptType: string; start: number; end: number }> = [];
    const src = hscSource;
    let i = 0;
    while (i < src.length) {
      // Skip comments
      if (src[i] === ';') {
        while (i < src.length && src[i] !== '\n') i++;
        continue;
      }
      if (src[i] === '"') {
        i++;
        while (i < src.length && src[i] !== '"') {
          if (src[i] === '\\') i++;
          i++;
        }
        i++;
        continue;
      }
      if (src[i] === '(') {
        const blockStart = i;
        let depth = 0;
        let inStr = false;
        while (i < src.length) {
          const ch = src[i];
          if (!inStr && ch === ';') {
            while (i < src.length && src[i] !== '\n') i++;
            continue;
          }
          if (ch === '"') {
            inStr = !inStr;
          } else if (!inStr) {
            if (ch === '(') depth++;
            else if (ch === ')') {
              depth--;
              if (depth === 0) {
                i++;
                break;
              }
            }
          }
          i++;
        }
        const blockText = src.slice(blockStart, i);
        const m = blockText.match(
          /^\(\s*script\s+(startup|dormant|continuous|static|stub)\s+(?:(?:void|boolean|real|short|long|string|unit|object)\s+)?([A-Za-z0-9_.-]+)/i,
        );
        if (m) {
          result.push({
            scriptType: m[1]!,
            name: m[2]!,
            start: blockStart,
            end: i,
          });
        }
        continue;
      }
      i++;
    }
    return result;
  })();

  const handleDeleteSingleScript = async (block: { name: string; start: number; end: number }) => {
    const remainingTracks = builderTracks.filter((t, idx) => {
      const safeId = t.id
        .replace(/^(?:run_evt_\d+_)+/i, '')
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .slice(0, 14);
      const genName = `run_evt_${idx + 1}_${safeId}`;
      return t.sourceScriptName !== block.name && genName !== block.name && t.id !== block.name;
    });
    const matchedBuilderTrack = remainingTracks.length !== builderTracks.length;
    if (matchedBuilderTrack) {
      setBuilderTracks(remainingTracks);
      if (!remainingTracks.some((t) => t.id === selectedTrackId)) {
        setSelectedTrackId(remainingTracks[0]?.id ?? '');
      }
    }
    const nextSource = matchedBuilderTrack
      ? generateHscFromBuilder(remainingTracks, [block.name])
      : `${hscSource.slice(0, block.start).trimEnd()}\n\n${hscSource.slice(block.end).trimStart()}`
          .replace(/^;\s*@(?:waypoint|flight_path|camera_pos|trigger_pos|command_list_path|object_pos|object_type|encounter_pos)\b.*$/gm, '')
          .trim();
    const formatted = nextSource ? `${nextSource}\n` : '; All scripts removed.\n';
    setHscSource(formatted);
    if (!window.opence.compileHaloScript) return;
    setIsBusy(true);
    const res = await window.opence.compileHaloScript(formatted);
    setIsBusy(false);
    if (res.ok) {
      setScriptCount(res.compiledScripts);
      setGlobalCount(res.compiledGlobals);
      setSyntaxNodeCount(res.syntaxNodesUsed);
      setDiagnostics(res.diagnostics);
      setStatusMessage(
        `Deleted script "${block.name}" and pruned its 3D waypoints, flight paths, and objects from the scenario (${res.compiledScripts} active script(s) remaining). Press Ctrl+S to save map.`,
      );
      window.dispatchEvent(new CustomEvent('opence:scenario-updated'));
      onMapModified?.();
      const refresh = await window.opence.decompileHaloScript?.();
      if (refresh?.ok) {
        setScenarioEntities(refresh.scenarioEntities);
      }
    }
  };

  const handleClearAllScripts = async () => {
    const emptySource = '; All scripts cleared from scenario.\n';
    setBuilderTracks([]);
    setSelectedTrackId('');
    setHscSource(emptySource);
    if (!window.opence.compileHaloScript) return;
    setIsBusy(true);
    const res = await window.opence.compileHaloScript(emptySource);
    setIsBusy(false);
    if (res.ok) {
      setScriptCount(0);
      setGlobalCount(0);
      setSyntaxNodeCount(0);
      setDiagnostics([]);
      setStatusMessage('Cleared all scripts, waypoints, flight paths, and script objects from the scenario (0 scripts active)! Press Ctrl+S to save map.');
      window.dispatchEvent(new CustomEvent('opence:scenario-updated'));
      onMapModified?.();
      const refresh = await window.opence.decompileHaloScript?.();
      if (refresh?.ok) {
        setScenarioEntities(refresh.scenarioEntities);
      }
    }
  };

  return (
    <div
      role={embedded ? 'region' : 'dialog'}
      aria-modal={embedded ? undefined : 'true'}
      data-testid="script-editor-dialog"
      style={
        embedded
          ? {
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              minWidth: 0,
              background: 'var(--bg-panel)',
              color: 'var(--text-primary)',
              overflow: 'hidden',
            }
          : {
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.72)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 160,
            }
      }
    >
      <div
        style={
          embedded
            ? {
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                overflow: 'hidden',
              }
            : {
                width: '94vw',
                maxWidth: 1320,
                height: '90vh',
                background: 'var(--bg-panel)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                boxShadow: '0 14px 48px rgba(0,0,0,0.65)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }
        }
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            background: 'var(--bg-panel-header)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent-cyan)' }}>
              3D Interactive Script Builder & HaloScript (.hsc) Compiler
            </span>
            <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
              <button
                data-testid="hs-tab-builder"
                onClick={() => {
                  if (activeStudioTab === 'code') {
                    syncBuilderTracksFromHscSource(hscSource, playerAnchor);
                  }
                  setActiveStudioTab('builder');
                }}
                style={{
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  background: activeStudioTab === 'builder' ? 'rgba(34, 197, 94, 0.22)' : 'rgba(255,255,255,0.05)',
                  border: activeStudioTab === 'builder' ? '1px solid #4ade80' : '1px solid var(--border)',
                  color: activeStudioTab === 'builder' ? '#4ade80' : 'var(--text-secondary)',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                3D Interactive Waypoint & Action Builder
              </button>
              <button
                data-testid="hs-tab-code"
                onClick={() => {
                  if (activeStudioTab === 'builder' && builderTracks.length > 0) {
                    setHscSource(generateHscFromBuilder(builderTracks));
                  }
                  setActiveStudioTab('code');
                }}
                style={{
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  background: activeStudioTab === 'code' ? 'rgba(56, 189, 248, 0.22)' : 'rgba(56, 189, 248, 0.1)',
                  border: activeStudioTab === 'code' ? '1px solid #38bdf8' : '1px solid rgba(56, 189, 248, 0.4)',
                  color: '#38bdf8',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                + Insert / Edit Custom Script (.hsc)
              </button>
            </div>
            <span
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 3,
                background: 'rgba(56, 189, 248, 0.12)',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--mono-font)',
              }}
            >
              Scripts: {scriptCount} | Globals: {globalCount} | Syntax Nodes: {syntaxNodeCount}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              data-testid="hs-reload-btn"
              onClick={loadFromMap}
              disabled={isBusy}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              Decompile from Map
            </button>
            <button
              data-testid="hs-export-btn"
              onClick={handleDownloadHsc}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                background: 'rgba(168, 85, 247, 0.15)',
                border: '1px solid rgba(168, 85, 247, 0.4)',
                color: '#c084fc',
                borderRadius: 3,
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Export .hsc
            </button>
            {!embedded && (
              <button
                data-testid="hs-close-btn"
                onClick={onClose}
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: 'var(--text-dim)',
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            )}
          </div>
        </div>

        {/* Status banner */}
        {statusMessage && (
          <div
            data-testid="hs-status-banner"
            style={{
              padding: '7px 14px',
              fontSize: 11.5,
              background: statusMessage.includes('Failed') || statusMessage.includes('error')
                ? 'rgba(239, 68, 68, 0.16)'
                : 'rgba(34, 197, 94, 0.15)',
              color: statusMessage.includes('Failed') || statusMessage.includes('error') ? '#f87171' : '#4ade80',
              borderBottom: '1px solid var(--border)',
            }}
          >
            {statusMessage}
          </div>
        )}

        {/* Main Split Body */}
        {activeStudioTab === 'builder' ? (
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            {/* Left Column: Unit / Squad Tracks & Waypoints */}
            <div
              style={{
                width: 390,
                borderRight: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                background: 'rgba(0,0,0,0.18)',
                overflowY: 'auto',
                padding: 12,
                gap: 12,
              }}
            >
              {/* Add New 3D Script Event Instance from Scratch or Major Event Preset */}
              <div
                style={{
                  padding: 10,
                  background: 'rgba(15, 23, 42, 0.85)',
                  border: '1px solid rgba(74, 222, 128, 0.4)',
                  borderRadius: 4,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: '#4ade80' }}>
                    + Create New 3D Script Event Instance
                  </span>
                  {builderTracks.length > 0 && (
                    <button
                      title="Delete all 3D script event instances and remove them from the map script"
                      onClick={async () => {
                        const removedSrcNames = builderTracks
                          .map((t) => t.sourceScriptName)
                          .filter(Boolean) as string[];
                        setBuilderTracks([]);
                        setSelectedTrackId('');
                        const updatedHsc = generateHscFromBuilder([], removedSrcNames);
                        setHscSource(updatedHsc);
                        if (window.opence.compileHaloScript) {
                          setIsBusy(true);
                          const res = await window.opence.compileHaloScript(updatedHsc);
                          setIsBusy(false);
                          if (res.ok) {
                            setScriptCount(res.compiledScripts);
                            setGlobalCount(res.compiledGlobals);
                            setSyntaxNodeCount(res.syntaxNodesUsed);
                            setStatusMessage('Cleared all 3D script instances from 3D viewer and map script.');
                            window.dispatchEvent(new CustomEvent('opence:scenario-updated'));
                            onMapModified?.();
                          }
                        }
                      }}
                      style={{
                        padding: '2px 7px',
                        fontSize: 10,
                        fontWeight: 700,
                        background: 'rgba(239, 68, 68, 0.16)',
                        border: '1px solid rgba(239, 68, 68, 0.45)',
                        color: '#f87171',
                        borderRadius: 3,
                        cursor: 'pointer',
                      }}
                    >
                      Clear All 3D Scripts
                    </button>
                  )}
                </div>
                <select
                  data-testid="hs-new-event-preset-select"
                  value={newEventPreset}
                  onChange={(e) => setNewEventPreset(e.target.value as BuilderEventPreset)}
                  style={{
                    width: '100%',
                    padding: '5px 8px',
                    background: '#141820',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    borderRadius: 3,
                    fontSize: 11,
                  }}
                >
                  {(Object.keys(BUILDER_EVENT_PRESET_LABELS) as BuilderEventPreset[]).map((p) => (
                    <option key={p} value={p}>
                      {BUILDER_EVENT_PRESET_LABELS[p]}
                    </option>
                  ))}
                </select>
                <button
                  data-testid="hs-add-script-instance-btn"
                  onClick={() => {
                    const idx = builderTracks.length + 1;
                    const created = createTrackFromPreset(newEventPreset, idx);
                    setBuilderTracks((prev) => [...prev, created]);
                    setSelectedTrackId(created.id);
                    if (created.waypoints[0]) {
                      setSelectedWaypointId(created.waypoints[0].id);
                    }
                  }}
                  style={{
                    padding: '6px 10px',
                    fontSize: 11.5,
                    fontWeight: 700,
                    background: 'rgba(34, 197, 94, 0.22)',
                    border: '1px solid #4ade80',
                    color: '#4ade80',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  + Add Script Event Instance to 3D Builder
                </button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--accent-cyan)' }}>
                  3D Script Event Instances ({builderTracks.length})
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                  Click to edit • 👁 Hide/Show • ✕ Delete
                </span>
              </div>

              {builderTracks.length === 0 ? (
                <div
                  style={{
                    padding: '12px 10px',
                    borderRadius: 4,
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px dashed var(--border)',
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    lineHeight: 1.45,
                  }}
                >
                  No 3D script events added yet. Choose an event foundation above (Aerial Insertion Cutscene, Vehicle Reinforcement Drop, Units Fighting, Door from Switch, Proximity Door, Trigger Cutscene, or Custom) and click <b>+ Add Script Event Instance</b> to build from scratch!
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {builderTracks.map((trk) => {
                    const isSel = trk.id === selectedTrack?.id;
                    const isVis = trk.visibleIn3d !== false;
                    return (
                      <div
                        key={trk.id}
                        onClick={() => {
                          setSelectedTrackId(trk.id);
                          if (trk.waypoints[0]) setSelectedWaypointId(trk.waypoints[0].id);
                        }}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 4,
                          border: isSel ? '1px solid #38bdf8' : '1px solid var(--border)',
                          background: isSel ? 'rgba(56, 189, 248, 0.14)' : 'var(--bg-panel-header)',
                          opacity: isVis ? 1 : 0.55,
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                            {trk.label}
                          </div>
                          <div style={{ fontSize: 10, color: trk.team === 'covenant' ? '#f87171' : '#38bdf8' }}>
                            {BUILDER_ROLE_LABELS[trk.role]} • {trk.waypoints.length} WPs • {trk.actions.length} steps
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                          <button
                            title={isVis ? 'Hide this script in 3D viewer' : 'Show this script in 3D viewer'}
                            onClick={() => {
                              setBuilderTracks((prev) =>
                                prev.map((x) => (x.id === trk.id ? { ...x, visibleIn3d: !isVis } : x)),
                              );
                            }}
                            style={{
                              padding: '2px 6px',
                              fontSize: 10,
                              background: isVis ? 'rgba(56, 189, 248, 0.16)' : 'rgba(255,255,255,0.06)',
                              border: isVis ? '1px solid rgba(56, 189, 248, 0.45)' : '1px solid var(--border)',
                              color: isVis ? '#38bdf8' : 'var(--text-dim)',
                              borderRadius: 3,
                              cursor: 'pointer',
                            }}
                          >
                            {isVis ? '👁 Show' : '🚫 Hidden'}
                          </button>
                          <button
                            title="Delete this script instance and remove all its items from the 3D viewer and map script"
                            onClick={async () => {
                              const remaining = builderTracks.filter((x) => x.id !== trk.id);
                              setBuilderTracks(remaining);
                              if (selectedTrackId === trk.id) {
                                setSelectedTrackId(remaining[0]?.id ?? '');
                              }
                              const updatedHsc = generateHscFromBuilder(
                                remaining,
                                trk.sourceScriptName ? [trk.sourceScriptName] : [],
                              );
                              setHscSource(updatedHsc);
                              if (window.opence.compileHaloScript) {
                                setIsBusy(true);
                                const res = await window.opence.compileHaloScript(updatedHsc);
                                setIsBusy(false);
                                if (res.ok) {
                                  setScriptCount(res.compiledScripts);
                                  setGlobalCount(res.compiledGlobals);
                                  setSyntaxNodeCount(res.syntaxNodesUsed);
                                  setStatusMessage(
                                    `Deleted script "${trk.label}" and removed all its waypoints/paths from the map script (${remaining.length} 3D script instance(s) remaining).`,
                                  );
                                  window.dispatchEvent(new CustomEvent('opence:scenario-updated'));
                                  onMapModified?.();
                                }
                              }
                            }}
                            style={{
                              padding: '2px 6px',
                              fontSize: 10,
                              fontWeight: 700,
                              background: 'rgba(239, 68, 68, 0.16)',
                              border: '1px solid rgba(239, 68, 68, 0.4)',
                              color: '#f87171',
                              borderRadius: 3,
                              cursor: 'pointer',
                            }}
                          >
                            ✕ Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Active Compiled Scripts in Map (shows all scripts present in the scenario right inside the 3D Builder) */}
              {parsedScriptBlocks.length > 0 && (
                <div
                  data-testid="hs-builder-active-map-scripts"
                  style={{
                    padding: 8,
                    background: 'rgba(15, 23, 42, 0.72)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#4ade80' }}>
                      Active Scripts in Map ({parsedScriptBlocks.length})
                    </span>
                    <button
                      onClick={() => setActiveStudioTab('code')}
                      style={{
                        padding: '1px 6px',
                        fontSize: 9.5,
                        background: 'rgba(56, 189, 248, 0.14)',
                        border: '1px solid rgba(56, 189, 248, 0.4)',
                        color: '#38bdf8',
                        borderRadius: 3,
                        cursor: 'pointer',
                      }}
                    >
                      Inspect .hsc Code
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 135, overflowY: 'auto' }}>
                    {parsedScriptBlocks.map((b) => (
                      <div
                        key={`${b.name}-${b.start}`}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '3px 6px',
                          background: 'rgba(0,0,0,0.28)',
                          border: '1px solid rgba(255,255,255,0.07)',
                          borderRadius: 3,
                          fontSize: 10,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                          <span
                            style={{
                              fontSize: 8.5,
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              padding: '1px 4px',
                              borderRadius: 2,
                              background: 'rgba(56, 189, 248, 0.15)',
                              color: '#38bdf8',
                            }}
                          >
                            {b.scriptType}
                          </span>
                          <span
                            style={{
                              fontFamily: 'var(--mono-font)',
                              color: 'var(--text-primary)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {b.name}
                          </span>
                        </div>
                        <button
                          title={`Delete script "${b.name}" from map`}
                          onClick={() => {
                            setBuilderTracks((prev) =>
                              prev.filter(
                                (t) => t.sourceScriptName !== b.name && `run_evt_${prev.indexOf(t) + 1}_${t.id.replace(/[^a-zA-Z0-9_]/g, '_')}` !== b.name,
                              ),
                            );
                            void handleDeleteSingleScript(b);
                          }}
                          style={{
                            padding: '1px 5px',
                            fontSize: 9,
                            fontWeight: 700,
                            background: 'rgba(239, 68, 68, 0.16)',
                            border: '1px solid rgba(239, 68, 68, 0.4)',
                            color: '#f87171',
                            borderRadius: 2,
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                        >
                          ✕ Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Selected Script Instance's Dedicated 3D Flight / Camera Path Router */}
              {selectedTrack && (
                <div
                  data-testid="hs-flight-path-router"
                  style={{
                    padding: 10,
                    background: 'rgba(15, 23, 42, 0.85)',
                    border: '1px solid rgba(56, 189, 248, 0.35)',
                    borderRadius: 4,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: '#38bdf8' }}>
                      ✈ Path & Waypoint Chain for: {selectedTrack.label}
                    </span>
                  </div>
                  {(selectedTrack.role.includes('pelican') || selectedTrack.role.includes('dropship')) && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        data-testid="hs-path-mode-entry"
                        onClick={() => setActivePathMode('entry')}
                        style={{
                          flex: 1,
                          padding: '5px 8px',
                          fontSize: 10.5,
                          fontWeight: 700,
                          borderRadius: 3,
                          cursor: 'pointer',
                          background: activePathMode === 'entry' ? 'rgba(56, 189, 248, 0.22)' : 'rgba(255,255,255,0.05)',
                          border: activePathMode === 'entry' ? '1px solid #38bdf8' : '1px solid var(--border)',
                          color: activePathMode === 'entry' ? '#38bdf8' : 'var(--text-secondary)',
                        }}
                      >
                        🛬 Entry / Approach Path (fly_in)
                      </button>
                      <button
                        data-testid="hs-path-mode-exit"
                        onClick={() => setActivePathMode('exit')}
                        style={{
                          flex: 1,
                          padding: '5px 8px',
                          fontSize: 10.5,
                          fontWeight: 700,
                          borderRadius: 3,
                          cursor: 'pointer',
                          background: activePathMode === 'exit' ? 'rgba(245, 158, 11, 0.22)' : 'rgba(255,255,255,0.05)',
                          border: activePathMode === 'exit' ? '1px solid #f59e0b' : '1px solid var(--border)',
                          color: activePathMode === 'exit' ? '#fbbf24' : 'var(--text-secondary)',
                        }}
                      >
                        🛫 Departure / Exit Path (fly_out)
                      </button>
                    </div>
                  )}
                  <div
                    style={{
                      padding: '5px 7px',
                      borderRadius: 3,
                      background: 'rgba(56, 189, 248, 0.09)',
                      border: '1px solid rgba(56, 189, 248, 0.25)',
                      fontSize: 9.8,
                      color: '#bae6fd',
                      lineHeight: 1.38,
                    }}
                  >
                    {selectedTrack.role.includes('pelican') || selectedTrack.role.includes('dropship') ? (
                      <>
                        <b>How Pelican &amp; C-Dropship Flight Paths Work:</b> Halo CE dropships have no AI pilot — Mantle automatically records your 3D waypoints below into a closed-loop <code>unit_control_data_v3</code> <b>Recorded Animation</b> stream inside the scenario!
                        <br />
                        <b>1.</b> Select <b>Entry Path (fly_in)</b> or <b>Departure Path (fly_out)</b> above.
                        <br />
                        <b>2.</b> Click a waypoint below (e.g. <code>START</code>, <code>TURN</code>, <code>END / LZ</code>, or <code>EXIT</code>), then <b>Left-Click on the 3D BSP</b> to place it and adjust its <b>Z Altitude</b> slider.
                        <br />
                        <b>3.</b> Hold <b>Shift + Left-Click</b> on the 3D BSP (or click <b>+ Insert Corner Waypoint</b>) to add S-turns, then click <b>Generate .hsc &amp; Compile into Scenario</b>!
                      </>
                    ) : (
                      <>
                        <b>AI Command List &amp; Waypoint Mode:</b> Ground vehicles &amp; AI squads compile your 3D waypoints below into a scenario <b>AI Command List</b> (<code>ai_command_list</code> with <code>go to</code> points) and 3D firing positions!
                      </>
                    )}
                  </div>
                  {(() => {
                    const isDropship =
                      selectedTrack.role.includes('pelican') || selectedTrack.role.includes('dropship');
                    const isExitMode = isDropship && activePathMode === 'exit';
                    const chain = isExitMode
                      ? selectedTrack.exitFlightChain && selectedTrack.exitFlightChain.length > 0
                        ? selectedTrack.exitFlightChain
                        : [...selectedTrack.flightChain].reverse()
                      : selectedTrack.flightChain;
                    const setChain = isExitMode ? setSelectedExitFlightChain : setSelectedFlightChain;
                    const accent = isExitMode
                      ? '#f59e0b'
                      : selectedTrack.team === 'covenant'
                        ? '#f87171'
                        : '#38bdf8';
                    return (
                      <>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {chain.map((wpName, idx) => {
                            const wpObj = builderWaypoints.find((w) => w.name === wpName);
                            const isSelected = wpObj?.id === selectedWaypointId;
                            const roleTag = isExitMode
                              ? idx === 0
                                ? 'DEPART LZ'
                                : idx === chain.length - 1
                                  ? 'DESPAWN EXIT'
                                  : `EXIT TURN #${idx}`
                              : idx === 0
                                ? 'START'
                                : idx === chain.length - 1
                                  ? 'END / LZ'
                                  : `TURN #${idx}`;
                            const gx = wpObj ? Number((playerAnchor.x + wpObj.xOffset).toFixed(2)) : 0;
                            const gy = wpObj ? Number((playerAnchor.y + wpObj.yOffset).toFixed(2)) : 0;
                            const gz = wpObj ? Number((playerAnchor.z + wpObj.zOffset).toFixed(2)) : 0;
                            return (
                              <div
                                key={`${wpName}-${idx}`}
                                onClick={() => wpObj && setSelectedWaypointId(wpObj.id)}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  padding: '4px 7px',
                                  borderRadius: 3,
                                  cursor: 'pointer',
                                  background: isSelected ? 'rgba(34, 197, 94, 0.2)' : 'rgba(0,0,0,0.28)',
                                  border: isSelected ? '1px solid #4ade80' : '1px solid var(--border)',
                                  fontSize: 10.5,
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span
                                    style={{
                                      fontSize: 9,
                                      fontWeight: 800,
                                      padding: '1px 5px',
                                      borderRadius: 3,
                                      background: 'rgba(255,255,255,0.08)',
                                      color: accent,
                                    }}
                                  >
                                    {roleTag}
                                  </span>
                                  <span style={{ fontFamily: 'var(--mono-font)', fontWeight: 600, color: 'var(--text-primary)' }}>
                                    {wpName}
                                  </span>
                                  {wpObj && (
                                    <span style={{ fontSize: 9.5, color: 'var(--text-dim)' }}>
                                      ({gx}, {gy}, Z:{gz}m)
                                    </span>
                                  )}
                                </div>
                                <div style={{ display: 'flex', gap: 3 }} onClick={(e) => e.stopPropagation()}>
                                  {idx > 0 && (
                                    <button
                                      title="Move earlier in path"
                                      onClick={() =>
                                        setChain((prev) => {
                                          const next = [...prev];
                                          const tmp = next[idx - 1]!;
                                          next[idx - 1] = next[idx]!;
                                          next[idx] = tmp;
                                          return next;
                                        })
                                      }
                                      style={{
                                        padding: '1px 4px',
                                        fontSize: 9,
                                        background: 'rgba(255,255,255,0.06)',
                                        border: '1px solid var(--border)',
                                        color: 'var(--text-secondary)',
                                        borderRadius: 2,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      ▲
                                    </button>
                                  )}
                                  {idx < chain.length - 1 && (
                                    <button
                                      title="Move later in path"
                                      onClick={() =>
                                        setChain((prev) => {
                                          const next = [...prev];
                                          const tmp = next[idx + 1]!;
                                          next[idx + 1] = next[idx]!;
                                          next[idx] = tmp;
                                          return next;
                                        })
                                      }
                                      style={{
                                        padding: '1px 4px',
                                        fontSize: 9,
                                        background: 'rgba(255,255,255,0.06)',
                                        border: '1px solid var(--border)',
                                        color: 'var(--text-secondary)',
                                        borderRadius: 2,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      ▼
                                    </button>
                                  )}
                                  {chain.length > 0 && (
                                    <button
                                      title="Remove waypoint from path chain"
                                      onClick={() => setChain((prev) => prev.filter((_, i) => i !== idx))}
                                      style={{
                                        padding: '1px 5px',
                                        fontSize: 9,
                                        background: 'rgba(239, 68, 68, 0.16)',
                                        border: '1px solid rgba(239, 68, 68, 0.4)',
                                        color: '#f87171',
                                        borderRadius: 2,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <button
                          data-testid="hs-add-flight-corner-btn"
                          onClick={() => {
                            const safeId = selectedTrack.id.replace(/[^a-zA-Z0-9_]/g, '_');
                            const prefix = isExitMode ? `wp_${safeId}_exit_turn_` : `wp_${safeId}_turn_`;
                            const nextNum = builderWaypoints.filter((w) => w.name.startsWith(prefix)).length + 1;
                            const newId = `wp-${Date.now()}`;
                            const newName = `${prefix}${nextNum}`;
                            const prevWpName = chain[Math.max(0, chain.length - 2)];
                            const endWpName = chain[chain.length - 1];
                            const prevWp = builderWaypoints.find((w) => w.name === prevWpName);
                            const endWp = builderWaypoints.find((w) => w.name === endWpName);
                            const midX = prevWp && endWp ? Number(((prevWp.xOffset + endWp.xOffset) * 0.5).toFixed(2)) : 12;
                            const midY = prevWp && endWp ? Number(((prevWp.yOffset + endWp.yOffset) * 0.5 + 4).toFixed(2)) : 6;
                            const midZ = prevWp && endWp ? Number(Math.max(2.5, (prevWp.zOffset + endWp.zOffset) * 0.5).toFixed(2)) : 5.0;
                            updateSelectedTrack((trk) => {
                              if (isExitMode) {
                                const nextExit =
                                  trk.exitFlightChain && trk.exitFlightChain.length > 0
                                    ? [...trk.exitFlightChain]
                                    : [...trk.flightChain].reverse();
                                nextExit.splice(Math.max(1, nextExit.length - 1), 0, newName);
                                return {
                                  ...trk,
                                  waypoints: [...trk.waypoints, { id: newId, name: newName, xOffset: midX, yOffset: midY, zOffset: midZ }],
                                  exitFlightChain: nextExit,
                                };
                              }
                              const nextChain = [...trk.flightChain];
                              nextChain.splice(Math.max(1, nextChain.length - 1), 0, newName);
                              return {
                                ...trk,
                                waypoints: [...trk.waypoints, { id: newId, name: newName, xOffset: midX, yOffset: midY, zOffset: midZ }],
                                flightChain: nextChain,
                              };
                            });
                            setSelectedWaypointId(newId);
                          }}
                          style={{
                            padding: '5px 8px',
                            fontSize: 10.5,
                            fontWeight: 700,
                            background: isExitMode ? 'rgba(245, 158, 11, 0.16)' : 'rgba(56, 189, 248, 0.16)',
                            border: `1px solid ${accent}`,
                            color: accent,
                            borderRadius: 3,
                            cursor: 'pointer',
                          }}
                        >
                          + Insert Corner Waypoint into {isExitMode ? 'Departure / Exit' : 'Entry / Approach'} Path
                        </button>
                      </>
                    );
                  })()}
                </div>
              )}

              {/* Waypoint Flags List for Selected Script Instance */}
              {selectedTrack && (
              <div
                style={{
                  padding: 10,
                  background: 'var(--bg-panel-header)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--accent-cyan)' }}>
                    3D Waypoints &amp; Camera Points
                  </span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      data-testid="hs-add-camera-waypoint-btn"
                      title="Add a new Cutscene Camera Point (cam_*) to this script's camera pan sequence"
                      onClick={() => {
                        const safeId = selectedTrack.id
                          .replace(/^(?:run_evt_\d+_)+/i, '')
                          .replace(/[^a-zA-Z0-9_]/g, '_')
                          .slice(0, 12);
                        const camCount = builderWaypoints.filter((w) => w.name.startsWith('cam_')).length + 1;
                        const newId = `cam-${Date.now()}`;
                        const newName = `cam_${safeId}_${camCount}`;
                        const lastCam = builderWaypoints.filter((w) => w.name.startsWith('cam_')).slice(-1)[0];
                        const nextX = lastCam ? Number((lastCam.xOffset + 5).toFixed(2)) : camCount * 4;
                        const nextY = lastCam ? Number((lastCam.yOffset + 3).toFixed(2)) : -6;
                        const nextZ = lastCam ? lastCam.zOffset : 2.8;
                        updateSelectedTrack((trk) => {
                          const hasCamAction = trk.actions.some((a) => a.kind === 'cutscene_camera_pan');
                          return {
                            ...trk,
                            waypoints: [
                              ...trk.waypoints,
                              { id: newId, name: newName, xOffset: nextX, yOffset: nextY, zOffset: nextZ },
                            ],
                            flightChain:
                              trk.role === 'cutscene_camera_rig' ? [...trk.flightChain, newName] : trk.flightChain,
                            actions: hasCamAction
                              ? trk.actions
                              : [
                                  ...trk.actions,
                                  { id: `act-cam-${Date.now()}`, kind: 'cutscene_camera_pan', waypointName: newName, seconds: 5 },
                                ],
                          };
                        });
                        setSelectedWaypointId(newId);
                      }}
                      style={{
                        padding: '2px 7px',
                        fontSize: 10.5,
                        fontWeight: 700,
                        background: 'rgba(192, 132, 252, 0.18)',
                        border: '1px solid rgba(192, 132, 252, 0.5)',
                        color: '#c084fc',
                        borderRadius: 3,
                        cursor: 'pointer',
                      }}
                    >
                      🎥 + Camera Point
                    </button>
                    <button
                      onClick={() => {
                        const safeId = selectedTrack.id
                          .replace(/^(?:run_evt_\d+_)+/i, '')
                          .replace(/[^a-zA-Z0-9_]/g, '_')
                          .slice(0, 12);
                        const isCamRig = selectedTrack.role === 'cutscene_camera_rig';
                        const n = isCamRig
                          ? builderWaypoints.filter((w) => w.name.startsWith('cam_')).length + 1
                          : builderWaypoints.length + 1;
                        const newId = `wp-${Date.now()}`;
                        const newName = isCamRig ? `cam_${safeId}_${n}` : `wp_${safeId}_${n}`;
                        updateSelectedTrack((trk) => {
                          const isDropship = trk.role.includes('pelican') || trk.role.includes('dropship');
                          const nextFlightChain =
                            activePathMode === 'exit'
                              ? trk.flightChain
                              : isDropship && trk.flightChain.length >= 2
                                ? [
                                    ...trk.flightChain.slice(0, trk.flightChain.length - 1),
                                    newName,
                                    trk.flightChain[trk.flightChain.length - 1]!,
                                  ]
                                : [...trk.flightChain, newName];
                          return {
                            ...trk,
                            waypoints: [...trk.waypoints, { id: newId, name: newName, xOffset: n * 5, yOffset: 0, zOffset: 2.2 }],
                            flightChain: nextFlightChain,
                            exitFlightChain:
                              activePathMode === 'exit'
                                ? [...(trk.exitFlightChain ?? []), newName]
                                : trk.exitFlightChain,
                          };
                        });
                        setSelectedWaypointId(newId);
                      }}
                      style={{
                        padding: '2px 7px',
                        fontSize: 10.5,
                        background: 'rgba(56, 189, 248, 0.16)',
                        border: '1px solid rgba(56, 189, 248, 0.4)',
                        color: '#38bdf8',
                        borderRadius: 3,
                        cursor: 'pointer',
                      }}
                    >
                      + Waypoint
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: 9.5, color: 'var(--text-dim)', lineHeight: 1.3 }}>
                  Global Halo World Coordinates (X, Y, Z) — matches <code>; @waypoint</code> &amp; <code>; @flight_path</code> in the <code>.hsc</code> script 1:1 (Player Spawn Anchor: {playerAnchor.x.toFixed(1)}, {playerAnchor.y.toFixed(1)}, {playerAnchor.z.toFixed(1)}).
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(84px, 1.3fr) minmax(48px, 1fr) minmax(48px, 1fr) minmax(52px, 1fr) 22px',
                    gap: 4,
                    fontSize: 9.5,
                    fontWeight: 700,
                    color: 'var(--text-dim)',
                    padding: '0 2px',
                  }}
                >
                  <span>Waypoint Name</span>
                  <span>World X</span>
                  <span>World Y</span>
                  <span style={{ color: '#fbbf24' }}>World Z</span>
                  <span />
                </div>
                {builderWaypoints.map((wp) => {
                  const worldX = Number((playerAnchor.x + wp.xOffset).toFixed(2));
                  const worldY = Number((playerAnchor.y + wp.yOffset).toFixed(2));
                  const worldZ = Number((playerAnchor.z + wp.zOffset).toFixed(2));
                  return (
                  <div
                    key={wp.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(84px, 1.3fr) minmax(48px, 1fr) minmax(48px, 1fr) minmax(52px, 1fr) 22px',
                      gap: 4,
                      alignItems: 'center',
                      fontSize: 10.5,
                    }}
                  >
                    <input
                      value={wp.name}
                      onChange={(e) => {
                        const newNm = e.target.value;
                        updateSelectedTrack((trk) => ({
                          ...trk,
                          waypoints: trk.waypoints.map((w) => (w.id === wp.id ? { ...w, name: newNm } : w)),
                          flightChain: trk.flightChain.map((nm) => (nm === wp.name ? newNm : nm)),
                          exitFlightChain: trk.exitFlightChain?.map((nm) => (nm === wp.name ? newNm : nm)),
                        }));
                      }}
                      style={{
                        minWidth: 0,
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '3px 5px',
                        background: '#141820',
                        border: '1px solid var(--border)',
                        color: 'var(--text-primary)',
                        borderRadius: 3,
                        fontSize: 10.5,
                        fontFamily: 'var(--mono-font)',
                      }}
                    />
                    <input
                      type="number"
                      step="1"
                      value={worldX}
                      title="Global World X Coordinate"
                      onChange={(e) => {
                        const nextWorldX = Number(e.target.value);
                        setBuilderWaypoints((prev) =>
                          prev.map((w) =>
                            w.id === wp.id
                              ? { ...w, xOffset: Number((nextWorldX - playerAnchor.x).toFixed(2)) }
                              : w,
                          ),
                        );
                      }}
                      style={{
                        minWidth: 0,
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '3px 4px',
                        background: '#141820',
                        border: '1px solid var(--border)',
                        color: 'var(--text-secondary)',
                        borderRadius: 3,
                        fontSize: 10.5,
                      }}
                    />
                    <input
                      type="number"
                      step="1"
                      value={worldY}
                      title="Global World Y Coordinate"
                      onChange={(e) => {
                        const nextWorldY = Number(e.target.value);
                        setBuilderWaypoints((prev) =>
                          prev.map((w) =>
                            w.id === wp.id
                              ? { ...w, yOffset: Number((nextWorldY - playerAnchor.y).toFixed(2)) }
                              : w,
                          ),
                        );
                      }}
                      style={{
                        minWidth: 0,
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '3px 4px',
                        background: '#141820',
                        border: '1px solid var(--border)',
                        color: 'var(--text-secondary)',
                        borderRadius: 3,
                        fontSize: 10.5,
                      }}
                    />
                    <input
                      type="number"
                      step="0.5"
                      value={worldZ}
                      title="Global World Z Altitude Coordinate"
                      onChange={(e) => {
                        const nextWorldZ = Number(e.target.value);
                        setBuilderWaypoints((prev) =>
                          prev.map((w) =>
                            w.id === wp.id
                              ? { ...w, zOffset: Number((nextWorldZ - playerAnchor.z).toFixed(2)) }
                              : w,
                          ),
                        );
                      }}
                      style={{
                        minWidth: 0,
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '3px 4px',
                        background: '#141820',
                        border: '1px solid var(--border)',
                        color: '#fbbf24',
                        borderRadius: 3,
                        fontSize: 10.5,
                      }}
                    />
                    <button
                      title="Delete waypoint"
                      onClick={() => {
                        updateSelectedTrack((trk) => ({
                          ...trk,
                          waypoints: trk.waypoints.filter((w) => w.id !== wp.id),
                          flightChain: trk.flightChain.filter((nm) => nm !== wp.name),
                          exitFlightChain: trk.exitFlightChain?.filter((nm) => nm !== wp.name),
                        }));
                      }}
                      style={{
                        padding: '2px 0',
                        fontSize: 9.5,
                        background: 'rgba(239, 68, 68, 0.16)',
                        border: '1px solid rgba(239, 68, 68, 0.4)',
                        color: '#f87171',
                        borderRadius: 3,
                        cursor: 'pointer',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  );
                })}
              </div>
              )}

              <button
                data-testid="hs-builder-compile-btn"
                disabled={isBusy}
                onClick={async () => {
                  const generated = generateHscFromBuilder();
                  setHscSource(generated);
                  if (!window.opence.compileHaloScript) return;
                  setIsBusy(true);
                  const res = await window.opence.compileHaloScript(generated);
                  setIsBusy(false);
                  if (res.ok) {
                    setScriptCount(res.compiledScripts);
                    setGlobalCount(res.compiledGlobals);
                    setSyntaxNodeCount(res.syntaxNodesUsed);
                    setDiagnostics(res.diagnostics);
                    setStatusMessage(
                      `Generated & compiled ${builderTracks.length} unit track(s) (${res.compiledScripts} scripts, ${res.syntaxNodesUsed} syntax nodes) into scenario! Switch to HSC Code tab to inspect or press Ctrl+S to save.`,
                    );
                    window.dispatchEvent(new CustomEvent('opence:scenario-updated'));
                    onMapModified?.();
                  } else {
                    setStatusMessage(`Builder compile failed: ${res.message}`);
                  }
                }}
                style={{
                  padding: '9px 12px',
                  fontSize: 12,
                  fontWeight: 700,
                  background: 'rgba(34, 197, 94, 0.24)',
                  border: '1px solid #4ade80',
                  color: '#4ade80',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Generate .hsc & Compile into Scenario
              </button>
            </div>

            {/* Right Column: Interactive 3D BSP Viewport, AI Tag Checklist & Action Sequencer */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 14, gap: 12, overflowY: 'auto' }}>
              {/* Required AI & Dropship Tags Readiness Banner */}
              {allTags.length > 0 && (
                <div
                  style={{
                    padding: '8px 12px',
                    background: 'rgba(15, 23, 42, 0.75)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-cyan)' }}>
                    Map AI & Dropship Tag Readiness:
                  </span>
                  {aiTagReadiness.map((item) => (
                    <span
                      key={item.label}
                      title={`Required tags: ${item.hint}`}
                      style={{
                        fontSize: 10.5,
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: item.ok ? 'rgba(34, 197, 94, 0.14)' : 'rgba(245, 158, 11, 0.16)',
                        border: item.ok ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid rgba(245, 158, 11, 0.45)',
                        color: item.ok ? '#4ade80' : '#fbbf24',
                        fontWeight: 600,
                      }}
                    >
                      {item.ok ? '✓ ' : '⚠ Missing: '}
                      {item.label}
                    </span>
                  ))}
                </div>
              )}

              {/* Real Three.js 3D BSP Terrain, Waypoint & S-Turn Flight Path Viewport */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  background: '#090d14',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  overflow: 'hidden',
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    height: viewportHeight,
                    minHeight: 220,
                    maxHeight: 860,
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    ref={viewportMountRef}
                    data-testid="hs-builder-3d-viewport"
                    style={{ width: '100%', height: '100%', cursor: 'crosshair' }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      top: 8,
                      left: 10,
                      padding: '3px 8px',
                      borderRadius: 4,
                      background: 'rgba(9, 13, 20, 0.82)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      fontSize: 10.5,
                      color: '#cbd5e1',
                      pointerEvents: 'none',
                    }}
                  >
                    {bspLoadedInfo}
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 8,
                      left: 10,
                      right: 10,
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 6,
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'rgba(9, 13, 20, 0.88)',
                      padding: '4px 10px',
                      borderRadius: 4,
                      border: '1px solid rgba(255,255,255,0.1)',
                    }}
                  >
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                      <span style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>Active Waypoint (L-Click BSP to Move • Shift+Click to Add Turn):</span>
                      {builderWaypoints.map((wp) => (
                        <button
                          key={wp.id}
                          onClick={() => setSelectedWaypointId(wp.id)}
                          style={{
                            padding: '2px 7px',
                            fontSize: 10,
                            fontWeight: 700,
                            borderRadius: 3,
                            cursor: 'pointer',
                            background: selectedWaypointId === wp.id ? 'rgba(34, 197, 94, 0.28)' : 'rgba(255,255,255,0.06)',
                            border: selectedWaypointId === wp.id ? '1px solid #4ade80' : '1px solid var(--border)',
                            color: selectedWaypointId === wp.id ? '#4ade80' : wp.name.startsWith('wp_patrol') ? '#84cc16' : '#fbbf24',
                          }}
                        >
                          {wp.name}
                        </button>
                      ))}
                      {selectedTrack && (
                        <>
                          <button
                            data-testid="hs-builder-add-patrol-wp"
                            onClick={() => {
                              const existingPatrols = selectedTrack.waypoints.filter((w) => w.name.startsWith('wp_patrol'));
                              const nextNum = existingPatrols.length + 1;
                              const safeName = `wp_patrol_${nextNum}`;
                              const refWp =
                                existingPatrols[existingPatrols.length - 1] ??
                                selectedTrack.waypoints.find((w) => w.name.includes('_lz') || w.name.includes('_hover')) ??
                                selectedTrack.waypoints[selectedTrack.waypoints.length - 1] ?? {
                                  xOffset: 8,
                                  yOffset: 0,
                                  zOffset: 0.5,
                                };
                              const newWpId = `wp_patrol_${Date.now()}`;
                              const newWp = {
                                id: newWpId,
                                name: safeName,
                                xOffset: Number((refWp.xOffset + 5).toFixed(2)),
                                yOffset: Number((refWp.yOffset + (nextNum % 2 === 0 ? 4 : -4)).toFixed(2)),
                                zOffset: 0.5,
                              };
                              setBuilderTracks((prev) =>
                                prev.map((t) => {
                                  if (t.id !== selectedTrack.id) return t;
                                  const hasPatrolAct = t.actions.some((a) => a.kind === 'follow_waypoint_path_ai');
                                  let nextActions = [...t.actions];
                                  if (!hasPatrolAct) {
                                    const newAct: BuilderActionStep = {
                                      id: `act_patrol_${Date.now()}`,
                                      kind: 'follow_waypoint_path_ai',
                                      waypointName: safeName,
                                    };
                                    // Insert BEFORE fly_away_and_despawn / trailing delay so unloaded troops immediately patrol at the LZ!
                                    const flyAwayIdx = nextActions.findIndex((a) => a.kind === 'fly_away_and_despawn');
                                    const insertIdx =
                                      flyAwayIdx > 0 && nextActions[flyAwayIdx - 1]?.kind === 'delay_seconds'
                                        ? flyAwayIdx - 1
                                        : flyAwayIdx >= 0
                                          ? flyAwayIdx
                                          : nextActions.length;
                                    nextActions.splice(insertIdx, 0, newAct);
                                  }
                                  return {
                                    ...t,
                                    waypoints: [...t.waypoints, newWp],
                                    actions: nextActions,
                                  };
                                }),
                              );
                              setSelectedWaypointId(newWpId);
                            }}
                            title="Add a ground AI Command List (0x44C) patrol waypoint starting from the LZ / squad position (Pelican still lands & unloads at LZ)"
                            style={{
                              padding: '2px 8px',
                              fontSize: 10,
                              fontWeight: 700,
                              borderRadius: 3,
                              cursor: 'pointer',
                              background: 'rgba(132, 204, 22, 0.2)',
                              border: '1px solid rgba(132, 204, 22, 0.55)',
                              color: '#a3e635',
                            }}
                          >
                            🥾 + Patrol Point (AI Command List)
                          </button>
                          <button
                            data-testid="hs-builder-add-migrate-wp"
                            onClick={() => {
                              const existingMigs = selectedTrack.waypoints.filter(
                                (w) => w.name.startsWith('wp_mig') || w.name.includes('_mig'),
                              );
                              const nextNum = existingMigs.length + 1;
                              const safeName = `wp_migrate_${nextNum}`;
                              const refWp =
                                existingMigs[existingMigs.length - 1] ??
                                selectedTrack.waypoints.find((w) => w.name.includes('_lz') || w.name.includes('_hover')) ??
                                selectedTrack.waypoints[selectedTrack.waypoints.length - 1] ?? {
                                  xOffset: 10,
                                  yOffset: 0,
                                  zOffset: 0.5,
                                };
                              const newWpId = `wp_mig_${Date.now()}`;
                              const newWp = {
                                id: newWpId,
                                name: safeName,
                                xOffset: Number((refWp.xOffset + 14).toFixed(2)),
                                yOffset: Number((refWp.yOffset + 8).toFixed(2)),
                                zOffset: 0.5,
                              };
                              const otherTrackEnc = builderTracks.find(
                                (other) => other.id !== selectedTrack.id && other.encounterName,
                              )?.encounterName;
                              const defaultTargetEnc =
                                otherTrackEnc ||
                                `${selectedTrack.team === 'covenant' ? 'cov' : 'unsc'}_mig_zone_${nextNum}`;
                              setBuilderTracks((prev) =>
                                prev.map((t) => {
                                  if (t.id !== selectedTrack.id) return t;
                                  const hasMigAct = t.actions.some((a) => a.kind === 'migrate_to_encounter');
                                  let nextActions = [...t.actions];
                                  if (!hasMigAct) {
                                    const newAct: BuilderActionStep = {
                                      id: `act_mig_${Date.now()}`,
                                      kind: 'migrate_to_encounter',
                                      targetName: defaultTargetEnc,
                                      waypointName: safeName,
                                    };
                                    // Insert BEFORE fly_away_and_despawn / trailing delay so unloaded troops migrate right after exiting the Pelican!
                                    const flyAwayIdx = nextActions.findIndex((a) => a.kind === 'fly_away_and_despawn');
                                    const insertIdx =
                                      flyAwayIdx > 0 && nextActions[flyAwayIdx - 1]?.kind === 'delay_seconds'
                                        ? flyAwayIdx - 1
                                        : flyAwayIdx >= 0
                                          ? flyAwayIdx
                                          : nextActions.length;
                                    nextActions.splice(insertIdx, 0, newAct);
                                  } else {
                                    nextActions = nextActions.map((a) =>
                                      a.kind === 'migrate_to_encounter' ? { ...a, waypointName: safeName } : a,
                                    );
                                  }
                                  return {
                                    ...t,
                                    waypoints: [...t.waypoints, newWp],
                                    actions: nextActions,
                                  };
                                }),
                              );
                              setSelectedWaypointId(newWpId);
                            }}
                            title="Add a 3D AI Migration Arrow (ai_migrate) from the Pelican LZ / squad start to a target ground zone (Pelican drops troops at LZ first, then squad migrates to wp_migrate_*)"
                            style={{
                              padding: '2px 8px',
                              fontSize: 10,
                              fontWeight: 700,
                              borderRadius: 3,
                              cursor: 'pointer',
                              background: 'rgba(16, 185, 129, 0.22)',
                              border: '1px solid rgba(16, 185, 129, 0.6)',
                              color: '#34d399',
                            }}
                          >
                            🔀 + AI Migration Arrow (ai_migrate)
                          </button>
                        </>
                      )}
                    </div>
                    {(() => {
                      const selWp = builderWaypoints.find((w) => w.id === selectedWaypointId);
                      if (!selWp) return null;
                      const worldZ = Number((playerAnchor.z + selWp.zOffset).toFixed(2));
                      return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 10, color: '#38bdf8', fontWeight: 700 }}>
                            {selWp.name} World Z ({worldZ}m):
                          </span>
                          <input
                            type="range"
                            min={-15}
                            max={35}
                            step={0.5}
                            value={selWp.zOffset}
                            onChange={(e) => {
                              const nextZ = Number(e.target.value);
                              setBuilderWaypoints((prev) =>
                                prev.map((w) => (w.id === selWp.id ? { ...w, zOffset: nextZ } : w)),
                              );
                            }}
                            style={{ width: 100, cursor: 'pointer', accentColor: '#38bdf8' }}
                          />
                        </div>
                      );
                    })()}
                  </div>
                  {lockPreviewToCutsceneCam && (
                    <>
                      <div
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          right: 0,
                          height: '13%',
                          background: 'rgba(0,0,0,0.92)',
                          borderBottom: '1px solid rgba(192, 132, 252, 0.45)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 12,
                          fontSize: 10.5,
                          fontWeight: 700,
                          color: '#c084fc',
                          letterSpacing: 1.5,
                          pointerEvents: 'none',
                        }}
                      >
                        <span>🎬 CINEMATIC LETTERBOX POV PREVIEW ({(previewTick / 30).toFixed(1)}s / TICK {previewTick})</span>
                        {(() => {
                          const segs = flightPreviewSim?.camSegments ?? [];
                          if (segs.length === 0) return null;
                          const activeSeg =
                            segs.find((s) => previewTick >= s.startTick && previewTick <= s.endTick) ??
                            (previewTick > segs[segs.length - 1]!.endTick ? segs[segs.length - 1]! : segs[0]!);
                          const localT = Math.max(0, previewTick - activeSeg.startTick);
                          const isMoving = activeSeg.moveTicks > 0 && localT < activeSeg.moveTicks;
                          return (
                            <span
                              style={{
                                padding: '2px 8px',
                                borderRadius: 4,
                                background: isMoving ? 'rgba(56, 189, 248, 0.22)' : 'rgba(250, 204, 21, 0.22)',
                                border: isMoving ? '1px solid #38bdf8' : '1px solid #facc15',
                                color: isMoving ? '#7dd3fc' : '#fde047',
                                letterSpacing: 0.6,
                              }}
                            >
                              Shot {activeSeg.camIdx + 1}/{segs.length}: {activeSeg.camName} •{' '}
                              {isMoving ? '🎥 Panning' : '⏸ Holding Shot'}
                            </span>
                          );
                        })()}
                      </div>
                      <div
                        style={{
                          position: 'absolute',
                          bottom: 42,
                          left: 0,
                          right: 0,
                          height: '11%',
                          background: 'rgba(0,0,0,0.92)',
                          borderTop: '1px solid rgba(192, 132, 252, 0.45)',
                          pointerEvents: 'none',
                        }}
                      />
                    </>
                  )}
                </div>

                {/* Live 3D Cutscene & Flight Trajectory Preview Scrubber */}
                {flightPreviewSim && (
                  <div
                    data-testid="hs-builder-preview-scrubber"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 12px',
                      background: 'rgba(30, 17, 54, 0.72)',
                      borderTop: '1px solid rgba(192, 132, 252, 0.35)',
                      flexWrap: 'wrap',
                    }}
                  >
                    <button
                      data-testid="hs-preview-play-btn"
                      onClick={() => setIsPlayingPreview((prev) => !prev)}
                      style={{
                        padding: '3px 10px',
                        fontSize: 11,
                        fontWeight: 700,
                        borderRadius: 4,
                        cursor: 'pointer',
                        background: isPlayingPreview ? 'rgba(239, 68, 68, 0.24)' : 'rgba(34, 197, 94, 0.24)',
                        border: isPlayingPreview ? '1px solid #f87171' : '1px solid #4ade80',
                        color: isPlayingPreview ? '#f87171' : '#4ade80',
                      }}
                    >
                      {isPlayingPreview ? '⏸ Pause 3D Preview' : '▶ Play Cutscene & Flight Preview'}
                    </button>
                    {flightPreviewSim.camSegments.length > 0 && (
                      <button
                        data-testid="hs-preview-cutscene-pov-btn"
                        onClick={() => {
                          setPreviewTick(0);
                          setLockPreviewToCutsceneCam(true);
                          setIsPlayingPreview(true);
                        }}
                        title="Reset to Tick 0, lock 3D camera to the Cutscene Camera POV with letterbox bars, and play the full cinematic sequence"
                        style={{
                          padding: '3px 10px',
                          fontSize: 11,
                          fontWeight: 700,
                          borderRadius: 4,
                          cursor: 'pointer',
                          background: 'rgba(192, 132, 252, 0.26)',
                          border: '1px solid #c084fc',
                          color: '#f0abfc',
                        }}
                      >
                        🎬 Preview Cutscene POV
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setIsPlayingPreview(false);
                        setPreviewTick(0);
                      }}
                      style={{
                        padding: '3px 8px',
                        fontSize: 10.5,
                        borderRadius: 4,
                        cursor: 'pointer',
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      ⏮ Reset (0s)
                    </button>
                    {flightPreviewSim.camSegments.map((seg) => (
                      <button
                        key={seg.camName}
                        onClick={() => {
                          setIsPlayingPreview(false);
                          setPreviewTick(seg.startTick);
                        }}
                        title={`Jump to Shot ${seg.camIdx + 1} (${seg.camName}) at Tick ${seg.startTick}`}
                        style={{
                          padding: '2px 7px',
                          fontSize: 10,
                          fontWeight: 700,
                          borderRadius: 3,
                          cursor: 'pointer',
                          background:
                            previewTick >= seg.startTick && previewTick < seg.endTick
                              ? 'rgba(232, 121, 249, 0.28)'
                              : 'rgba(255,255,255,0.06)',
                          border:
                            previewTick >= seg.startTick && previewTick < seg.endTick
                              ? '1px solid #e879f9'
                              : '1px solid var(--border)',
                          color:
                            previewTick >= seg.startTick && previewTick < seg.endTick
                              ? '#f0abfc'
                              : 'var(--text-secondary)',
                        }}
                      >
                        Shot {seg.camIdx + 1}
                      </button>
                    ))}
                    <input
                      data-testid="hs-preview-tick-slider"
                      type="range"
                      min={0}
                      max={flightPreviewSim.maxTicks}
                      step={1}
                      value={Math.min(previewTick, flightPreviewSim.maxTicks)}
                      onChange={(e) => {
                        setIsPlayingPreview(false);
                        setPreviewTick(Number(e.target.value));
                      }}
                      style={{ flex: 1, minWidth: 140, cursor: 'pointer', accentColor: '#c084fc' }}
                    />
                    <span
                      style={{
                        fontSize: 10.5,
                        fontFamily: 'var(--mono-font)',
                        color: '#e2e8f0',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Tick {previewTick} / {flightPreviewSim.maxTicks} ({(previewTick / 30).toFixed(1)}s /{' '}
                      {(flightPreviewSim.maxTicks / 30).toFixed(1)}s)
                    </span>
                    {flightPreviewSim.camSegments.length > 0 && (
                      <button
                        data-testid="hs-preview-lock-cam-btn"
                        onClick={() => setLockPreviewToCutsceneCam((prev) => !prev)}
                        title="Lock the 3D viewport camera to the active interpolated Cutscene Camera POV with cinematic letterbox bars"
                        style={{
                          padding: '3px 9px',
                          fontSize: 10.5,
                          fontWeight: 700,
                          borderRadius: 4,
                          cursor: 'pointer',
                          background: lockPreviewToCutsceneCam ? 'rgba(192, 132, 252, 0.28)' : 'rgba(255,255,255,0.06)',
                          border: lockPreviewToCutsceneCam ? '1px solid #c084fc' : '1px solid var(--border)',
                          color: lockPreviewToCutsceneCam ? '#e879f9' : 'var(--text-secondary)',
                        }}
                      >
                        🎥 {lockPreviewToCutsceneCam ? 'Unlock Free Camera' : 'Lock to Cutscene Camera POV'}
                      </button>
                    )}
                  </div>
                )}

                {/* Bottom 3D Viewer Enlarge / Height Slider & Drag Handle */}
                <div
                  onMouseDown={(e) => {
                    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'BUTTON') {
                      return;
                    }
                    e.preventDefault();
                    const startY = e.clientY;
                    const startH = viewportHeight;
                    const onMove = (me: MouseEvent) => {
                      const nextH = Math.max(220, Math.min(860, startH + (me.clientY - startY)));
                      setViewportHeight(nextH);
                    };
                    const onUp = () => {
                      window.removeEventListener('mousemove', onMove);
                      window.removeEventListener('mouseup', onUp);
                    };
                    window.addEventListener('mousemove', onMove);
                    window.addEventListener('mouseup', onUp);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '5px 12px',
                    background: 'rgba(15, 23, 42, 0.95)',
                    borderTop: '1px solid var(--border)',
                    cursor: 'ns-resize',
                    userSelect: 'none',
                  }}
                  title="Drag vertically or use the slider to enlarge/shrink the 3D viewport"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--accent-cyan)', whiteSpace: 'nowrap' }}>
                      ⇕ 3D Viewer Size ({viewportHeight}px):
                    </span>
                    <input
                      data-testid="hs-builder-viewport-size-slider"
                      type="range"
                      min={220}
                      max={860}
                      step={10}
                      value={viewportHeight}
                      onChange={(e) => setViewportHeight(Number(e.target.value))}
                      style={{ flex: 1, maxWidth: 280, cursor: 'pointer', accentColor: '#38bdf8' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 5 }}>
                    {[
                      { label: 'Compact', h: 280 },
                      { label: 'Default', h: 380 },
                      { label: 'Large', h: 540 },
                      { label: 'Max', h: 740 },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        onClick={() => setViewportHeight(preset.h)}
                        style={{
                          padding: '2px 7px',
                          fontSize: 10,
                          fontWeight: 600,
                          borderRadius: 3,
                          cursor: 'pointer',
                          background: Math.abs(viewportHeight - preset.h) < 20 ? 'rgba(56, 189, 248, 0.22)' : 'rgba(255,255,255,0.06)',
                          border: Math.abs(viewportHeight - preset.h) < 20 ? '1px solid #38bdf8' : '1px solid var(--border)',
                          color: Math.abs(viewportHeight - preset.h) < 20 ? '#38bdf8' : 'var(--text-secondary)',
                        }}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Selected Track Configuration & Predetermined Action List */}
              {selectedTrack && (
                <div
                  style={{
                    flex: 1,
                    background: 'var(--bg-panel-header)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr 0.8fr', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginBottom: 3 }}>Track Label</div>
                      <input
                        value={selectedTrack.label}
                        onChange={(e) =>
                          setBuilderTracks((prev) =>
                            prev.map((t) => (t.id === selectedTrack.id ? { ...t, label: e.target.value } : t)),
                          )
                        }
                        style={{
                          width: '100%',
                          padding: '5px 8px',
                          background: '#141820',
                          border: '1px solid var(--border)',
                          color: 'var(--text-primary)',
                          borderRadius: 4,
                          fontSize: 11.5,
                        }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginBottom: 3 }}>
                        Predetermined Unit / Dropship Role
                      </div>
                      <select
                        value={selectedTrack.role}
                        onChange={(e) => {
                          const role = e.target.value as BuilderUnitRole;
                          const isCov = role.startsWith('cov_');
                          setBuilderTracks((prev) =>
                            prev.map((t, idx) => {
                              if (t.id !== selectedTrack.id) return t;
                              const s = idx + 1;
                              const nextObj = role.startsWith('unsc_pelican')
                                ? `pelican_drop_${s}`
                                : role.startsWith('cov_dropship')
                                  ? `cdropship_drop_${s}`
                                  : role === 'unsc_scorpion'
                                    ? `scorpion_tank_${s}`
                                    : role === 'cov_wraith'
                                      ? `wraith_tank_${s}`
                                      : role === 'unsc_warthog'
                                        ? `warthog_${s}`
                                        : t.objectName;
                              const nextCargo =
                                role === 'unsc_pelican_tank'
                                  ? `scorpion_tank_${s}`
                                  : role === 'cov_dropship_wraith'
                                    ? `wraith_tank_${s}`
                                    : role === 'cov_dropship_ghost'
                                      ? `cov_ghost_${s}`
                                      : role === 'unsc_pelican_marines' || role === 'cov_dropship_elites'
                                        ? ''
                                        : t.cargoObjectName;
                              const nextEnc = isCov ? `cov_elites_${s}` : `unsc_marines_${s}`;
                              const nextDriver = isCov ? `cov_crew_${s}` : `unsc_crew_${s}`;
                              return {
                                ...t,
                                role,
                                team: isCov ? 'covenant' : 'human',
                                objectName: nextObj,
                                cargoObjectName: nextCargo,
                                encounterName: nextEnc,
                                driverEncounterName: nextDriver,
                              };
                            }),
                          );
                        }}
                        style={{
                          width: '100%',
                          padding: '5px 8px',
                          background: '#141820',
                          border: '1px solid var(--border)',
                          color: 'var(--text-primary)',
                          borderRadius: 4,
                          fontSize: 11.5,
                        }}
                      >
                        {(Object.keys(BUILDER_ROLE_LABELS) as BuilderUnitRole[]).map((r) => (
                          <option key={r} value={r}>
                            {BUILDER_ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginBottom: 3 }}>Team Allegiance</div>
                      <select
                        value={selectedTrack.team}
                        onChange={(e) =>
                          setBuilderTracks((prev) =>
                            prev.map((t) =>
                              t.id === selectedTrack.id ? { ...t, team: e.target.value as 'human' | 'covenant' } : t,
                            ),
                          )
                        }
                        style={{
                          width: '100%',
                          padding: '5px 8px',
                          background: '#141820',
                          border: '1px solid var(--border)',
                          color: selectedTrack.team === 'covenant' ? '#f87171' : '#38bdf8',
                          borderRadius: 4,
                          fontSize: 11.5,
                          fontWeight: 600,
                        }}
                      >
                        <option value="human">Human (Allied w/ Player)</option>
                        <option value="covenant">Covenant (Enemy to Player & Human)</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginBottom: 3 }}>Primary Object Name</div>
                      <input
                        value={selectedTrack.objectName}
                        onChange={(e) =>
                          setBuilderTracks((prev) =>
                            prev.map((t) => (t.id === selectedTrack.id ? { ...t, objectName: e.target.value } : t)),
                          )
                        }
                        style={{
                          width: '100%',
                          padding: '4px 6px',
                          background: '#141820',
                          border: '1px solid var(--border)',
                          color: 'var(--text-primary)',
                          borderRadius: 3,
                          fontSize: 11,
                          fontFamily: 'var(--mono-font)',
                        }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginBottom: 3 }}>Cargo Vehicle Name</div>
                      <input
                        value={selectedTrack.cargoObjectName}
                        onChange={(e) =>
                          setBuilderTracks((prev) =>
                            prev.map((t) =>
                              t.id === selectedTrack.id ? { ...t, cargoObjectName: e.target.value } : t,
                            ),
                          )
                        }
                        style={{
                          width: '100%',
                          padding: '4px 6px',
                          background: '#141820',
                          border: '1px solid var(--border)',
                          color: 'var(--text-primary)',
                          borderRadius: 3,
                          fontSize: 11,
                          fontFamily: 'var(--mono-font)',
                        }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginBottom: 3 }}>Infantry AI Squad</div>
                      <input
                        value={selectedTrack.encounterName}
                        onChange={(e) =>
                          setBuilderTracks((prev) =>
                            prev.map((t) => (t.id === selectedTrack.id ? { ...t, encounterName: e.target.value } : t)),
                          )
                        }
                        style={{
                          width: '100%',
                          padding: '4px 6px',
                          background: '#141820',
                          border: '1px solid var(--border)',
                          color: 'var(--text-primary)',
                          borderRadius: 3,
                          fontSize: 11,
                          fontFamily: 'var(--mono-font)',
                        }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginBottom: 3 }}>Vehicle Driver AI</div>
                      <input
                        value={selectedTrack.driverEncounterName}
                        onChange={(e) =>
                          setBuilderTracks((prev) =>
                            prev.map((t) =>
                              t.id === selectedTrack.id ? { ...t, driverEncounterName: e.target.value } : t,
                            ),
                          )
                        }
                        style={{
                          width: '100%',
                          padding: '4px 6px',
                          background: '#141820',
                          border: '1px solid var(--border)',
                          color: 'var(--text-primary)',
                          borderRadius: 3,
                          fontSize: 11,
                          fontFamily: 'var(--mono-font)',
                        }}
                      />
                    </div>
                  </div>

                  {/* Action Sequence List */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--accent-cyan)' }}>
                      Ordered Waypoints, Cutscene Timings & Actions for {selectedTrack.label}
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        data-testid="hs-add-sleep-step-btn"
                        title="Insert a custom (sleep <ticks>) Wait / Delay step into this sequence"
                        onClick={() =>
                          setBuilderTracks((prev) =>
                            prev.map((t) =>
                              t.id === selectedTrack.id
                                ? {
                                    ...t,
                                    actions: [
                                      ...t.actions,
                                      {
                                        id: `act-sleep-${Date.now()}`,
                                        kind: 'delay_seconds',
                                        seconds: 3,
                                        sleepTicks: 90,
                                      },
                                    ],
                                  }
                                : t,
                            ),
                          )
                        }
                        style={{
                          padding: '3px 9px',
                          fontSize: 11,
                          fontWeight: 600,
                          background: 'rgba(251, 191, 36, 0.16)',
                          border: '1px solid rgba(251, 191, 36, 0.45)',
                          color: '#fbbf24',
                          borderRadius: 3,
                          cursor: 'pointer',
                        }}
                      >
                        ⏱ + Sleep / Wait Step
                      </button>
                      <button
                        onClick={() =>
                          setBuilderTracks((prev) =>
                            prev.map((t) =>
                              t.id === selectedTrack.id
                                ? {
                                    ...t,
                                    actions: [
                                      ...t.actions,
                                      { id: `act-${Date.now()}`, kind: 'engage_ai_combat', seconds: 3 },
                                    ],
                                  }
                                : t,
                            ),
                          )
                        }
                        style={{
                          padding: '3px 9px',
                          fontSize: 11,
                          fontWeight: 600,
                          background: 'rgba(56, 189, 248, 0.16)',
                          border: '1px solid rgba(56, 189, 248, 0.45)',
                          color: '#38bdf8',
                          borderRadius: 3,
                          cursor: 'pointer',
                        }}
                      >
                        + Add Action Step
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {selectedTrack.actions.map((act, aIdx) => {
                      const updateAct = (patch: Partial<BuilderActionStep>) => {
                        setBuilderTracks((prev) => {
                          const nextTracks = prev.map((t) =>
                            t.id === selectedTrack.id
                              ? {
                                  ...t,
                                  actions: t.actions.map((a) => (a.id === act.id ? { ...a, ...patch } : a)),
                                }
                              : t,
                          );
                          setHscSource(generateHscFromBuilder(nextTracks));
                          return nextTracks;
                        });
                      };
                      const trackCamNames = builderWaypoints
                        .filter((w) => w.name.startsWith('cam_'))
                        .map((w) => w.name);
                      return (
                        <div
                          key={act.id}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                            padding: '7px 9px',
                            background: 'rgba(0,0,0,0.28)',
                            border:
                              act.kind === 'cutscene_camera_pan'
                                ? '1px solid rgba(192, 132, 252, 0.45)'
                                : '1px solid var(--border)',
                            borderRadius: 4,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', width: 22 }}>
                              #{aIdx + 1}
                            </span>
                            <div style={{ display: 'flex', gap: 2 }}>
                              <button
                                title="Move step earlier"
                                disabled={aIdx === 0}
                                onClick={() =>
                                  setBuilderTracks((prev) =>
                                    prev.map((t) => {
                                      if (t.id !== selectedTrack.id || aIdx === 0) return t;
                                      const next = [...t.actions];
                                      const tmp = next[aIdx - 1]!;
                                      next[aIdx - 1] = next[aIdx]!;
                                      next[aIdx] = tmp;
                                      return { ...t, actions: next };
                                    }),
                                  )
                                }
                                style={{
                                  padding: '1px 4px',
                                  fontSize: 9,
                                  background: 'rgba(255,255,255,0.06)',
                                  border: '1px solid var(--border)',
                                  color: aIdx === 0 ? 'var(--text-dim)' : 'var(--text-secondary)',
                                  borderRadius: 2,
                                  cursor: aIdx === 0 ? 'default' : 'pointer',
                                }}
                              >
                                ▲
                              </button>
                              <button
                                title="Move step later"
                                disabled={aIdx === selectedTrack.actions.length - 1}
                                onClick={() =>
                                  setBuilderTracks((prev) =>
                                    prev.map((t) => {
                                      if (t.id !== selectedTrack.id || aIdx >= t.actions.length - 1) return t;
                                      const next = [...t.actions];
                                      const tmp = next[aIdx + 1]!;
                                      next[aIdx + 1] = next[aIdx]!;
                                      next[aIdx] = tmp;
                                      return { ...t, actions: next };
                                    }),
                                  )
                                }
                                style={{
                                  padding: '1px 4px',
                                  fontSize: 9,
                                  background: 'rgba(255,255,255,0.06)',
                                  border: '1px solid var(--border)',
                                  color:
                                    aIdx === selectedTrack.actions.length - 1
                                      ? 'var(--text-dim)'
                                      : 'var(--text-secondary)',
                                  borderRadius: 2,
                                  cursor: aIdx === selectedTrack.actions.length - 1 ? 'default' : 'pointer',
                                }}
                              >
                                ▼
                              </button>
                            </div>
                            <select
                              value={act.kind}
                              onChange={(e) => {
                                const kind = e.target.value as BuilderActionKind;
                                updateAct({ kind });
                              }}
                              style={{
                                flex: 1,
                                minWidth: 210,
                                padding: '4px 8px',
                                background: '#141820',
                                border: '1px solid var(--border)',
                                color: 'var(--text-primary)',
                                borderRadius: 3,
                                fontSize: 11,
                              }}
                            >
                              {(Object.keys(BUILDER_ACTION_LABELS) as BuilderActionKind[]).map((k) => (
                                <option key={k} value={k}>
                                  {BUILDER_ACTION_LABELS[k]}
                                </option>
                              ))}
                            </select>

                            {(act.kind === 'fly_approach_s_turns' || act.kind === 'follow_waypoint_path_ai') && (
                              <span
                                title="Uses all waypoints in this script's Path & Waypoint Chain in order"
                                style={{
                                  padding: '3px 8px',
                                  fontSize: 10,
                                  fontWeight: 700,
                                  borderRadius: 3,
                                  background: 'rgba(56, 189, 248, 0.14)',
                                  border: '1px solid rgba(56, 189, 248, 0.4)',
                                  color: '#38bdf8',
                                  fontFamily: 'var(--mono-font)',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {selectedTrack.flightChain.length || builderWaypoints.length} WPs (
                                {selectedTrack.flightChain[0] ?? builderWaypoints[0]?.name ?? 'start'} →{' '}
                                {selectedTrack.flightChain[selectedTrack.flightChain.length - 1] ??
                                  builderWaypoints[builderWaypoints.length - 1]?.name ??
                                  'lz'}
                                )
                              </span>
                            )}

                            {act.kind === 'fly_approach_s_turns' && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span style={{ fontSize: 10, color: 'var(--text-dim)' }} title="Ticks before flight completion to open doors / finish wait">
                                  Lead:
                                </span>
                                <input
                                  type="number"
                                  min="0"
                                  max="600"
                                  value={act.sleepTicks ?? 45}
                                  onChange={(e) => updateAct({ sleepTicks: Math.max(0, Number(e.target.value)) })}
                                  style={{
                                    width: 52,
                                    padding: '3px 5px',
                                    background: '#141820',
                                    border: '1px solid var(--border)',
                                    color: '#38bdf8',
                                    borderRadius: 3,
                                    fontSize: 10.5,
                                  }}
                                />
                                <span style={{ fontSize: 10, color: 'var(--text-dim)' }} title="Hover settle sleep ticks at LZ before unloading">
                                  Settle Sleep:
                                </span>
                                <input
                                  type="number"
                                  min="1"
                                  max="600"
                                  value={act.secondarySleepTicks ?? 45}
                                  onChange={(e) => updateAct({ secondarySleepTicks: Math.max(1, Number(e.target.value)) })}
                                  style={{
                                    width: 52,
                                    padding: '3px 5px',
                                    background: '#141820',
                                    border: '1px solid var(--border)',
                                    color: '#fbbf24',
                                    borderRadius: 3,
                                    fontSize: 10.5,
                                  }}
                                />
                                <span style={{ fontSize: 9.5, color: 'var(--text-dim)' }}>ticks</span>
                              </div>
                            )}

                            {(act.kind === 'teleport_to_waypoint' || act.kind === 'activate_hud_navpoint') && (
                              <select
                                value={act.waypointName ?? builderWaypoints[0]?.name ?? ''}
                                onChange={(e) => updateAct({ waypointName: e.target.value })}
                                style={{
                                  width: 140,
                                  padding: '4px 6px',
                                  background: '#141820',
                                  border: '1px solid var(--border)',
                                  color: '#fbbf24',
                                  borderRadius: 3,
                                  fontSize: 11,
                                }}
                              >
                                {builderWaypoints.map((wp) => (
                                  <option key={wp.id} value={wp.name}>
                                    {wp.name}
                                  </option>
                                ))}
                              </select>
                            )}

                            {act.kind === 'wait_for_trigger' && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                                <input
                                  placeholder="trig_drop_1"
                                  value={act.triggerName ?? 'trig_drop_1'}
                                  onChange={(e) => updateAct({ triggerName: e.target.value })}
                                  style={{
                                    width: 115,
                                    padding: '4px 6px',
                                    background: '#141820',
                                    border: '1px solid var(--border)',
                                    color: '#4ade80',
                                    borderRadius: 3,
                                    fontSize: 11,
                                    fontFamily: 'var(--mono-font)',
                                  }}
                                />
                                <select
                                  title="3D Waypoint defining where this trigger volume sits on the map"
                                  value={
                                    act.waypointName ??
                                    builderWaypoints.find((w) => w.name.includes('trig'))?.name ??
                                    ''
                                  }
                                  onChange={(e) => updateAct({ waypointName: e.target.value })}
                                  style={{
                                    width: 115,
                                    padding: '4px 6px',
                                    background: '#141820',
                                    border: '1px solid var(--border)',
                                    color: '#fbbf24',
                                    borderRadius: 3,
                                    fontSize: 10.5,
                                  }}
                                >
                                  {builderWaypoints
                                    .filter((w) => !w.name.startsWith('cam_'))
                                    .map((wp) => (
                                      <option key={wp.id} value={wp.name}>
                                        📍 {wp.name}
                                      </option>
                                    ))}
                                </select>
                                <button
                                  title="Snap this trigger volume waypoint to ground level right in front of Player Spawn so the player immediately triggers it"
                                  onClick={() => {
                                    updateSelectedTrack((trk) => {
                                      const existingTrigWp =
                                        trk.waypoints.find((w) => w.name === act.waypointName && !trk.flightChain.includes(w.name)) ??
                                        trk.waypoints.find((w) => w.name.includes('trig'));
                                      if (existingTrigWp) {
                                        setSelectedWaypointId(existingTrigWp.id);
                                        return {
                                          ...trk,
                                          waypoints: trk.waypoints.map((w) =>
                                            w.id === existingTrigWp.id
                                              ? { ...w, xOffset: 4, yOffset: 0, zOffset: 0.5 }
                                              : w,
                                          ),
                                          actions: trk.actions.map((a) =>
                                            a.id === act.id ? { ...a, waypointName: existingTrigWp.name } : a,
                                          ),
                                        };
                                      }
                                      const newTrigId = `${trk.id}-trig-${Date.now()}`;
                                      const newTrigName = `wp_trig_1`;
                                      setSelectedWaypointId(newTrigId);
                                      return {
                                        ...trk,
                                        waypoints: [
                                          { id: newTrigId, name: newTrigName, xOffset: 4, yOffset: 0, zOffset: 0.5 },
                                          ...trk.waypoints,
                                        ],
                                        actions: trk.actions.map((a) =>
                                          a.id === act.id ? { ...a, waypointName: newTrigName } : a,
                                        ),
                                      };
                                    });
                                    setStatusMessage('Snapped Trigger Volume waypoint right in front of Player Spawn (+4m, 0m, +0.5m)! Click "Generate .hsc & Compile" to apply.');
                                  }}
                                  style={{
                                    padding: '3px 7px',
                                    fontSize: 10,
                                    fontWeight: 700,
                                    background: 'rgba(34, 197, 94, 0.18)',
                                    border: '1px solid rgba(34, 197, 94, 0.45)',
                                    color: '#4ade80',
                                    borderRadius: 3,
                                    cursor: 'pointer',
                                  }}
                                >
                                  📍 Snap Trigger to Spawn
                                </button>
                                <span style={{ fontSize: 9.5, color: 'var(--text-dim)' }}>Poll:</span>
                                <input
                                  type="number"
                                  min="1"
                                  max="120"
                                  title="Polling interval in ticks (15 ticks = 0.5s)"
                                  value={act.sleepTicks ?? 15}
                                  onChange={(e) => updateAct({ sleepTicks: Math.max(1, Number(e.target.value)) })}
                                  style={{
                                    width: 44,
                                    padding: '3px 4px',
                                    background: '#141820',
                                    border: '1px solid var(--border)',
                                    color: 'var(--text-secondary)',
                                    borderRadius: 3,
                                    fontSize: 10.5,
                                  }}
                                />
                                <span style={{ fontSize: 9.5, color: 'var(--text-dim)' }}>t</span>
                              </div>
                            )}

                            {(act.kind === 'migrate_to_encounter' || act.kind === 'operate_device_door') && (
                              <input
                                placeholder={
                                  act.kind === 'migrate_to_encounter' ? 'target_encounter' : 'blast_door_1'
                                }
                                value={
                                  act.targetName ??
                                  (act.kind === 'migrate_to_encounter' ? 'unsc_marines_2' : 'blast_door_1')
                                }
                                onChange={(e) => updateAct({ targetName: e.target.value })}
                                style={{
                                  width: 140,
                                  padding: '4px 6px',
                                  background: '#141820',
                                  border: '1px solid var(--border)',
                                  color: '#38bdf8',
                                  borderRadius: 3,
                                  fontSize: 11,
                                  fontFamily: 'var(--mono-font)',
                                }}
                              />
                            )}

                            {act.kind === 'open_bay_doors' && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Sleep:</span>
                                <input
                                  type="number"
                                  min="1"
                                  max="600"
                                  value={act.sleepTicks ?? 45}
                                  onChange={(e) => updateAct({ sleepTicks: Math.max(1, Number(e.target.value)) })}
                                  style={{
                                    width: 55,
                                    padding: '3px 5px',
                                    background: '#141820',
                                    border: '1px solid var(--border)',
                                    color: '#fbbf24',
                                    borderRadius: 3,
                                    fontSize: 10.5,
                                  }}
                                />
                                <span style={{ fontSize: 9.5, color: 'var(--text-dim)' }}>ticks</span>
                              </div>
                            )}

                            {act.kind === 'unload_cargo_and_troops' && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span style={{ fontSize: 10, color: 'var(--text-dim)' }} title="Sleep ticks after dropping vehicle before unloading infantry">
                                  Drop Sleep:
                                </span>
                                <input
                                  type="number"
                                  min="1"
                                  max="600"
                                  value={act.sleepTicks ?? 25}
                                  onChange={(e) => updateAct({ sleepTicks: Math.max(1, Number(e.target.value)) })}
                                  style={{
                                    width: 55,
                                    padding: '3px 5px',
                                    background: '#141820',
                                    border: '1px solid var(--border)',
                                    color: '#fbbf24',
                                    borderRadius: 3,
                                    fontSize: 10.5,
                                  }}
                                />
                                <span style={{ fontSize: 9.5, color: 'var(--text-dim)' }}>ticks</span>
                              </div>
                            )}

                            {act.kind === 'fly_away_and_despawn' && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span style={{ fontSize: 10, color: 'var(--text-dim)' }} title="Minimum sleep ticks before despawning departing dropship (30 ticks = 1s)">
                                  Min Fly-Out Sleep:
                                </span>
                                <input
                                  type="number"
                                  min="30"
                                  max="3600"
                                  value={act.sleepTicks ?? 210}
                                  onChange={(e) => updateAct({ sleepTicks: Math.max(30, Number(e.target.value)) })}
                                  style={{
                                    width: 60,
                                    padding: '3px 5px',
                                    background: '#141820',
                                    border: '1px solid var(--border)',
                                    color: '#fbbf24',
                                    borderRadius: 3,
                                    fontSize: 10.5,
                                  }}
                                />
                                <span style={{ fontSize: 9.5, color: 'var(--text-dim)' }}>
                                  ticks ({((act.sleepTicks ?? 210) / 30).toFixed(1)}s)
                                </span>
                              </div>
                            )}

                            {act.kind === 'delay_seconds' && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span style={{ fontSize: 10, color: '#fbbf24', fontWeight: 600 }}>Seconds:</span>
                                <input
                                  type="number"
                                  step="0.5"
                                  min="0.1"
                                  max="300"
                                  value={
                                    act.seconds ??
                                    Number(((act.sleepTicks ?? 90) / 30).toFixed(2))
                                  }
                                  onChange={(e) => {
                                    const secs = Math.max(0.05, Number(e.target.value));
                                    updateAct({
                                      seconds: secs,
                                      sleepTicks: Math.max(1, Math.round(secs * 30)),
                                    });
                                  }}
                                  style={{
                                    width: 58,
                                    padding: '4px 6px',
                                    background: '#141820',
                                    border: '1px solid var(--border)',
                                    color: '#fbbf24',
                                    borderRadius: 3,
                                    fontSize: 11,
                                  }}
                                />
                                <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Ticks (30/s):</span>
                                <input
                                  type="number"
                                  step="5"
                                  min="1"
                                  max="9000"
                                  value={
                                    act.sleepTicks ??
                                    Math.max(1, Math.round((act.seconds ?? 3) * 30))
                                  }
                                  onChange={(e) => {
                                    const tks = Math.max(1, Math.round(Number(e.target.value)));
                                    updateAct({
                                      sleepTicks: tks,
                                      seconds: Number((tks / 30).toFixed(2)),
                                    });
                                  }}
                                  style={{
                                    width: 64,
                                    padding: '4px 6px',
                                    background: '#141820',
                                    border: '1px solid var(--border)',
                                    color: '#38bdf8',
                                    borderRadius: 3,
                                    fontSize: 11,
                                  }}
                                />
                              </div>
                            )}

                            {act.kind === 'show_cutscene_title' && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 10, color: '#c084fc', fontWeight: 600 }}>Title Name:</span>
                                <input
                                  placeholder="chapter_1"
                                  value={act.targetName ?? 'chapter_1'}
                                  onChange={(e) => updateAct({ targetName: e.target.value })}
                                  style={{
                                    width: 120,
                                    padding: '4px 6px',
                                    background: '#141820',
                                    border: '1px solid var(--border)',
                                    color: '#c084fc',
                                    borderRadius: 3,
                                    fontSize: 11,
                                    fontFamily: 'var(--mono-font)',
                                  }}
                                />
                                <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Hold (s):</span>
                                <input
                                  type="number"
                                  step="0.5"
                                  min="1"
                                  max="30"
                                  value={act.seconds ?? 4}
                                  onChange={(e) => updateAct({ seconds: Math.max(1, Number(e.target.value)) })}
                                  style={{
                                    width: 52,
                                    padding: '4px 6px',
                                    background: '#141820',
                                    border: '1px solid var(--border)',
                                    color: '#fbbf24',
                                    borderRadius: 3,
                                    fontSize: 11,
                                  }}
                                />
                              </div>
                            )}

                            {act.kind === 'wait_until_wave_cleared' && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 10, color: '#f87171', fontWeight: 600 }}>Encounter:</span>
                                <input
                                  placeholder={selectedTrack.encounterName || 'cov_elites_1'}
                                  value={act.targetName ?? (selectedTrack.encounterName || 'cov_elites_1')}
                                  onChange={(e) => updateAct({ targetName: e.target.value })}
                                  style={{
                                    width: 125,
                                    padding: '4px 6px',
                                    background: '#141820',
                                    border: '1px solid var(--border)',
                                    color: '#f87171',
                                    borderRadius: 3,
                                    fontSize: 11,
                                    fontFamily: 'var(--mono-font)',
                                  }}
                                />
                                <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Alive ≤:</span>
                                <input
                                  type="number"
                                  min="0"
                                  max="32"
                                  value={act.sleepTicks ?? 0}
                                  onChange={(e) => updateAct({ sleepTicks: Math.max(0, Math.round(Number(e.target.value))) })}
                                  style={{
                                    width: 48,
                                    padding: '4px 6px',
                                    background: '#141820',
                                    border: '1px solid var(--border)',
                                    color: '#fbbf24',
                                    borderRadius: 3,
                                    fontSize: 11,
                                  }}
                                />
                              </div>
                            )}

                            <button
                              onClick={() =>
                                setBuilderTracks((prev) =>
                                  prev.map((t) =>
                                    t.id === selectedTrack.id
                                      ? { ...t, actions: t.actions.filter((a) => a.id !== act.id) }
                                      : t,
                                  ),
                                )
                              }
                              style={{
                                padding: '2px 7px',
                                fontSize: 10.5,
                                background: 'rgba(239, 68, 68, 0.16)',
                                border: '1px solid rgba(239, 68, 68, 0.4)',
                                color: '#f87171',
                                borderRadius: 3,
                                cursor: 'pointer',
                                marginLeft: 'auto',
                              }}
                            >
                              Remove
                            </button>
                          </div>

                          {/* Rich Cutscene Camera Transition & Sleep Timing Editor */}
                          {act.kind === 'cutscene_camera_pan' && (() => {
                            const camList =
                              trackCamNames.length >= 1
                                ? trackCamNames
                                : [act.waypointName || 'cam_drop_1_1', act.targetName || 'cam_drop_1_2'];
                            const stepMoveTicks = Math.max(
                              15,
                              Math.round(act.camStepMoveTicks ?? (act.seconds ?? 4) * 30),
                            );
                            const stepSleepTicks = Math.max(
                              15,
                              Math.round(act.camStepSleepTicks ?? stepMoveTicks),
                            );
                            const initHoldTicks = Math.max(0, Math.round(act.camInitialHoldTicks ?? 30));

                            const applyUniformCameraTiming = (
                              newStepMoveTicks: number,
                              newStepSleepTicks: number,
                              newInitHoldTicks: number,
                            ) => {
                              const syncedStepSleep = Math.max(newStepMoveTicks, newStepSleepTicks);
                              const nextShots: BuilderCameraShotTiming[] = camList.map((cn, idx) => ({
                                camName: cn,
                                moveTicks: idx === 0 ? 0 : newStepMoveTicks,
                                sleepTicks:
                                  idx === 0
                                    ? camList.length <= 1
                                      ? syncedStepSleep
                                      : newInitHoldTicks
                                    : syncedStepSleep,
                              }));
                              updateAct({
                                seconds: Number((newStepMoveTicks / 30).toFixed(2)),
                                camStepMoveTicks: newStepMoveTicks,
                                camStepSleepTicks: syncedStepSleep,
                                camInitialHoldTicks: newInitHoldTicks,
                                cameraTimings: nextShots,
                              });
                            };

                            return (
                              <div
                                data-testid="hs-cutscene-timing-editor"
                                style={{
                                  marginTop: 2,
                                  padding: '8px 10px',
                                  background: 'rgba(192, 132, 252, 0.08)',
                                  border: '1px solid rgba(192, 132, 252, 0.3)',
                                  borderRadius: 4,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 7,
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                                  <span style={{ fontSize: 10.5, fontWeight: 700, color: '#c084fc' }}>
                                    🎥 Cutscene Camera Speed &amp; Sleep Editor ({camList.join(' → ')}) — 30 Ticks = 1.0 Sec
                                  </span>
                                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                    <button
                                      type="button"
                                      title="Set 6.0s (180 ticks) transition + 6.0s sleep per camera (Slow Cinematic)"
                                      onClick={() => applyUniformCameraTiming(180, 180, 45)}
                                      style={{
                                        padding: '2px 6px',
                                        fontSize: 9.5,
                                        fontWeight: 700,
                                        background: 'rgba(192, 132, 252, 0.18)',
                                        border: '1px solid rgba(192, 132, 252, 0.45)',
                                        color: '#e9d5ff',
                                        borderRadius: 3,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      🐢 Slow (6s / 180t per cam)
                                    </button>
                                    <button
                                      type="button"
                                      title="Set 4.0s (120 ticks) transition + 4.0s sleep per camera (Standard)"
                                      onClick={() => applyUniformCameraTiming(120, 120, 30)}
                                      style={{
                                        padding: '2px 6px',
                                        fontSize: 9.5,
                                        fontWeight: 700,
                                        background: 'rgba(56, 189, 248, 0.16)',
                                        border: '1px solid rgba(56, 189, 248, 0.45)',
                                        color: '#bae6fd',
                                        borderRadius: 3,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      🎬 Medium (4s / 120t per cam)
                                    </button>
                                    <button
                                      type="button"
                                      title="Simulate the exact 30 Hz Halo CE Pelican physics (including initial acceleration, turn banking, and landing deceleration) and sync every camera's move + sleep ticks to the Pelican's real position!"
                                      onClick={() => {
                                        const chainWps = selectedTrack.flightChain
                                          .map((nm) => builderWaypoints.find((w) => w.name === nm))
                                          .filter(Boolean) as BuilderWaypoint[];
                                        const chainWorldPts = chainWps.map((w) => ({
                                          x: playerAnchor.x + w.xOffset,
                                          y: playerAnchor.y + w.yOffset,
                                          z: playerAnchor.z + w.zOffset,
                                        }));
                                        let totalDist = 0;
                                        for (let i = 1; i < chainWorldPts.length; i++) {
                                          const a = chainWorldPts[i - 1]!;
                                          const b = chainWorldPts[i]!;
                                          totalDist += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
                                        }
                                        const sim = buildRecordedFlightStreamFromWaypoints(
                                          chainWorldPts.length >= 2
                                            ? chainWorldPts
                                            : [
                                                { x: 0, y: 0, z: 10 },
                                                { x: 60, y: 0, z: 2 },
                                              ],
                                          false,
                                        );
                                        const samples = sim.trajectorySamples;
                                        const totalFlightTicks = Math.max(180, sim.totalTicks);

                                        // Find the exact simulated tick where the Pelican is closest to each camera point in 3D space
                                        const rawCamTicks: number[] = camList.map((camNm, idx) => {
                                          if (idx === 0) return 0;
                                          if (idx === camList.length - 1) return Math.max(90, totalFlightTicks - 75);
                                          const camWp = builderWaypoints.find((w) => w.name === camNm);
                                          if (!camWp || samples.length === 0) {
                                            return Math.round((idx / Math.max(1, camList.length - 1)) * (totalFlightTicks - 75));
                                          }
                                          const cx = playerAnchor.x + camWp.xOffset;
                                          const cy = playerAnchor.y + camWp.yOffset;
                                          const cz = playerAnchor.z + camWp.zOffset;
                                          let bestTick = Math.round((idx / Math.max(1, camList.length - 1)) * (totalFlightTicks - 75));
                                          let bestDist = Infinity;
                                          for (const s of samples) {
                                            const d = Math.hypot(s.x - cx, s.y - cy, (s.z - cz) * 0.5);
                                            if (d < bestDist) {
                                              bestDist = d;
                                              bestTick = s.tick;
                                            }
                                          }
                                          return bestTick;
                                        });

                                        // Ensure strictly increasing arrival ticks across the camera sequence
                                        for (let i = 1; i < rawCamTicks.length; i++) {
                                          if (rawCamTicks[i]! <= rawCamTicks[i - 1]! + 45) {
                                            rawCamTicks[i] = rawCamTicks[i - 1]! + 60;
                                          }
                                        }

                                        // Hold on Camera #1 for 30 ticks while the Pelican accelerates off the start waypoint,
                                        // then pan continuously through each intermediate camera alongside the Pelican,
                                        // and hold on the final LZ camera until the Pelican finishes landing!
                                        const hold0 = 30;
                                        let elapsedTicks = hold0;
                                        const syncedTimings = camList.map((camNm, idx) => {
                                          if (idx === 0) {
                                            return { camName: camNm, moveTicks: 0, sleepTicks: hold0 };
                                          }
                                          const isLast = idx === camList.length - 1;
                                          const targetArrival = rawCamTicks[idx]!;
                                          const moveTicks = Math.max(
                                            45,
                                            Math.round((targetArrival - elapsedTicks) / 5) * 5,
                                          );
                                          const desiredStepSleep = isLast
                                            ? Math.max(
                                                moveTicks + 30,
                                                Math.round((totalFlightTicks - elapsedTicks) / 5) * 5,
                                              )
                                            : moveTicks;
                                          elapsedTicks += desiredStepSleep;
                                          return {
                                            camName: camNm,
                                            moveTicks,
                                            sleepTicks: desiredStepSleep,
                                          };
                                        });

                                        const avgMove =
                                          syncedTimings.length > 1
                                            ? Math.round(
                                                syncedTimings
                                                  .slice(1)
                                                  .reduce((acc, s) => acc + s.moveTicks, 0) /
                                                  (syncedTimings.length - 1),
                                              )
                                            : 120;
                                        const avgSleep =
                                          syncedTimings.length > 1
                                            ? Math.round(
                                                syncedTimings
                                                  .slice(1)
                                                  .reduce((acc, s) => acc + s.sleepTicks, 0) /
                                                  (syncedTimings.length - 1),
                                              )
                                            : 120;

                                        updateAct({
                                          seconds: Number((avgMove / 30).toFixed(2)),
                                          camStepMoveTicks: avgMove,
                                          camStepSleepTicks: avgSleep,
                                          camInitialHoldTicks: hold0,
                                          cameraTimings: syncedTimings,
                                        });
                                        setStatusMessage(
                                          `Synced ${camList.length} cameras to exact Pelican physics simulation (${totalDist.toFixed(0)} wu, ${totalFlightTicks} ticks / ${(totalFlightTicks / 30).toFixed(1)}s including acceleration & landing flare)! Click "Generate & Compile" to apply.`,
                                        );
                                      }}
                                      style={{
                                        padding: '2px 7px',
                                        fontSize: 9.5,
                                        fontWeight: 700,
                                        background: 'rgba(34, 197, 94, 0.2)',
                                        border: '1px solid rgba(34, 197, 94, 0.5)',
                                        color: '#4ade80',
                                        borderRadius: 3,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      ✈ Match Flight Time
                                    </button>
                                    <button
                                      type="button"
                                      title="Snap/align the Pelican's 3D flight path waypoints directly along the Cutscene Camera Track (offset slightly in front of each camera at matching altitudes) and sync camera timings!"
                                      onClick={() => {
                                        const camWps = camList
                                          .map((nm) => builderWaypoints.find((w) => w.name === nm))
                                          .filter(Boolean) as BuilderWaypoint[];
                                        if (camWps.length < 2) {
                                          setStatusMessage('Add at least 2 camera points (cam_*) to snap the flight path to the camera track.');
                                          return;
                                        }
                                        const safeId = selectedTrack.id.replace(/[^a-zA-Z0-9_]/g, '_');
                                        const startName = selectedTrack.flightChain[0] || `wp_${safeId}_start`;
                                        const lzName =
                                          selectedTrack.flightChain[selectedTrack.flightChain.length - 1] || `wp_${safeId}_lz`;

                                        const newFlightChain: string[] = [];
                                        const updatedFlightWps: BuilderWaypoint[] = camWps.map((cw, idx) => {
                                          const isFirst = idx === 0;
                                          const isLast = idx === camWps.length - 1;
                                          const wpName = isFirst
                                            ? startName
                                            : isLast
                                              ? lzName
                                              : `wp_${safeId}_turn_${idx}`;
                                          newFlightChain.push(wpName);
                                          const existing = builderWaypoints.find((w) => w.name === wpName);
                                          // Offset slightly in front of each camera along the camera track direction so the Pelican stays in frame
                                          const nextCw = camWps[Math.min(camWps.length - 1, idx + 1)]!;
                                          const prevCw = camWps[Math.max(0, idx - 1)]!;
                                          const dirX = nextCw.xOffset - prevCw.xOffset;
                                          const dirY = nextCw.yOffset - prevCw.yOffset;
                                          const dirLen = Math.hypot(dirX, dirY) || 1;
                                          const ux = dirX / dirLen;
                                          const uy = dirY / dirLen;
                                          const fwdLead = isFirst ? 5.0 : isLast ? 4.5 : 6.0;
                                          const zAdjust = isLast ? -1.8 : -0.5;
                                          return {
                                            id: existing?.id ?? `${selectedTrack.id}-wp-snap-${idx + 1}`,
                                            name: wpName,
                                            xOffset: Number((cw.xOffset + ux * fwdLead).toFixed(2)),
                                            yOffset: Number((cw.yOffset + uy * fwdLead).toFixed(2)),
                                            zOffset: Number((cw.zOffset + zAdjust).toFixed(2)),
                                          };
                                        });

                                        const chainWorldPts = updatedFlightWps.map((w) => ({
                                          x: playerAnchor.x + w.xOffset,
                                          y: playerAnchor.y + w.yOffset,
                                          z: playerAnchor.z + w.zOffset,
                                        }));
                                        const sim = buildRecordedFlightStreamFromWaypoints(chainWorldPts, false);
                                        const totalFlightTicks = Math.max(180, sim.totalTicks);
                                        const hold0 = 30;
                                        let elapsedTicks = hold0;
                                        const syncedTimings = camList.map((camNm, idx) => {
                                          if (idx === 0) {
                                            return { camName: camNm, moveTicks: 0, sleepTicks: hold0 };
                                          }
                                          const isLast = idx === camList.length - 1;
                                          const targetArrival = isLast
                                            ? Math.max(90, totalFlightTicks - 75)
                                            : sim.waypointArrivalTicks[idx] ||
                                              Math.round((idx / Math.max(1, camList.length - 1)) * (totalFlightTicks - 75));
                                          const moveTicks = Math.max(45, Math.round((targetArrival - elapsedTicks) / 5) * 5);
                                          const desiredStepSleep = isLast
                                            ? Math.max(
                                                moveTicks + 30,
                                                Math.round((totalFlightTicks - elapsedTicks) / 5) * 5,
                                              )
                                            : moveTicks;
                                          elapsedTicks += desiredStepSleep;
                                          return { camName: camNm, moveTicks, sleepTicks: desiredStepSleep };
                                        });

                                        const avgMove =
                                          syncedTimings.length > 1
                                            ? Math.round(
                                                syncedTimings.slice(1).reduce((acc, s) => acc + s.moveTicks, 0) /
                                                  (syncedTimings.length - 1),
                                              )
                                            : 120;
                                        const avgSleep =
                                          syncedTimings.length > 1
                                            ? Math.round(
                                                syncedTimings.slice(1).reduce((acc, s) => acc + s.sleepTicks, 0) /
                                                  (syncedTimings.length - 1),
                                              )
                                            : 120;

                                        setBuilderTracks((prev) => {
                                          const nextTracks = prev.map((t) => {
                                            if (t.id !== selectedTrack.id) return t;
                                            const nonApproachWps = t.waypoints.filter(
                                              (w) =>
                                                !t.flightChain.includes(w.name) &&
                                                !newFlightChain.includes(w.name),
                                            );
                                            const nextExitChain =
                                              t.exitFlightChain && t.exitFlightChain.length >= 2
                                                ? [lzName, ...t.exitFlightChain.slice(1)]
                                                : [...newFlightChain].reverse();
                                            return {
                                              ...t,
                                              waypoints: [...nonApproachWps, ...updatedFlightWps],
                                              flightChain: newFlightChain,
                                              exitFlightChain: nextExitChain,
                                              actions: t.actions.map((a) =>
                                                a.id === act.id
                                                  ? {
                                                      ...a,
                                                      seconds: Number((avgMove / 30).toFixed(2)),
                                                      camStepMoveTicks: avgMove,
                                                      camStepSleepTicks: avgSleep,
                                                      camInitialHoldTicks: hold0,
                                                      cameraTimings: syncedTimings,
                                                    }
                                                  : a,
                                              ),
                                            };
                                          });
                                          setHscSource(generateHscFromBuilder(nextTracks));
                                          return nextTracks;
                                        });
                                        setStatusMessage(
                                          `Aligned ${updatedFlightWps.length} flight waypoints directly along the ${camWps.length}-camera track and synced camera timings (${totalFlightTicks} ticks / ${(totalFlightTicks / 30).toFixed(1)}s)!`,
                                        );
                                      }}
                                      style={{
                                        padding: '2px 7px',
                                        fontSize: 9.5,
                                        fontWeight: 700,
                                        background: 'rgba(192, 132, 252, 0.18)',
                                        border: '1px solid rgba(192, 132, 252, 0.5)',
                                        color: '#e9d5ff',
                                        borderRadius: 3,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      🛤 Snap Flight to Cameras
                                    </button>
                                  </div>
                                </div>

                                {/* All-Camera Default Controls (Seconds & Ticks) */}
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', fontSize: 10 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Pan Time / Cam (s):</span>
                                    <input
                                      type="number"
                                      step="0.5"
                                      min="0.5"
                                      max="60"
                                      value={Number((stepMoveTicks / 30).toFixed(2))}
                                      onChange={(e) => {
                                        const tks = Math.max(15, Math.round(Number(e.target.value) * 30));
                                        applyUniformCameraTiming(tks, tks, initHoldTicks);
                                      }}
                                      style={{
                                        width: 52,
                                        padding: '3px 5px',
                                        background: '#141820',
                                        border: '1px solid var(--border)',
                                        color: '#c084fc',
                                        borderRadius: 3,
                                        fontSize: 10.5,
                                      }}
                                    />
                                    <span style={{ color: 'var(--text-dim)' }}>({stepMoveTicks}t)</span>
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Sleep / Cam (ticks):</span>
                                    <input
                                      type="number"
                                      step="15"
                                      min="15"
                                      max="3600"
                                      value={stepSleepTicks}
                                      onChange={(e) => {
                                        const sTks = Math.max(15, Math.round(Number(e.target.value)));
                                        applyUniformCameraTiming(stepMoveTicks, sTks, initHoldTicks);
                                      }}
                                      style={{
                                        width: 56,
                                        padding: '3px 5px',
                                        background: '#141820',
                                        border: '1px solid var(--border)',
                                        color: '#fbbf24',
                                        borderRadius: 3,
                                        fontSize: 10.5,
                                      }}
                                    />
                                    <span style={{ color: 'var(--text-dim)' }}>
                                      ({(stepSleepTicks / 30).toFixed(1)}s)
                                    </span>
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ color: 'var(--text-secondary)' }} title="Hold/sleep ticks on the 1st camera (cam_1) before starting to move toward cam_2">
                                      Cam #1 Hold (ticks):
                                    </span>
                                    <input
                                      type="number"
                                      step="15"
                                      min="0"
                                      max="1800"
                                      value={initHoldTicks}
                                      onChange={(e) => {
                                        const hTks = Math.max(0, Math.round(Number(e.target.value)));
                                        applyUniformCameraTiming(stepMoveTicks, stepSleepTicks, hTks);
                                      }}
                                      style={{
                                        width: 52,
                                        padding: '3px 5px',
                                        background: '#141820',
                                        border: '1px solid var(--border)',
                                        color: '#38bdf8',
                                        borderRadius: 3,
                                        fontSize: 10.5,
                                      }}
                                    />
                                  </div>
                                </div>

                                {/* Per-Camera Shot Table: (camera_set <cam> <moveTicks>) + (sleep <sleepTicks>) */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  {camList.map((camNm, cIdx) => {
                                    const shot =
                                      act.cameraTimings?.find((ct) => ct.camName === camNm) ??
                                      act.cameraTimings?.[cIdx];
                                    const curMove =
                                      shot !== undefined
                                        ? shot.moveTicks
                                        : cIdx === 0
                                          ? 0
                                          : stepMoveTicks;
                                    const rawCurSleep =
                                      shot !== undefined
                                        ? shot.sleepTicks
                                        : cIdx === 0
                                          ? camList.length <= 1
                                            ? stepSleepTicks
                                            : initHoldTicks
                                          : stepSleepTicks;
                                    const curSleep = curMove > 0 ? Math.max(curMove, rawCurSleep) : rawCurSleep;
                                    const curHoldAfterMove = Math.max(0, curSleep - curMove);
                                    const updateThisCameraShot = (nextMove: number, nextSleep: number) => {
                                      const clampedMove = Math.max(0, Math.round(nextMove));
                                      const clampedSleep =
                                        clampedMove > 0
                                          ? Math.max(clampedMove, Math.round(nextSleep))
                                          : Math.max(0, Math.round(nextSleep));
                                      const baseList: BuilderCameraShotTiming[] = camList.map((cn, idx) => {
                                        const ex =
                                          act.cameraTimings?.find((ct) => ct.camName === cn) ??
                                          act.cameraTimings?.[idx];
                                        const m = ex !== undefined ? ex.moveTicks : idx === 0 ? 0 : stepMoveTicks;
                                        const s =
                                          ex !== undefined
                                            ? ex.sleepTicks
                                            : idx === 0
                                              ? camList.length <= 1
                                                ? stepSleepTicks
                                                : initHoldTicks
                                              : stepSleepTicks;
                                        return {
                                          camName: cn,
                                          moveTicks: m,
                                          sleepTicks: m > 0 ? Math.max(m, s) : s,
                                        };
                                      });
                                      baseList[cIdx] = {
                                        camName: camNm,
                                        moveTicks: clampedMove,
                                        sleepTicks: clampedSleep,
                                      };
                                      updateAct({
                                        cameraTimings: baseList,
                                        ...(cIdx === 0 ? { camInitialHoldTicks: clampedSleep } : {}),
                                        ...(cIdx === 1
                                          ? {
                                              camStepMoveTicks: Math.max(15, clampedMove),
                                              camStepSleepTicks: Math.max(15, clampedSleep),
                                              seconds: Number((Math.max(15, clampedMove) / 30).toFixed(2)),
                                            }
                                          : {}),
                                      });
                                    };
                                    return (
                                      <div
                                        key={`${camNm}-${cIdx}`}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                          gap: 8,
                                          padding: '3px 7px',
                                          background: 'rgba(0,0,0,0.32)',
                                          border: '1px solid rgba(255,255,255,0.08)',
                                          borderRadius: 3,
                                          fontSize: 10,
                                        }}
                                      >
                                        <span style={{ fontFamily: 'var(--mono-font)', color: '#e9d5ff', fontWeight: 700, minWidth: 110 }}>
                                          Shot #{cIdx + 1}: {camNm}
                                        </span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                          <span style={{ color: 'var(--text-dim)' }} title="Ticks for (camera_set <cam> <moveTicks>) to reach this camera point">
                                            <code>camera_set</code> Move Ticks:
                                          </span>
                                          <input
                                            type="number"
                                            step="15"
                                            min="0"
                                            max="3600"
                                            value={curMove}
                                            onChange={(e) => {
                                              const nextMove = Math.max(0, Math.round(Number(e.target.value)));
                                              updateThisCameraShot(nextMove, nextMove + curHoldAfterMove);
                                            }}
                                            style={{
                                              width: 56,
                                              padding: '2px 5px',
                                              background: '#141820',
                                              border: '1px solid var(--border)',
                                              color: '#c084fc',
                                              borderRadius: 3,
                                              fontSize: 10,
                                            }}
                                          />
                                          <span style={{ color: 'var(--text-dim)', minWidth: 36 }}>
                                            ({(curMove / 30).toFixed(1)}s)
                                          </span>
                                          {cIdx > 0 && (
                                            <>
                                              <span style={{ color: 'var(--text-dim)' }} title="Extra ticks to hold steady at this camera after arrival before advancing">
                                                Hold at Cam:
                                              </span>
                                              <input
                                                type="number"
                                                step="15"
                                                min="0"
                                                max="3600"
                                                value={curHoldAfterMove}
                                                onChange={(e) => {
                                                  const nextHold = Math.max(0, Math.round(Number(e.target.value)));
                                                  updateThisCameraShot(curMove, curMove + nextHold);
                                                }}
                                                style={{
                                                  width: 48,
                                                  padding: '2px 5px',
                                                  background: '#141820',
                                                  border: '1px solid var(--border)',
                                                  color: '#38bdf8',
                                                  borderRadius: 3,
                                                  fontSize: 10,
                                                }}
                                              />
                                            </>
                                          )}
                                          <span style={{ color: 'var(--text-dim)' }} title="Total (sleep <N>) ticks for this camera shot (Move Ticks + Hold at Cam)">
                                            <code>sleep</code> Total Ticks:
                                          </span>
                                          <input
                                            type="number"
                                            step="15"
                                            min={curMove}
                                            max="3600"
                                            value={curSleep}
                                            onChange={(e) => updateThisCameraShot(curMove, Number(e.target.value))}
                                            style={{
                                              width: 56,
                                              padding: '2px 5px',
                                              background: '#141820',
                                              border: '1px solid var(--border)',
                                              color: '#fbbf24',
                                              borderRadius: 3,
                                              fontSize: 10,
                                            }}
                                          />
                                          <span style={{ color: 'var(--text-dim)', minWidth: 36 }}>
                                            ({(curSleep / 30).toFixed(1)}s)
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {/* Left Column: Sample Scripts & Scenario Setup Wizard */}
          <div
            style={{
              width: 430,
              borderRight: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              background: 'rgba(0,0,0,0.18)',
              overflowY: 'auto',
              padding: 12,
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: 6 }}>
                SP / MP Sample Script Library & Guides
              </div>
              <select
                data-testid="hs-template-select"
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  background: 'var(--bg-input, #1e1e1e)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  color: 'var(--text-primary)',
                  fontSize: 11.5,
                }}
              >
                {HALOSCRIPT_SAMPLE_TEMPLATES.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.title}
                  </option>
                ))}
              </select>
            </div>

            <div
              style={{
                padding: 10,
                background: 'var(--bg-panel-header)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                fontSize: 11.5,
                lineHeight: 1.45,
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                {selectedTemplate.title}
              </div>
              <div style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>{selectedTemplate.summary}</div>

              <div style={{ fontWeight: 600, color: '#fbbf24', marginBottom: 4 }}>Step-by-Step Setup Guide:</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--text-dim)', fontSize: 11 }}>
                {selectedTemplate.requiredSetupGuide.map((step, i) => (
                  <div key={i}>{step}</div>
                ))}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                <button
                  data-testid="hs-auto-setup-entities-btn"
                  onClick={() => handleAutoSetupEntities(selectedTemplate)}
                  disabled={isBusy}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    fontSize: 11,
                    fontWeight: 600,
                    background: 'rgba(251, 191, 36, 0.16)',
                    border: '1px solid rgba(251, 191, 36, 0.45)',
                    color: '#fbbf24',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  Auto-Setup Scenario Entities
                </button>
                <button
                  data-testid="hs-load-template-btn"
                  onClick={() => setHscSource(selectedTemplate.hscSource)}
                  style={{
                    padding: '6px 8px',
                    fontSize: 11,
                    fontWeight: 600,
                    background: 'rgba(56, 189, 248, 0.16)',
                    border: '1px solid rgba(56, 189, 248, 0.45)',
                    color: '#38bdf8',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  Load Sample
                </button>
                <button
                  data-testid="hs-append-template-btn"
                  onClick={() => setHscSource((prev) => `${prev.trimEnd()}\n\n${selectedTemplate.hscSource}`)}
                  style={{
                    padding: '6px 8px',
                    fontSize: 11,
                    fontWeight: 600,
                    background: 'rgba(34, 197, 94, 0.16)',
                    border: '1px solid rgba(34, 197, 94, 0.45)',
                    color: '#4ade80',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  Append Sample
                </button>
              </div>
            </div>

            {/* Quick .HSC Directors: Firefight Waves, Mission Beats & Multi-Shot Cutscenes */}
            <div
              data-testid="hs-quick-directors-panel"
              style={{
                padding: 10,
                background: 'var(--bg-panel-header)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                fontSize: 11,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>
                Quick .HSC Directors (Firefight, Mission & Cutscene)
              </div>
              <div style={{ color: 'var(--text-dim)', fontSize: 10.5 }}>
                Generate structured HaloScript state machines using your map&apos;s encounters, triggers, and camera points:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                <button
                  data-testid="hs-gen-firefight-btn"
                  onClick={() => {
                    const res = exportHaloCeFirefight({
                      schemaVersion: 1,
                      rounds: 2,
                      maxAlive: 16,
                      intermissionMs: 5000,
                      enemies: [
                        { id: 'covenant_grunts', label: 'Covenant Grunts' },
                        { id: 'covenant_elites', label: 'Covenant Elites' },
                        { id: 'covenant_hunters', label: 'Covenant Hunters' },
                      ],
                      waves: [
                        { name: 'Recon Wave', groups: [{ enemyId: 'covenant_grunts', count: 4 }, { enemyId: 'covenant_elites', count: 2 }] },
                        { name: 'Assault Wave', groups: [{ enemyId: 'covenant_elites', count: 4 }] },
                        { name: 'Boss Wave', groups: [{ enemyId: 'covenant_hunters', count: 2 }] },
                      ],
                    });
                    setHscSource((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${res.content}` : res.content));
                    setStatusMessage(`Appended Firefight Wave Survival script (${res.filename}).`);
                  }}
                  style={{
                    flex: 1,
                    padding: '5px 8px',
                    fontSize: 10.5,
                    fontWeight: 700,
                    background: 'rgba(249, 115, 22, 0.16)',
                    border: '1px solid rgba(249, 115, 22, 0.45)',
                    color: '#fb923c',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                  title="Generate a finite-wave Firefight Survival script with multi-round wave progression and AI living-count gates"
                >
                  + Firefight Waves
                </button>
                <button
                  data-testid="hs-gen-mission-beats-btn"
                  onClick={() => {
                    const enc1 = scenarioEntities.encounters[0] ?? 'enc_lz_covenant';
                    const enc2 = scenarioEntities.encounters[1] ?? 'enc_bunker_elites';
                    const trig1 = scenarioEntities.triggerVolumes[0] ?? 'trig_enter_valley';
                    const res = exportHaloCeMission([
                      {
                        id: 'beat_1',
                        title: 'Advance to Valley',
                        objective: 'Enter the valley trigger volume',
                        trigger: 'triggerVolume',
                        encounterName: enc1,
                        triggerRef: trig1,
                      },
                      {
                        id: 'beat_2',
                        title: 'Clear Covenant Landing Zone',
                        objective: 'Eliminate all Covenant defenders',
                        trigger: 'encounterCleared',
                        encounterName: enc1,
                      },
                      {
                        id: 'beat_3',
                        title: 'Assault Bunker',
                        objective: 'Defeat the Elite garrison',
                        trigger: 'encounterCleared',
                        encounterName: enc2,
                      },
                    ]);
                    setHscSource((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${res.content}` : res.content));
                    setStatusMessage(`Appended Campaign Mission Beat Director (${res.filename}).`);
                  }}
                  style={{
                    flex: 1,
                    padding: '5px 8px',
                    fontSize: 10.5,
                    fontWeight: 700,
                    background: 'rgba(56, 189, 248, 0.16)',
                    border: '1px solid rgba(56, 189, 248, 0.45)',
                    color: '#38bdf8',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                  title="Generate sequential campaign mission beats with trigger volumes and guarded AI encounter waves"
                >
                  + Mission Beats
                </button>
                <button
                  data-testid="hs-gen-cutscene-btn"
                  onClick={() => {
                    const cams =
                      scenarioEntities.cutsceneCameraPoints.length >= 2
                        ? scenarioEntities.cutsceneCameraPoints.slice(0, 3)
                        : ['cam_intro_1', 'cam_intro_2', 'cam_intro_3'];
                    const res = exportHaloCeCinematic(
                      cams.map((cp, idx) => ({
                        id: `shot_${idx + 1}`,
                        name: `Shot ${idx + 1}`,
                        durationMs: 3000,
                        cameraPosition: [idx * 5, 0, 2],
                        lookAt: [0, 0, 0],
                        fov: 70,
                        subtitle: `Cutscene camera shot ${idx + 1}`,
                        cameraMarker: cp,
                      })),
                    );
                    setHscSource((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${res.content}` : res.content));
                    setStatusMessage(`Appended Multi-Shot Cutscene Director (${res.filename}).`);
                  }}
                  style={{
                    flex: 1,
                    padding: '5px 8px',
                    fontSize: 10.5,
                    fontWeight: 700,
                    background: 'rgba(192, 132, 252, 0.16)',
                    border: '1px solid rgba(192, 132, 252, 0.45)',
                    color: '#c084fc',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                  title="Generate a multi-shot camera cutscene with letterbox, camera control, and camera point interpolation"
                >
                  + Cutscene Director
                </button>
              </div>
            </div>

            {/* Active Scripts List with 1-Click Delete */}
            <div
              style={{
                padding: 10,
                background: 'var(--bg-panel-header)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                fontSize: 11,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>
                  Active Scripts in Editor ({parsedScriptBlocks.length})
                </span>
                {parsedScriptBlocks.length > 0 && (
                  <button
                    data-testid="hs-clear-all-scripts-btn"
                    onClick={handleClearAllScripts}
                    disabled={isBusy}
                    style={{
                      padding: '2px 7px',
                      fontSize: 10.5,
                      fontWeight: 600,
                      background: 'rgba(239, 68, 68, 0.18)',
                      border: '1px solid rgba(239, 68, 68, 0.45)',
                      color: '#f87171',
                      borderRadius: 3,
                      cursor: 'pointer',
                    }}
                  >
                    Clear All Scripts
                  </button>
                )}
              </div>
              {parsedScriptBlocks.length === 0 ? (
                <div style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>
                  No scripts currently in editor.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 150, overflowY: 'auto' }}>
                  {parsedScriptBlocks.map((sb, idx) => (
                    <div
                      key={`${sb.name}-${idx}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '4px 8px',
                        background: 'rgba(0,0,0,0.25)',
                        border: '1px solid var(--border)',
                        borderRadius: 3,
                      }}
                    >
                      <span style={{ fontFamily: 'var(--mono-font)', color: 'var(--text-primary)' }}>
                        <span style={{ color: '#38bdf8' }}>[{sb.scriptType}]</span> {sb.name}
                      </span>
                      <button
                        data-testid={`hs-delete-script-${sb.name}`}
                        onClick={() => handleDeleteSingleScript(sb)}
                        disabled={isBusy}
                        title={`Delete script "${sb.name}" and recompile`}
                        style={{
                          padding: '2px 6px',
                          fontSize: 10.5,
                          fontWeight: 700,
                          background: 'rgba(239, 68, 68, 0.16)',
                          border: '1px solid rgba(239, 68, 68, 0.4)',
                          color: '#f87171',
                          borderRadius: 3,
                          cursor: 'pointer',
                        }}
                      >
                        ✕ Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Active Scenario Entities Inspector */}
            <div
              style={{
                padding: 10,
                background: 'var(--bg-panel-header)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                fontSize: 11,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>
                Scenario Script Entities in Current Map
              </div>
              <div>
                <strong>Object Names ({scenarioEntities.objectNames.length}):</strong>{' '}
                <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--mono-font)' }}>
                  {scenarioEntities.objectNames.join(', ') || '(none)'}
                </span>
              </div>
              <div>
                <strong>Trigger Volumes ({scenarioEntities.triggerVolumes.length}):</strong>{' '}
                <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--mono-font)' }}>
                  {scenarioEntities.triggerVolumes.join(', ') || '(none)'}
                </span>
              </div>
              <div>
                <strong>Cutscene Camera Points ({scenarioEntities.cutsceneCameraPoints.length}):</strong>{' '}
                <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--mono-font)' }}>
                  {scenarioEntities.cutsceneCameraPoints.join(', ') || '(none)'}
                </span>
              </div>
              <div>
                <strong>AI Encounters ({scenarioEntities.encounters.length}):</strong>{' '}
                <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--mono-font)' }}>
                  {scenarioEntities.encounters.join(', ') || '(none)'}
                </span>
              </div>
            </div>
          </div>

          {/* Right Column: HSC Code Editor & Compiler Output */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                borderBottom: '1px solid var(--border)',
                background: 'rgba(0,0,0,0.12)',
              }}
            >
              <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontFamily: 'var(--mono-font)' }}>
                scenario.hsc — Lisp S-Expression Editor
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  data-testid="hs-toolbar-clear-btn"
                  onClick={handleClearAllScripts}
                  disabled={isBusy}
                  style={{
                    padding: '5px 10px',
                    fontSize: 11,
                    fontWeight: 600,
                    background: 'rgba(239, 68, 68, 0.16)',
                    border: '1px solid rgba(239, 68, 68, 0.45)',
                    color: '#f87171',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  Clear All Scripts
                </button>
                <button
                  data-testid="hs-lint-btn"
                  onClick={handleLint}
                  style={{
                    padding: '5px 12px',
                    fontSize: 11,
                    fontWeight: 600,
                    background: 'rgba(56, 189, 248, 0.15)',
                    border: '1px solid rgba(56, 189, 248, 0.4)',
                    color: '#38bdf8',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >
                  Validate / Lint (.hsc)
                </button>
                <button
                  data-testid="hs-compile-btn"
                  onClick={handleCompileIntoScenario}
                  disabled={isBusy}
                  style={{
                    padding: '5px 14px',
                    fontSize: 11,
                    fontWeight: 700,
                    background: 'rgba(34, 197, 94, 0.2)',
                    border: '1px solid rgba(34, 197, 94, 0.5)',
                    color: '#4ade80',
                    borderRadius: 3,
                    cursor: isBusy ? 'wait' : 'pointer',
                  }}
                >
                  {isBusy ? 'Compiling...' : 'Compile into Scenario (In-Memory)'}
                </button>
              </div>
            </div>

            <textarea
              data-testid="hs-source-textarea"
              value={hscSource}
              onChange={(e) => setHscSource(e.target.value)}
              spellCheck={false}
              style={{
                flex: 1,
                width: '100%',
                boxSizing: 'border-box',
                background: '#0d1117',
                color: '#e6edf3',
                border: 'none',
                padding: 14,
                fontFamily: 'var(--mono-font)',
                fontSize: 12,
                lineHeight: 1.5,
                resize: 'none',
                outline: 'none',
              }}
            />

            {diagnostics.length > 0 && (
              <div
                data-testid="hs-diagnostics-list"
                style={{
                  maxHeight: 140,
                  overflowY: 'auto',
                  borderTop: '1px solid var(--border)',
                  background: 'rgba(0,0,0,0.35)',
                  padding: '8px 12px',
                }}
              >
                {diagnostics.map((d, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: 11,
                      fontFamily: 'var(--mono-font)',
                      color: d.severity === 'error' ? '#f87171' : '#fbbf24',
                      marginBottom: 3,
                    }}
                  >
                    [Line {d.line}] {d.severity.toUpperCase()}: {d.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

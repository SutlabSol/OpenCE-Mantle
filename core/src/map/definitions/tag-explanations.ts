/**
 * Comprehensive Tag Group & Field Explanation Dictionary for Halo: Custom Edition.
 * Synthesized from Bungie's official Guerilla `#explanation` strings (`tag_definitions.h`)
 * and HEK / MEK reference documentation across all 83 Halo 1 tag classes.
 */

export interface TagGroupExplanation {
  group: string;
  fourCC: string;
  title: string;
  summary: string;
  keyTips?: string;
}

export const TAG_GROUP_EXPLANATIONS: Record<string, TagGroupExplanation> = {
  actor: {
    group: 'actor',
    fourCC: 'actr',
    title: 'AI Actor Brain & Behavior Profile',
    summary:
      'Defines core AI intelligence: perception (vision cone, hearing distance), combat movement (dive, evade, cover seeking), grenade throwing logic, and berserk/flee triggers.',
    keyTips: 'Pair with an actor_variant (actv) to bind this AI brain to a specific Biped and Weapon.',
  },
  actor_variant: {
    group: 'actor_variant',
    fourCC: 'actv',
    title: 'AI Actor Variant (Biped + Weapon + Shield Loadout)',
    summary:
      'Combines an AI Actor brain (actr) with a specific Biped body (bipd), Weapon (weap), firing burst pattern, grenade count, and shield/health multipliers.',
    keyTips: 'Scenario AI Encounters reference actor_palette entries which point to actor_variant tags.',
  },
  antenna: {
    group: 'antenna',
    fourCC: 'ant!',
    title: 'Spring-Physics Flexible Antenna',
    summary:
      'Simulates flexible whip antennas (such as on the Warthog) using a chain of spring-mass vertices attached to a model marker.',
  },
  biped: {
    group: 'biped',
    fourCC: 'bipd',
    title: 'Character Unit (Player Spartan, Marine, Covenant, Flood)',
    summary:
      'Defines walking/jumping character physics, camera height, movement speeds, turning rates, collision pill dimensions, footsteps, and melee/boarding seat interactions.',
    keyTips: 'Edit "jump velocity", "walking speed", and "camera interpolation" here to customize player or NPC movement.',
  },
  bitmap: {
    group: 'bitmap',
    fourCC: 'bitm',
    title: '2D Texture, Sprite Sheet, Cubemap, or Volume Texture',
    summary:
      'Stores compressed (DXT1/DXT3/DXT5) or uncompressed (A8R8G8B8, R5G6B5, P8) pixel data, mipmap pyramids, and sprite sequence frames for shaders and HUD elements.',
    keyTips: 'Use "Open in Bitmap Editor" in the header to import/export PNG or DDS textures directly.',
  },
  camera_track: {
    group: 'camera_track',
    fourCC: 'trak',
    title: '3rd-Person Vehicle / Unit Camera Spline Track',
    summary:
      'Defines quaternion control points that control how the 3rd-person camera orbits and pitches around a vehicle or character.',
  },
  color_table: {
    group: 'color_table',
    fourCC: 'colo',
    title: 'Named Color Swatch Table',
    summary: 'Stores named RGB color entries referenced by UI widgets and multiplayer team color tables.',
  },
  continuous_damage_effect: {
    group: 'continuous_damage_effect',
    fourCC: 'cdmg',
    title: 'Per-Tick Continuous Area Damage & Camera Shake',
    summary: 'Applies ongoing per-tick damage, screen shake, and controller rumble while inside a damage zone or beam.',
  },
  contrail: {
    group: 'contrail',
    fourCC: 'cont',
    title: 'Ribbon Trail Effect (Sniper Trail, Banshee Wingtip)',
    summary: 'Renders a fading 3D ribbon strip behind moving projectiles or vehicle wingtips.',
  },
  damage_effect: {
    group: 'damage_effect',
    fourCC: 'jpt!',
    title: 'Instant Damage, Force Impulse, & Screen Shake',
    summary:
      'Defines hitscan/explosion damage bounds, armor piercing, shield/health multipliers per material type (cyborg, elite, flood, metal), knockback impulse ("instantaneous acceleration"), and camera shake.',
    keyTips: 'Increase "instantaneous acceleration" to launch vehicles/players with explosions or melee hits.',
  },
  decal: {
    group: 'decal',
    fourCC: 'deca',
    title: 'Surface Decal (Bullet Holes, Scorch Marks, Blood Splatters)',
    summary: 'Projects a 2D blended texture quad onto structure BSP triangles where projectiles hit or blood splashes.',
  },
  detail_object_collection: {
    group: 'detail_object_collection',
    fourCC: 'dobc',
    title: '3D Terrain Clutter Sprites (Grass, Pebbles, Shells)',
    summary: 'Defines small camera-facing or axial sprite billboards scattered densely across BSP terrain surfaces.',
  },
  device: {
    group: 'device',
    fourCC: 'devi',
    title: 'Base Interactive Device',
    summary: 'Base class for powered/positional mechanical doors, elevators, switches, and light fixtures.',
  },
  device_control: {
    group: 'device_control',
    fourCC: 'ctrl',
    title: 'Interactive Switch / Button / Holopanel',
    summary:
      'A player-activatable switch or touch panel that toggles a Scenario Device Group (opening doors, extending bridges, or triggering HaloScript events).',
  },
  device_light_fixture: {
    group: 'device_light_fixture',
    fourCC: 'lifi',
    title: 'Scriptable Light Fixture Object',
    summary: 'A placeable light fixture controlled by device power/position groups.',
  },
  device_machine: {
    group: 'device_machine',
    fourCC: 'mach',
    title: 'Mechanical Door, Elevator, or Extending Bridge',
    summary:
      'An animated mechanical object (door, lift, Hang Em High tombstone, forerunner bridge) driven by device groups or automatic proximity detection.',
    keyTips: 'Set "door" type and clear "does not operate automatically" so doors slide open when players approach.',
  },
  dialogue: {
    group: 'dialogue',
    fourCC: 'udlg',
    title: 'AI Combat Vocalization Set',
    summary: 'Maps AI combat states (spotted enemy, throwing grenade, ally killed, hurt, cheering) to sound tags.',
  },
  effect: {
    group: 'effect',
    fourCC: 'effe',
    title: 'Composite Visual/Audio/Particle Event Sequence',
    summary:
      'Orchestrates timed events (explosions, muzzle flashes, bullet impacts, footstep dust) that spawn particles, lights, sounds, decals, and damage effects.',
  },
  equipment: {
    group: 'equipment',
    fourCC: 'eqip',
    title: 'Pickup Powerup, Ammo Pack, Grenade, or Health Kit',
    summary:
      'Defines ground pickups that grant overshields, active camouflage, health, ammunition, or grenades when walked over.',
  },
  flag: {
    group: 'flag',
    fourCC: 'flag',
    title: 'Cloth-Simulated Flag Banner',
    summary: 'Defines cloth simulation grid, wind physics, and shaders for the CTF flag banner.',
  },
  fog: {
    group: 'fog',
    fourCC: 'fog ',
    title: 'Planar Water / Ground Fog Volume',
    summary: 'Defines volumetric fog plane color, maximum density, opaque depth, and animated mist layers.',
  },
  font: {
    group: 'font',
    fourCC: 'font',
    title: 'Bitmap Character Font Table',
    summary: 'Stores rasterized character glyphs, kerning pairs, and baseline metrics for HUD and menu text.',
  },
  garbage: {
    group: 'garbage',
    fourCC: 'garb',
    title: 'Debris & Shell Casing Object',
    summary: 'Short-lived physical debris chunks spawned by explosions or destroyed objects.',
  },
  gbxmodel: {
    group: 'gbxmodel',
    fourCC: 'mod2',
    title: 'Gearbox PC/CE 3D Skinned Mesh Model',
    summary:
      'Stores 3D skeletal nodes (bones), attachment markers, regions, permutations, 5 LOD tiers, vertex/triangle buffers, and shader references.',
    keyTips: 'Use "Export .glb" or "Export .obj" in the header to export this 3D mesh to Blender.',
  },
  globals: {
    group: 'globals',
    fourCC: 'matg',
    title: 'Master Game Engine Globals (globals\\globals)',
    summary:
      'Controls universal game rules: player walking/running speeds, falling damage, multiplayer starting weapons/vehicles, grenade carrying limits, first-person hands, and material surface physics.',
    keyTips: 'Every map has one globals\\globals tag. Edit "player information" and "multiplayer information" here.',
  },
  glow: {
    group: 'glow',
    fourCC: 'glw!',
    title: ' Energy Sword / Plasma Glow Trail',
    summary: 'Renders glowing particle sprites attached along a marker path (used by the Energy Sword and plasma cores).',
  },
  grenade_hud_interface: {
    group: 'grenade_hud_interface',
    fourCC: 'grhi',
    title: 'Grenade Count HUD Layout',
    summary: 'Positions the Frag/Plasma grenade icon and counter on the player HUD.',
  },
  hud_globals: {
    group: 'hud_globals',
    fourCC: 'hudg',
    title: 'Global HUD Colors, Waypoints, & Messaging Layout',
    summary: 'Defines default HUD tint colors, objective waypoint arrows, motion sensor range, and HUD message anchor coordinates.',
  },
  hud_message_text: {
    group: 'hud_message_text',
    fourCC: 'hmt ',
    title: 'Campaign HUD Objective & Tutorial Messages',
    summary: 'Stores UTF-16 message strings with dynamic controller/key button icon tokens.',
  },
  hud_number: {
    group: 'hud_number',
    fourCC: 'hud#',
    title: 'HUD Numeric Digit Sprite Font',
    summary: 'Maps 0-9 numeric digits to a sprite bitmap for ammo and timer displays.',
  },
  input_device_defaults: {
    group: 'input_device_defaults',
    fourCC: 'devc',
    title: 'Controller & Keyboard Default Bindings',
    summary: 'Default button and axis mappings for input devices.',
  },
  item: {
    group: 'item',
    fourCC: 'item',
    title: 'Base Holdable/Drop Item',
    summary: 'Base class for weapons, equipment, and garbage items.',
  },
  item_collection: {
    group: 'item_collection',
    fourCC: 'itmc',
    title: 'Multiplayer Item Spawn Collection (.itmc)',
    summary:
      'Wraps one or more Weapon (weap) or Equipment (eqip) tags with weighted spawn probabilities and respawn timer (seconds) for multiplayer placement.',
    keyTips: 'Scenario Netgame Equipment entries reference item_collection tags to spawn weapons/powerups in MP.',
  },
  lens_flare: {
    group: 'lens_flare',
    fourCC: 'lens',
    title: 'Sun / Light Corona & Lens Flare',
    summary: 'Renders camera-space optical flare rings and corona glow when looking toward a light source or sky sun.',
  },
  light: {
    group: 'light',
    fourCC: 'ligh',
    title: 'Dynamic Point / Spot Light Source',
    summary: 'Defines a dynamic light source (flashlight, warthog headlights, plasma bolt glow, explosion flash) with radius, cone angle, color, and lens flare.',
  },
  light_volume: {
    group: 'light_volume',
    fourCC: 'mgs2',
    title: 'Volumetric Light Beam / Plasma BoltChain',
    summary: 'Draws a line of glowing sprites between two points (used by Covenant plasma rifle bolts and light beams).',
  },
  lightning: {
    group: 'lightning',
    fourCC: 'elec',
    title: 'Procedural Electrical Arc / Lightning',
    summary: 'Generates jittering branching electrical arcs between markers.',
  },
  material_effects: {
    group: 'material_effects',
    fourCC: 'foot',
    title: 'Surface Material Footstep & Impact Lookup Table',
    summary: 'Maps Halo’s 33 surface materials (dirt, sand, stone, snow, wood, metal, water, glass, cyborg shield) to footstep, tire skid, and impact effects.',
  },
  meter: {
    group: 'meter',
    fourCC: 'metr',
    title: 'HUD Stencil Bar / Gradient Meter',
    summary: 'Stores RLE-encoded gradient mask bitmaps used to fill the shield bar, health bar, and plasma heat gauge.',
  },
  model: {
    group: 'model',
    fourCC: 'mode',
    title: 'Xbox 3D Skinned Mesh Model',
    summary: 'Original Xbox Halo 1 3D model format with compressed 32-byte vertices.',
  },
  model_animations: {
    group: 'model_animations',
    fourCC: 'antr',
    title: 'Skeletal Keyframe Animation Graph',
    summary:
      'Stores skeletal bone animations (walk, run, idle, reload, fire, enter/exit vehicle, pelican flight path) and maps them to unit/weapon state machines.',
  },
  model_collision_geometry: {
    group: 'model_collision_geometry',
    fourCC: 'coll',
    title: '3D Collision BSP Hitbox & Vitality/Shield Model',
    summary:
      'Defines the 3D collision BSP tree (bsp3d_nodes, planes, leaves, bsp2d_nodes, surfaces, edges, vertices) per bone, plus body health, energy shield vitality, stun time, and per-material damage multipliers.',
    keyTips: 'Edit "maximum body vitality" and "maximum shield vitality" here to change a unit or vehicle’s health/shields.',
  },
  multiplayer_scenario_description: {
    group: 'multiplayer_scenario_description',
    fourCC: 'mply',
    title: 'Multiplayer Map Menu List & Preview Thumbnails',
    summary: 'Lists multiplayer map filenames, localized display names, and preview bitmaps for the UI map picker.',
  },
  object: {
    group: 'object',
    fourCC: 'obje',
    title: 'Base 3D World Object',
    summary: 'Root class shared by all 11 Halo object types (biped, vehicle, weapon, equipment, garbage, projectile, scenery, device_machine, device_control, device_light_fixture, sound_scenery).',
  },
  particle: {
    group: 'particle',
    fourCC: 'part',
    title: 'Single Billboard Particle Sprite',
    summary: 'Defines a single physicalized particle (sparks, smoke puff, shell casing, dirt clod) with gravity, friction, size, and animated sprite frames.',
  },
  particle_system: {
    group: 'particle_system',
    fourCC: 'pctl',
    title: 'GPU/CPU Emitter Particle System',
    summary: 'Simulates complex multi-state particle emitters (flamethrower fire, atmospheric snow/rain, smoke plumes).',
  },
  physics: {
    group: 'physics',
    fourCC: 'phys',
    title: 'Vehicle Rigid-Body Mass Points, Suspension, & Aerodynamics',
    summary:
      'Defines rigid-body mass, center of mass, 3x3 inertia matrices, powered mass points (wheel traction, hovering antigravity), friction, and tire spring suspension.',
    keyTips: 'Edit "mass", "gravity scale", and "powered mass points" / "mass points" friction to tune vehicle handling.',
  },
  placeholder: {
    group: 'placeholder',
    fourCC: 'plac',
    title: 'Editor Placeholder Object',
    summary: 'Temporary development placeholder object.',
  },
  point_physics: {
    group: 'point_physics',
    fourCC: 'pphy',
    title: 'Particle Point Physics Properties',
    summary: 'Defines elasticity, friction, air drag, and water buoyancy for particles and weather.',
  },
  preferences_network_game: {
    group: 'preferences_network_game',
    fourCC: 'ngpr',
    title: 'Network Game Preferences',
    summary: 'Default multiplayer network game settings.',
  },
  projectile: {
    group: 'projectile',
    fourCC: 'proj',
    title: 'Fired Bullet, Rocket, Plasma Bolt, or Thrown Grenade',
    summary:
      'Defines initial/final velocity, gravity arc, homing turning rate (needler/rocket), detonation timer, bounce physics, impact damage_effect, and per-material surface responses.',
    keyTips: 'Edit "initial velocity", "final velocity", "guided angular velocity", and "damage" dependencies here.',
  },
  scenario: {
    group: 'scenario',
    fourCC: 'scnr',
    title: 'Master Level Scenario (Placements, Spawns, AI, Triggers & HaloScript)',
    summary:
      'The root tag of every Halo map. Orchestrates Structure BSPs, skies, object palettes & placements (scenery, vehicles, weapons, netgame flags/equipment, player spawns), AI encounters/squads, trigger volumes, cutscene cameras, and compiled HaloScript (.hsc) bytecode.',
    keyTips: 'Use the 3D Viewport to move objects visually, or Tools > HaloScript IDE to edit/compile level scripts.',
  },
  scenario_structure_bsp: {
    group: 'scenario_structure_bsp',
    fourCC: 'sbsp',
    title: 'Level 3D Environment Geometry, Lightmaps, Collision BSP, & Portals',
    summary:
      'Contains the level’s 3D world collision BSP, rendered lightmapped triangle meshes, cluster visibility portals (PVS), detail objects, weather polyhedra, and pathfinding nodes.',
  },
  scenery: {
    group: 'scenery',
    fourCC: 'scen',
    title: 'Static 3D Environment Prop (Boulders, Trees, Crates, Bases)',
    summary: 'A static world object with a 3D gbxmodel and model_collision_geometry placed in the scenario.',
  },
  shader: {
    group: 'shader',
    fourCC: 'shdr',
    title: 'Base Surface Shader',
    summary: 'Base class for all Halo 1 rendering shaders and surface physics material types.',
  },
  shader_environment: {
    group: 'shader_environment',
    fourCC: 'senv',
    title: 'BSP Environment Shader (Diffuse + Detail + Bump + Lightmap)',
    summary:
      'Used exclusively on Structure BSP (sbsp) level geometry. Blends a base diffuse map, primary/secondary detail maps, micro-detail map, bump map, self-illumination, and cubemap reflection.',
    keyTips: 'Note: shader_environment only renders on BSP geometry. Use shader_model (soso) for gbxmodel objects!',
  },
  shader_model: {
    group: 'shader_model',
    fourCC: 'soso',
    title: '3D Object / Character / Vehicle Opaque Shader',
    summary:
      'Primary shader for 3D gbxmodel objects (weapons, vehicles, characters, scenery). Supports base diffuse texture, multipurpose map (specular, self-illumination, reflection mask, team color), detail map, and cubemap reflections.',
  },
  shader_transparent_chicago: {
    group: 'shader_transparent_chicago',
    fourCC: 'schi',
    title: 'Multi-Stage Animated Transparent Shader (Chicago)',
    summary:
      'Versatile transparent shader supporting up to 4 scrolling/rotating/pulsing texture stages with additive, alpha-blend, or multiply framebuffer blending.',
  },
  shader_transparent_chicago_extended: {
    group: 'shader_transparent_chicago_extended',
    fourCC: 'scex',
    title: '4+2 Stage Extended Transparent Shader',
    summary: 'Extended version of shader_transparent_chicago with separate 4-stage and 2-stage fallbacks.',
  },
  shader_transparent_generic: {
    group: 'shader_transparent_generic',
    fourCC: 'sotr',
    title: 'Xbox Pixel-Shader Combiner Transparent Shader',
    summary: 'Original Xbox multi-stage register-combiner transparent shader.',
  },
  shader_transparent_glass: {
    group: 'shader_transparent_glass',
    fourCC: 'sgla',
    title: 'Tinted / Reflective Glass & Windshield Shader',
    summary: 'Renders frosted tint, specular reflection cubemap, and diffuse layer for glass windows and visors.',
  },
  shader_transparent_meter: {
    group: 'shader_transparent_meter',
    fourCC: 'smet',
    title: 'DynamicWeapon / Unit Meter Readout Shader',
    summary: 'Drives dynamic ammo/compass/heat bar displays directly on 3D first-person weapon models (like the Assault Rifle display).',
  },
  shader_transparent_plasma: {
    group: 'shader_transparent_plasma',
    fourCC: 'spla',
    title: '3D Animated Energy Shield / Plasma Field Shader',
    summary: 'Renders 3D noise-displaced glowing energy fields (Jackal shields, overshield glow).',
  },
  shader_transparent_water: {
    group: 'shader_transparent_water',
    fourCC: 'swat',
    title: 'Animated Rippling Water Surface Shader',
    summary: 'Renders animated bump-mapped water reflections and refractions on BSP water planes.',
  },
  sky: {
    group: 'sky',
    fourCC: 'sky ',
    title: 'Skybox Dome, Indoor/Outdoor Fog, & Directional Sun Lighting',
    summary:
      'Defines the 3D skybox gbxmodel, outdoor/indoor distance fog color and density, ambient radiosity light, and directional sun/lens-flare light sources.',
  },
  sound: {
    group: 'sound',
    fourCC: 'snd!',
    title: 'Audio Clip Set (Xbox ADPCM / 16-bit PCM / Ogg)',
    summary:
      'Stores distance attenuation bounds (minimum/maximum distance), pitch ranges, and randomized audio permutations with optional 8,000 Hz lip-sync mouth_data.',
    keyTips: 'Use "Open in Sound Auditor" in the header to play audio, export WAV, or import custom WAV files.',
  },
  sound_environment: {
    group: 'sound_environment',
    fourCC: 'snde',
    title: 'EAX Acoustic Reverb Preset',
    summary: 'Defines room acoustic reverb decay time, damping, and reflections for BSP clusters.',
  },
  sound_looping: {
    group: 'sound_looping',
    fourCC: 'lsnd',
    title: 'Continuous Looping Soundscape / Music / Engine Loop',
    summary:
      'Combines seamless looping audio tracks (in/loop/out) with randomized periodic detail sounds for ambient wind, combat music, or vehicle engines.',
  },
  sound_scenery: {
    group: 'sound_scenery',
    fourCC: 'ssce',
    title: '3D Positional Ambient Sound Emitter Object',
    summary: 'An invisible placeable object that emits 3D positional audio in the level.',
  },
  string_list: {
    group: 'string_list',
    fourCC: 'str#',
    title: 'ASCII String List',
    summary: 'Stores an indexed array of single-byte ASCII strings.',
  },
  tag_collection: {
    group: 'tag_collection',
    fourCC: 'tagc',
    title: 'Tag Reference Bundle',
    summary: 'A list of tag references grouped together for batch loading.',
  },
  ui_widget_collection: {
    group: 'ui_widget_collection',
    fourCC: 'Soul',
    title: 'Root UI Menu Screen Collection',
    summary: 'Top-level list of UI menu widget definitions.',
  },
  ui_widget_definition: {
    group: 'ui_widget_definition',
    fourCC: 'DeLa',
    title: 'Menu UI Screen / Button / List Widget',
    summary: 'Defines a menu panel, button, spinner, or dialog box with event handlers, bounds, background bitmaps, and child widgets.',
  },
  unicode_string_list: {
    group: 'unicode_string_list',
    fourCC: 'ustr',
    title: 'UTF-16 Localized Text String List',
    summary: 'Stores UTF-16 localized text strings for weapon pickup prompts, vehicle seat labels, and menu titles.',
    keyTips: 'Switch to the "Unicode Strings" tab in the Tag Editor to edit localized strings directly.',
  },
  unit: {
    group: 'unit',
    fourCC: 'unit',
    title: 'Base Controllable Unit (Bipeds & Vehicles)',
    summary: 'Shared base class for Bipeds and Vehicles (seats, cameras, weapons, HUD interfaces, dialogue).',
  },
  unit_hud_interface: {
    group: 'unit_hud_interface',
    fourCC: 'unhi',
    title: 'Player / Vehicle Shield, Health & Motion Sensor HUD',
    summary: 'Defines the layout of the player’s health bar, energy shield bar, motion sensor radar, and auxiliary vehicle meters.',
  },
  vehicle: {
    group: 'vehicle',
    fourCC: 'vehi',
    title: 'Driveable / AI-Pilotable Vehicle (Warthog, Scorpion, Ghost, Pelican)',
    summary:
      'Defines vehicle physics type (human tank, human jeep, human plane, alien scout, alien fighter, turret), maximum forward/reverse speeds, turn rates, seats, mounted weapons, and suspension.',
    keyTips: 'Edit "maximum forward speed", "maximum reverse speed", "turn rate", and "seats" to customize vehicle behavior.',
  },
  virtual_keyboard: {
    group: 'virtual_keyboard',
    fourCC: 'vcky',
    title: 'On-Screen Virtual Keyboard',
    summary: 'Defines keys and bitmaps for on-screen text entry.',
  },
  weapon: {
    group: 'weapon',
    fourCC: 'weap',
    title: 'Handheld or Vehicle-Mounted Weapon',
    summary:
      'Defines firing triggers (rate of fire, projectiles per shot, error spread, recoil), magazines (ammo capacity, reload time), zoom levels, heat/overheat thresholds, first-person models, and weapon HUD.',
    keyTips: 'Expand "magazines" for ammo/reload settings and "triggers" for rate of fire, spread, and projectile settings.',
  },
  weapon_hud_interface: {
    group: 'weapon_hud_interface',
    fourCC: 'wphi',
    title: 'Weapon Crosshair Reticle, Ammo Counter, & Heat HUD',
    summary: 'Defines the aiming crosshair reticle, clip/reserve ammo counters, bullet icon strip, and plasma heat meter for a weapon.',
    keyTips: 'Click "Open in HUD Previewer" in the header for a live WYSIWYG 16:9 / 4:3 HUD preview.',
  },
  weather_particle_system: {
    group: 'weather_particle_system',
    fourCC: 'rain',
    title: 'Cluster Weather System (Snow, Rain, Windblown Ash)',
    summary: 'Renders camera-relative falling rain or snow particles inside BSP clusters.',
  },
  wind: {
    group: 'wind',
    fourCC: 'wind',
    title: 'Cluster Wind Velocity & Gust Profile',
    summary: 'Defines wind direction, velocity bounds, and gustiness affecting flags, antennas, and weather in a BSP cluster.',
  },
};

/**
 * Lookup dictionary of concise explanations for common tag fields and reflexive blocks.
 * Keyed by lowercase field name (and optional `<group>.<field>` override).
 */
export const FIELD_EXPLANATIONS: Record<string, string> = {
  // Object base fields
  'bounding radius': 'Radius (in world units) of the object’s physics & visibility culling sphere.',
  'bounding offset': '3D offset from the object’s origin to the center of its bounding sphere.',
  'origin offset': '3D offset applied to the object’s placement origin relative to its physics center.',
  'acceleration scale': 'Multiplier on knockback impulse from explosions and melee hits (0 = immovable, 1 = normal, >2 = launches easily).',
  'render bounding radius': 'Radius used by the rasterizer to frustum-cull the 3D model when off-screen.',
  'default model variant': 'Name of the region permutation variant to select by default (e.g. "default").',
  'functions': 'Dynamic A/B/C/D function channels that map engine inputs (velocity, heat, shield, power) to shader/light animations.',
  'attachments': 'Child tags (lights, effects, contrails, looping sounds) attached to named 3D markers on the model.',
  'widgets': 'Attached visual widgets such as flexible whip antennas (ant!), cloth flags (flag), or glow trails (glw!).',
  'change colors': 'Randomized or team-driven RGB color permutations applied to shader color channels (e.g. Covenant armor ranks).',

  // Unit / Biped / Vehicle fields
  'camera marker name': 'Name of the 3D model marker where the camera attaches (e.g. "camera" on bipeds).',
  'camera submerged marker name': 'Marker used when the camera is underwater.',
  'pitch auto-level': 'How quickly the camera pitch levels back to the horizon while driving.',
  'pitch range': 'Minimum and maximum vertical look pitch angles (in degrees).',
  'camera tracks': 'Spline camera tracks controlling 3rd-person orbit distance and height.',
  'seats': 'Passenger, driver, and gunner seats on this unit, including seat animations, camera markers, and mounted seat weapons.',
  'powered seats': 'Driver/gunner power output multipliers that enable vehicle movement or turret rotation when occupied.',
  'weapons': 'Built-in weapons mounted directly to this unit or vehicle (e.g. Warthog chaingun, Scorpion cannon, Ghost plasma cannons).',
  'Dialogue': 'AI combat dialogue vocalization tag.',
  'turning velocity maximum': 'Maximum horizontal yaw turning speed (degrees/sec).',
  'turning acceleration maximum': 'How quickly the unit reaches maximum turning speed (degrees/sec²).',
  'casual turning modifier': 'Turning speed multiplier when not in active combat [0..1].',
  'stationary turning threshold': 'Yaw angle delta (degrees) before the biped plays a foot-shuffling turn animation.',
  'jump velocity': 'Upward vertical velocity applied when jumping (world units/sec; default Spartan is ~0.14).',
  'maximum soft landing time': 'Time (seconds) of fall before triggering a soft landing recovery.',
  'maximum hard landing time': 'Time (seconds) of fall before triggering a hard stun landing.',
  'minimum soft landing velocity': 'Downward impact speed that triggers soft landing sound/camera dip.',
  'minimum hard landing velocity': 'Downward impact speed that causes fall damage and temporary movement stun.',
  'maximum hard landing velocity': 'Downward impact speed that causes lethal fall damage.',
  'standing camera height': 'First-person eye height (world units) above the ground when standing.',
  'crouching camera height': 'First-person eye height (world units) above the ground when crouching.',
  'crouch transition time': 'Time (seconds) to interpolate between standing and crouching.',
  'collision radius': 'Horizontal radius of the biped’s physics collision pill.',
  'collision height': 'Vertical height of the biped’s physics collision pill.',

  // Vehicle physics & handling fields
  'type': 'Physics/behavior archetype (e.g. human tank, human jeep, human boat, human plane, alien scout, alien fighter, turret).',
  'maximum forward speed': 'Top speed when driving forward (world units/sec).',
  'maximum reverse speed': 'Top speed when driving in reverse (world units/sec).',
  'acceleration': 'Rate at which the vehicle accelerates toward top speed.',
  'deceleration': 'Braking / coasting deceleration rate.',
  'maximum left turn': 'Maximum left steering angle or turn rate.',
  'maximum right turn (negative)': 'Maximum right steering angle or turn rate (usually negative).',
  'wheel circumference': 'Circumference of the wheels for synchronizing tire spin animations with ground speed.',
  'turn rate': 'How fast the steering wheels or hovercraft yaw respond to player turn input.',
  'blur speed': 'Speed threshold at which wheel motion blur permutations activate.',
  'overdampen cusp angle': 'Roll/pitch angle where anti-flip roll dampening kicks in.',
  'overdampen exponent': 'Strength of the anti-roll stabilization torque.',

  // Weapon fields, magazines & triggers
  'heat recovery threshold': 'Heat fraction [0..1] below which an overheated weapon becomes ready to fire again.',
  'overheated threshold': 'Heat fraction [0..1] (usually 1.0) that triggers weapon overheating and venting.',
  'heat detonation threshold': 'Heat threshold where the weapon risks exploding.',
  'heat loss per second': 'Rate at which plasma heat dissipates per second when not firing.',
  'heat illumination': 'Self-illumination glow intensity generated by weapon heat.',
  'magnification levels': 'Number of scope zoom steps (0 = no zoom, 1 = 2x Pistol/Rocket zoom, 2 = 2x/8x Sniper zoom).',
  'magnification range': 'Minimum and maximum field-of-view zoom multipliers (e.g. 2.0 to 8.0).',
  'autoaim angle': 'Cone angle (degrees) within which reticle magnetism assists aiming.',
  'autoaim range': 'Maximum distance (world units) at which autoaim is active.',
  'magnetism angle': 'Cone angle (degrees) within which bullet trajectories bend slightly toward targets.',
  'magnetism range': 'Maximum distance (world units) for bullet magnetism.',
  'deviation angle': 'Maximum angle (degrees) projectiles can deviate from the barrel vector.',
  'movement penalized': 'When penalizing movement, accuracy or speed is reduced while moving.',
  'forward movement penalty': 'Multiplier on forward walking speed while holding this weapon.',
  'sideways movement penalty': 'Multiplier on strafing speed while holding this weapon.',
  'minimum target range': 'Closest distance AI actors will engage with this weapon.',
  'looking time modifier': 'Multiplier on look sensitivity while holding/firing this weapon.',
  'light power-on time': 'Time (seconds) for the weapon flashlight to fade in.',
  'light power-off time': 'Time (seconds) for the weapon flashlight to fade out.',
  'ready time': 'Time (seconds) required to draw/ready the weapon before it can fire.',
  'magazines': 'Ammunition pools (primary clip and secondary launcher). Controls reserve ammo, clip size, reload time, and ammo pickups.',
  'rounds recharged': 'Rounds automatically regenerated per second (e.g. recharging energy weapons).',
  'rounds total initial': 'Starting total ammunition when spawning with or picking up this weapon.',
  'rounds total maximum': 'Maximum total ammunition (clip + reserve) the player can carry.',
  'rounds loaded maximum': 'Magazine clip capacity before reloading.',
  'reload time': 'Duration (seconds) of the reload animation.',
  'rounds reloaded': 'Number of rounds inserted per reload cycle (e.g. 8 for AR/Pistol, 1 per shell for Shotgun).',
  'chamber time': 'Time (seconds) to chamber the next round after reloading.',
  'triggers': 'Primary (left-click) and Secondary (right-click/grenade) firing barrels. Controls rate of fire, projectile count, spread error, recoil, and charging.',
  'rounds per second': 'Minimum and maximum rate of fire (shots per second; e.g. 15 for Assault Rifle, 3.5 for Pistol).',
  'acceleration time': 'Time (seconds) to spin up from minimum to maximum rate of fire (e.g. Plasma Rifle / Chaingun).',
  'deceleration time': 'Time (seconds) to spin down back to minimum rate of fire.',
  'blurred rate of fire': 'Rate of fire when firing animations blend into continuous motion blur.',
  'magazine': 'Index of the magazine block (0 = primary, 1 = secondary) consumed by this trigger.',
  'rounds per shot': 'Ammo rounds deducted from the magazine each time this trigger fires.',
  'minimum rounds loaded': 'Minimum rounds required in the magazine to allow firing.',
  'rounds between tracers': 'Number of non-tracer shots between visible tracer projectiles.',
  'error': 'Minimum and maximum accuracy bloom cone angle (degrees). Lower values = laser-accurate!',
  'recoil': 'Camera pitch/yaw kickback angles per shot.',
  'projectiles per shot': 'Number of projectiles spawned simultaneously per shot (e.g. 1 for rifle, 15 for Shotgun pellets).',
  'distribution angle': 'Cone spread angle (degrees) when firing multiple projectiles per shot.',
  'minimum error': 'Baseline inaccuracy angle (degrees) on the very first shot before bloom.',
  'error angle': 'Minimum and maximum spread angle (degrees) as sustained fire heats up bloom.',
  'charging time': 'Time (seconds) required to hold the trigger to reach full overcharge (Plasma Pistol / Spartan Laser).',
  'charged time': 'Maximum time (seconds) a full charge can be held before discharging or draining.',
  'overcharged action': 'What happens when held past charged time (none, explode, discharge).',
  'charged illumination': 'Glow intensity while holding an overcharge.',
  'spew time': 'Duration of misfire spewing.',
  'firing effects': 'Muzzle flash, firing sound, and shell-casing effects played each shot.',

  // Projectile fields
  'detonation timer starts': 'When the fuse countdown starts (immediately on fire, or after first bounce on ground).',
  'impact noise': 'AI hearing alertness level generated when the projectile impacts.',
  'ai perception radius': 'Radius within which AI actors notice and dodge the incoming projectile.',
  'collision radius (proj)': 'Radius of the projectile’s collision sphere.',
  'arming time': 'Delay (seconds) before the projectile can detonate on proximity/impact.',
  'danger radius': 'Radius within which AI actors will dive away from this projectile (e.g. Frag/Plasma grenade).',
  'timer': 'Minimum and maximum fuse time (seconds) before automatic detonation.',
  'minimum velocity': 'Speed below which the projectile comes to rest or detonates.',
  'maximum range': 'Maximum travel distance (world units) before the projectile expires or detonates.',
  'air gravity scale': 'Multiplier on world gravity while flying through air (0 = flies straight like a rocket/laser, 1 = normal arc).',
  'air damage range': 'Distance range over which air drag reduces damage.',
  'water gravity scale': 'Multiplier on gravity when traveling underwater.',
  'initial velocity': 'Launch speed (world units/sec) when leaving the barrel.',
  'final velocity': 'Terminal speed (world units/sec) after rocket boost or air drag.',
  'guided angular velocity': 'Homing turn rate (degrees/sec) for tracking targets (used by Needler needles and Hunter cannon).',
  'material responses': 'Per-surface behavior (bounce, attach/stick, detonate, penetrate) for each of Halo’s 33 material types.',

  // Damage Effect (jpt!) fields
  'radius': 'Inner (100% damage) and outer (falloff to 0%) blast radius in world units.',
  'angular scale': 'Directional cone restriction for the damage blast.',
  'shake duration': 'Duration (seconds) of camera screen shake on nearby players.',
  'shake falloff function': 'Curve controlling how camera shake fades over time.',
  'random translation': 'Maximum camera shake displacement in world units.',
  'random rotation': 'Maximum camera shake rotational wobble in degrees.',
  'wobble function': 'Periodic waveform used to oscillate the camera during screen shake.',
  'side effect': 'Special status effect (none, harmless, lethal to the unsuspecting, emp).',
  'category': 'Damage classification (none, falling, bullet, grenade, high explosive, sniper, melee, flame, mounted weapon, vehicle, plasma, needle, shotgun).',
  'damage lower bound': 'Minimum hit points of damage dealt inside the inner radius.',
  'damage upper bound': 'Maximum hit points of damage dealt inside the inner radius (from..to range).',
  'vehicle passthrough penalty': 'Fraction of damage transferred directly to vehicle passengers [0..1].',
  'active camouflage damage': 'How much this hit disrupts the target’s active camouflage.',
  'stun': 'Movement/turn slow-down multiplier applied to the victim on hit [0..1].',
  'maximum stun': 'Cap on cumulative stun slow-down [0..1].',
  'stun time': 'Duration (seconds) that the stun slow-down lasts.',
  'instantaneous acceleration': 'Physical knockback impulse applied to hit objects, vehicles, and ragdolls.',

  // Collision Model (coll) fields
  'maximum body vitality': 'Total body health hit points (e.g. 75 for Spartan, 400 for Scorpion).',
  'body system shock': 'Damage threshold in a single hit that instantly destroys the body.',
  'friendly damage resistance': 'Fraction [0..1] of friendly-fire damage ignored.',
  'maximum shield vitality': 'Total energy shield hit points (e.g. 75 for Spartan, 100 for Elite).',
  'shield material type': 'Surface material used when the energy shield is active (typically 22 = cyborg energy shield).',
  'shield failure threshold': 'Shield fraction below which shield malfunction effects play.',
  'minimum stun damage': 'Damage required to reset the shield recharge delay timer.',
  ' recharge time': 'Time (seconds) required for shields to recharge from 0% to 100% once stun expires.',
  'materials': 'Collision surface materials mapping model polygons to Halo’s 33 physics materials and damage multipliers.',
  'regions': 'Destructible/permutable body regions (e.g. head, torso, windshield, hull).',
  'pathfinding spheres': 'Spherical obstacle volumes used by AI actors to walk around this object.',
  'nodes': 'Bone nodes containing the compiled 3D Collision BSP trees (`bsps`).',

  // Scenario (scnr) fields
  'skies': 'Skybox tags (`sky `) referenced by this scenario’s outdoor BSP clusters.',
  'object names': 'Named scenario objects (e.g. `pelican_1`, `drop_hog`, `door_1`) that HaloScript (`.hsc`) functions can control by name!',
  'scenery': 'Placed static 3D scenery instances in the level (position, rotation, palette index).',
  'scenery palette': 'Palette of `.scenery` tags available for placement in this scenario.',
  'bipeds': 'Placed character biped instances in the level.',
  'biped palette': 'Palette of `.biped` tags available for placement.',
  'vehicles': 'Placed vehicle instances in the level (position, rotation, multiplayer spawn flags).',
  'vehicle palette': 'Palette of `.vehicle` tags available for placement.',
  'equipment': 'Placed singleplayer equipment pickups.',
  'equipment palette': 'Palette of `.equipment` tags available for placement.',
  'weapon palette': 'Palette of `.weapon` tags available for placement.',
  'device groups': 'Power and position state groups (`0.0` = closed/off, `1.0` = open/on) shared by doors, elevators, and control switches.',
  'machines': 'Placed mechanical door/elevator/bridge instances (`device_machine`).',
  'machine palette': 'Palette of `.device_machine` tags available for placement.',
  'controls': 'Placed interactive switch/button instances (`device_control`).',
  'control palette': 'Palette of `.device_control` tags available for placement.',
  'light fixtures': 'Placed scriptable light fixture instances.',
  'light fixtures palette': 'Palette of `.device_light_fixture` tags.',
  'sound scenery': 'Placed 3D ambient sound emitters.',
  'sound scenery palette': 'Palette of `.sound_scenery` tags.',
  'player starting profile': 'Default starting health, shield, primary/secondary weapons, ammo, and grenade counts for players.',
  'player starting locations': 'Player spawn points (3D position, facing yaw, team index, BSP index, and gametype filter).',
  'trigger volumes': '3D oriented bounding box (OBB) volumes used by HaloScript (`volume_test_objects`) to detect when players, AI, or vehicles enter an area!',
  'recorded animations': 'Pre-recorded movement paths (used by `recording_play` to fly Pelicans, Dropships, and Banshees along scripted trajectories).',
  'netgame flags': 'Multiplayer objective markers: CTF Flag Bases, King of the Hill boundary points, Oddball spawns, Race checkpoints, Teleporter Origins, and Teleporter Targets.',
  'netgame equipment': 'Multiplayer weapon, powerup, grenade, and vehicle spawn placements referencing `.item_collection` or `.vehicle` tags.',
  'starting equipment': 'Multiplayer gametype starting weapon loadouts.',
  'decals': 'Static blood/scorch/graffiti decals placed on the BSP.',
  'decal palette': 'Palette of `.decal` tags.',
  'actor palette': 'Palette of `.actor_variant` (`actv`) AI character types used by Encounters and Squads!',
  'encounters': 'AI combat encounters containing Squads (which spawn AI actor variants), Platoons, and 3D Firing Positions (`A`–`Z`).',
  'command lists': 'Scripted waypoint command sequences (move, look, enter vehicle, wait, animate) assigned to AI squads.',
  'ai animation references': 'Named animations callable by AI command lists and scripts.',
  'ai script references': 'Named HaloScript static scripts callable by AI encounters.',
  'ai recording references': 'Named recorded animations callable by AI.',
  'ai conversations': 'Scripted multi-line NPC dialogue conversations with subtitles and participant triggers.',
  'scripts': 'Compiled HaloScript (`.hsc`) function headers (`startup`, `dormant`, `continuous`, `static`, `stub`).',
  'globals': 'Compiled HaloScript global variables declared in the scenario.',
  'references': 'Tag references scraped from HaloScript literals (sounds, effects, damage effects, actor variants, objects).',
  'cutscene flags': 'Named 3D reference coordinate flags used for teleporting objects/players (`object_teleport`) or anchoring cutscenes.',
  'cutscene camera points': 'Named 3D camera keyframes (position, orientation, roll, field of view) used by `camera_set` for cinematic flythroughs!',
  'cutscene titles': 'On-screen cinematic chapter titles (e.g. "Two Betrayals") with fade-in/hold/fade-out timers, colors, and screen bounds.',
  'structure bsps': 'List of `.scenario_structure_bsp` (`sbsp`) level geometry sections in this map.',

  // Font (font) fields
  'ascending height': 'Vertical height (in pixels) of characters above the text baseline.',
  'descending height': 'Vertical depth (in pixels) of character descenders (like g, j, p, q, y) below the baseline.',
  'leading height': 'Extra vertical line spacing (in pixels) added between lines of text.',
  'leading width': 'Extra horizontal tracking space (in pixels) added between adjacent characters.',
  'character tables': 'Lookup tables indexing Unicode character blocks (0x00..0xFF) into the characters glyph array.',
  'characters': 'Individual rasterized character glyphs with width, height, baseline bearing, and pixel data offset.',
  'character': 'UTF-16 Unicode codepoint value for this glyph (e.g. 65 = "A").',
  'character width': 'Horizontal advance width (in pixels) to move the cursor after drawing this character.',
  'bitmap width': 'Width of the glyph’s cropped monochrome bitmap in pixels.',
  'bitmap height': 'Height of the glyph’s cropped monochrome bitmap in pixels.',
  'bitmap origin x': 'Horizontal bearing offset from the cursor to the left edge of the glyph bitmap.',
  'bitmap origin y': 'Vertical bearing offset from the baseline to the top edge of the glyph bitmap.',

  // Shader Model (soso) & Shader Environment (senv) fields
  'detail mask': 'Selects which multipurpose map channel masks the detail texture (none, reflection mask, self-illumination, change color).',
  'detail map scale': 'UV tiling multiplier for the close-up detail texture (higher = finer grain).',
  'detail map v-scale': 'Vertical UV aspect ratio multiplier for the detail texture.',
  'u-animation period': 'Time (seconds) for one full horizontal UV scroll cycle.',
  'v-animation period': 'Time (seconds) for one full vertical UV scroll cycle.',
  'u-animation scale': 'Amplitude of horizontal texture scrolling/oscillation.',
  'v-animation scale': 'Amplitude of vertical texture scrolling/oscillation.',
  'self-illumination': 'Emissive glow settings that stay bright even in unlit dark areas.',
  'primary on color': 'RGB emissive glow color when the primary self-illumination channel is active.',
  'primary off color': 'RGB emissive color when the primary self-illumination channel is dimmed/off.',
  'primary animation period': 'Pulse cycle time (seconds) for primary emissive glow.',
  'perpendicular brightness': 'Reflection intensity [0..1] when viewing the surface straight-on (90°).',
  'parallel brightness': 'Reflection intensity [0..1] when viewing the surface at a grazing Fresnel angle.',
  'perpendicular tint color': 'RGB reflection tint when looking straight at the surface.',
  'parallel tint color': 'RGB reflection tint at grazing Fresnel angles.',
  'bump scale': 'Depth/strength of normal-map surface relief bumps.',
  'primary detail map scale': 'UV tiling scale for the primary detail texture blended over the base diffuse map.',
  'secondary detail map scale': 'UV tiling scale for the secondary detail texture.',
  'micro-detail map scale': 'High-frequency close-up UV tiling scale for micro-detail grain.',
  'material color': 'Diffuse RGB tint multiplied over the base texture.',
  'material type': 'Physical surface material used for footsteps, bullet impacts, and tire traction (e.g. dirt, stone, metal, cyborg shield).',

  // Globals (matg) fields
  'sounds': 'Global engine UI/water sounds.',
  'camera': 'Default 3rd-person camera track.',
  'player Control': 'Look sensitivity, magnetism, autoaim, and controller look acceleration curves.',
  'difficulty': 'Campaign difficulty multipliers (Easy, Normal, Heroic, Legendary) for enemy health, shields, damage, and perception.',
  'grenades': 'Maximum carried and starting counts for Frag and Plasma grenades, plus throwing velocity.',
  'interface bitmaps': 'Global UI fonts, color tables, and HUD elements.',
  'weapon list': 'Master list of weapons available to script/cheat functions.',
  'cheat powerups': 'Powerup equipment tags spawned by debug cheats.',
  'multiplayer information': 'Multiplayer rules: flag, oddball, vehicles, weapons, and hill sounds.',
  'player information': 'Master player Spartan settings: walking/running/crouching speeds, jump height, shield/health recharge, and first-person hands!',
  'first person interface': 'First-person hands gbxmodel, base bitmap, and shield/health meter tags.',
  'falling damage': 'Safe fall distance and lethal fall velocity thresholds.',
  'walking speed': 'Forward walking speed in world units per second.',
  'run forward': 'Maximum forward running speed in world units per second (default Spartan is 0.075).',
  'run backward': 'Maximum backward running speed in world units per second.',
  'run sideways': 'Maximum strafing speed in world units per second.',
  'run acceleration': 'How quickly the player reaches top running speed.',
  'sneak forward': 'Crouch-walking forward speed in world units per second.',
  'sneak backward': 'Crouch-walking backward speed.',
  'sneak sideways': 'Crouch-walking strafe speed.',
  'airborne acceleration': 'Mid-air directional control acceleration while jumping or falling.',
  'stun movement penalty': 'Movement speed reduction when hit by stunning gunfire or explosions [0..1].',
  'stun turning penalty': 'Turning speed reduction when stunned [0..1].',
  'stun jumping penalty': 'Jump height reduction when stunned [0..1].',

  // Sky (sky ), Fog (fog ), & Light (ligh) fields
  'outdoor ambient radiosity color': 'Ambient sky light RGB color illuminating outdoor BSP surfaces.',
  'outdoor ambient radiosity power': 'Brightness multiplier for outdoor ambient sky lighting.',
  'indoor ambient radiosity color': 'Ambient RGB light color inside indoor BSP clusters.',
  'indoor ambient radiosity power': 'Brightness multiplier for indoor ambient lighting.',
  'outdoor fog color': 'RGB color of distance atmospheric fog in outdoor areas.',
  'outdoor fog maximum density': 'Maximum opacity [0..1] of outdoor distance fog.',
  'outdoor fog start distance': 'Distance (world units) from the camera where outdoor fog begins fading in.',
  'outdoor fog opaque distance': 'Distance (world units) where outdoor fog reaches maximum density.',
  'indoor fog color': 'RGB color of indoor atmospheric fog.',
  'indoor fog maximum density': 'Maximum opacity [0..1] of indoor fog.',
  'indoor fog start distance': 'Distance where indoor fog begins.',
  'indoor fog opaque distance': 'Distance where indoor fog reaches full density.',
  'lights': 'Directional sun/moon light sources cast by the sky into the level.',
  'cutoff angle': 'Outer cone angle (degrees) of a spotlight.',
  'falloff angle': 'Inner full-brightness cone angle (degrees) before spotlight falloff.',
  'duration': 'Lifetime (seconds) of a temporary dynamic light flash.',

  // Actor (actr) & Actor Variant (actv) fields
  'major upgrade': 'Probability [0..1] that this AI spawns upgraded to its major rank variant.',
  'body vitality': 'Base health hit points for this AI actor variant.',
  'shield vitality': 'Base energy shield hit points for this AI actor variant.',
  'burst origin radius': 'Aiming inaccuracy offset at the start of an AI firing burst.',
  'burst origin angle': 'Angular aim error at the start of an AI firing burst.',
  'burst return length': 'How far the AI pulls its aim back toward the target during a burst.',
  'burst duration': 'Minimum and maximum duration (seconds) of each firing burst.',
  'burst separation': 'Pause delay (seconds) between consecutive firing bursts.',
  'maximumrate of fire': 'Cap on shots per second when this AI fires its weapon.',
  'grenade velocity': 'Launch speed (world units/sec) when this AI throws grenades.',
  'grenade count': 'Starting number of grenades carried by this AI.',
  'dont drop grenades chance': 'Probability [0..1] that the AI will NOT drop its remaining grenades when killed.',
  'drop weapon loaded': 'Minimum and maximum rounds left in the magazine when the AI drops its weapon.',
  'drop weapon ammo': 'Total reserve ammo on the weapon dropped when this AI dies.',

  // Common placement & child block fields
  'position': '3D world coordinates (X, Y, Z) in world units.',
  'rotation': '3D orientation Euler angles (Yaw, Pitch, Roll) in degrees.',
  'facing': 'Horizontal compass yaw facing angle in degrees.',
  'name': 'Identifier name or index into the scenario Object Names table.',
  'team index': 'Multiplayer team ownership (0 = Red / Default, 1 = Blue).',
  'bsp index': 'Index of the Structure BSP containing this placement.',
  'appearance player index': 'Player appearance slot index.',
  'desired permutation': 'Model region permutation index to select (0 = default).',
  'spawn time': 'Respawn interval in seconds (0 = default gametype timer).',
};

/**
 * Resolves a human-friendly explanation string for a tag group (`primaryClassName` or 4-char FourCC).
 */
export function getTagGroupExplanation(group: string): string | null {
  const key = group.trim().toLowerCase();
  const byName = TAG_GROUP_EXPLANATIONS[key];
  if (byName) {
    return `${byName.title} — ${byName.summary}`;
  }
  const byFourCC = Object.values(TAG_GROUP_EXPLANATIONS).find((e) => e.fourCC.toLowerCase() === key);
  if (byFourCC) {
    return `${byFourCC.title} — ${byFourCC.summary}`;
  }
  return null;
}

/**
 * Resolves a concise inline description for a tag field or reflexive block name.
 * Always provides a clear plain-English explanation via exact lookup or contextual heuristics.
 */
export function getFieldExplanation(
  fieldName: string,
  tagGroup?: string,
  fieldType?: string,
  fieldKind?: string,
): string | null {
  const cleanName = fieldName.trim().toLowerCase();
  if (tagGroup) {
    const scoped = FIELD_EXPLANATIONS[`${tagGroup.toLowerCase()}.${cleanName}`];
    if (scoped) return scoped;
  }
  if (FIELD_EXPLANATIONS[cleanName]) {
    return FIELD_EXPLANATIONS[cleanName];
  }
  // Heuristic fallback for common Halo field naming patterns
  if (cleanName === 'flags' || cleanName.endsWith(' flags')) {
    return 'Toggleable behavior checkboxes controlling how the Halo engine handles this item.';
  }
  if (cleanName.endsWith(' palette')) {
    return `List of ${cleanName.replace(' palette', '')} tag types available for placement in this level.`;
  }
  if (cleanName.includes('vitality') || cleanName.includes('health')) {
    return 'Hit point capacity before depletion or destruction.';
  }
  if (cleanName.includes('shield')) {
    return 'Energy shield behavior, strength, or recharge timing.';
  }
  if (cleanName.includes('spawn time') || cleanName.includes('respawn')) {
    return 'Time in seconds before the item or vehicle respawns.';
  }
  if (cleanName.includes('field of view') || cleanName === 'fov') {
    return 'Camera horizontal field-of-view angle in degrees (default is 70°).';
  }
  if (cleanName.includes('color') || cleanName.includes('tint') || (fieldType && fieldType.toLowerCase().includes('color'))) {
    return 'RGB color tint values (each channel ranges from 0.0 to 1.0).';
  }
  if (cleanName.includes('velocity') || cleanName.includes('speed')) {
    return 'Movement or launch speed in world units per second.';
  }
  if (cleanName.includes('acceleration') || cleanName.includes('deceleration')) {
    return 'Rate of speed change in world units per second squared.';
  }
  if (cleanName.includes('angle') || cleanName.includes('yaw') || cleanName.includes('pitch') || cleanName.includes('roll') || fieldType === 'Angle') {
    return 'Rotation or cone angle measured in degrees (°).';
  }
  if (cleanName.includes('radius') || cleanName.includes('distance') || cleanName.includes('range')) {
    return 'Distance or radius measured in Halo world units (~3 meters per unit).';
  }
  if (cleanName.includes('time') || cleanName.includes('delay') || cleanName.includes('duration') || cleanName.includes('period')) {
    return 'Time duration or cycle interval measured in seconds.';
  }
  if (cleanName.includes('scale') || cleanName.includes('modifier') || cleanName.includes('multiplier') || cleanName.includes('fraction') || fieldType === 'Fraction') {
    return 'Multiplier or proportional ratio (0.0 = none, 1.0 = 100% normal).';
  }
  if (cleanName.includes('offset') || cleanName.includes('position') || cleanName.includes('origin') || cleanName.includes('point')) {
    return '3D/2D coordinate offset relative to the parent object or screen.';
  }
  if (cleanName.includes('marker')) {
    return 'Name of the 3D attachment marker on the GBXModel where this effect or object connects.';
  }
  if (cleanName.includes('count') || cleanName.includes('maximum') || cleanName.includes('minimum')) {
    return 'Numeric limit or quantity threshold used by the engine.';
  }
  if (fieldKind === 'reflexive') {
    return `Expandable list of ${cleanName} entries stored inside this tag.`;
  }
  if (fieldKind === 'enum') {
    return `Selects the ${cleanName} mode from Halo’s built-in preset options.`;
  }
  if (fieldKind === 'bounds') {
    return `Minimum ("From") and maximum ("To") range for ${cleanName}.`;
  }
  if (fieldKind === 'string') {
    return `Text identifier (up to 31 characters) for ${cleanName}.`;
  }
  if (fieldKind === 'number') {
    return `Numeric tuning value for ${cleanName}.`;
  }
  return null;
}

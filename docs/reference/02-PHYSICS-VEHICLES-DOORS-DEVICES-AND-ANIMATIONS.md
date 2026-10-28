# 02 — Physics (`phys`), Vehicles (`vehi`), Interactive Doors & Devices (`mach`, `ctrl`, `lifi`) & Animations (`antr`)

> **Purpose**: Complete byte-level specification, mathematical formulas, step-by-step creation workflows, and **OpenCE Mantle** visual editor blueprints for Halo CE's Physics engine (`phys`, `pphy`), Vehicles (`vehi`, `trak`), Interactive Doors/Elevators/Switches (`devi`, `mach`, `ctrl`, `lifi` + `scnr.device_groups`), and Skeletal Animations (`antr` / `.JMA`–`.JMW`).

---

## 1. How Physics (`phys`) & Point Physics (`pphy`) Are Made and Work

### 1.1 Overview of Halo 1's Sphere-Point Physics Engine (`phys`)
Halo 1 does **not** use Havok (which was introduced in Halo 2). Instead, vehicles (`vehi`) use a custom spring-damper rigid-body physics engine driven by a **`physics` (`phys`, 128-byte header, Version 4)** tag:
- Vehicle-to-Vehicle, Vehicle-to-BSP (`sbsp`), Vehicle-to-Machine (`mach`), and Vehicle-to-Scenery (`scen`) collisions are simulated using up to **32 spherical `mass_points`** (`PhysicsMassPoint`, `128` bytes each).
- Projectile, weapon fire, and biped melee hits against the vehicle use its `model_collision_geometry` (`coll`) tag instead.

### 1.2 Exact Binary Layout of `phys` (`128`-byte Root Header + 3 Reflexives)

| Offset | Type | Field Name | Description & Engine Behavior |
| :--- | :--- | :--- | :--- |
| `0x00` | `float` | `radius` | Positive value enables legacy physics; **`-1.0` enables the standard Halo 1 physics model**. |
| `0x04` | `float` | `moment_scale` | Multiplier applied to the computed 3×3 inertia tensor (`default = 0.3`). Lower values make the vehicle rotate/pitch more easily. |
| `0x08` | `float` | `mass` | Total vehicle mass (e.g. `1000.0` for Warthog). Distributed across `mass_points` proportionally to each point's `relative_mass`. |
| `0x0C` | `Point3D` | `center_of_mass` | `(x, y, z)` in object space — **automatically computed on compile/save** as the mass-weighted centroid of all `mass_points`. |
| `0x18` | `float` | `density` | Overall vehicle density (`g/cm³` scale). |
| `0x1C` | `float` | `gravity_scale` | Multiplier on standard world gravity (`1.0` = normal gravity; `< 1.0` = floaty; `0.0` = zero-G). |
| `0x20` | `float` | `ground_friction` | Base surface friction coefficient (`default = 0.2`). |
| `0x24` | `float` | `ground_depth` | Ground penetration/suspension depth in world units (`default = 0.2`). |
| `0x28` | `float` | `ground_damp_fraction` | Suspension damping fraction (`default = 0.05`). |
| `0x2C` | `float` | `ground_normal_k1` | Cosine of surface slope angle where powered mass points begin losing traction (`default = 0.7071068` = `45°`). |
| `0x30` | `float` | `ground_normal_k0` | Cosine of max slope angle where traction reaches zero (`default = 0.5` = `60°`; **setting `-1.0` lets the vehicle drive up vertical `90°` walls and upside-down ceilings!**). |
| `0x38` | `float` | `water_friction` | Drag in water (`default = 0.05`). |
| `0x3C` | `float` | `water_depth` | Depth scale in water (`default = 0.25`). |
| `0x40` | `float` | `water_density` | Buoyancy ratio against water (`default = 1.0`; `< 1.0` floats on water). |
| `0x48` | `float` | `air_friction` | Aerodynamic drag in air (`default = 0.001`). |
| `0x50` | `float[3]` | `xx_moment`, `yy_moment`, `zz_moment` | Diagonal moments of inertia `(I_xx, I_yy, I_zz)` (**computed on compile/save**). |
| `0x5C` | `Reflexive` | `inertial_matrix_and_inverse` | Always **2 elements** of `36` bytes each (`3×3` `float` matrix): `[0]` is forward inertia matrix $M$; `[1]` is inverse matrix $M^{-1}$. |
| `0x68` | `Reflexive` | `powered_mass_points` | Up to **32 elements** of `128` bytes each (`PhysicsPoweredMassPoint`). |
| `0x74` | `Reflexive` | `mass_points` | Up to **32 elements** of `128` bytes each (`PhysicsMassPoint`). |

#### A. `powered_mass_points` (`128` bytes each, max 32)
Defines propulsion, flight lift, or Covenant hover repulsors that `mass_points` can attach to:
- `0x00`: `name` (`String32`, e.g. `tire_drive` or `antigrav`)
- `0x20`: `flags` (`Bitmask32`):
  - Bit 0 (`0x01`): `ground_friction` (drives wheels/tank treads along the ground)
  - Bit 1 (`0x02`): `water_friction` (boat propeller)
  - Bit 2 (`0x04`): `air_friction`
  - Bit 3 (`0x08`): `water_lift`
  - Bit 4 (`0x10`): `air_lift` (Banshee/Pelican wing lift)
  - Bit 5 (`0x20`): `thrust` (jet/rocket propulsion)
  - Bit 6 (`0x40`): `antigrav` (Ghost/Wraith hover repulsor)
- `0x24`–`0x38`: Antigrav parameters: `antigrav_strength`, `antigrav_offset`, `antigrav_height`, `antigrav_damp_fraction`, `antigrav_normal_k1`, `antigrav_normal_k0`.

#### B. `mass_points` (`128` bytes each, max 32)
Each `#marker` sphere in the physics `.jms` file compiles into one `mass_point`:
- `0x00`: `name` (`String32`, e.g. `front left tire`, `hull front`)
- `0x20`: `powered_mass_point` (`int16` index into `powered_mass_points`, `-1` if unpowered)
- `0x22`: `model_node` (`int16` parent bone index in `gbxmodel`, `0` = root)
- `0x24`: `flags` (`Bitmask32`: Bit 0 = `metallic`)
- `0x28`: `relative_mass` (`float`, user-authored weight ratio, default `1.0`)
- `0x2C`: `mass` (`float`, **computed** from `relative_mass` and root `mass`)
- `0x30`: `relative_density` (`float`, user-authored density ratio, default `1.0`)
- `0x34`: `density` (`float`, **computed** from `relative_density` and root `density`)
- `0x38`: `position` (`Point3D` `x, y, z` in world units = `jms_pos / 100.0`)
- `0x44`: `forward` (`Vector3D` `i, j, k` — primary rolling/sliding axis)
- `0x50`: `up` (`Vector3D` `i, j, k` — normal/suspension axis)
- `0x5C`: `friction_type` (`Enum16`): `0 = point` (omnidirectional hull sphere), `1 = forward` (wheel/ski that rolls freely along `forward` and grips sideways), `2 = left`, `3 = up`
- `0x60`: `friction_parallel_scale` (`float` — friction multiplier along `friction_type` axis; low for rolling tires)
- `0x64`: `friction_perpendicular_scale` (`float` — lateral grip multiplier perpendicular to `friction_type`; high for tires so the vehicle doesn't slide sideways in turns)
- `0x68`: `radius` (`float` in world units = `jms_radius / 100.0`)

### 1.3 Exact Inertia Tensor & Center-of-Mass Math (`MEK/mek_lib/reclaimer/hek/defs/objs/phys.py`)
Whenever a `phys` tag is compiled from `.jms` or edited in Mantle, the following derived fields **must** be recalculated:
1. **Per-Point Mass & Center of Mass**:
   $$\text{mass}_i = \text{total\_mass} \times \frac{\text{relative\_mass}_i}{\sum_{j=1}^N \text{relative\_mass}_j}$$
   $$\text{center\_of\_mass} = \frac{1}{\text{total\_mass}} \sum_{i=1}^N \text{mass}_i \cdot \text{position}_i$$
2. **Per-Point Density**:
   $$\text{den\_scale} = \frac{\text{total\_density}}{N} \sum_{j=1}^N \frac{\text{relative\_mass}_j}{\text{relative\_density}_j}, \quad \text{mass\_scale} = \frac{N}{\sum_{j=1}^N \text{relative\_mass}_j}$$
   $$\text{density}_i = \text{den\_scale} \times \text{mass\_scale} \times \text{relative\_density}_i$$
3. **3×3 Inertia Matrix $M$ and Inverse $M^{-1}$**:
   For each mass point $i$, let $(dx, dy, dz) = \text{position}_i - \text{center\_of\_mass}$ and let the solid sphere moment term be $r_{\text{term}} = 0.4 \times \text{radius}_i^2$:
   $$\begin{aligned}
   xx &= \sum_i \text{mass}_i \cdot (dy^2 + dz^2 + r_{\text{term}}) \\
   yy &= \sum_i \text{mass}_i \cdot (dx^2 + dz^2 + r_{\text{term}}) \\
   zz &= \sum_i \text{mass}_i \cdot (dx^2 + dy^2 + r_{\text{term}}) \\
   xy &= \sum_i \text{mass}_i \cdot (dx \cdot dy), \quad zx = \sum_i \text{mass}_i \cdot (dx \cdot dz), \quad yz = \sum_i \text{mass}_i \cdot (dy \cdot dz)
   \end{aligned}$$
   Multiply by `moment_scale`:
   $$M = \text{moment\_scale} \times \begin{bmatrix} xx & -xy & -zx \\ -xy & yy & -yz \\ -zx & -yz & zz \endend{bmatrix}$$
   Store `xx_moment = M[0][0]`, `yy_moment = M[1][1]`, `zz_moment = M[2][2]`, write $M$ into `inertial_matrix_and_inverse[0]`, and write the 3×3 matrix inverse $M^{-1}$ into `inertial_matrix_and_inverse[1]`.

### 1.4 Point Physics (`pphy`, `64` bytes)
Used by particles (`part`, `pctl`), contrails (`cont`), and weather (`rain`).
- Derived constants calculated at save time (`MEK/mek_lib/reclaimer/hek/defs/objs/pphy.py`):
  - `runtime_mass_over_radius_cubed` (`0x04`): `density * 355840.0 / 3.0`
  - `water_gravity_scale` (`0x08`): `-((density - 1.0) / (density + 1.0))` (so particles with `density < 1.0` like air bubbles float upward in water!)
  - `air_gravity_scale` (`0x0C`): `-((density / 0.0011 - 1.0) / (density / 0.0011 + 1.0))`

---

## 2. How Vehicles (`vehi`), Seats (`unit.seats`) & Camera Tracks (`trak`) Are Made

### 2.1 Vehicle Types & Steering Models (`vehi` at `0x2F4`)
- `0 = human_tank` (Scorpion): Differential tread steering using `powered_mass_points`, `maximum_forward_speed`, `maximum_reverse_speed`, `turn_rate`.
- `1 = human_jeep` (Warthog): Ackermann wheel steering (`maximum_left_turn`, `maximum_right_turn` [negative!], `wheel_circumference`, `turn_rate`, `overdampen_cusp_angle`, `overdampen_exponent`).
- `2 = human_boat`, `3 = human_plane` (Pelican).
- `4 = alien_scout` (Ghost): Hover vehicle using `antigravity` `powered_mass_points`.
- `5 = alien_fighter` (Banshee): Pitch/bank aerial vehicle.
- `6 = turret` (Shade / Gun Turret): Stationary rotating mount.

### 2.2 Vehicle Animations (`antr.vehicles` & `antr.suspension_animations`)
1. **`vehicles` block in `model_animations` (`antr`)**:
   - Uses `.JMO` **overlay animations** driven by vehicle physics state:
     - `steering`: Frame 0 = full left turn, middle frame = straight ahead, final frame = full right turn.
     - `roll`, `throttle`, `velocity`, `braking`, `ground-speed`, `occupied`, `unoccupied`.
2. **`suspension_animations` block in `model_animations` (`antr`, max 8 tracks)**:
   - Links a wheel's `mass_point_index` (in `phys.mass_points`) to a `.JMO` overlay animation (e.g., `suspension front left.JMO`).
   - Interpolates the wheel bone between `full_extension_ground_depth` (Frame 0, wheel hanging down in midair) and `full_compression_ground_depth` (Final frame, wheel compressed up into fender).

### 2.3 Seats (`unit.seats`, max 16, `284` bytes each) & Camera Tracks (`trak`)
- **`label` (`0x04` `String32`)**: e.g., `W-driver`, `W-gunner`, `W-passenger`, `G-driver`, `B-driver`, `S-driver`. **Critical Rule**: A biped can ONLY enter a vehicle seat if the biped's `model_animations` (`antr.units`) contains a matching unit seat label!
- **`marker_name` (`0x24` `String32`)**: The `#marker` on the vehicle's `gbxmodel` where the rider's origin attaches.
- **`camera_marker_name` (`0x74` `String32`) & `camera_tracks` (`trak`)**:
  - `camera_track` (`trak`) contains up to **16 quaternion + position control points** defining the 3rd-person camera arc from looking straight down (Point 0) to looking straight up (Last Point) relative to `camera_marker_name`.

---

## 3. How Doors, Elevators & Interactive Devices (`devi`, `mach`, `ctrl`, `lifi`) Are Made

### 3.1 Class Hierarchy & State Model (`power` & `position` $\in [0.0, 1.0]$)
All interactive map devices inherit from `object` (`0x000`–`0x17B`) $\rightarrow$ `device` (`devi`, `0x17C`–`0x28F`), and specialize into:
1. **`device_machine` (`mach`, `804` bytes)**: Doors (`0`), Platforms/Elevators (`1`), and Rotating Gears (`2`).
2. **`device_control` (`ctrl`, `792` bytes)**: Toggle switches (`0`), On buttons (`1`), Off buttons (`2`), and Multi-floor Elevator Call buttons (`3`, which set the group to `call_value`).
3. **`device_light_fixture` (`lifi`, `720` bytes)**: Scripted or switch-controlled lights.

### 3.2 Step-by-Step Workflow for Building a Working Door (`device_machine`)
1. **Bone Hierarchy & Collision Parenting Rule**:
   - Create a root bone (`frame`) and one child bone per moving door panel (`frame_left_door`, `frame_right_door`).
   - **CRITICAL**: In the collision model (`coll`), each door panel's collision geometry **must be parented to its moving bone (`frame_left_door`, `frame_right_door`)**, NOT the static root bone! Halo moves each `coll` BSP node 1:1 with its `gbxmodel`/`antr` bone; if parented to the root bone, the visual door opens while an invisible collision wall stays closed!
2. **Overlay Animation (`device position.JMO`)**:
   - Export an **overlay animation (`.JMO`, NOT `.JMA`!)** named **`device position.JMO`**:
     - **Frame 0**: Closed position (`0.0`).
     - **Final Frame**: Fully open position (`1.0`).
   - When compiled into `antr`, `device position.JMO` populates `antr.devices[0].animations[0]` (`position`).
   - **How Timing Works**: The speed of the door in-game is **independent** of the `.JMO` frame count; it is controlled entirely by `devi.position_transition_time` (in seconds) and `devi.position_acceleration_time`!
3. **Derived Tick Recalculation Required on Save (`objs/devi.py` & `mach`)**:
   When editing a `mach` or `devi` tag in Mantle, we must recalculate the internal inverse-tick fields (`0x26C`–`0x284` and `0x320`):
   - `inv_power_transition_time` (`0x26C`) = `1.0 / (30.0 * power_transition_time)`
   - `inv_power_acceleration_time` (`0x270`) = `1.0 / (30.0 * power_acceleration_time)`
   - `inv_position_transition_time` (`0x274`) = `1.0 / (30.0 * position_transition_time)`
   - `inv_position_acceleration_time` (`0x278`) = `1.0 / (30.0 * position_acceleration_time)`
   - `delay_time_ticks` (`0x284`) = `Math.floor(30.0 * delay_time)`
   - `door_open_time_ticks` (`0x320`) = `Math.floor(30.0 * door_open_time)`
4. **Bounding Radius & Automatic Proximity Opening**:
   - `object.bounding_radius` (`0x04`) must cover the full extent of the door when open.
   - If `mach.machine_type == 0 (door)` and `scnr.machines[i].machine_flags` does **not** have `does_not_operate_automatically` checked, the engine scans a sphere of radius `devi.automatic_activation_radius` (`0x21C`, falling back to `object.bounding_radius` if `0`) every 4 ticks for approaching bipeds, opens the door (`1.0`), waits `door_open_time` seconds after the doorway clears, and closes it (`0.0`).
5. **Wiring a `device_control` Switch to a `device_machine` Door in `scnr` (Zero Scripts Needed)**:
   - Create an entry in `scnr.device_groups` (`0x288`, `52` bytes: `name`, `initial_value = 0.0`).
   - Assign that `device_group` index to **both** `scnr.machines[door].position_group` (`+0x2A`) and `scnr.controls[switch].position_group` (`+0x2A`), and check `does_not_operate_automatically` on the machine placement.
   - Pressing `E` on the switch (`triggers_when = 0 touched_by_player`) or shooting the switch (`triggers_when = 1 destroyed`) toggles the shared `device_group`, opening/closing all linked doors simultaneously!

---

## 4. Skeletal Animations (`antr` & `.JMA`–`.JMW` Formats)

| Extension | Root Node Movement (`frame_info_type`) | Node Transform Mode | Primary Use Case in Halo CE |
| :---: | :--- | :--- | :--- |
| **`.JMA`** | `dx, dy, dyaw` (2D horizontal + yaw) | Absolute bone transforms | Biped walk, run, strafe, and turn locomotion cycles |
| **`.JMM`** | `none` (Stationary root) | Absolute bone transforms | Idle poses, first-person weapon animations (`fp_animations`), vehicle enter/exit |
| **`.JMT`** | `dx, dy` (2D horizontal, no yaw) | Absolute bone transforms | Translational movement without root rotation |
| **`.JMZ`** | `dx, dy, dz, dyaw` (Full 3D + yaw) | Absolute bone transforms | Climbing, vaulting, airborne leaps, and vertical root motion |
| **`.JMW`** | World-relative (`world` flag) | Absolute world space `(0,0,0)` | Full-scene cinematic animations anchored to world origin |
| **`.JMO`** | `none` | **Additive Frame-0 Offsets (Overlay)** | Aiming screens (`aim-still`, `aim-move`), weapon fire/reload recoil overlays, vehicle `steering`/`suspension`, and **`device position.JMO`** for doors! |
| **`.JMR`** | `none` | **Selective Bone Replacement** | Upper-body reload, grenade throw, or melee while lower-body legs keep running |

---

## 5. How OpenCE Mantle Automates Physics, Vehicles, Doors & Animations

1. **Interactive 3D Vehicle Physics & Mass-Point Editor (Planned for `ScenarioViewport` / `ModdingStudio`)**:
   - Render `phys.mass_points` as interactive 3D spheres overlaid on the vehicle's `gbxmodel` mesh, with color coding for `ground_friction` tires, `antigrav` repulsors, and unpowered hull spheres.
   - Let users drag spheres with 3D gizmos, adjust `radius` and `relative_mass`, mirror left/right spheres (`y -> -y`), and automatically run `calc_internal_data()` (`center_of_mass` + 3×3 `inertial_matrix_and_inverse`) on save!
2. **1-Click Interactive Door & Switch Builder**:
   - Convert any static `.obj` or `.scenery` into an animated `.device_machine` door by letting the user set the **Closed Pose** and **Open Pose** with a 3D gizmo in Mantle: Mantle automatically builds the 2-bone `mod2`, `coll`, and `antr` (`device position` track), populates `inv_position_transition_time` and `door_open_time_ticks`, and lets users draw a visual link line from any `device_control` switch to any `device_machine` door in the 3D Viewport!

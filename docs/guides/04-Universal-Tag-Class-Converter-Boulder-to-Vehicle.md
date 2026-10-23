# Guide 4: Universal Tag Class Converter & Driving a Scenery Boulder (`scen` → `vehi`)

## What Are the Benefits & Use Cases of the Universal Tag Class Converter?
OpenCE Mantle's **Universal Tag Class Converter (`Tools` → `Universal Tag Converter, Error Scanner & Mod Studio...`)** provides 4 conversion pipelines that previously required external command-line tools or manual hex editing:

1. **`11-Class Object ↔ Object Converter` (`scen`, `vehi`, `weap`, `bipd`, `eqip`, `garb`, `proj`, `mach`, `ctrl`, `lifi`, `ssce`)**:
   - **Use Case A (`Scenery` → `Vehicle`, e.g., Driveable Boulder / Tree / Crate)**: Turns any static 3D scenery object into a driveable vehicle complete with inherited Warthog seats, entry markers, physics (`phys`), and animation node tables!
   - **Use Case B (`Vehicle` / `Weapon` / `Biped` → `Scenery`)**: Turns any vehicle (like a Pelican or Scorpion), weapon, or character biped into a static prop (`scenery`) so you can place 50 of them around a map as decorative cover or dioramas without hitting Halo CE's network vehicle/AI limits.
   - **Use Case C (`Scenery` / `Equipment` → `Projectile`)**: Makes a grenade launcher or tank fire boulders, crates, or Oddball skulls as projectiles!
2. **`Collision Model (coll) → Visible GBXModel (mod2) & Scenery`**:
   - Extracts the invisible 3D collision BSP geometry from any `.coll` tag and compiles it into a visible 3D mesh so you can inspect or place collision geometry in-game.
3. **`Structure BSP (sbsp) → GBXModel (mod2) & Placeable Scenery (scen)`**:
   - Extracts an entire level's BSP terrain mesh and turns it into a placeable scenery tag.
4. **`.JMS → .OBJ Source Converter`**:
   - Converts legacy Halo CE `.JMS` (version `8200`) model/physics source files into standard Wavefront `.OBJ` files for Blender or Mantle's Custom Object Builder.

---

## Why Your Converted Boulder Didn't Spawn or Have a Seat Before (And How We Fixed It!)
Previously, when converting `scenery\boulders\...` (`508` bytes) to `vehicle` (`1008` bytes), only the first `380` bytes (`Object` base header) were copied, leaving bytes `380..1008` (`Unit` seats + `Vehicle` speed/turn/mass points) zeroed out and `physics` (`phys`) / `animation graph` (`antr`) set to `Null`. In Halo CE, a vehicle with `0` seats, `Null` physics, and a 1-node `gbxmodel` cannot be entered or driven.

### What `convertObjectTagClassInMap` Does Now:
When you convert any `scenery` tag (like a boulder) to `vehicle`:
1. It automatically finds a donor vehicle in the map (preferring `warthog` or `ghost`) and copies its `Unit` + `Vehicle` tail (`+380..1008`), giving the converted boulder **working driver/passenger/gunner seats, camera tracks, speed, turn rate, and suspension**!
2. It inherits the donor vehicle's **`physics` (`phys`)** and **`animation graph` (`antr`)** dependencies.
3. It creates dedicated `_model` (`mod2`) and `_collision` (`coll`) copies of the boulder that keep the **boulder's 3D visual mesh, shaders, and 3D boulder collision BSP on node 0**, while grafting the donor vehicle's **node hierarchy and seat entry markers (`lf_enter`, `driver`, etc.)** so Halo CE spawns the boulder as a vehicle and lets Master Chief climb inside and drive it!

---

## Step-by-Step Walkthrough: Convert a Boulder into a Driveable Vehicle!
1. Open **`bloodgulch.map`** (or `whatitistobe_copy.map`) in OpenCE Mantle.
2. Go to **`Tools` → `Universal Tag Converter, Error Scanner & Mod Studio...`**.
3. In **Tab 1 (`1. Universal Tag Class Converter & .JMS Compiler`)**, look at **Card 3 (`11-Class Object ↔ Object Converter`)**:
   - In the left dropdown, select **`[scenery] scenery\boulders\boulder_large\boulder_large`** (or any boulder/rock/tree tag).
   - In the target class dropdown (`→`), select **`vehicle`**.
   - Click **`Convert Object Class`**.
   - You will see a green banner:
     `Converted "scenery\boulders\..." (scenery) -> "scenery\boulders\..._as_vehicle" (vehicle) ... Inherited vehicle seats, physics, and rig markers from "vehicles\warthog\mp_warthog".`
4. Close the Mod Studio dialog. Now let's spawn the Boulder Vehicle in the map!
   - **Quickest Way (Swap an Existing Warthog in the 3D Viewport or Scenario Palette)**:
     1. In the left Tag Tree, expand **`scenario` (`scnr`)** and double-click the scenario tag to open the **Tag Editor**.
     2. Expand **`vehicle palette` (`scnr.vehicle palette`)**.
     3. Change **`vehicle palette[0].name`** (which is `vehicles\warthog\mp_warthog`) to your new **`scenery\boulders\..._as_vehicle`** tag!
     4. *(Or click **`+ Add Chunk`** on `vehicle palette`, select your `..._as_vehicle` tag, and in `vehicles[0].type` select the new palette entry!)*
5. Press **`Ctrl+S`** to save (or click **`Run in OpenCE`** directly).
6. Walk up to the Warthog spawn point: **a giant 3D Boulder is parked there! Walk up to it, press `E` to enter the driver's seat, and drive the boulder around Blood Gulch!**

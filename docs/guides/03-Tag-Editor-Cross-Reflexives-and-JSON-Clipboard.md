# Guide 3: Tag Editor Group/Field Descriptions, Cross-Reflexive Dropdowns & JSON Clipboard

## What Is This Feature & Why Is It Useful?
Previously, editing Halo CE tags required memorizing cryptic raw integer indices (like knowing what `vehicles[2].type = 1` or `vehicles[2].name = 0` meant) or manually re-typing 30+ fields when copying a weapon barrel, vehicle seat, or camera point from one tag to another.

This feature adds three major productivity upgrades inside the **Tag Editor (`Raw Fields` tab & right-side `Tag Properties` dock)**:

---

## 1. Tag Class Overview Banner & Field Descriptions
- **Where to see it**: Click any tag in the left Tag Tree (or click any 3D object in the 3D Viewport) to open its fields.
- **What it shows**:
  1. At the top of the Tag Field Editor, a cyan **Tag Class Overview Banner** explains what that Halo CE tag class (`vehi`, `weap`, `scnr`, `mod2`, `coll`, `soso`, `actv`, `jpt!`, etc.) controls in the Blam! engine.
  2. Next to individual fields (`bounding radius`, `render bounding radius`, `acceleration scale`, `max forward speed`, `rounds per second`, `error angle`, `damage lower bound`, etc.), a subtle description explains the exact units (`world units`, `ticks`, `seconds`, `radians`, `[0..1]`) and gameplay effect.

---

## 2. Smart Cross-Reflexive Dropdowns (`name`, `type`, `palette`, `marker`, `node`)
Instead of forcing you to type raw `int16` index numbers (`-1`, `0`, `1`, `2`...) when linking reflexive arrays inside a tag, the Tag Editor automatically resolves cross-reflexive integer indices into human-readable **Dropdown Menus**:

| Tag / Reflexive Block | Field Name | Automatically Resolves To Dropdown Of: |
|---|---|---|
| `scnr.vehicles[i]` | `type` | `scnr.vehicle palette` (`#0: mp_warthog`, `#1: ghost`, ...) |
| `scnr.vehicles[i]` | `name` | `scnr.object names` (`-1: None`, `#0: pelican_01`, `#1: hog_drop_01`, ...) |
| `scnr.bipeds[i]` | `type` / `name` | `scnr.biped palette` / `scnr.object names` |
| `scnr.scenery[i]` | `type` / `name` | `scnr.scenery palette` / `scnr.object names` |
| `scnr.weapons[i]` | `type` / `name` | `scnr.weapon palette` / `scnr.object names` |
| `scnr.ai_squads[i]` | `actor type` | `scnr.actor palette` |
| `gbxmodel` / `coll` | `node index` | `nodes` (`#0: frame hull`, `#1: frame lf tire`, ...) |
| `vehi` / `weap` | `shader index` | `shaders` (`#0: warthog hull`, `#1: warthog tires`, ...) |

### How to Test Cross-Reflexive Dropdowns:
1. Open `bloodgulch.map` or `whatitistobe_copy.map`.
2. Double-click the `scenario` (`scnr`) tag to open the **Tag Editor**.
3. Scroll down to **`vehicles`** (`scnr.vehicles`) and expand **`#0`**.
4. Click the **`type`** dropdown to switch the vehicle type among entries in `vehicle palette`, or click the **`name`** dropdown to assign any entry from `object names`!

---

## 3. Reflexive Chunk JSON Clipboard (`Copy JSON` / `Paste JSON`)
Every reflexive block element header (`#0`, `#1`, `#2`, ...) now has **`Copy JSON`** and **`Paste JSON`** buttons on the right side of its header bar.

### Use Cases:
- **Copy a Vehicle Seat**: Copy the passenger/gunner seat (`seats[1]`) from a Warthog and paste it into a custom vehicle's `seats[0]`.
- **Copy Weapon Barrels / Triggers**: Copy a Plasma Rifle's firing barrel stats (`triggers[0]`) and paste them onto an Assault Rifle.
- **Duplicate & Tweak Scenario Encounters or Cutscene Camera Points**: Copy `cutscene_camera_points[0]` as JSON, click `+ Add Chunk`, and click `Paste JSON` on `#1`.

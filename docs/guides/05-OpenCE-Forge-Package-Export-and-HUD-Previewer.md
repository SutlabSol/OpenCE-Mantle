# Guide 5: Exporting OpenCE Forge Packages (`.ocetags`) & Authentic Halo CE HUD Previewer

## Part 1: How to Export a Custom Weapon Skin, Custom Model, or Vehicle in OpenCE's `.ocetags` Package Format

When you create a custom weapon skin (via the Bitmap Editor), modify a weapon's projectiles/stats (via the Tag Editor), or build a custom 3D model/vehicle, OpenCE uses self-contained **`.ocetags`** packages (stored in `OpenCE\assets\custom_items\` or injected via Mantle's `Inject Tags...`).

### Method A: From the OpenCE Mod Studio (`Tools` → `OpenCE Mod Packager (.ocetags / mod.toml / XML)...`)
1. Open your map containing your customized weapon, vehicle, biped, or scenery tag.
2. Go to **`Tools` → `OpenCE Mod Packager (mod.toml / XML)...`** (Tab 3 of the Mod Studio).
3. In the top card (**`OpenCE Forge & Mantle Package Exporter (.ocetags)`**):
   - Select your root tag in the dropdown (for example, `[weapon] weapons\assault rifle\assault rifle` after you have painted or imported a custom skin on its bitmap!).
   - Enter a **Forge Display Name** (e.g., `Gold Assault Rifle`).
   - Click **`Export OpenCE Package (.ocetags)...`** and save it (e.g. into your OpenCE `assets\custom_items\` folder or anywhere on disk).
   - **What gets bundled automatically**: OpenCE Mantle walks the entire dependency tree of that tag and bundles the root tag, its `gbxmodel` (including 3D vertices and triangle strips), `model_collision_geometry`, `shader_model`, custom `bitmap` pixel data, `sound` permutations, projectiles, and HUD interfaces into a single `.ocetags` file!

### Method B: Directly from the Left Tag Tree (`Extract Checked...`)
1. Check the checkbox next to any tag(s) in the left Tag Tree.
2. Click **`Extract Checked...`** in the top toolbar to export a `.ocetags` package.

---

## Part 2: Authentic Halo CE HUD Previewer (`HudPreviewerDialog`)

### What We Fixed
The HUD Previewer now renders the **exact in-game Halo: Combat Evolved HUD layout**:
1. **Top-Right Corner (`anchor = top right`)**:
   - Stepped cyan **Shield Bar** (depletes from left to right into the right-hand shield tab, turns flashing red when critical `<= 20%`).
   - **8 Slanted Health Pips** tucked directly underneath the left half of the shield bar (cyan when healthy, amber at medium health, red when critical).
2. **Top-Left Corner (`anchor = top left`)**:
   - **Frag & Plasma Grenade Boxes** at the very top-left with grenade silhouettes and counts.
   - **Angled Ammo Bracket** directly underneath with the **Reserve Ammo Counter** on the left and the **Individual Bullet / Shell / Rocket / Needle Pip Grid** on the right (`60` bullet pips in `2×30` rows for the MA5B Assault Rifle, `12` rounds for the M6D Pistol, `12` shells for the Shotgun, `4` rounds for the Sniper Rifle, `2` rockets for the SPNKr, `20` needles for the Needler, or the **Plasma Core Battery + Heat Meter** for Covenant weapons).
3. **Bottom-Left Corner (`anchor = bottom left`)**:
   - Circular **Motion Tracker (Radar)** with forward FOV wedge cone, `15m` range indicator, sweeping radar line, golden ally dots, and red enemy blips.
4. **Center Crosshair & Live Decoded Tag Bitmaps**:
   - Switch between all 8 Halo CE weapon reticles in the top toolbar (`Weapon HUD:` dropdown), test firing (`F`), reloading (`R`), switching grenades (`G`), and zooming (`Z`), and view the **actual decoded bitmap sprite sheets** referenced by the open HUD tag at the bottom of the dialog!

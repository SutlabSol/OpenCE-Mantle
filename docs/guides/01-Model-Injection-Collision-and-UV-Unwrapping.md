# Guide 1: Custom 3D Model Injection, Blender-Parity Collision & 3 UV Unwrap Modes

## Overview & Benefits
OpenCE Mantle's **Build Custom 3D Object Tag (`Tools` → `Build Custom 3D Object Tag (.obj)...`)** compiles any Wavefront `.obj` 3D model and `.png`/`.dds` texture into a complete, self-contained Halo CE tag set:
- `bitmap` (`.bitm`)
- `shader_model` (`.soso`)
- `gbxmodel` (`.mod2`)
- `model_collision_geometry` (`.coll`)
- Root object tag (`scenery`, `vehicle`, `weapon`, or `equipment`)

---

## 1. Prominent Face / Triangle Counter Badge
As soon as you pick a `.obj` file in **Step 2**, OpenCE Mantle parses the mesh and displays a prominent counter badge on the right side of the Step 2 header:
- **Faces / Triangles**: Exact triangle count of your `.obj` mesh (color-coded green when `<= 2,048` triangles or amber for high-poly meshes).
- **Vertices**: Total compiled vertex count.
- **Collision Surfaces**: Number of merged coplanar convex collision polygons generated for Halo CE's physics engine.

---

## 2. Three Built-In UV Unwrap Modes (Step 3)
If your `.obj` model does not have UV coordinates (or if its UVs overlap/stretch), you can check **"Override OBJ UVs with Built-In Unwrapper"** in **Step 3** and choose between **3 UV Unwrap Modes**:

### Mode A: `Per-Triangle Grid (Every Triangle Separated in Order)` *(Recommended for Hand-Painting Faces)*
- **What it does**: Gives **every single triangle** (`#1 .. #N`) its own isolated, non-overlapping square cell in a sequential `ceil(sqrt(N)) × ceil(sqrt(N))` grid, ordered from top-left to bottom-right in the exact face order of your `.obj` file!
- **Why use it**: Zero overlapping faces! Every triangle is separated into its own padded cell (`10%..90%` of the cell interior) so painting on any triangle in the exported UV template never bleeds onto any other face.

### Mode B: `Smart Angle Unwrap (Connected Coplanar Islands)` *(Blender-Style Smart UV Project)*
- **What it does**: Groups connected triangles whose surface normals are within `42°` (`cos >= 0.74`) into planar UV islands, projects each island onto its dominant 2D tangent plane preserving true aspect ratio, and packs all islands into a non-overlapping grid.
- **Why use it**: Keeps flat walls, roofs, slopes, and bevels together as continuous UV islands while preventing 90° edges from folding over each other.

### Mode C: `6-Side Box Unfold (+X, -X, +Y, -Y, +Z, -Z)`
- **What it does**: Projects each triangle onto one of 6 directional cube faces (`+X`, `-X`, `+Y`, `-Y`, `+Z`, `-Z`) arranged in a `3 × 2` atlas.
- **Why use it**: Best for simple box-like crates, pillars, or architectural blocks.

---

## 3. Step-by-Step Workflow to Export & Paint a Per-Triangle or Smart UV Map
1. Open any map in OpenCE Mantle and go to **`Tools` → `Build Custom 3D Object Tag (.obj)...`**.
2. In **Step 2**, click **Browse .OBJ...** and select your `.obj` file. Check the **Faces / Triangles** counter badge at the top-right of Step 2.
3. In **Step 3**, select **`Per-Triangle Grid (Every Triangle Separated in Order)`** or **`Smart Angle Unwrap (Connected Coplanar Islands)`** from the UV Unwrap dropdown.
4. Click **Export UV Wireframe Template (.PNG)...** and save the `1024×1024` guide image.
5. Paint over the template in Photoshop, GIMP, Krita, or Paint.NET, save your painted `.png`, and select it via **Browse .PNG / .DDS...** in Step 3.
6. Click **Compile & Inject Object**!

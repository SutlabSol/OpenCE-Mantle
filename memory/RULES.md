# Standing rules (apply to every task, not just the one that introduced them)

- Work on copies. Never modify sample maps. Write outputs via temp file then rename.
  Never overwrite the source map. Cancel leaves no partial file.
  ONE permitted exception (user-approved 2026-10-11): File > Save may overwrite the map
  the user opened - only File > Save, only after the backup prompt was offered on open
  (and a confirmation when the backup was skipped or failed), only via a temp file in the
  same folder + atomic rename after finalizeForSave, and refused when the file changed on
  disk since it was opened. Never for a map opened from a .bak. Every other operation
  (Inject, Save As, Extract, Decompress/Recompress, converter) writes a new file; Inject
  writes nothing (in memory until Save / Save As).
- Tests use the shared SAMPLE_MAPS_DIR helper, never a hardcoded /app path. Read map
  files inside beforeAll, never at describe scope.
- Node 22 LTS and Yarn 1 only. No major dependency upgrades without asking.
- Report status as "verified by tests", "verified in mock preview", or "unverified".
  Never call a milestone done on tests alone; user confirms on Windows and in OpenCE.
- If an offset, size, or flag is ambiguous, stop and ask. Log each such decision in
  SOURCES.md or PRD.md.
- Stay inside the milestone named. Flag header/CRC fix-ups instead of building M6
  work. Don't start M7.
- Embedded (external=0) data relocation stays disabled until verified against real
  bytes in ui.map. Synthetic tests alone must never enable it. Until then, ADD blocks
  tags with embedded bytes outside the tag struct, with a plain-language warning
  listing the tag path.
- External (external=1) data is metadata only. Compare resource map fingerprints
  between container and target, and warn on mismatch. A bounds check alone is not
  enough.
- Containers flagged with unresolved BSP references: refuse or warn before injecting.
- Dependencies already in the target are reused, not duplicated. The dialog lists
  reused, added, and skipped tags.
- Validate before writing: tag count limit, tag data size limit, missing
  dependencies, unresolved references. Refuse to produce a map that can't be valid,
  and say why.
- Normalize tag paths (backslashes, case-insensitive) for conflict detection, and
  preserve original casing when writing.
- Handoff notes: max 25 lines. Cover what changed, what's verified and how, what's
  unverified, and exact Windows and OpenCE test steps. No file-by-file narration.
- Run targeted tests for the area changed. Run the full suite and screenshots only at
  the end of a milestone step.
- Do not run the testing agent, screenshot tool, or full-stack tests unless the user asks.
- The user builds and tests on Windows each iteration. Every handoff must give: exact
  build commands, exact click-through steps, and what they should see.
- For map-writing changes, include a self-check the user can run: open a map, save it
  unchanged, and compare bytes against the original, listing every expected difference.
- No logic keyed to a specific map name, tag path, or file size. Format-level constants
  (fixed struct-layout byte offsets, sentinel values like 0xFFFFFFFF) are fine - they
  apply to every v609 map. A check or branch that only fires for one named map/tag or
  one observed size is not.
- Version numbering on every build release (Standard SemVer `MAJOR.MINOR.PATCH`):
  - Every new feature increments the 2nd number (`MINOR`: `0.1.0` -> `0.2.0` -> `0.3.0`) in both `core/package.json` and `desktop/package.json`.
  - Every bugfix, optimization, or UI change increments the 3rd number (`PATCH`: `0.2.0` -> `0.2.1` -> `0.2.2`) in both `core/package.json` and `desktop/package.json`.
  - Every fresh build via `desktop/build-dist.js` automatically renames and updates the user's Desktop shortcut (`OpenCE Mantle <version>.lnk`) in-place so its icon position is preserved and it always launches the latest `OpenCE Mantle <version>.exe`.

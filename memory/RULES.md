# Standing rules (apply to every task, not just the one that introduced them)

- Work on copies. Never modify sample maps. Write outputs via temp file then rename.
  Never overwrite the source map. Cancel leaves no partial file.
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

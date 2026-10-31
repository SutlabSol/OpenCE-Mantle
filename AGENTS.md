# OpenCE Mantle — Repository Rules & Standards

## 1. Mandatory Semantic Versioning (`MAJOR.MINOR.PATCH`) on Every Build & Release
Whenever you modify code, fix bugs, refine UI, or add features and produce a build or release (`node build-dist.js`, `yarn dist:win`, or a GitHub release), you **MUST automatically increment the version number** according to industry-standard Semantic Versioning (**SemVer 2.0.0**) without waiting for the user to remind you:

- **PATCH (`X.Y.Z` → `X.Y.(Z+1)`)**: Bug fixes, workflow fixes, UI/UX refinements, performance improvements, and code audit cleanups.
- **MINOR (`X.Y.Z` → `X.(Y+1).0`)**: New feature milestones, major new studios/panels, or backwards-compatible architectural expansions.
- **MAJOR (`X.Y.Z` → `(X+1).0.0`)**: Major platform milestones or breaking format/API changes.

### Version Synchronization Checklist (Always Update Together)
Every version bump **must** be synchronized across all of the following files before running `node build-dist.js`:
1. `desktop/package.json` (`"version": "X.Y.Z"`)
2. `core/package.json` (`"version": "X.Y.Z"`)
3. `desktop/src/App.tsx` (`useState<string>('X.Y.Z')`)
4. `desktop/src/components/WorkspaceHome.tsx` (`appVersion || 'X.Y.Z'` fallbacks)
5. `desktop/src/components/HelpAboutModal.tsx` (`appVersion || 'X.Y.Z'` fallback)
6. `desktop/src/components/WhatsNewModal.tsx` (Add a new top entry in `RELEASE_NOTES` for `'X.Y.Z'` summarizing the changes)

After updating the version strings, run `node build-dist.js` in `desktop/` so that:
- `desktop/release/OpenCE Mantle X.Y.Z.exe` and `OpenCE Mantle Setup X.Y.Z.exe` are generated with the new version.
- Previous `.exe` builds in `desktop/release/` are automatically archived into `Legacy Builds.zip`.
- The user's Desktop shortcut (`OpenCE Mantle X.Y.Z.lnk`) is updated to point to the latest `.exe`.

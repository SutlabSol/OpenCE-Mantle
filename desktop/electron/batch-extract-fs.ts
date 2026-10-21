import * as fs from 'fs';
import * as path from 'path';
import type { BatchExtractManifest } from './shared-types';

const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/**
 * Sanitizes a map name for use as a folder name.
 * Strips extensions (.map, .bak) and replaces characters forbidden on Windows.
 */
export function sanitizeMapName(mapFileNameOrPath: string): string {
  const base = path.basename(mapFileNameOrPath);
  const withoutExt = base.replace(/\.bak$/i, '').replace(/\.map$/i, '');
  let sanitized = withoutExt.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/, '').trim();
  if (WINDOWS_RESERVED_NAMES.has(sanitized.toUpperCase())) {
    sanitized = `_${sanitized}_`;
  }
  return sanitized || 'exported_map';
}

/**
 * Sanitizes a single path segment (directory name or filename stem) for Windows.
 */
function sanitizeSegment(segment: string): string {
  let cleaned = segment.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/, '').trim();
  if (!cleaned) cleaned = '_';
  if (WINDOWS_RESERVED_NAMES.has(cleaned.toUpperCase())) {
    cleaned = `${cleaned}_`;
  }
  return cleaned;
}

/**
 * Converts a Halo CE tag path and group into a relative directory and filename.
 * E.g. "weapons\\assault rifle\\assault rifle", "weapon"
 * -> relativeDir: "weapons\\assault rifle"
 * -> fileName: "assault rifle.weapon.ocetags"
 * -> fullRelativePath: "weapons\\assault rifle\\assault rifle.weapon.ocetags"
 */
export function sanitizeTagRelativePath(
  tagPath: string,
  group: string,
): { relativeDir: string; fileName: string; fullRelativePath: string } {
  const normalized = tagPath.replace(/[\/\\]+/g, '\\').replace(/^\\+|\\+$/g, '');
  const rawSegments = normalized.split('\\').filter((s) => s.length > 0);
  const rawLeaf = rawSegments.length > 0 ? rawSegments.pop()! : 'tag';
  const leafSanitized = sanitizeSegment(rawLeaf);
  const groupSanitized = sanitizeSegment(group || 'tag');
  const fileName = `${leafSanitized}.${groupSanitized}.ocetags`;

  const dirSegments = rawSegments.map(sanitizeSegment);
  const relativeDir = dirSegments.join(path.sep);
  const fullRelativePath = relativeDir ? path.join(relativeDir, fileName) : fileName;

  return { relativeDir, fileName, fullRelativePath };
}

/**
 * Counts existing .ocetags files in target directory, excluding hidden / staging directories.
 */
export function countExistingOcetagsFiles(targetDir: string): number {
  if (!fs.existsSync(targetDir)) return 0;
  let count = 0;
  const queue = [targetDir];
  while (queue.length > 0) {
    const current = queue.pop()!;
    try {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue; // Skip hidden / staging folders
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          queue.push(full);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.ocetags')) {
          count++;
        }
      }
    } catch {
      // Best-effort skip unreadable folders
    }
  }
  return count;
}

/**
 * Returns free disk space in bytes for the drive containing dirPath, or null if unreadable.
 */
export function getDriveFreeSpace(dirPath: string): number | null {
  try {
    const stat = fs.statfsSync(dirPath);
    return stat.bavail * stat.bsize;
  } catch {
    return null;
  }
}

/**
 * Commits all staged files from stagingDir to targetDir, overwriting existing files if needed.
 * Deletes stagingDir when finished. Returns total files committed.
 */
export function commitStagedFiles(stagingDir: string, targetDir: string): number {
  if (!fs.existsSync(stagingDir)) return 0;
  let count = 0;
  const queue = [stagingDir];
  const filesToMove: string[] = [];

  while (queue.length > 0) {
    const current = queue.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
      } else if (entry.isFile()) {
        filesToMove.push(full);
      }
    }
  }

  for (const stagedFile of filesToMove) {
    const rel = path.relative(stagingDir, stagedFile);
    const dest = path.join(targetDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest)) {
      try {
        fs.unlinkSync(dest);
      } catch {
        // Fallback for Windows file handle delays
      }
    }
    fs.renameSync(stagedFile, dest);
    count++;
  }

  try {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  } catch {
    /* best effort cleanup */
  }

  return count;
}

/**
 * Recursively deletes stagingDir, leaving targetDir untouched.
 */
export function discardStagedFiles(stagingDir: string): void {
  if (fs.existsSync(stagingDir)) {
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      /* best effort cleanup */
    }
  }
}

/**
 * Generates a human-readable plaintext summary report for a batch extraction.
 */
export function generateBatchReportText(manifest: BatchExtractManifest): string {
  const lines: string[] = [];
  lines.push('======================================================================');
  lines.push('OpenCE Mantle - Batch Map Tag Extraction Report');
  lines.push('======================================================================');
  lines.push(`Map:           ${manifest.mapFileName}`);
  lines.push(`Scenario:      ${manifest.scenarioName}`);
  lines.push(`Extracted At:  ${manifest.extractedAt}`);
  lines.push(`Tool Version:  ${manifest.toolVersion} (Container format v${manifest.containerVersion})`);
  lines.push('');
  lines.push('SUMMARY:');
  lines.push('----------------------------------------------------------------------');
  lines.push(`Total tags in map:    ${manifest.summary.totalTagsInMap}`);
  lines.push(`Extracted containers: ${manifest.summary.extractedCount} files (${(manifest.summary.totalBytesWritten / 1024 / 1024).toFixed(2)} MB)`);
  lines.push(`Skipped (existing):   ${manifest.summary.skippedExistingCount}`);
  lines.push(`External tags:        ${manifest.summary.externalCount}`);
  lines.push(`Blocked tags:         ${manifest.summary.blockedCount}`);
  lines.push(`Failed tags:          ${manifest.summary.failedCount}`);
  lines.push('');

  if (manifest.blocked.length > 0) {
    lines.push(`BLOCKED TAGS (${manifest.blocked.length}):`);
    lines.push('----------------------------------------------------------------------');
    for (const b of manifest.blocked) {
      lines.push(`- "${b.path}" (${b.group}): ${b.reason}`);
    }
    lines.push('');
  }

  if (manifest.external.length > 0) {
    lines.push(`EXTERNAL TAGS (${manifest.external.length}):`);
    lines.push('----------------------------------------------------------------------');
    for (const ext of manifest.external) {
      lines.push(`- "${ext.path}" (${ext.group}): ${ext.reason}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Writes manifest.json and batch-extract-report.txt into targetDir.
 */
export function writeManifestAndReport(
  targetDir: string,
  manifest: BatchExtractManifest,
  reportText: string,
): { manifestPath: string; reportPath: string } {
  fs.mkdirSync(targetDir, { recursive: true });
  const manifestPath = path.join(targetDir, 'manifest.json');
  const reportPath = path.join(targetDir, 'batch-extract-report.txt');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  fs.writeFileSync(reportPath, reportText, 'utf-8');
  return { manifestPath, reportPath };
}

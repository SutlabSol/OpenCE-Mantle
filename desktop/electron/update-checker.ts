import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { app } from 'electron';
import type {
  DownloadUpdateResult,
  UpdateCheckResult,
  UpdateDownloadProgressEvent,
  UpdateReleaseAsset,
} from './shared-types';

export const GITHUB_REPO_OWNER = 'SutlabSol';
export const GITHUB_REPO_NAME = 'OpenCE-Mantle';

const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'codeload.github.com',
]);

let lastStagedUpdate: {
  version: string;
  assetName: string;
  installMode: 'installer' | 'portable';
  downloadedFilePath: string;
} | null = null;

/**
 * Returns true when OpenCE Mantle is running as a standalone electron-builder portable `.exe`.
 */
export function isRunningPortableBuild(): boolean {
  if (process.env.PORTABLE_EXECUTABLE_FILE) return true;
  try {
    const exePath = app.getPath('exe').toLowerCase();
    // NSIS per-user install lives under AppData\Local\Programs\opence-desktop
    if (exePath.includes('appdata\\local\\programs\\') || exePath.includes('program files')) {
      return false;
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * Normalizes a version string like "v0.6.8" or "V0.6.8-beta.1" into "0.6.8" / "0.6.8-beta.1".
 */
export function normalizeVersionString(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^[vV]\s*/, '');
}

/**
 * Compares two semantic version strings (e.g. "0.6.8" vs "0.7.0").
 * Returns:
 *  - `1` if `candidate` is newer than `current`
 *  - `-1` if `candidate` is older than `current`
 *  - `0` if equal
 */
export function compareSemver(currentRaw: string, candidateRaw: string): number {
  const curClean = normalizeVersionString(currentRaw);
  const candClean = normalizeVersionString(candidateRaw);
  if (!curClean || !candClean) return 0;
  if (curClean === candClean) return 0;

  const [curCore, curPre] = curClean.split('-', 2);
  const [candCore, candPre] = candClean.split('-', 2);

  const curParts = curCore.split('.').map((n) => parseInt(n, 10) || 0);
  const candParts = candCore.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(curParts.length, candParts.length, 3);

  for (let i = 0; i < len; i++) {
    const a = curParts[i] ?? 0;
    const b = candParts[i] ?? 0;
    if (b > a) return 1;
    if (b < a) return -1;
  }

  // If core versions match, a stable release (no prerelease tag) is newer than a prerelease
  if (curPre && !candPre) return 1;
  if (!curPre && candPre) return -1;
  if (curPre && candPre && curPre !== candPre) {
    return candPre.localeCompare(curPre, undefined, { numeric: true }) > 0 ? 1 : -1;
  }
  return 0;
}

function fetchJson(url: string, currentVersion: string, timeoutMs = 6500): Promise<{ statusCode: number; data: any }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `OpenCE-Mantle/${normalizeVersionString(currentVersion) || '0.6.8'}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        timeout: timeoutMs,
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          fetchJson(res.headers.location, currentVersion, timeoutMs).then(resolve, reject);
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            const parsed = text ? JSON.parse(text) : null;
            resolve({ statusCode: res.statusCode ?? 0, data: parsed });
          } catch {
            resolve({ statusCode: res.statusCode ?? 0, data: null });
          }
        });
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error('Update check request timed out.'));
    });
    req.on('error', (err) => {
      reject(err);
    });
  });
}

function classifyReleaseAssets(assets: any[]): {
  installerAsset: UpdateReleaseAsset | null;
  portableAsset: UpdateReleaseAsset | null;
} {
  if (!Array.isArray(assets)) {
    return { installerAsset: null, portableAsset: null };
  }
  let installerAsset: UpdateReleaseAsset | null = null;
  let portableAsset: UpdateReleaseAsset | null = null;

  for (const a of assets) {
    if (!a || typeof a.name !== 'string' || typeof a.browser_download_url !== 'string') continue;
    const nameLower = a.name.toLowerCase();
    if (!nameLower.endsWith('.exe')) continue;
    const entry: UpdateReleaseAsset = {
      name: a.name,
      browserDownloadUrl: a.browser_download_url,
      sizeBytes: typeof a.size === 'number' ? a.size : 0,
    };
    if (nameLower.includes('setup') || nameLower.includes('installer')) {
      if (!installerAsset) installerAsset = entry;
    } else {
      if (!portableAsset) portableAsset = entry;
    }
  }
  return { installerAsset, portableAsset };
}

/**
 * Checks GitHub Releases for `SutlabSol/OpenCE-Mantle` and compares the latest tag against `currentVersion`.
 */
export async function checkForGitHubUpdates(currentVersion: string): Promise<UpdateCheckResult> {
  const normCurrent = normalizeVersionString(currentVersion) || '0.6.8';
  const latestUrl = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`;
  const allReleasesUrl = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases?per_page=5`;
  const repoReleasesPage = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases`;

  try {
    let releaseObj: any = null;
    const latestRes = await fetchJson(latestUrl, normCurrent);
    if (latestRes.statusCode === 200 && latestRes.data && typeof latestRes.data.tag_name === 'string') {
      releaseObj = latestRes.data;
    } else if (latestRes.statusCode === 404) {
      const listRes = await fetchJson(allReleasesUrl, normCurrent);
      if (listRes.statusCode === 200 && Array.isArray(listRes.data) && listRes.data.length > 0) {
        releaseObj = listRes.data.find((r: any) => !r.draft && typeof r.tag_name === 'string') ?? null;
      }
      if (!releaseObj) {
        return {
          ok: true,
          currentVersion: normCurrent,
          latestVersion: normCurrent,
          updateAvailable: false,
          releaseName: `OpenCE Mantle v${normCurrent}`,
          releaseNotes: 'No newer GitHub releases published yet.',
          publishedAt: null,
          htmlUrl: repoReleasesPage,
          installerAsset: null,
          portableAsset: null,
          checkedAt: new Date().toISOString(),
        };
      }
    } else {
      const apiMsg =
        latestRes.data && typeof latestRes.data.message === 'string'
          ? latestRes.data.message
          : `GitHub API returned HTTP ${latestRes.statusCode}`;
      return {
        ok: false,
        currentVersion: normCurrent,
        error: apiMsg,
        checkedAt: new Date().toISOString(),
      };
    }

    const latestVersion = normalizeVersionString(releaseObj.tag_name);
    const isNewer = compareSemver(normCurrent, latestVersion) > 0;
    const { installerAsset, portableAsset } = classifyReleaseAssets(releaseObj.assets);

    return {
      ok: true,
      currentVersion: normCurrent,
      latestVersion,
      updateAvailable: isNewer,
      releaseName:
        typeof releaseObj.name === 'string' && releaseObj.name.trim()
          ? releaseObj.name.trim()
          : `OpenCE Mantle v${latestVersion}`,
      releaseNotes: typeof releaseObj.body === 'string' ? releaseObj.body : '',
      publishedAt: typeof releaseObj.published_at === 'string' ? releaseObj.published_at : null,
      htmlUrl: typeof releaseObj.html_url === 'string' ? releaseObj.html_url : repoReleasesPage,
      installerAsset,
      portableAsset,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      ok: false,
      currentVersion: normCurrent,
      error: (err as Error)?.message || 'Failed to connect to GitHub Releases.',
      checkedAt: new Date().toISOString(),
    };
  }
}

function streamHttpsToFile(
  url: string,
  destPartPath: string,
  expectedTotalBytes: number,
  onProgress: (transferred: number, total: number, bytesPerSecond: number) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      reject(new Error(`Invalid download URL: ${url}`));
      return;
    }

    if (parsedUrl.protocol !== 'https:' || !ALLOWED_DOWNLOAD_HOSTS.has(parsedUrl.hostname)) {
      reject(new Error(`Untrusted download host: ${parsedUrl.hostname}`));
      return;
    }

    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'OpenCE-Mantle-Updater',
          Accept: 'application/octet-stream,*/*',
        },
        timeout: 30000,
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          streamHttpsToFile(res.headers.location, destPartPath, expectedTotalBytes, onProgress)
            .then(resolve, reject);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Download failed with HTTP status ${res.statusCode ?? 0}.`));
          return;
        }

        const contentLen = parseInt(String(res.headers['content-length'] || '0'), 10);
        const total = contentLen > 0 ? contentLen : expectedTotalBytes;

        const fileStream = fs.createWriteStream(destPartPath);
        let transferred = 0;
        const startTime = Date.now();
        let lastEmitTime = 0;

        res.on('data', (chunk: Buffer) => {
          transferred += chunk.length;
          const now = Date.now();
          if (now - lastEmitTime >= 100 || (total > 0 && transferred >= total)) {
            lastEmitTime = now;
            const elapsedSec = Math.max(0.1, (now - startTime) / 1000);
            const bps = Math.round(transferred / elapsedSec);
            onProgress(transferred, total, bps);
          }
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => {
            resolve(transferred);
          });
        });

        fileStream.on('error', (err) => {
          res.destroy();
          try {
            if (fs.existsSync(destPartPath)) fs.unlinkSync(destPartPath);
          } catch {
            // ignore
          }
          reject(err);
        });
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error('Update download timed out.'));
    });

    req.on('error', (err) => {
      try {
        if (fs.existsSync(destPartPath)) fs.unlinkSync(destPartPath);
      } catch {
        // ignore
      }
      reject(err);
    });
  });
}

/**
 * Downloads the selected (or auto-matched) release `.exe` asset in the background into the OS temp directory,
 * reporting live progress via `emitProgress`.
 */
export async function downloadUpdateAsset(
  currentVersion: string,
  options: {
    mode?: 'auto' | 'installer' | 'portable';
    assetUrl?: string;
    assetName?: string;
    version?: string;
  } = {},
  emitProgress: (evt: UpdateDownloadProgressEvent) => void,
): Promise<DownloadUpdateResult> {
  try {
    let targetUrl = options.assetUrl;
    let targetName = options.assetName;
    let targetVersion = options.version ? normalizeVersionString(options.version) : '';
    let expectedSize = 0;
    const preferPortable =
      options.mode === 'portable' || (options.mode !== 'installer' && isRunningPortableBuild());
    let installMode: 'installer' | 'portable' = preferPortable ? 'portable' : 'installer';

    if (!targetUrl || !targetName) {
      const check = await checkForGitHubUpdates(currentVersion);
      if (!check.ok) {
        return { ok: false, error: check.error };
      }
      targetVersion = check.latestVersion;
      const chosenAsset = preferPortable
        ? (check.portableAsset ?? check.installerAsset)
        : (check.installerAsset ?? check.portableAsset);

      if (!chosenAsset) {
        return {
          ok: false,
          error: 'No downloadable Windows .exe asset was found on the latest GitHub Release.',
        };
      }
      targetUrl = chosenAsset.browserDownloadUrl;
      targetName = chosenAsset.name;
      expectedSize = chosenAsset.sizeBytes;
      const lower = targetName.toLowerCase();
      installMode = lower.includes('setup') || lower.includes('installer') ? 'installer' : 'portable';
    } else {
      const lower = targetName.toLowerCase();
      installMode = lower.includes('setup') || lower.includes('installer') ? 'installer' : 'portable';
    }

    const safeFileName = targetName.replace(/[<>:"/\\|?*]/g, '_');
    const stagingDir = path.join(app.getPath('temp'), 'opence-mantle-updates');
    fs.mkdirSync(stagingDir, { recursive: true });
    const finalPath = path.join(stagingDir, safeFileName);
    const partPath = `${finalPath}.part`;

    emitProgress({
      stage: 'downloading',
      version: targetVersion || currentVersion,
      assetName: safeFileName,
      installMode,
      percent: 0,
      transferredBytes: 0,
      totalBytes: expectedSize,
      bytesPerSecond: 0,
    });

    const writtenBytes = await streamHttpsToFile(
      targetUrl,
      partPath,
      expectedSize,
      (transferred, total, bps) => {
        const pct = total > 0 ? Math.min(99, Math.round((transferred / total) * 100)) : 50;
        emitProgress({
          stage: 'downloading',
          version: targetVersion || currentVersion,
          assetName: safeFileName,
          installMode,
          percent: pct,
          transferredBytes: transferred,
          totalBytes: total,
          bytesPerSecond: bps,
        });
      },
    );

    // Verify Windows PE 'MZ' signature and minimum size (> 512 KB)
    const stat = fs.statSync(partPath);
    if (stat.size < 512 * 1024) {
      fs.unlinkSync(partPath);
      throw new Error(`Downloaded file is unexpectedly small (${stat.size} bytes).`);
    }
    const headerBuf = Buffer.alloc(2);
    const fd = fs.openSync(partPath, 'r');
    try {
      fs.readSync(fd, headerBuf, 0, 2, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (headerBuf[0] !== 0x4d || headerBuf[1] !== 0x5a) {
      fs.unlinkSync(partPath);
      throw new Error('Downloaded file is not a valid Windows executable (missing MZ header).');
    }

    if (fs.existsSync(finalPath)) {
      try {
        fs.unlinkSync(finalPath);
      } catch {
        // ignore
      }
    }
    fs.renameSync(partPath, finalPath);

    lastStagedUpdate = {
      version: targetVersion || currentVersion,
      assetName: safeFileName,
      installMode,
      downloadedFilePath: finalPath,
    };

    emitProgress({
      stage: 'ready',
      version: targetVersion || currentVersion,
      assetName: safeFileName,
      installMode,
      percent: 100,
      transferredBytes: writtenBytes,
      totalBytes: writtenBytes,
      bytesPerSecond: 0,
      downloadedFilePath: finalPath,
    });

    return {
      ok: true,
      version: targetVersion || currentVersion,
      assetName: safeFileName,
      installMode,
      downloadedFilePath: finalPath,
      sizeBytes: writtenBytes,
    };
  } catch (err) {
    const message = (err as Error)?.message || 'Failed to download update.';
    emitProgress({
      stage: 'error',
      version: options.version || currentVersion,
      assetName: options.assetName || 'OpenCE Mantle.exe',
      installMode: isRunningPortableBuild() ? 'portable' : 'installer',
      percent: 0,
      transferredBytes: 0,
      totalBytes: 0,
      bytesPerSecond: 0,
      error: message,
    });
    return { ok: false, error: message };
  }
}

/**
 * Spawns a detached helper script that waits for the current OpenCE Mantle process to exit,
 * silently installs or swaps the new binary, and relaunches OpenCE Mantle.
 */
export function spawnUpdateApplyScript(
  downloadedFilePath?: string,
  installMode?: 'installer' | 'portable',
): { ok: boolean; message?: string } {
  const targetFile = downloadedFilePath || lastStagedUpdate?.downloadedFilePath;
  const mode = installMode || lastStagedUpdate?.installMode || (isRunningPortableBuild() ? 'portable' : 'installer');

  if (!targetFile || !fs.existsSync(targetFile)) {
    return { ok: false, message: 'No downloaded update file found to apply.' };
  }

  const pid = process.pid;
  const escapedStaged = targetFile.replace(/'/g, "''");

  if (mode === 'installer') {
    const installedExe = path.join(
      process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local'),
      'Programs',
      'opence-desktop',
      'OpenCE Mantle.exe',
    );
    const escapedInstalledExe = installedExe.replace(/'/g, "''");
    const currentExe = app.getPath('exe').replace(/'/g, "''");

    const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
Wait-Process -Id ${pid} -Timeout 15
Start-Sleep -Milliseconds 800
Start-Process -FilePath '${escapedStaged}' -ArgumentList '/S' -Wait
Start-Sleep -Milliseconds 500
if (Test-Path '${escapedInstalledExe}') {
  Start-Process -FilePath '${escapedInstalledExe}'
} elseif (Test-Path '${currentExe}') {
  Start-Process -FilePath '${currentExe}'
}
`;
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psScript],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    child.unref();
    return { ok: true };
  } else {
    // Portable mode: replace the outer portable .exe in place (and update versioned filename + Desktop shortcut if applicable) and relaunch it
    const rawPortableTarget = process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe');
    const newVer = lastStagedUpdate?.version ? normalizeVersionString(lastStagedUpdate.version) : '';
    const targetDir = path.dirname(rawPortableTarget);
    const targetBase = path.basename(rawPortableTarget);
    let finalLaunchPath = rawPortableTarget;
    if (newVer && /^OpenCE[\s._-]+Mantle[\s._-]+\d+\.\d+\.\d+.*\.exe$/i.test(targetBase)) {
      finalLaunchPath = path.join(targetDir, `OpenCE Mantle ${newVer}.exe`);
    }
    const portableTargetEsc = rawPortableTarget.replace(/'/g, "''");
    const finalLaunchEsc = finalLaunchPath.replace(/'/g, "''");
    const newVerEsc = newVer.replace(/'/g, "''");

    const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
Wait-Process -Id ${pid} -Timeout 15
for ($i = 0; $i -lt 25; $i++) {
  Start-Sleep -Milliseconds 400
  try {
    Copy-Item -LiteralPath '${escapedStaged}' -Destination '${finalLaunchEsc}' -Force -ErrorAction Stop
    if ('${finalLaunchEsc}' -ne '${portableTargetEsc}' -and (Test-Path -LiteralPath '${portableTargetEsc}')) {
      Remove-Item -LiteralPath '${portableTargetEsc}' -Force -ErrorAction SilentlyContinue
    }
    break
  } catch {
    # Still releasing file lock from portable wrapper
  }
}
try {
  $desktopDir = [Environment]::GetFolderPath('Desktop')
  if ($desktopDir -and (Test-Path -LiteralPath $desktopDir)) {
    $lnks = Get-ChildItem -LiteralPath $desktopDir -Filter 'OpenCE Mantle*.lnk' -ErrorAction SilentlyContinue
    if ($lnks -and $lnks.Count -gt 0) {
      $sh = New-Object -ComObject WScript.Shell
      $primaryLnk = $lnks[0].FullName
      $newLnkName = if ('${newVerEsc}') { "OpenCE Mantle ${newVerEsc}.lnk" } else { $lnks[0].Name }
      $newLnkPath = Join-Path $desktopDir $newLnkName
      if ($primaryLnk -ne $newLnkPath) {
        if (Test-Path -LiteralPath $newLnkPath) { Remove-Item -LiteralPath $newLnkPath -Force }
        Rename-Item -LiteralPath $primaryLnk -NewName $newLnkName -Force
      }
      $sc = $sh.CreateShortcut($newLnkPath)
      $sc.TargetPath = '${finalLaunchEsc}'
      $sc.WorkingDirectory = Split-Path -Parent '${finalLaunchEsc}'
      $sc.Save()
    }
  }
} catch {}
Start-Process -FilePath '${finalLaunchEsc}'
`;
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psScript],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    child.unref();
    return { ok: true };
  }
}

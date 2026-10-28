import * as https from 'https';
import type { UpdateCheckResult, UpdateReleaseAsset } from './shared-types';

export const GITHUB_REPO_OWNER = 'SutlabSol';
export const GITHUB_REPO_NAME = 'OpenCE-Mantle';

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
        // Handle 301/302 redirects if any
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
      // Fallback to /releases list in case only pre-releases exist or no releases have been published yet
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

/**
 * Steam `libraryfolders.vdf` Discovery, MCC Mod Package Stager,
 * and Transactional `ModManifest.txt` Registrar (UTF-16LE / UTF-8 BOM-preserving).
 *
 * Adapted from Project Guilty Spark (`crates/spark-core/src/steam.rs` and `mcc.rs`).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { packageMccMapName } from '../../core/src/map/mod-packager';

export interface SteamMccDiscoveryResult {
  mccInstallPaths: string[];
  defaultModManifestPath: string;
  manifestExists: boolean;
  registeredRoots: string[];
}

export interface MccDeployOptions {
  title: string;
  description?: string;
  author?: string;
  scenarioPath?: string;
  isMultiplayer?: boolean;
  targetRootDir: string;
  registerInModManifest?: boolean;
  customManifestPath?: string;
}

export interface MccDeployResult {
  ok: true;
  modFolderPath: string;
  mapOutputPath: string;
  modInfoPath: string;
  manifestRegistered: boolean;
  manifestPath?: string;
  backupPath?: string;
}

const MAX_MANIFEST_BYTES = 1024 * 1024; // 1 MiB

function normalizeWinPath(s: string): string {
  return s
    .trim()
    .replace(/^"+|"+$/g, '')
    .replace(/[\\/]+$/, '')
    .replace(/\//g, '\\')
    .toLowerCase();
}

/**
 * Decodes `ModManifest.txt` preserving whether it is UTF-16LE with BOM, UTF-8 with BOM, or plain UTF-8.
 */
export function decodeMccModManifest(bytes: Buffer): {
  text: string;
  utf16le: boolean;
  utf8Bom: boolean;
} {
  if (bytes.length > MAX_MANIFEST_BYTES) {
    throw new Error('ModManifest.txt exceeds 1 MiB safety limit.');
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    if (bytes.length % 2 !== 0) {
      throw new Error('Malformed UTF-16LE ModManifest.txt (odd byte count).');
    }
    const text = bytes.subarray(2).toString('utf16le');
    return { text, utf16le: true, utf8Bom: false };
  }
  const utf8Bom =
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const payload = utf8Bom ? bytes.subarray(3) : bytes;
  const text = payload.toString('utf8');
  return { text, utf16le: false, utf8Bom };
}

export function encodeMccModManifest(
  text: string,
  utf16le: boolean,
  utf8Bom: boolean,
): Buffer {
  if (utf16le) {
    const body = Buffer.from(text, 'utf16le');
    return Buffer.concat([Buffer.from([0xff, 0xfe]), body]);
  }
  const body = Buffer.from(text, 'utf8');
  return utf8Bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
}

/**
 * Transactionally registers `modRoot` inside `ModManifest.txt` while preserving UTF-16LE / UTF-8 BOM
 * and CRLF/LF line endings, using an exclusive lockfile and atomic temp-file swap + verification.
 */
export function registerMccModRoot(
  manifestPath: string,
  modRoot: string,
): { added: boolean; backupPath?: string } {
  const cleanRoot = path.resolve(modRoot);
  if (/[\r\n\0"]/.test(cleanRoot)) {
    throw new Error('Mod root path cannot contain line breaks or quotes.');
  }
  const parentDir = path.dirname(manifestPath);
  fs.mkdirSync(parentDir, { recursive: true });

  const lockPath = path.join(parentDir, '.opence-mantle-manifest.lock');
  let lockFd: number | null = null;
  try {
    lockFd = fs.openSync(lockPath, 'wx');
  } catch (err: any) {
    throw new Error(
      `ModManifest.txt is locked by another operation (${err?.message ?? err}).`,
    );
  }

  try {
    const original = fs.existsSync(manifestPath)
      ? fs.readFileSync(manifestPath)
      : Buffer.alloc(0);
    const { text: initialText, utf16le, utf8Bom } = decodeMccModManifest(original);
    const existingLines = initialText.split(/\r?\n/);
    if (existingLines.some((line) => normalizeWinPath(line) === normalizeWinPath(cleanRoot))) {
      return { added: false };
    }

    const newline = initialText.includes('\r\n')
      ? '\r\n'
      : initialText.includes('\n')
        ? '\n'
        : '\r\n';
    let updatedText = initialText;
    if (updatedText.length > 0 && !updatedText.endsWith('\n')) {
      updatedText += newline;
    }
    updatedText += cleanRoot + newline;

    const encoded = encodeMccModManifest(updatedText, utf16le, utf8Bom);

    // Check for concurrent modification before write
    const current = fs.existsSync(manifestPath)
      ? fs.readFileSync(manifestPath)
      : Buffer.alloc(0);
    if (!current.equals(original)) {
      throw new Error(
        'ModManifest.txt changed during registration; retry to preserve concurrent changes.',
      );
    }

    let backupPath: string | undefined;
    if (fs.existsSync(manifestPath)) {
      backupPath = `${manifestPath}.bak`;
      fs.writeFileSync(backupPath, original);
    }

    const tempPath = `${manifestPath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tempPath, encoded);
    fs.renameSync(tempPath, manifestPath);

    const readback = fs.readFileSync(manifestPath);
    if (!readback.equals(encoded)) {
      if (backupPath && fs.existsSync(backupPath)) {
        fs.writeFileSync(manifestPath, original);
      }
      throw new Error('ModManifest.txt verification failed; previous file restored.');
    }

    return { added: true, backupPath };
  } finally {
    if (lockFd !== null) {
      try {
        fs.closeSync(lockFd);
      } catch {
        // ignore
      }
    }
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // ignore
    }
  }
}

/**
 * Discovers Steam MCC installations via `libraryfolders.vdf` and inspects `ModManifest.txt`.
 */
export function discoverSteamMccInstallations(): SteamMccDiscoveryResult {
  const candidates = new Set<string>([
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
  ]);

  for (const drive of ['C', 'D', 'E', 'F', 'G']) {
    candidates.add(`${drive}:\\SteamLibrary`);
    candidates.add(`${drive}:\\Steam`);
  }

  const libraryRoots = new Set<string>();
  for (const root of candidates) {
    if (fs.existsSync(root)) {
      libraryRoots.add(root);
    }
    const vdfPath = path.join(root, 'steamapps', 'libraryfolders.vdf');
    if (fs.existsSync(vdfPath)) {
      try {
        const text = fs.readFileSync(vdfPath, 'utf8');
        const regex = /"path"\s+"([^"]+)"/gi;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
          const libPath = match[1].replace(/\\\\/g, '\\');
          if (fs.existsSync(libPath)) {
            libraryRoots.add(libPath);
          }
        }
      } catch {
        // ignore unreadable VDF
      }
    }
  }

  const mccInstallPaths: string[] = [];
  for (const lib of libraryRoots) {
    const mccDir = path.join(lib, 'steamapps', 'common', 'Halo The Master Chief Collection');
    if (fs.existsSync(mccDir) && fs.existsSync(path.join(mccDir, 'halo1'))) {
      mccInstallPaths.push(mccDir);
    }
  }

  const defaultModManifestPath = path.join(
    os.homedir(),
    'AppData',
    'LocalLow',
    'MCC',
    'Config',
    'ModManifest.txt',
  );
  const manifestExists = fs.existsSync(defaultModManifestPath);
  const registeredRoots: string[] = [];
  if (manifestExists) {
    try {
      const { text } = decodeMccModManifest(fs.readFileSync(defaultModManifestPath));
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
          registeredRoots.push(trimmed);
        }
      }
    } catch {
      // ignore
    }
  }

  return {
    mccInstallPaths,
    defaultModManifestPath,
    manifestExists,
    registeredRoots,
  };
}

/**
 * Packages the current map buffer into an MCC-ready mod directory (`ModInfo.json` + `maps/<leaf>.map`)
 * and optionally registers the parent directory in `ModManifest.txt`.
 */
export function deployMccModPackage(
  mapBuffer: Buffer,
  defaultScenarioName: string,
  options: MccDeployOptions,
): MccDeployResult {
  const safeSlug =
    options.title
      .trim()
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') ||
    defaultScenarioName ||
    'OpenCE_MCC_Mod';

  const modFolderPath = path.join(options.targetRootDir, safeSlug);
  const mapsDir = path.join(modFolderPath, 'maps');
  fs.mkdirSync(mapsDir, { recursive: true });

  const mapFileName = packageMccMapName(options.scenarioPath || defaultScenarioName);
  const mapOutputPath = path.join(mapsDir, mapFileName);
  fs.writeFileSync(mapOutputPath, mapBuffer);

  const modInfo = {
    Title: { Neutral: options.title || defaultScenarioName },
    Description: { Neutral: options.description || 'Packaged with OpenCE Mantle' },
    Author: options.author || 'OpenCE Modder',
    Engine: 'Halo1',
    MinAppVersion: '1.3385.0.0',
    ModVersion: '1.0.0',
    GameModContents: {
      HasCampaign: !options.isMultiplayer,
      HasMultiplayer: Boolean(options.isMultiplayer),
    },
  };

  const modInfoPath = path.join(modFolderPath, 'ModInfo.json');
  fs.writeFileSync(modInfoPath, JSON.stringify(modInfo, null, 2), 'utf8');

  let manifestRegistered = false;
  let manifestPath: string | undefined;
  let backupPath: string | undefined;

  if (options.registerInModManifest) {
    manifestPath =
      options.customManifestPath ||
      path.join(os.homedir(), 'AppData', 'LocalLow', 'MCC', 'Config', 'ModManifest.txt');
    const reg = registerMccModRoot(manifestPath, options.targetRootDir);
    manifestRegistered = reg.added || true;
    backupPath = reg.backupPath;
  }

  return {
    ok: true,
    modFolderPath,
    mapOutputPath,
    modInfoPath,
    manifestRegistered,
    manifestPath,
    backupPath,
  };
}

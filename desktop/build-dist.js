process.noAsar = true;
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { build, Platform } = require('electron-builder');

function findRceditX64() {
  const cacheDir = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign');
  if (!fs.existsSync(cacheDir)) return null;
  for (const entry of fs.readdirSync(cacheDir)) {
    const candidate = path.join(cacheDir, entry, 'rcedit-x64.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function updateDesktopShortcut(targetExePath, version, iconIcoPath) {
  if (process.platform !== 'win32' || !fs.existsSync(targetExePath)) return;
  try {
    const desktopDir = path.join(os.homedir(), 'Desktop');
    if (!fs.existsSync(desktopDir)) return;

    const existingShortcuts = fs
      .readdirSync(desktopDir)
      .filter((f) => /^OpenCE Mantle.*\.lnk$/i.test(f));

    const newShortcutName = `OpenCE Mantle ${version}.lnk`;
    const newShortcutPath = path.join(desktopDir, newShortcutName);

    // If an older version shortcut exists on Desktop, rename it first so its Desktop icon position is preserved
    if (existingShortcuts.length > 0) {
      const primaryOld = path.join(desktopDir, existingShortcuts[0]);
      if (primaryOld.toLowerCase() !== newShortcutPath.toLowerCase()) {
        try {
          if (fs.existsSync(newShortcutPath)) fs.unlinkSync(newShortcutPath);
          fs.renameSync(primaryOld, newShortcutPath);
        } catch {
          // fallback to creating newShortcutPath directly
        }
      }
      for (let i = 1; i < existingShortcuts.length; i++) {
        const extra = path.join(desktopDir, existingShortcuts[i]);
        if (extra.toLowerCase() !== newShortcutPath.toLowerCase()) {
          try {
            fs.unlinkSync(extra);
          } catch {
            // ignore
          }
        }
      }
    }

    const workingDir = path.dirname(targetExePath);
    const psScript = [
      '$sh = New-Object -ComObject WScript.Shell;',
      `$sc = $sh.CreateShortcut('${newShortcutPath.replace(/'/g, "''")}');`,
      `$sc.TargetPath = '${targetExePath.replace(/'/g, "''")}';`,
      `$sc.WorkingDirectory = '${workingDir.replace(/'/g, "''")}';`,
      fs.existsSync(iconIcoPath) ? `$sc.IconLocation = '${iconIcoPath.replace(/'/g, "''")},0';` : '',
      '$sc.Save();',
    ]
      .filter(Boolean)
      .join(' ');

    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
      stdio: 'ignore',
    });
    console.log(`Updated Desktop shortcut: ${newShortcutPath} -> ${targetExePath}`);
  } catch (err) {
    console.warn('Could not update Desktop shortcut automatically:', err.message || err);
  }
}

async function main() {
  console.log('Compiling renderer (Vite) and Electron main/preload/worker bundles...');
  const { execSync } = require('child_process');
  execSync('npm run build', { cwd: __dirname, stdio: 'inherit' });

  console.log('Building portable Windows application (OpenCE Mantle) with electron-builder...');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  const displayVersion = String(pkg.displayVersion || pkg.version || '0.2.1').trim();
  const iconIco = path.resolve(__dirname, 'build', 'icon.ico');
  const rcedit = findRceditX64();

  // Archive any older version .exe files in release/ into Legacy Builds.zip
  const releaseDir = path.join(__dirname, 'release');
  if (fs.existsSync(releaseDir)) {
    const oldExes = fs
      .readdirSync(releaseDir)
      .filter((f) => /^OpenCE Mantle.*\.exe$/i.test(f) && !f.includes(displayVersion))
      .map((f) => path.join(releaseDir, f));
    if (oldExes.length > 0) {
      const legacyZip = path.join(releaseDir, 'Legacy Builds.zip');
      try {
        const quotedPaths = oldExes.map((p) => `'${p.replace(/'/g, "''")}'`).join(',');
        execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Compress-Archive -Path @(${quotedPaths}) -Update -DestinationPath '${legacyZip.replace(/'/g, "''")}'; Remove-Item -Path @(${quotedPaths}) -Force`,
          ],
          { stdio: 'ignore' },
        );
        console.log(`Archived ${oldExes.length} older build(s) into ${legacyZip}`);
      } catch (err) {
        console.warn('Could not archive older builds:', err.message || err);
      }
    }
  }

  const results = await build({
    targets: Platform.WINDOWS.createTarget(['portable', 'nsis']),
    config: {
      forceCodeSigning: false,
      win: {
        icon: 'build/icon.ico',
        signAndEditExecutable: false,
      },
      portable: {
        artifactName: `OpenCE Mantle ${displayVersion}.\${ext}`,
      },
      nsis: {
        oneClick: true,
        perMachine: false,
        artifactName: `OpenCE Mantle Setup ${displayVersion}.\${ext}`,
      },
      afterPack: async (context) => {
        const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
        if (rcedit && fs.existsSync(exePath) && fs.existsSync(iconIco)) {
          console.log(`Embedding icon into unpacked Electron binary ${exePath} via rcedit...`);
          execFileSync(rcedit, [
            exePath,
            '--set-icon', iconIco,
            '--set-version-string', 'ProductName', 'OpenCE Mantle',
            '--set-version-string', 'FileDescription', 'OpenCE Mantle',
          ]);
        }
      },
    },
  });

  // Never run rcedit on the finished portable .exe artifact because it is an NSIS
  // self-extracting archive (makensis already sets its icon from win.icon and computes
  // an integrity CRC over the file; modifying the PE header afterwards breaks NSIS CRC).
  for (const artifact of results) {
    console.log('Artifact:', artifact);
  }

  // Generate latest.yml for electron-updater / differential update metadata
  const setupExeName = `OpenCE Mantle Setup ${displayVersion}.exe`;
  const setupExePath = path.join(__dirname, 'release', setupExeName);
  if (fs.existsSync(setupExePath)) {
    const crypto = require('crypto');
    const setupBuf = fs.readFileSync(setupExePath);
    const sha512 = crypto.createHash('sha512').update(setupBuf).digest('base64');
    const releaseDate = new Date().toISOString();
    const ghSafeSetupName = setupExeName.replace(/\s+/g, '.');
    const latestYml = [
      `version: ${displayVersion}`,
      `files:`,
      `  - url: ${ghSafeSetupName}`,
      `    sha512: ${sha512}`,
      `    size: ${setupBuf.length}`,
      `path: ${ghSafeSetupName}`,
      `sha512: ${sha512}`,
      `releaseDate: '${releaseDate}'`,
      '',
    ].join('\n');
    const latestYmlPath = path.join(__dirname, 'release', 'latest.yml');
    fs.writeFileSync(latestYmlPath, latestYml, 'utf8');
    console.log('Artifact:', latestYmlPath);
  }

  // Only sync resources/app.asar into %LOCALAPPDATA%\Programs\opence-desktop when --sync-installed is explicitly passed
  if (process.argv.includes('--sync-installed')) {
    const unpackedResources = path.join(__dirname, 'release', 'win-unpacked', 'resources');
    const installedCandidates = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'opence-desktop'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'OpenCE Mantle'),
    ];
    for (const instDir of installedCandidates) {
      const instRes = path.join(instDir, 'resources');
      if (fs.existsSync(instRes) && fs.existsSync(unpackedResources)) {
        try {
          fs.cpSync(unpackedResources, instRes, { recursive: true, force: true });
          console.log(`Synced latest app bundle into installed directory: ${instRes}`);
        } catch (err) {
          console.warn(`Could not sync to ${instRes} (app may be running):`, err.message || err);
        }
      }
    }
  } else {
    console.log('Skipping sync to installed directory (preserving installed build for auto-update testing).');
  }

  const portableExe = path.join(__dirname, 'release', `OpenCE Mantle ${displayVersion}.exe`);
  updateDesktopShortcut(portableExe, displayVersion, iconIco);

  console.log('Build completed successfully!');
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});

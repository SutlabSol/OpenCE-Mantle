process.noAsar = true;
const path = require('path');
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

async function main() {
  console.log('Building portable Windows application (OpenCE Mantle) with electron-builder...');
  const iconIco = path.resolve(__dirname, 'build', 'icon.ico');
  const rcedit = findRceditX64();

  const results = await build({
    targets: Platform.WINDOWS.createTarget(['portable']),
    config: {
      forceCodeSigning: false,
      win: {
        icon: 'build/icon.ico',
        signAndEditExecutable: false,
      },
      afterPack: async (context) => {
        const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
        if (rcedit && fs.existsSync(exePath) && fs.existsSync(iconIco)) {
          console.log(`Embedding icon into ${exePath} via rcedit...`);
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

  // Also apply rcedit icon to portable wrapper .exe if present
  for (const artifact of results) {
    if (rcedit && artifact.endsWith('.exe') && fs.existsSync(artifact) && fs.existsSync(iconIco)) {
      try {
        execFileSync(rcedit, [artifact, '--set-icon', iconIco]);
      } catch {}
    }
    console.log('Artifact:', artifact);
  }
  console.log('Build completed successfully!');
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});

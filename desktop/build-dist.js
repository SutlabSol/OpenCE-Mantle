process.noAsar = true;
const { build, Platform } = require('electron-builder');

async function main() {
  console.log('Building portable Windows application with electron-builder...');
  const results = await build({
    targets: Platform.WINDOWS.createTarget(['portable']),
    config: {
      forceCodeSigning: false,
      win: {
        signAndEditExecutable: false,
      },
    },
  });
  console.log('Build completed successfully!');
  for (const artifact of results) {
    console.log('Artifact:', artifact);
  }
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});

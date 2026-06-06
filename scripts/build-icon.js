// Converts MapPlot.png → build/icon.ico for use by Electron and the installer
const pngToIco = require('png-to-ico');
const path     = require('path');
const fs       = require('fs');

const src = path.join(__dirname, '..', 'MapPlot.png');
const out = path.join(__dirname, '..', 'build', 'icon.ico');

if (!fs.existsSync(src)) {
  console.error('MapPlot.png not found — place it in the project root.');
  process.exit(1);
}

fs.mkdirSync(path.dirname(out), { recursive: true });

pngToIco(src)
  .then(buf => {
    fs.writeFileSync(out, buf);
    console.log('✓ build/icon.ico generated');
  })
  .catch(err => {
    console.error('Icon conversion failed:', err.message);
    process.exit(1);
  });

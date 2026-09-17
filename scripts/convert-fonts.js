const fs = require('fs');
const path = require('path');
const ttf2woff2 = require('ttf2woff2');

// Path to the fonts folder (project root -> fonts)
const fontsDir = path.resolve(__dirname, '..', 'fonts');

if (!fs.existsSync(fontsDir)) {
  console.error('Fonts directory not found:', fontsDir);
  process.exit(1);
}

const files = fs.readdirSync(fontsDir).filter(f => f.toLowerCase().endsWith('.ttf'));
if (files.length === 0) {
  console.log('No .ttf files found in', fontsDir);
  process.exit(0);
}

files.forEach(file => {
  const inPath = path.join(fontsDir, file);
  const outName = file.replace(/\.ttf$/i, '.woff2');
  const outPath = path.join(fontsDir, outName);

  try {
    const ttf = fs.readFileSync(inPath);
    const woff2 = ttf2woff2(ttf);
    fs.writeFileSync(outPath, woff2);
    console.log('Converted', file, '→', outName);
  } catch (err) {
    console.error('Error converting', file, err);
  }
});

console.log('Done. Generated .woff2 files in', fontsDir);

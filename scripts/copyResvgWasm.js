const fs = require('fs');
const path = require('path');

const dest = path.join(__dirname, '../assets/resvg.wasm');

try {
  const src = require.resolve('@resvg/resvg-wasm/index_bg.wasm');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log('[postinstall] Copied resvg WASM to assets/resvg.wasm');
} catch (err) {
  console.warn('[postinstall] Could not copy resvg WASM:', err?.message || err);
}

// Headless smoke test for Cartridge Index.
// Runs the real app in Chromium: boots it, imports a fixture library through the
// actual file-input path, and checks the invariants that have bitten us before.
// Usage: node tests/smoke.mjs   (requires playwright + chromium, see CI workflow)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const check = (name, ok) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name);
  if (!ok) failures.push(name);
};

// CI installs `playwright`; locally you can use playwright-core + CHROMIUM_PATH
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = await import('playwright-core')); }
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] }
    : {}
);
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
page.on('dialog', d => d.accept());

await page.goto('file://' + join(root, 'index.html'));
await page.waitForTimeout(1500);

// ── Boot ──
check('boots without page errors', pageErrors.length === 0);
const version = await page.evaluate(() => document.getElementById('app-version-header')?.textContent);
check('APP_VERSION rendered (' + version + ')', /^v\d+\.\d+/.test(version || ''));

// ── SW cache version matches APP_VERSION ──
const swCache = (readFileSync(join(root, 'sw.js'), 'utf8').match(/cartridge-index-(v[\d.]+)/) || [])[1];
check('sw.js cache version matches APP_VERSION (' + swCache + ')', swCache === version);

// ── Import a fixture library through the real file input ──
const result = await page.evaluate(async () => {
  const backup = {
    games: [
      {
        id: 'aaaa0001', filename: 'Tetris (World).gb', platform: 'gb', title: 'Tetris',
        status: 'unplayed', tags: [],
        screenshots: ['blob:https://x/dead', 'https://example.com/shot.png'],
        videoBlobUrl: 'blob:https://x/vid',
        boxArt: 'https://example.com/x".png?"><img src=x onerror=window.__xss=1>',
      },
      { id: 'aaaa0002', filename: 'Mole Mania (USA).gb', platform: 'gb', title: 'Mole Mania', status: 'playing', genre: 'Puzzle', tags: ['puzzle'] },
    ],
    collections: [{ id: 'c1', name: 'Favourites', gameIds: ['aaaa0001'] }],
  };
  const dt = new DataTransfer();
  dt.items.add(new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' }));
  const input = document.getElementById('import-json-file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 600));

  const out = {};
  const cards = document.querySelectorAll('.game-card');
  out.cardCount = cards.length;
  out.xssFired = !!window.__xss;
  out.blobStripped = ![...cards].some(c => (c.dataset.imgs || '').includes('blob:'));
  out.genreFilterVisible = getComputedStyle(document.getElementById('genre-filter-select')).display !== 'none';

  // Save-on-change: edit the title with no Save button, close, check the grid
  cards[0]?.click();
  await new Promise(r => setTimeout(r, 300));
  out.modalOpen = document.getElementById('game-modal').classList.contains('open');
  out.saveBtnGone = !document.getElementById('modal-save');
  const t = document.getElementById('modal-title-input');
  t.value = 'Smoke Test Title';
  t.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('modal-done').click();
  await new Promise(r => setTimeout(r, 300));
  out.titlePersisted = [...document.querySelectorAll('.card-title')].some(n => n.textContent === 'Smoke Test Title');

  // Random picker opens a modal
  document.getElementById('btn-random').click();
  await new Promise(r => setTimeout(r, 200));
  out.randomOpens = document.getElementById('game-modal').classList.contains('open');
  return out;
});

check('import populates the grid (2 cards)', result.cardCount === 2);
check('crafted XSS URL does not execute', !result.xssFired);
check('blob: URLs stripped on import', result.blobStripped);
check('genre filter appears when genre data exists', result.genreFilterVisible);
check('modal opens on card click', result.modalOpen);
check('Save button removed (save-on-change model)', result.saveBtnGone);
check('title edit persists without a Save click', result.titlePersisted);
check('random picker opens a game', result.randomOpens);
check('no page errors after interactions', pageErrors.length === 0);
if (pageErrors.length) console.log('  page errors:', pageErrors);

await browser.close();

if (failures.length) {
  console.error('\n' + failures.length + ' check(s) failed');
  process.exit(1);
}
console.log('\nAll checks passed');

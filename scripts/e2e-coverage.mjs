// coverage-raw/ に溜めたブラウザの実行範囲を、ソースマップで元の TypeScript に戻して集計する
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { CoverageReport } from 'monocart-coverage-reports';

const report = new CoverageReport({
  name: 'E2E coverage',
  outputDir: 'coverage-e2e',
  reports: [['console-summary'], ['text', { file: null }], ['json-summary']],
  entryFilter: (e) => e.url.includes('/assets/'),
  sourceFilter: (p) => p.includes('src/'),
  sourcePath: (p) => p.replace(/^.*?(src\/)/, '$1'),
});
report.cleanCache();
// ビルド時のソースマップを付けて、元の TypeScript ファイル単位にする
const maps = new Map();
for (const f of readdirSync('dist/assets').filter((n) => n.endsWith('.js.map'))) {
  maps.set(f.replace(/\.map$/, ''), JSON.parse(readFileSync(`dist/assets/${f}`, 'utf8')));
}
for (const f of readdirSync('coverage-raw')) {
  const data = JSON.parse(readFileSync(`coverage-raw/${f}`, 'utf8'));
  if (!Array.isArray(data) || data.length === 0) continue;
  for (const e of data) {
    const name = e.url.split('/').pop();
    if (maps.has(name)) e.sourceMap = maps.get(name);
  }
  await report.add(data);
}
await report.generate();
rmSync('coverage-raw', { recursive: true, force: true });

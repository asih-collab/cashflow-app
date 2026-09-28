// dist/ の中身から Service Worker のキャッシュ一覧を作って dist/sw.js に書き出す
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(relative(dist, p));
  }
})(dist);

const assets = files.filter((f) => f !== 'sw.js' && !f.endsWith('.map')).map((f) => './' + f.split('\\').join('/'));
const hash = createHash('sha256');
for (const f of files.filter((f) => f !== 'sw.js').sort()) hash.update(f).update(readFileSync(join(dist, f)));
const version = hash.digest('hex').slice(0, 12);

const template = readFileSync(new URL('../src/sw.js', import.meta.url), 'utf8');
const out = template.replace('__VERSION__', version).replace('__ASSETS__', JSON.stringify(assets, null, 2));
writeFileSync(join(dist, 'sw.js'), out);
console.log(`sw.js: version ${version}, ${assets.length} assets`);

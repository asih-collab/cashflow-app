// レシートの読み取り（アプリ内のカメラ）で使う文字認識（Tesseract）の部品を dist/ocr/ に置く。
// 最初に使うときだけ読み込み、その後は Service Worker が端末に残す（アプリの起動時には読み込まない）。
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'dist/ocr');
mkdirSync(out, { recursive: true });
const nm = join(root, 'node_modules');
copyFileSync(join(nm, 'tesseract.js/dist/worker.min.js'), join(out, 'worker.min.js'));
// 日本語の LSTM だけを使うので、lstm の本体だけ（端末に合わせて simd / relaxedsimd / 通常から選ばれる）
for (const f of readdirSync(join(nm, 'tesseract.js-core'))) {
  if (/^tesseract-core-(?:simd-|relaxedsimd-)?lstm\.wasm(?:\.js)?$/.test(f)) copyFileSync(join(nm, 'tesseract.js-core', f), join(out, f));
}
// 日本語の学習データ（小さい best_int 版、約 2MB）
copyFileSync(join(nm, '@tesseract.js-data/jpn/4.0.0_best_int/jpn.traineddata.gz'), join(out, 'jpn.traineddata.gz'));
console.log(`ocr: ${readdirSync(out).join(', ')}`);

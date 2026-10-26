// アプリ内でのレシートの文字認識。カメラで撮った画像をこの端末の中だけで読み取り、文字にする。
// 画像は保存しない（カメラロールにも残らない）。読み取りが終わったら捨てる。
// 文字認識は Tesseract（日本語の小さいモデル）。部品（約 6MB）は最初に使ったときだけ読み込み、その後は端末に残る。
//
// 読み取りやすくするため、先に画像を整える: 大きさをそろえ、白黒にし、明るさのむら（影・照明）を抑える。

type Progress = (ratio: number, label: string) => void;

interface TesseractWorker {
  recognize(image: Blob | HTMLCanvasElement): Promise<{ data: { text: string } }>;
  setParameters(p: Record<string, string>): Promise<unknown>;
  terminate(): Promise<unknown>;
}

let workerP: Promise<TesseractWorker> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let progressCb: Progress | null = null;

const BASE = `${import.meta.env.BASE_URL}ocr/`;

async function getWorker(): Promise<TesseractWorker> {
  if (!workerP) {
    workerP = (async () => {
      const T = await import('tesseract.js');
      const w = (await T.createWorker('jpn', 1 /* LSTM のみ */, {
        workerPath: `${BASE}worker.min.js`,
        corePath: BASE,
        langPath: BASE,
        gzip: true,
        cacheMethod: 'none', // 部品は Service Worker が端末に残す
        logger: (m: { status: string; progress: number }) => {
          const label = m.status.includes('recogniz') ? '読み取り中' : '準備中（初回だけ少しかかります）';
          progressCb?.(m.progress ?? 0, label);
        },
      })) as unknown as TesseractWorker;
      // レシートは 1 列の文章として読む（品名と金額を同じ行に保つ）
      await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
      return w;
    })();
    workerP.catch(() => { workerP = null; });
  }
  return workerP;
}

/** 使い終わって 1 分たったら文字認識を片付ける（メモリを空ける） */
function scheduleIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const p = workerP;
    workerP = null;
    void p?.then((w) => w.terminate()).catch(() => {});
  }, 60_000);
}

/**
 * 画像を整える: 長い辺を 1600〜2400px にそろえ、白黒にし、まわりの明るさとの差で文字を浮かせる（影・照明のむら対策）。
 * 結果はキャンバス（画像ファイルにはしない）。
 */
export async function preprocess(image: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(image, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const long = Math.max(bmp.width, bmp.height);
  const scale = long > 2400 ? 2400 / long : long < 1600 ? 1600 / long : 1;
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  // 明るさ（白黒）
  const gray = new Float32Array(w * h);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) gray[j] = 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
  // まわり（文字の数倍の大きさ）の平均を積分画像で求め、それより十分暗い点を文字にする（局所的な二値化）
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x]!;
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1]! + row;
    }
  }
  const r = Math.max(8, Math.round(Math.min(w, h) / 40));
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const sum = integral[y1 * (w + 1) + x1]! - integral[y0 * (w + 1) + x1]! - integral[y1 * (w + 1) + x0]! + integral[y0 * (w + 1) + x0]!;
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const v = gray[y * w + x]! < mean * 0.86 ? 0 : 255;
      const k = (y * w + x) * 4;
      px[k] = px[k + 1] = px[k + 2] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** 整えずにそのまま（比べるため） */
async function plain(image: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(image);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}

/**
 * レシートの画像から文字を取り出す。整えた画像とそのままの画像の 2 回読み、両方の文字を返す
 * （読み違いは片方だけに出ることが多い。読み取り側で両方の手がかりを合わせて、辻つまの合う金額を選ぶ）。
 */
export async function recognizeReceiptTwice(image: Blob, onProgress?: Progress): Promise<{ primary: string; combined: string }> {
  const a = await recognizeReceipt(image, (r, l) => onProgress?.(r / 2, l));
  const b = await recognizeReceipt(image, (r, l) => onProgress?.(0.5 + r / 2, l), { preprocess: false });
  return { primary: b.trim() || a, combined: `${a}\n${b}` };
}

/** レシートの画像から文字を取り出す */
export async function recognizeReceipt(image: Blob, onProgress?: Progress, opts: { preprocess?: boolean } = {}): Promise<string> {
  progressCb = onProgress ?? null;
  if (idleTimer) clearTimeout(idleTimer);
  try {
    onProgress?.(0, '画像を整えています');
    const canvas = opts.preprocess === false ? await plain(image) : await preprocess(image);
    const worker = await getWorker();
    const { data } = await worker.recognize(canvas);
    canvas.width = canvas.height = 0; // 画像を捨てる
    return data.text;
  } finally {
    progressCb = null;
    scheduleIdle();
  }
}

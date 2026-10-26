// レシートの読み取り: iPhone の文字認識（写真の「テキスト認識表示」、ショートカットの「画像からテキストを抽出」）で
// 取り出した文字から、合計金額・日付・お店・支払い方法を取り出す。画像は端末の外に出さない（文字認識も端末内）。
//
// 文字認識の結果は、レシートの左右の列が別々の行に分かれたり（「合計」「お預り」「お釣り」の後に金額がまとめて並ぶ）、
// 全角・記号の読み違い（¥ が \ になる、1,234 が 1.234 になる）が起きる。複数の手がかりで候補を出し、
// 「お預り − お釣り = 合計」「カード払いの額 = 合計」のように数字の辻つまが合うものを選ぶ。

export interface ReceiptResult {
  /** 合計金額（取れなければ null） */
  total: number | null;
  /** 金額の確からしさ */
  confidence: 'high' | 'medium' | 'low';
  /** 合計の候補（確からしい順。画面で選び直せるように） */
  candidates: number[];
  /** 日付（YYYY-MM-DD。取れなければ null） */
  date: string | null;
  /** お店の名前（取れなければ null） */
  store: string | null;
  /** 支払い方法の手がかり */
  payment: 'card' | 'paypay' | 'ic' | 'cash' | null;
}

type Kind = 'total' | 'subtotal' | 'tax' | 'paid' | 'change' | 'tender' | 'discount' | 'point' | 'count' | 'other';

interface Line {
  raw: string;
  text: string;
  kind: Kind;
  amounts: { value: number; yen: boolean }[];
  /** 金額だけの行（列が分かれた場合の右側） */
  amountOnly: boolean;
}

/** 全角→半角、¥ の読み違い、数字の中の読み違いをそろえる */
export function normalize(s: string): string {
  let t = s.normalize('NFKC');
  t = t.replace(/[\\￥]/g, '¥').replace(/[‐‑‒–—―−]/g, '-');
  // 数字の間の空白（「1, 234」「1 234」）をつめる。¥ の後の空白も
  t = t.replace(/(\d)\s*,\s*(?=\d{3}\b)/g, '$1,').replace(/¥\s+/g, '¥');
  // 数字に挟まれた O / o / l / I / | は 0 / 1 の読み違い
  // ¥ の直後に紛れ込んだ 1 文字（「¥ギ80」など、カメラの文字認識で起きる）を消す
  t = t.replace(/¥\s?[^\d\s,.\-¥](?=\s?\d)/g, '¥');
  // 行頭の ¥ が似た字（寺・半・羊・平・Y）に読まれた金額だけの行
  t = t.replace(/^(\s*)[寺半羊芋平Y¥](?=\s?\d[\d,.\s]*(?:円)?\s*$)/gm, '$1¥');
  t = t.replace(/(?<=¥|\d)[\dOolI|,]+/g, (m) => m.replace(/[Oo]/g, '0').replace(/[lI|]/g, '1'));
  // 「1, 010」のように桁区切りの後に空白
  t = t.replace(/(\d),\s+(?=\d{3}(?!\d))/g, '$1,');
  return t;
}

// 行の種類を決めるキーワード。上から順に判定する（「税込合計」は税ではなく合計、「小計」は合計ではない）
const KIND_RULES: [Kind, RegExp][] = [
  ['change', /お?釣り?銭?|おつり|釣\s*銭|チェンジ|CHANGE/i],
  ['paid', /お?預\s*(?:り|か|かり)|預り金|受領|お受取|お預/],
  ['count', /点\s*数|買上点数|個数|ITEMS?\b|^\s*\d+\s*点\s*$/i],
  ['point', /ポイント|ﾎﾟｲﾝﾄ|\bpt\b|\bP\s*付与|獲得|利用\s*P|dポイント|楽天ポイント|Ponta|nanaco\s*ポイント|残高/i],
  ['total', /税込\s*(?:合計|計)|合\s*計\s*\(?税込|総\s*合\s*計/],
  ['tax', /消費税|内\s*税|外\s*税|税\s*額|内消費|\(税|税\s*\d+\s*%|\d+\s*%\s*対象|対象\s*(?:額|計)|課税|非課税|税率/],
  ['discount', /値\s*引|割\s*引|クーポン|ｸｰﾎﾟﾝ|OFF\b/i],
  ['subtotal', /小\s*計|SUB\s*TOTAL/i],
  ['total', /合\s*計|お?買\s*上\s*げ?\s*(?:合\s*)?計|ご?請\s*求|お?支\s*払\s*(?:い)?\s*(?:金\s*額|額|合計)?|総\s*計|現\s*計|領\s*収\s*(?:金\s*)?額|お?会\s*計|運\s*賃|ご?利用\s*(?:金\s*)?額|お?買上\s*(?:金\s*)?額|^\s*金\s*額|TOTAL|^計$|^\s*計\s*[¥\d]/i],
  ['tender', /クレジット|ｸﾚｼﾞｯﾄ|カード|VISA|JCB|MASTER|AMEX|ダイナース|DINERS|PayPay|ペイペイ|楽天ペイ|d払い|au\s*PAY|メルペイ|交通系|Suica|PASMO|ICOCA|iD\b|QUICPay|電子マネー|WAON|nanaco|Edy|QR|バーコード決済/i],
];

/** 金額以外の数字（日付・時刻・電話・登録番号・レジ番号など）を消してから金額を探す */
function stripNonAmounts(t: string): string {
  return t
    .replace(/T\s?\d{13}/g, ' ')
    .replace(/(?:20\d{2}|令和\s*\d{1,2}|R\s*\d{1,2})\s*[年/.\-]\s*\d{1,2}\s*[月/.\-]\s*\d{1,2}\s*日?/g, ' ')
    .replace(/(?<![\d,¥])\d{2}[/.]\d{1,2}[/.]\d{1,2}(?![\d,])/g, ' ')
    .replace(/\d{1,2}\s*月\s*\d{1,2}\s*日/g, ' ')
    .replace(/\d{1,2}\s*[:：]\s*\d{2}(?:\s*[:：]\s*\d{2})?/g, ' ')
    .replace(/\d{1,2}\s*時\s*\d{1,2}\s*分/g, ' ')
    .replace(/(?:TEL|Tel|tel|電話|☎|℡)[^\d]*[\d\-()\s]{9,}/g, ' ')
    .replace(/\(?0\d{1,4}\)?[\-\s]\d{1,4}[\-\s]\d{3,4}/g, ' ')
    .replace(/(?:No|NO|№|#|レジ|責|担当|取引|伝票|ID|会員|カード番号|承認|番号|乗務員|車番|端末)[.:：\s]*[\d\-*]+/g, ' ')
    .replace(/[*＊Xx]{4,}[\d\s]*/g, ' ')
    .replace(/\d+\s*(?:%|％|点|個|コ|本|枚|回|名|人|g|ml|kg|L)(?![A-Za-z])/g, ' ')
    .replace(/\d{8,}/g, ' ');
}

const AMOUNT_RE = /(¥\s*)?(-?\d{1,3}(?:[,.]\d{3})+|-?\d{1,7})(\s*円|\s*-(?!\d)|\s*※)?/g;

function amountsIn(text: string): { value: number; yen: boolean }[] {
  const out: { value: number; yen: boolean }[] = [];
  for (const m of stripNonAmounts(text).matchAll(AMOUNT_RE)) {
    const v = Number(m[2]!.replace(/[,.]/g, ''));
    if (!Number.isFinite(v) || v === 0 || Math.abs(v) > 10_000_000) continue;
    out.push({ value: Math.abs(v), yen: !!m[1] || !!m[3] });
  }
  return out;
}

function kindOf(text: string): Kind {
  for (const [k, re] of KIND_RULES) if (re.test(text)) return k;
  return 'other';
}

export function parseLines(raw: string): Line[] {
  return normalize(raw)
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0)
    .map((text) => {
      const amounts = amountsIn(text);
      const rest = stripNonAmounts(text).replace(AMOUNT_RE, '').replace(/[\s¥円\-※*:：()（）]/g, '');
      return { raw: text, text, kind: kindOf(text), amounts, amountOnly: amounts.length > 0 && rest.length === 0 };
    });
}

/** 合計の候補に点数を付ける。同じ金額に複数の根拠があれば点数を足す */
export function totalCandidates(lines: Line[]): Map<number, number> {
  const score = new Map<number, number>();
  const add = (v: number | undefined, s: number) => { if (v && v > 0) score.set(v, (score.get(v) ?? 0) + s); };
  const lastAmount = (l: Line) => {
    const yen = l.amounts.filter((a) => a.yen);
    return (yen.length > 0 ? yen : l.amounts).at(-1)?.value;
  };
  const values: Partial<Record<Kind, number[]>> = {};
  const push = (k: Kind, v: number | undefined) => { if (v) (values[k] ??= []).push(v); };

  // 金額だけの行が続くところ（列が分かれた形）。長さ 2 以上の並びに含まれる行
  const runOf = new Map<number, [number, number]>();
  for (let a = 0; a < lines.length; a++) {
    if (!lines[a]!.amountOnly) continue;
    let b = a;
    while (b < lines.length && lines[b]!.amountOnly) b++;
    const run: [number, number] = [a, b];
    if (b - a >= 2) for (let k = a; k < b; k++) runOf.set(k, run);
    a = b - 1;
  }

  // 1. 同じ行の「合計 ¥1,234」、または次の 1〜2 行の金額だけの行（列が分かれた並びの一部は 2. で扱う）
  lines.forEach((l, i) => {
    if (l.kind === 'other') return;
    let v = l.amounts.length > 0 && !l.amountOnly ? lastAmount(l) : undefined;
    if (v === undefined && l.amounts.length === 0) {
      for (const j of [i + 1, i + 2]) {
        const n = lines[j];
        if (!n) break;
        if (n.amountOnly) { if (!runOf.has(j)) v = lastAmount(n); break; }
        if (n.kind !== 'other') break;
      }
    }
    push(l.kind, v);
  });

  // 2. 列が分かれた形: 金額だけの行の並びは、その直前の「金額のない行」（品名・合計・お預りなど）に順に対応する
  for (const [a, b] of new Set(runOf.values())) {
    const prevLines: Line[] = [];
    for (let k = a - 1; k >= 0 && lines[k]!.amounts.length === 0; k--) prevLines.unshift(lines[k]!);
    const run = lines.slice(a, b);
    const n = Math.min(prevLines.length, run.length);
    if (n === 0) continue;
    const labels = prevLines.slice(-n);
    const amounts = prevLines.length >= run.length ? run : run.slice(-n);
    labels.forEach((lab, k) => {
      const v = lastAmount(amounts[k]!);
      if (lab.kind === 'total') add(v, 70);
      push(lab.kind, v);
    });
  }

  // 2b. 列が分かれ、間に別の金額の行が挟まった場合: 合計・お預りなどの見出し（金額なし）を、並びの後ろから順に対応させる
  for (const [a, b] of new Set(runOf.values())) {
    const keys = lines.slice(0, a).filter((l) => l.amounts.length === 0 && l.kind !== 'other' && l.kind !== 'count');
    const run = lines.slice(a, b);
    if (keys.length === 0 || keys.length > run.length) continue;
    const tail = run.slice(-keys.length);
    keys.forEach((lab, k) => {
      const v = lastAmount(tail[k]!);
      if (lab.kind === 'total') add(v, 50);
      if (lab.kind === 'paid' || lab.kind === 'change') push(lab.kind, v);
    });
  }

  // 品物の金額の合計 = 合計（品物の行が読めている場合の確かめ）
  const items = lines.filter((l) => l.kind === 'other' && l.amounts.length > 0 && !l.amountOnly).map((l) => lastAmount(l)!);
  const itemSum = items.reduce((x, y) => x + y, 0);

  for (const v of values.total ?? []) add(v, 100);
  for (const v of values.tender ?? []) add(v, 60);
  // お預り − お釣り = 合計（現金払い）
  for (const p of values.paid ?? []) for (const c of values.change ?? []) if (p > c) add(p - c, 80);
  // 小計 + 外税 = 合計 / 小計 = 合計（税込表示）
  for (const s of values.subtotal ?? []) {
    add(s, 25);
    for (const t of values.tax ?? []) if (t < s * 0.2) add(s + t, 15);
  }
  if (items.length >= 2 && itemSum > 0) {
    if (score.has(itemSum)) add(itemSum, 30);
    else if (![...score.values()].some((x) => x >= 100)) add(itemSum, 20);
  }
  // 根拠のある候補が弱ければ、¥ 付きの金額のうち大きいもの（お預りなどを除く）
  if (![...score.values()].some((x) => x >= 60)) {
    const excluded = new Set([...(values.paid ?? []), ...(values.change ?? []), ...(values.point ?? [])]);
    const all = lines.filter((l) => !['paid', 'change', 'point', 'count', 'tax'].includes(l.kind)).flatMap((l) => l.amounts);
    const yen = all.filter((a) => a.yen && !excluded.has(a.value));
    const pool = yen.length > 0 ? yen : all.filter((a) => !excluded.has(a.value));
    const max = Math.max(0, ...pool.map((a) => a.value));
    add(max || undefined, yen.length > 0 ? 30 : 10);
  }
  // お預りやお釣りと同じ値は、合計の根拠が他になければ下げる
  for (const v of [...(values.paid ?? []), ...(values.change ?? [])]) if ((score.get(v) ?? 0) < 100) score.set(v, (score.get(v) ?? 0) - 40);
  return score;
}

const ERA: Record<string, number> = { 令和: 2018, R: 2018 };

function validDate(y: number, m: number, d: number, today: Date): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1) return null;
  const diff = (dt.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000;
  if (diff > 1 || diff < -400) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function findDate(text: string, today = new Date()): string | null {
  const t = normalize(text);
  const patterns: [RegExp, (m: RegExpMatchArray) => [number, number, number]][] = [
    [/(20\d{2})\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})/g, (m) => [Number(m[1]), Number(m[2]), Number(m[3])]],
    [/(令和|R)\s*(\d{1,2})\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})/g, (m) => [ERA[m[1]!]! + Number(m[2]), Number(m[3]), Number(m[4])]],
    [/(?<![\d¥,])(\d{2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{1,2})(?![\d,])/g, (m) => [2000 + Number(m[1]), Number(m[2]), Number(m[3])]],
    [/(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*日/g, (m) => [today.getFullYear(), Number(m[1]), Number(m[2])]],
  ];
  let found: string | null = null;
  for (const [re, f] of patterns) {
    for (const m of t.matchAll(re)) {
      const [y, mo, d] = f(m);
      const v = validDate(y, mo, d, today) ?? (re.source.startsWith('(?<!\\d)(\\d{1,2})\\s*月') ? validDate(y - 1, mo, d, today) : null);
      if (v) { found = v; break; }
    }
    if (found) break;
  }
  // 見つからない・古すぎる（2 か月以上前）ときは、数字の読み違い（9→0 など）を直した候補から、最近の日付を探す
  if (!found || ageDays(found, today) > 60) {
    const fuzzy = fuzzyDate(t, today);
    if (fuzzy) return fuzzy;
  }
  return found;
}

function ageDays(date: string, today: Date): number {
  const [y, m, d] = date.split('-').map(Number);
  return (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(y!, m! - 1, d!).getTime()) / 86400000;
}

/** カメラの文字認識で起きやすい数字の読み違い */
const CONFUSE: Record<string, string[]> = { '9': ['0'], '6': ['0', '8'], '8': ['0', '3', '6'], '3': ['8'], '0': ['8', '6', '9'], '7': ['1'], '1': ['7'], '5': ['6'] };

function variants(digits: string): string[] {
  let out = [''];
  for (const ch of digits) out = out.flatMap((p) => [ch, ...(CONFUSE[ch] ?? [])].map((c) => p + c));
  return out;
}

function fuzzyDate(t: string, today: Date): string | null {
  const best: { v: string; cost: number; age: number }[] = [];
  const consider = (y: number, mo: string, d: string) => {
    for (const m2 of variants(mo)) for (const d2 of variants(d)) {
      const v = validDate(y, Number(m2), Number(d2), today);
      if (!v) continue;
      const age = ageDays(v, today);
      if (age > 60) continue;
      const cost = [...m2].filter((c, i) => c !== mo[i]).length + [...d2].filter((c, i) => c !== d[i]).length;
      best.push({ v, cost, age });
    }
  };
  for (const m of t.matchAll(/(20\d{2})\D{1,2}(\d{1,2})\D{1,2}(\d{1,2})/g)) consider(Number(m[1]), m[2]!, m[3]!);
  for (const m of t.matchAll(/(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)) consider(today.getFullYear(), m[1]!, m[2]!);
  best.sort((a, b) => a.cost - b.cost || a.age - b.age);
  return best[0]?.v ?? null;
}

/** よく行くお店の名前（文字認識の読み方の揺れも）。見つかったらその名前で表示する */
export const STORES: [RegExp, string][] = [
  [/セブン[\-\s・]?イレブン|7[\-\s]?ELEVEN|SEVEN[\-\s]?ELEVEN/i, 'セブン-イレブン'],
  [/ファミリーマート|ファミマ|FamilyMart/i, 'ファミリーマート'],
  [/ナチュラルローソン|ローソンストア100|ローソン|LAWSON/i, 'ローソン'],
  [/ミニストップ|MINISTOP/i, 'ミニストップ'],
  [/デイリーヤマザキ/, 'デイリーヤマザキ'],
  [/NewDays|ニューデイズ/i, 'NewDays'],
  [/スターバックス|STARBUCKS/i, 'スターバックス'],
  [/ドトール|DOUTOR/i, 'ドトール'],
  [/タリーズ|TULLY'?S/i, 'タリーズ'],
  [/コメダ/, 'コメダ珈琲'],
  [/エクセルシオール/, 'エクセルシオール'],
  [/マクドナルド|McDonald/i, 'マクドナルド'],
  [/モスバーガー|MOS\s*BURGER/i, 'モスバーガー'],
  [/すき家/, 'すき家'], [/吉野家/, '吉野家'], [/松屋/, '松屋'], [/なか卯/, 'なか卯'],
  [/サイゼリヤ/, 'サイゼリヤ'], [/ガスト/, 'ガスト'], [/丸亀製麺/, '丸亀製麺'], [/大戸屋/, '大戸屋'],
  [/鳥貴族/, '鳥貴族'], [/スシロー/, 'スシロー'], [/くら寿司/, 'くら寿司'], [/はま寿司/, 'はま寿司'], [/CoCo壱|ココイチ/, 'CoCo壱番屋'],
  [/イオン|AEON/i, 'イオン'], [/イトーヨーカドー/, 'イトーヨーカドー'], [/西友|SEIYU/i, '西友'], [/ライフ(?!カード)/, 'ライフ'],
  [/まいばすけっと/, 'まいばすけっと'], [/オーケー|OK\s*ストア/i, 'オーケー'], [/成城石井/, '成城石井'], [/サミット/, 'サミット'],
  [/マルエツ/, 'マルエツ'], [/東急ストア/, '東急ストア'], [/ヤオコー/, 'ヤオコー'], [/ベルク/, 'ベルク'], [/業務スーパー/, '業務スーパー'],
  [/マツモトキヨシ|マツキヨ/, 'マツモトキヨシ'], [/ウエルシア/, 'ウエルシア'], [/スギ薬局/, 'スギ薬局'], [/ツルハ/, 'ツルハドラッグ'],
  [/サンドラッグ/, 'サンドラッグ'], [/ココカラファイン/, 'ココカラファイン'], [/トモズ/, 'トモズ'], [/ドラッグ/, 'ドラッグストア'],
  [/ダイソー|DAISO/i, 'ダイソー'], [/セリア/, 'セリア'], [/キャンドゥ/, 'キャンドゥ'], [/無印良品|MUJI/i, '無印良品'], [/ニトリ/, 'ニトリ'],
  [/ユニクロ|UNIQLO/i, 'ユニクロ'], [/\bGU\b|ジーユー/, 'GU'], [/ZARA/i, 'ZARA'],
  [/ヨドバシ/, 'ヨドバシカメラ'], [/ビックカメラ|BIC\s*CAMERA/i, 'ビックカメラ'], [/ヤマダ電機|YAMADA/i, 'ヤマダ電機'], [/ケーズデンキ/, 'ケーズデンキ'],
  [/紀伊國屋|紀伊国屋/, '紀伊國屋書店'], [/TSUTAYA|蔦屋/i, 'TSUTAYA'], [/ブックオフ|BOOKOFF/i, 'ブックオフ'],
  [/ENEOS|エネオス/i, 'ENEOS'], [/出光|apollostation/i, '出光'],
];

const NOT_STORE = /領収|レシート|いらっしゃい|ありがとう|毎度|お買上|ご来店|登録番号|^\d|〒|都|県|市|区|町|丁目|TEL|電話|営業時間|株式会社|有限会社|店長|担当|レジ|^[\W\d_]+$/;

export function findStore(text: string): string | null {
  const t = normalize(text);
  for (const [re, name] of STORES) if (re.test(t)) return name;
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 6);
  for (const l of lines) {
    if (l.length < 2 || l.length > 30 || NOT_STORE.test(l)) continue;
    if ((l.match(/\d/g)?.length ?? 0) > l.length / 3) continue;
    return l.replace(/\s+/g, ' ');
  }
  return null;
}

export function findPayment(text: string): ReceiptResult['payment'] {
  const t = normalize(text);
  if (/PayPay|ペイペイ/i.test(t)) return 'paypay';
  if (/Suica|PASMO|ICOCA|交通系|iD\b|QUICPay|電子マネー|WAON|nanaco|Edy/i.test(t)) return 'ic';
  if (/クレジット|ｸﾚｼﾞｯﾄ|VISA|JCB|MASTER|AMEX|ダイナース|DINERS|カード\s*(?:払|支払|決済)/i.test(t)) return 'card';
  if (/お?預\s*(?:り|か)|お釣|おつり|釣銭|現金/.test(t)) return 'cash';
  return null;
}

export function parseReceipt(raw: string, today = new Date()): ReceiptResult {
  const lines = parseLines(raw);
  const score = totalCandidates(lines);
  const ranked = [...score.entries()].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const top = ranked[0];
  const confidence: ReceiptResult['confidence'] = !top ? 'low' : top[1] >= 150 ? 'high' : top[1] >= 80 ? 'medium' : 'low';
  return {
    total: top ? top[0] : null,
    confidence,
    candidates: ranked.slice(0, 5).map(([v]) => v),
    date: findDate(raw, today),
    store: findStore(raw),
    payment: findPayment(raw),
  };
}

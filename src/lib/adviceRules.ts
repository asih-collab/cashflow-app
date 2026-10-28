// 改善アドバイス（F23）のルール・しきい値・文言。月 1 回の見直しでは、このファイルだけを直す（04 の 6 章）。
// 変えたら tests/unit/advice.test.ts を通すこと。ルールの ID（rule）は集計に使うので、意味が変わらない限り変えない。
//
// 各ルールは「今月の状況（AdviceContext）」を受け取り、0 件以上のアドバイスを返す。
// priority は大きいほど上に出る。warn（注意）> info（参考）> good（順調）の順に目安を分けている。

import type { Advice, AdviceContext } from './advice';
import type { DailyContext } from './dailyAdvice';
import { debtOverview, monthLabel, pendingLumps, totalPlan } from './debt';
import { yen } from './money';

/** しきい値（見直しで調整する値はここ） */
export const LIMITS = {
  /** 見込みを今日までのペースだけで出すまでの日数（それまでは前月の実績と混ぜる） */
  forecastWarmupDays: 7,
  /** 同じルールから出す件数の上限 */
  maxPerRule: 2,
  /** ホームに出す件数 */
  homeCount: 3,
  /** 赤字見込みを知らせる最小額（ぶれで出続けないように） */
  deficitMin: 3000,
  /** 黒字見込みを返済に回す提案を出す最小額 */
  surplusMin: 10000,
  /** 予算のペース: 使った割合が経過の割合をこれ以上上回ったら知らせる */
  paceMargin: 0.15,
  /** 予算のペースの判定を始める最小の実績（少額で騒がない） */
  paceMinSpent: 3000,
  /** 予算のペースの判定は月の何日目から（初日に 1 回使っただけで出ないように） */
  paceFromDay: 4,
  /** 前月より増えた: 見込みが前月の何倍以上、かつ何円以上多いとき */
  jumpRatio: 1.3,
  jumpMin: 5000,
  /** 1 回あたりの金額: 何回以上の記録で比べるか、何割以上・何円以上上がったら */
  unitMinCount: 3,
  unitRatio: 1.3,
  unitMin: 300,
  /** 回数が多い中分類（コンビニ・カフェなど）: 今月の見込み回数がこれ以上 */
  freqNames: ['コンビニ', 'カフェ', 'タクシー'],
  freqMin: 12,
  /** 回数の判定は、月の何日目から・何回以上の記録から（初日の 1 回で騒がない） */
  freqFromDay: 7,
  freqMinCount: 4,
  /** 直近 7 日で記録のない日がこれ以上なら、記録漏れを知らせる */
  emptyDaysMin: 3,
  /** 予算より順調: 使った割合が経過の割合よりこれ以上少ないとき */
  goodMargin: 0.1,
} as const;

const fmtDays = (n: number) => `${n} 日`;
const perDay = (amount: number, days: number) => (days > 0 ? Math.floor(amount / days) : amount);

/** 赤字の見込み → どこをいくら抑えれば黒字か */
function deficitForecast(c: AdviceContext): Advice[] {
  if (c.income <= 0 || c.balanceForecast > -LIMITS.deficitMin) return [];
  const gap = -c.balanceForecast;
  // 始まって間もないうちは、今月の数日分より前月の傾向のほうが当てになる
  const top = (c.warmingUp ? c.prevParents[0] : undefined) ?? c.parents[0];
  const allowance = Math.max(0, c.variableForecast - gap - c.variableSoFar);
  return [{
    rule: 'deficit_forecast', key: 'deficit_forecast', level: 'warn', priority: 100, href: '#/summary',
    title: c.daysLeft > 0 ? `このペースだと月末に約 ${yen(gap)} の赤字です` : `今月は約 ${yen(gap)} の赤字で終わりそうです`,
    body: c.daysLeft > 0
      ? `黒字で終えるには、変動費を残り ${fmtDays(c.daysLeft)}で ${yen(allowance)} 以内（1 日 ${yen(perDay(allowance, c.daysLeft))}）にします。${top ? `いちばん大きいのは${top.name}（${yen(top.amount)}）です。` : ''}`
      : `${top ? `いちばん大きかったのは${top.name}（${yen(top.amount)}）でした。` : ''}来月の予算を見直すときの目安にしてください。`,
  }];
}

/** 予算を超えた大分類 */
function overBudget(c: AdviceContext): Advice[] {
  const out: Advice[] = [];
  for (const p of c.parents) {
    const b = c.budgets.get(p.id);
    if (!b || p.amount <= b) continue;
    out.push({
      rule: 'over_budget', key: `over_budget:${p.name}`, level: 'warn', priority: 90 + Math.min(9, (p.amount - b) / 5000),
      href: '#/summary',
      title: `${p.name}が予算を ${yen(p.amount - b)} 超えています`,
      body: `予算 ${yen(b)} に対して ${yen(p.amount)}。${c.daysLeft > 0 ? `残り ${fmtDays(c.daysLeft)}は${p.name}を控えめにすると、ほかの予算で吸収できます。` : ''}`,
    });
  }
  return out;
}

/** 予算のペースより速い大分類 */
function budgetPace(c: AdviceContext): Advice[] {
  if (c.elapsedDays < LIMITS.paceFromDay || c.daysLeft <= 0) return [];
  const out: Advice[] = [];
  for (const p of c.parents) {
    const b = c.budgets.get(p.id);
    if (!b || p.amount > b || p.amount < LIMITS.paceMinSpent) continue;
    const used = p.amount / b;
    if (used < c.elapsedRatio + LIMITS.paceMargin) continue;
    const left = b - p.amount;
    out.push({
      rule: 'budget_pace', key: `budget_pace:${p.name}`, level: 'warn', priority: 80 + used * 5,
      href: '#/summary',
      title: `${p.name}が予算のペースより速めです`,
      body: `月の ${Math.round(c.elapsedRatio * 100)}% が過ぎたところで、予算の ${Math.round(used * 100)}% を使っています。残りは ${yen(left)}、1 日 ${yen(perDay(left, c.daysLeft))} までに抑えると予算内です。`,
    });
  }
  return out;
}

/** 前月より大きく増えそうな大分類 */
function categoryJump(c: AdviceContext): Advice[] {
  if (!c.hasPrev || c.elapsedDays < LIMITS.paceFromDay) return [];
  const out: Advice[] = [];
  for (const p of c.parents) {
    const prev = c.prevParents.find((x) => x.id === p.id)?.amount ?? 0;
    if (prev <= 0) continue;
    const forecast = Math.round((p.amount / c.elapsedDays) * c.totalDays);
    if (forecast < prev * LIMITS.jumpRatio || forecast - prev < LIMITS.jumpMin) continue;
    out.push({
      rule: 'category_jump', key: `category_jump:${p.name}`, level: 'info', priority: 60 + Math.min(9, (forecast - prev) / 10000),
      href: '#/summary',
      title: `${p.name}が先月より増えるペースです`,
      body: `このままだと月末に約 ${yen(forecast)}（先月 ${yen(prev)}、+${yen(forecast - prev)}）。`,
    });
  }
  return out;
}

/** 1 回あたりの金額が上がった中分類 */
function unitPriceUp(c: AdviceContext): Advice[] {
  if (!c.hasPrev) return [];
  const out: Advice[] = [];
  for (const s of c.subs) {
    const p = c.prevSubs.find((x) => x.id === s.id);
    if (!p || s.count < LIMITS.unitMinCount || p.count < LIMITS.unitMinCount) continue;
    const now = Math.round(s.amount / s.count);
    const before = Math.round(p.amount / p.count);
    if (now < before * LIMITS.unitRatio || now - before < LIMITS.unitMin) continue;
    out.push({
      rule: 'unit_price_up', key: `unit_price_up:${s.name}`, level: 'info', priority: 50,
      title: `${s.name}の 1 回あたりが上がっています`,
      body: `先月は 1 回 ${yen(before)}、今月は ${yen(now)}（${s.count} 回）。回数より 1 回の金額で増えています。`,
    });
  }
  return out;
}

/** 回数の多い中分類（コンビニ・カフェなど） */
function frequency(c: AdviceContext): Advice[] {
  const out: Advice[] = [];
  for (const s of c.subs) {
    if (!(LIMITS.freqNames as readonly string[]).includes(s.name)) continue;
    if (c.elapsedDays < LIMITS.freqFromDay || s.count < LIMITS.freqMinCount) continue;
    const forecastCount = Math.round((s.count / c.elapsedDays) * c.totalDays);
    if (forecastCount < LIMITS.freqMin) continue;
    const unit = Math.round(s.amount / s.count);
    const weekly = Math.max(1, Math.round(forecastCount / (c.totalDays / 7)));
    const save = Math.round(unit * Math.round(c.totalDays / 7));
    out.push({
      rule: 'frequency', key: `frequency:${s.name}`, level: 'info', priority: 45,
      title: `${s.name}は今月 ${s.count} 回（${yen(s.amount)}）`,
      body: `このままだと月 ${forecastCount} 回ほど（週 ${weekly} 回、1 回 ${yen(unit)}）。週に 1 回減らすと、月 ${yen(save)} ほど浮きます。`,
    });
  }
  return out;
}

/** 黒字の見込み → 貯金の目標に回すと、届くのがどれだけ早まるか */
function surplusToGoal(c: AdviceContext): Advice[] {
  if (c.income <= 0 || c.warmingUp || c.balanceForecast < LIMITS.surplusMin) return [];
  const out: Advice[] = [];
  for (const g of c.goals) {
    if (!g.reachMonth || !g.reachWithSurplus || g.reachWithSurplus >= g.reachMonth) continue;
    const surplus = Math.floor(c.balanceForecast / 1000) * 1000;
    const [ay, am] = g.reachWithSurplus.split('-').map(Number);
    const [by, bm] = g.reachMonth.split('-').map(Number);
    const months = (by! - ay!) * 12 + (bm! - am!);
    out.push({
      rule: 'surplus_to_goal', key: `surplus_to_goal:${g.name}`, level: 'good', priority: 72, href: '#/goals',
      title: `黒字見込みを${g.name}に回すと ${months} か月早く届きます`,
      body: `月末に約 ${yen(c.balanceForecast)} の黒字見込み。このうち ${yen(surplus)} を入れると、${monthLabel(g.reachMonth)} → ${monthLabel(g.reachWithSurplus)} です。`,
    });
  }
  return out;
}

/** 黒字の見込み → 返済に回すと完済がどれだけ早まるか */
function surplusToDebt(c: AdviceContext): Advice[] {
  // 始まって間もないうちは見込みが予算頼みなので、実績がたまってから出す
  if (c.debts.length === 0 || c.income <= 0 || c.warmingUp || c.balanceForecast < LIMITS.surplusMin) return [];
  const surplus = Math.floor(c.balanceForecast / 1000) * 1000;
  const base = totalPlan(c.debts);
  // 年率のいちばん高いカード（同じなら残高の大きいほう）に、月末（期間の最後の月）にまとめて返したとする
  const target = [...c.debts].filter((d) => d.balance > 0).sort((a, b) => b.annual_rate - a.annual_rate || b.balance - a.balance)[0];
  if (!target) return [];
  const month = c.period.end.slice(0, 7);
  const alt = totalPlan(c.debts.map((d) => (d.id === target.id ? { ...d, lumps: [...(d.lumps ?? []), { month, amount: surplus, done: false }] } : d)));
  const faster = base.months !== null && alt.months !== null ? base.months - alt.months : 0;
  const saved = base.totalInterest - alt.totalInterest;
  if (saved <= 0) return [];
  return [{
    rule: 'surplus_to_debt', key: 'surplus_to_debt', level: 'good', priority: 70, href: '#/debts',
    title: `月末に約 ${yen(c.balanceForecast)} の黒字見込みです`,
    body: `このうち ${yen(surplus)} を${target.name}の返済に回すと、手数料が約 ${yen(saved)} 減ります${faster > 0 ? `（完済が ${faster} か月早まる）` : ''}。`,
  }];
}

/** リボの手数料の大きさと、次の一括返済の効果 */
function revoFee(c: AdviceContext): Advice[] {
  const o = debtOverview(c.debts);
  if (!o || o.interestNow <= 0) return [];
  const next = c.debts.flatMap((d) => pendingLumps(d).map((l) => ({ d, l }))).sort((a, b) => a.l.month.localeCompare(b.l.month))[0];
  let after = '';
  if (next) {
    const reduced = Math.round((next.l.amount * next.d.annual_rate) / 100 / 12);
    after = `${monthLabel(next.l.month)}の一括返済（${yen(next.l.amount)}）のあとは、月 ${yen(reduced)} ほど減ります。`;
  }
  const plan = totalPlan(c.debts);
  return [{
    rule: 'revo_fee', key: 'revo_fee', level: 'info', priority: 30, href: '#/debts',
    title: `リボの手数料は今月約 ${yen(o.interestNow)}`,
    body: `毎月の返済 ${yen(o.monthly)} のうち、残高が減るのは ${yen(o.principalNow)} です。${after}${plan.payoffMonth ? `完済見込みは${monthLabel(plan.payoffMonth)}。` : ''}`,
  }];
}

/** 記録の抜け（使い始めて 1 週間以上たってから） */
function missingRecords(c: AdviceContext): Advice[] {
  if (c.daysSinceFirstRecord < 7 || c.emptyDaysLast7 < LIMITS.emptyDaysMin) return [];
  return [{
    rule: 'missing_records', key: 'missing_records', level: 'info', priority: 65, href: '#/history?v=list',
    title: `この 1 週間で記録のない日が ${c.emptyDaysLast7} 日あります`,
    body: '使わなかった日なら問題ありません。記録し忘れがあれば、履歴から日付を選んで追加できます。',
  }];
}

/** 予算より順調 */
function goodPace(c: AdviceContext): Advice[] {
  const budget = [...c.budgets.values()].reduce((a, b) => a + b, 0);
  if (budget <= 0 || c.elapsedDays < LIMITS.paceFromDay || c.daysLeft <= 0) return [];
  const used = c.variableSoFar / budget;
  if (used > c.elapsedRatio - LIMITS.goodMargin) return [];
  const expectedLeft = Math.max(0, budget - c.variableForecast);
  return [{
    rule: 'good_pace', key: 'good_pace', level: 'good', priority: 20,
    title: '予算より少ないペースです',
    body: `月の ${Math.round(c.elapsedRatio * 100)}% が過ぎて、予算の ${Math.round(used * 100)}% です。この調子なら月末に約 ${yen(expectedLeft)} 残ります。`,
  }];
}

/** 上から順に評価する（並びは priority で決まるので、ここの順は関係ない） */
export const RULES: ((c: AdviceContext) => Advice[])[] = [
  deficitForecast, overBudget, budgetPace, categoryJump, unitPriceUp, frequency, surplusToDebt, surplusToGoal, revoFee, missingRecords, goodPace,
];

// ---- 今日の気づき（日ごと） --------------------------------------------------------
// その日・前の日の記録から。key に日付を入れる（反応は日ごとに 1 件）。

export const DAILY_LIMITS = {
  /** ホームに出す件数 */
  count: 3,
  /** 1 回あたりの平均を出すのに必要な記録の数 */
  minRecordsForAverage: 10,
  /** 大きめの出費: 平均の何倍以上、かつ何円以上 */
  bigRatio: 3,
  bigMin: 5000,
  /** 同じ中分類を今日何回使ったら知らせるか */
  repeatMin: 3,
  /** 使いすぎやすい曜日: ほかの曜日の平均の何倍以上、かつ何円以上多い、同じ曜日が何日以上あるとき */
  weekdayRatio: 1.5,
  weekdayMin: 3000,
  weekdaySamples: 3,
  /** チャレンジ: 上限の何割から知らせるか */
  challengeNear: 0.8,
} as const;

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const sum = (xs: { amount: number }[]) => xs.reduce((a, x) => a + x.amount, 0);

/** 今日の 1 日の目安と、今日使った額 */
function dailyAllowance(c: DailyContext): Advice[] {
  if (c.allowanceToday === null) return [];
  const a = c.allowanceToday;
  const key = `daily_allowance:${c.today}`;
  if (c.todayTotal > a) {
    const restDays = c.daysLeftInclToday - 1;
    const left = c.budgetTotal - c.spentBeforeToday - c.scheduledSpend - c.todayTotal;
    return [{
      rule: 'daily_allowance', key, level: 'warn', priority: 95, href: '#/history?v=list',
      title: `今日は 1 日の目安を ${yen(c.todayTotal - a)} 超えています`,
      body: `今日 ${yen(c.todayTotal)}（目安 ${yen(a)}）。${restDays > 0 ? (left > 0 ? `残り ${restDays} 日を 1 日 ${yen(Math.floor(left / restDays))} にすると、今月の予算内に収まります。` : `今月の予算をすでに ${yen(-left)} 超えています。残り ${restDays} 日はできるだけ控えめに。`) : ''}`,
    }];
  }
  return [{
    rule: 'daily_allowance', key, level: c.todayTotal === 0 ? 'info' : 'good', priority: 60,
    title: `今日使えるのは、あと ${yen(a - c.todayTotal)}`,
    body: `今日の目安は ${yen(a)}（今月の予算の残り ÷ 残り ${c.daysLeftInclToday} 日${c.scheduledSpend > 0 ? `。先の日付で記録した ${yen(c.scheduledSpend)} は先に引いています` : ''}）。${c.todayTotal > 0 ? `ここまで ${yen(c.todayTotal)} です。` : 'まだ使っていません。'}`,
  }];
}

/** 昨日のふり返り */
function yesterdayRecap(c: DailyContext): Advice[] {
  if (c.yesterdayItems.length === 0) return [];
  const top = [...c.yesterdayItems].sort((x, y) => y.amount - x.amount)[0]!;
  const vs = c.allowanceYesterday === null ? '' : c.yesterdayTotal <= c.allowanceYesterday
    ? `目安（${yen(c.allowanceYesterday)}）より ${yen(c.allowanceYesterday - c.yesterdayTotal)} 少なく済みました。`
    : `目安（${yen(c.allowanceYesterday)}）より ${yen(c.yesterdayTotal - c.allowanceYesterday)} 多めでした。`;
  return [{
    rule: 'yesterday_recap', key: `yesterday_recap:${c.today}`,
    level: c.allowanceYesterday !== null && c.yesterdayTotal <= c.allowanceYesterday ? 'good' : 'info', priority: 50,
    title: `昨日は ${yen(c.yesterdayTotal)}（${c.yesterdayItems.length} 件）`,
    body: `${c.yesterdayItems.length > 1 ? `いちばん大きいのは${top.sub}の ${yen(top.amount)}。` : `${top.sub}の ${yen(top.amount)}。`}${vs}`,
  }];
}

/** 今日、同じ中分類を何度も */
function repeatToday(c: DailyContext): Advice[] {
  const by = new Map<string, number[]>();
  for (const x of c.todayItems) by.set(x.sub, [...(by.get(x.sub) ?? []), x.amount]);
  return [...by.entries()].filter(([, v]) => v.length >= DAILY_LIMITS.repeatMin).map(([sub, v]) => ({
    rule: 'repeat_today', key: `repeat_today:${sub}:${c.today}`, level: 'info' as const, priority: 70,
    title: `今日の${sub}は ${v.length} 回目（計 ${yen(v.reduce((a, b) => a + b, 0))}）`,
    body: '1 回は少しでも、重なると大きくなります。次の 1 回は見送ってみませんか。',
  }));
}

/** 今日の大きめの出費 */
function bigPurchase(c: DailyContext): Advice[] {
  if (c.avgPerRecord === null) return [];
  const limit = Math.max(DAILY_LIMITS.bigMin, c.avgPerRecord * DAILY_LIMITS.bigRatio);
  const big = c.todayItems.filter((x) => x.amount >= limit).sort((a, b) => b.amount - a.amount)[0];
  if (!big) return [];
  let body = `いつもの 1 回の平均は ${yen(c.avgPerRecord)} です。`;
  if (c.allowanceToday !== null && c.daysLeftInclToday > 1) {
    const before = Math.floor((c.budgetTotal - c.spentBeforeToday - c.scheduledSpend) / c.daysLeftInclToday);
    const after = Math.max(0, Math.floor((c.budgetTotal - c.spentBeforeToday - c.scheduledSpend - c.todayTotal) / (c.daysLeftInclToday - 1)));
    body += `今月の残りの 1 日あたりが ${yen(before)} → ${yen(after)} になりました。`;
  }
  return [{ rule: 'big_purchase', key: `big_purchase:${c.today}`, level: 'info', priority: 75, title: `今日の${big.sub} ${yen(big.amount)} は大きめの出費です`, body }];
}

/** 使いすぎやすい曜日 */
function weekdayPeak(c: DailyContext): Advice[] {
  if (c.weekdaySamples < DAILY_LIMITS.weekdaySamples || c.otherAvg <= 0) return [];
  if (c.weekdayAvg < c.otherAvg * DAILY_LIMITS.weekdayRatio || c.weekdayAvg - c.otherAvg < DAILY_LIMITS.weekdayMin) return [];
  const w = WD[c.weekday];
  return [{
    rule: 'weekday_peak', key: `weekday_peak:${c.today}`, level: 'info', priority: 55,
    title: `${w}曜日は使いすぎやすい日です`,
    body: `これまでの${w}曜日は 1 日平均 ${yen(c.weekdayAvg)}（ほかの曜日は ${yen(c.otherAvg)}）。今日は使う前に金額を決めておくと安心です。`,
  }];
}

/** 今日・明日の固定費などの引き落とし（予定） */
function upcomingFixed(c: DailyContext): Advice[] {
  const out: Advice[] = [];
  const one = (items: { name: string; amount: number }[], when: '今日' | '明日', priority: number) => {
    if (items.length === 0) return;
    out.push({
      rule: 'upcoming_fixed', key: `upcoming_fixed:${when}:${c.today}`, level: 'info', priority, href: '#/recurring',
      title: `${when}は ${items.map((x) => x.name).join('・')}（${yen(sum(items))}）の予定です`,
      body: '固定費の自動記録に入っている予定です。口座やカードの残高を確かめておきましょう。',
    });
  };
  one(c.scheduledToday, '今日', 66);
  one(c.scheduledTomorrow, '明日', 64);
  return out;
}

/** 給料日 */
function payday(c: DailyContext): Advice[] {
  if (c.paydayIncome <= 0 || c.allowanceToday === null) return [];
  return [{
    rule: 'payday', key: `payday:${c.today}`, level: 'good', priority: 90, href: '#/budget',
    title: `今日は収入 ${yen(c.paydayIncome)} が入りました`,
    body: `今月の変動費の予算は ${yen(c.budgetTotal)}、1 日あたり ${yen(Math.floor(c.budgetTotal / c.periodTotalDays))} です。最初の 1 週間で使いすぎないのがコツです。`,
  }];
}

/** 節約のチャレンジ: 上限に近い・達した・超えた */
function challengeAlert(c: DailyContext): Advice[] {
  return c.challenges.filter((x) => x.ratio >= DAILY_LIMITS.challengeNear).map((x) => ({
    rule: 'challenge_alert', key: `challenge_alert:${x.name}:${c.today}`, level: x.over || x.reached ? 'warn' as const : 'info' as const,
    priority: x.over ? 92 : x.reached ? 88 : 68, href: '#/goals',
    title: x.over ? `${x.name}: 上限を超えています（${x.text}）` : x.reached ? `${x.name}: 今月はここまで（${x.text}）` : `${x.name}: 上限に近づいています（${x.text}）`,
    body: x.over || x.reached ? '今月の残りは、この分はお休みにしましょう。浮いた分は貯金の目標に回せます。' : '使う前に、本当に今月必要か考えてみましょう。',
  }));
}

export const DAILY_RULES: ((c: DailyContext) => Advice[])[] = [dailyAllowance, yesterdayRecap, repeatToday, bigPurchase, weekdayPeak, upcomingFixed, payday, challengeAlert];

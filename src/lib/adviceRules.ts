// 改善アドバイス（F23）のルール・しきい値・文言。月 1 回の見直しでは、このファイルだけを直す（04 の 6 章）。
// 変えたら tests/unit/advice.test.ts を通すこと。ルールの ID（rule）は集計に使うので、意味が変わらない限り変えない。
//
// 各ルールは「今月の状況（AdviceContext）」を受け取り、0 件以上のアドバイスを返す。
// priority は大きいほど上に出る。warn（注意）> info（参考）> good（順調）の順に目安を分けている。

import type { Advice, AdviceContext } from './advice';
import type { DailyContext } from './dailyAdvice';
import type { MonthlyReport } from './monthlyReport';
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
  /** 習慣になっている出費: 過去 30 日で何回以上、1 回平均いくら以下（大きな買い物は対象外） */
  habitMin: 6,
  habitMaxAvg: 3000,
  /** 使わない日: 記録を始めて何日以上たってから褒めるか */
  noSpendMinDays: 7,
} as const;

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const sum = (xs: { amount: number }[]) => xs.reduce((a, x) => a + x.amount, 0);

/** 今日の 1 日の目安を超えたとき（目安そのものはホームの「1 日あたり」に出ているので、超えたときだけ） */
function dailyAllowance(c: DailyContext): Advice[] {
  if (c.allowanceToday === null) return [];
  const a = c.allowanceToday;
  if (c.todayTotal <= a) return [];
  const restDays = c.daysLeftInclToday - 1;
  const left = c.budgetTotal - c.spentBeforeToday - c.scheduledSpend - c.todayTotal;
  return [{
    rule: 'daily_allowance', key: `daily_allowance:${c.today}`, level: 'warn', priority: 95, href: '#/history?v=list',
    title: `今日は 1 日の目安を ${yen(c.todayTotal - a)} 超えています`,
    body: `今日 ${yen(c.todayTotal)}（目安 ${yen(a)}）。${restDays > 0 ? (left > 0 ? `残り ${restDays} 日を 1 日 ${yen(Math.floor(left / restDays))} にすると、今月の予算内に収まります。` : `今月の予算をすでに ${yen(-left)} 超えています。残り ${restDays} 日はできるだけ控えめに。`) : ''}`,
  }];
}

/** 習慣になっている小さな出費を、今日また使ったとき: 1 年に直すといくらか、週 1 回減らすといくら浮くか */
function habitToday(c: DailyContext): Advice[] {
  const todaySubs = new Set(c.todayItems.map((x) => x.sub));
  const h = c.habits
    .filter((x) => todaySubs.has(x.sub) && x.count >= DAILY_LIMITS.habitMin && x.total / x.count <= DAILY_LIMITS.habitMaxAvg)
    .sort((x, y) => y.total - x.total)[0];
  if (!h) return [];
  const avg = Math.round(h.total / h.count);
  const perYear = Math.round((h.total / 30) * 365 / 1000) * 1000;
  return [{
    rule: 'habit_today', key: `habit_today:${h.sub}:${c.today}`, level: 'info', priority: 72, href: '#/history?v=list',
    title: `${h.sub}はこの 30 日で ${h.count} 回・${yen(h.total)}`,
    body: `このペースだと 1 年で約 ${yen(perYear)}。1 回平均 ${yen(avg)} なので、週に 1 回減らすだけで年 ${yen(avg * 52)} 浮きます。`,
  }];
}

/** 昨日は使わない日だった: 褒めて、続けたときの効果を出す */
function noSpendDay(c: DailyContext): Advice[] {
  if (!c.yesterdayZero || c.recordedDays < DAILY_LIMITS.noSpendMinDays || c.avgDaily <= 0) return [];
  return [{
    rule: 'no_spend_day', key: `no_spend_day:${c.today}`, level: 'good', priority: 58,
    title: '昨日は使わない日でした',
    body: `今月 ${c.zeroDaysThisPeriod} 日目です。いつもの 1 日平均（${yen(c.avgDaily)}）を使わずに済んだ計算。週にもう 1 日増やせると、月 ${yen(c.avgDaily * 4)} ほど浮きます。`,
  }];
}

/** 明日は使いすぎやすい曜日: 前の日のうちに上限を決めてもらう */
function tomorrowPeak(c: DailyContext): Advice[] {
  if (c.tomorrowSamples < DAILY_LIMITS.weekdaySamples || c.tomorrowOtherAvg <= 0) return [];
  if (c.tomorrowAvg < c.tomorrowOtherAvg * DAILY_LIMITS.weekdayRatio || c.tomorrowAvg - c.tomorrowOtherAvg < DAILY_LIMITS.weekdayMin) return [];
  const w = WD[c.tomorrowWeekday];
  return [{
    rule: 'tomorrow_peak', key: `tomorrow_peak:${c.today}`, level: 'info', priority: 54,
    title: `明日（${w}曜日）は使いすぎやすい日です`,
    body: `これまでの${w}曜日は 1 日平均 ${yen(c.tomorrowAvg)}（ほかの曜日は ${yen(c.tomorrowOtherAvg)}）。今日のうちに明日使う上限を決めておくと、使いすぎを防げます。`,
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

export const DAILY_RULES: ((c: DailyContext) => Advice[])[] = [
  dailyAllowance, habitToday, noSpendDay, tomorrowPeak, yesterdayRecap, repeatToday, bigPurchase, weekdayPeak, upcomingFixed, payday, challengeAlert,
];

// ---- 月終わりのふり返り（月ごと） ----------------------------------------------------
// 予算期間が終わったときに、その期間の記録と来月の見通しから。key に期間の始まりの日を入れる（反応は期間ごと）。
// 季節の役立ち情報は「来月（次の期間の最終日の月）」に合わせて出す。

export const MONTHLY_LIMITS = {
  /** 出す件数 */
  count: 7,
  /** 季節の役立ち情報の件数 */
  seasonalMax: 2,
  /** 役立ち情報（季節・お金の仕組み）に必ず取る枠 */
  infoSlots: 3,
  /** 黒字・赤字として扱う最小額 */
  balanceMin: 10000,
  /** 来月の見込みが予算をこれ以上超えたら知らせる */
  forecastOverMin: 3000,
  /** 先月より増えた: 何倍以上、かつ何円以上 */
  risingRatio: 1.2,
  risingMin: 5000,
  /** 習慣の出費: 回数・1 回平均の上限 */
  habitMin: 8,
  habitMaxAvg: 2000,
  /** 土日に偏っている: 変動費のうち土日の割合、そのときの変動費の最小額 */
  weekendShare: 0.5,
  weekendMinVariable: 30000,
  /** 使わない日が多いと褒める日数 */
  noSpendGood: 6,
  /** リボの金利の話をする年率 */
  highRate: 12,
} as const;

const W = 4.3; // 1 か月の週の数

/** 先月の収支（赤字・黒字の使い道） */
function mBalance(r: MonthlyReport): Advice[] {
  const key = (k: string) => `${k}:${r.period.start}`;
  if (r.income <= 0) return [];
  if (r.balance <= -MONTHLY_LIMITS.balanceMin) {
    const top = [...r.lines].sort((a, b) => (b.actual - (b.budget ?? b.actual)) - (a.actual - (a.budget ?? a.actual)) || b.actual - a.actual)[0];
    return [{
      rule: 'm_deficit', key: key('m_deficit'), level: 'warn', priority: 95, href: '#/summary',
      title: `${r.period.label}は ${yen(-r.balance)} の赤字でした`,
      body: `収入 ${yen(r.income)} に対して、固定費 ${yen(r.fixed)}・変動費 ${yen(r.variable)}。${top ? `いちばん大きいのは${top.name}（${yen(top.actual)}）。` : ''}${r.forecast.balance < 0 ? `来月も今のペースだと約 ${yen(-r.forecast.balance)} の赤字見込みです。変動費を週 ${yen(Math.ceil(-r.forecast.balance / W / 100) * 100)} 減らすと収支がとれます。` : '来月の見通しは黒字です。この差を守れれば大丈夫。'}`,
    }];
  }
  if (r.balance >= MONTHLY_LIMITS.balanceMin) {
    const d = r.topDebt;
    if (d && d.rate >= MONTHLY_LIMITS.highRate) {
      const amt = Math.min(r.balance, d.balance);
      return [{
        rule: 'm_surplus', key: key('m_surplus'), level: 'good', priority: 80, href: '#/debts',
        title: `${r.period.label}は ${yen(r.balance)} の黒字でした`,
        body: `このうち ${yen(amt)} を${d.name}（年 ${d.rate}%）の繰り上げ返済に回すと、手数料が年およそ ${yen(Math.round(amt * d.rate / 100))} 減ります。確実に「年 ${d.rate}% で増える」のと同じなので、ほかのどこに置くより有利です。`,
      }];
    }
    const g = r.goals.find((x) => x.ratio < 1);
    return [{
      rule: 'm_surplus', key: key('m_surplus'), level: 'good', priority: 80, href: g ? '#/goals' : '#/summary',
      title: `${r.period.label}は ${yen(r.balance)} の黒字でした`,
      body: g ? `口座に置いたままだと、なんとなく使ってしまいがちです。今日のうちに${g.label}へ移しておきましょう（今 ${yen(g.total)} / ${yen(g.target)}）。` : '口座に置いたままだと使ってしまいがちです。今日のうちに貯金用の口座へ移しておきましょう。',
    }];
  }
  return [];
}

/** 予算を超えた大分類（来月の週の目安） */
function mOverBudget(r: MonthlyReport): Advice[] {
  return r.lines.filter((l) => l.budget !== null && l.actual > l.budget).sort((a, b) => (b.actual - b.budget!) - (a.actual - a.budget!)).slice(0, 2).map((l) => {
    const nb = l.nextBudget ?? l.budget!;
    return {
      rule: 'm_over_budget', key: `m_over_budget:${l.name}:${r.period.start}`, level: 'warn' as const, priority: 90, href: '#/budget',
      title: `${l.name}が予算を ${yen(l.actual - l.budget!)} 超えました`,
      body: `${yen(l.actual)} / 予算 ${yen(l.budget!)}。来月は週 ${yen(Math.floor(nb / W / 100) * 100)} が目安です。週の初めに「今週の${l.name}」の上限を決めておくと守りやすくなります。`,
    };
  });
}

/** 来月の見込みが予算を超えそう */
function mForecastOver(r: MonthlyReport): Advice[] {
  const l = r.lines.map((x) => ({ x, b: x.nextBudget ?? x.budget })).filter(({ x, b }) => b !== null && x.predicted - b >= MONTHLY_LIMITS.forecastOverMin && !(x.budget !== null && x.actual > x.budget))
    .sort((a, b) => (b.x.predicted - b.b!) - (a.x.predicted - a.b!))[0];
  if (!l) return [];
  return [{
    rule: 'm_forecast_over', key: `m_forecast_over:${l.x.name}:${r.period.start}`, level: 'info', priority: 70, href: '#/budget',
    title: `来月の${l.x.name}は約 ${yen(l.x.predicted)} の見込み（予算 ${yen(l.b!)}）`,
    body: 'ここ数か月の記録からの見込みです。予算を見込みに合わせるか、使い方を変えるか、どちらかを先に決めておきましょう。決めないまま月に入ると、たいてい見込みどおりになります。',
  }];
}

/** 先月より大きく増えた大分類 */
function mRising(r: MonthlyReport): Advice[] {
  const l = r.lines.filter((x) => x.prev !== null && x.prev > 0 && x.actual >= x.prev * MONTHLY_LIMITS.risingRatio && x.actual - x.prev >= MONTHLY_LIMITS.risingMin)
    .sort((a, b) => (b.actual - b.prev!) - (a.actual - a.prev!))[0];
  if (!l) return [];
  return [{
    rule: 'm_rising', key: `m_rising:${l.name}:${r.period.start}`, level: 'info', priority: 66, href: '#/history?v=list',
    title: `${l.name}が先月より ${yen(l.actual - l.prev!)} 増えました`,
    body: `${yen(l.prev!)} → ${yen(l.actual)}。一度きりの出費なら気にしなくて大丈夫。続くようなら、何が増えたのか履歴で一度だけ見ておくと、来月の使い方が決めやすくなります。`,
  }];
}

/** 来月の一括返済・貯金の予定 */
function mEvents(r: MonthlyReport): Advice[] {
  if (r.events.length === 0) return [];
  const total = r.events.reduce((a, e) => a + e.amount, 0);
  return [{
    rule: 'm_events', key: `m_events:${r.period.start}`, level: 'info', priority: 92, href: r.events.some((e) => e.kind === 'debt') ? '#/debts' : '#/goals',
    title: `来月は ${r.events.map((e) => e.label).join('・')}（計 ${yen(total)}）の予定です`,
    body: 'ボーナスなどが入ったら、その日のうちに予定の分を移すのがいちばん確実です。「残ったら」にすると、ほぼ確実に減ります。終わったら、返済・目標の画面で「済み」にしてください。',
  }];
}

/** サブスクの棚卸し（3 か月に 1 回） */
function mSubscriptions(r: MonthlyReport): Advice[] {
  const month = Number(r.next.end.slice(5, 7));
  const total = r.subscriptions.reduce((a, x) => a + x.amount, 0);
  if (month % 3 !== 0 || total < 3000) return [];
  return [{
    rule: 'm_subscriptions', key: `m_subscriptions:${r.period.start}`, level: 'info', priority: 60, href: '#/recurring',
    title: `サブスクは月 ${yen(total)}、1 年で ${yen(total * 12)}`,
    body: `${r.subscriptions.length} 件（${r.subscriptions.slice(0, 4).map((x) => x.name).join('・')}${r.subscriptions.length > 4 ? ' など' : ''}）。3 か月に 1 回の棚卸しの時期です。「この 1 か月で使ったか」で分けて、使っていないものは一度止めてみましょう。困ったらまた入ればいいだけです。`,
  }];
}

/** 習慣になっている小さな出費 */
function mHabit(r: MonthlyReport): Advice[] {
  const x = r.habits.find((h) => h.count >= MONTHLY_LIMITS.habitMin && h.total / h.count <= MONTHLY_LIMITS.habitMaxAvg);
  if (!x) return [];
  const avg = Math.round(x.total / x.count);
  return [{
    rule: 'm_habit', key: `m_habit:${x.name}:${r.period.start}`, level: 'info', priority: 62, href: '#/history?v=list',
    title: `${x.name}は先月 ${x.count} 回・${yen(x.total)}`,
    body: `1 回 ${yen(avg)} でも、1 年にすると約 ${yen(x.total * 12)}。全部やめなくても、週に 1 回減らすだけで年 ${yen(avg * 52)} 浮きます。「買う前に 1 回だけ考える日」を決めるのがおすすめです。`,
  }];
}

/** 使わない日 */
function mNoSpend(r: MonthlyReport): Advice[] {
  if (r.trackedDays < 14) return [];
  if (r.noSpendDays >= MONTHLY_LIMITS.noSpendGood) {
    return [{ rule: 'm_no_spend', key: `m_no_spend:${r.period.start}`, level: 'good', priority: 52, title: `使わない日が ${r.noSpendDays} 日ありました`, body: 'お金を使わない日は、いちばん簡単で効く節約です。来月も同じくらいを目指しましょう。' }];
  }
  return [{ rule: 'm_no_spend', key: `m_no_spend:${r.period.start}`, level: 'info', priority: 50, title: `使わない日は ${r.noSpendDays} 日でした`, body: '週に 1 日、「今日は何も買わない日」を決めてみませんか。お弁当と水筒を持っていく日にすると続けやすいです。' }];
}

/** 土日に偏っている */
function mWeekend(r: MonthlyReport): Advice[] {
  if (r.weekendShare < MONTHLY_LIMITS.weekendShare || r.variable < MONTHLY_LIMITS.weekendMinVariable) return [];
  return [{
    rule: 'm_weekend', key: `m_weekend:${r.period.start}`, level: 'info', priority: 58,
    title: `変動費の ${Math.round(r.weekendShare * 100)}% が土日でした`,
    body: '土日は 1 か月の 3 割ほどしかないので、かなり偏っています。金曜の夜に「この週末に使う額」を決めておくと、使いすぎを防げます。',
  }];
}

/** 目標の進み具合 */
function mGoal(r: MonthlyReport): Advice[] {
  return r.goals.filter((g) => g.ratio < 1).slice(0, 1).map((g) => ({
    rule: 'm_goal', key: `m_goal:${r.period.start}`, level: 'good' as const, priority: 48, href: '#/goals',
    title: `${g.label}: ${Math.round(g.ratio * 100)}%（${yen(g.total)} / ${yen(g.target)}）`,
    body: g.reachMonth ? `今のペースなら ${monthLabel(g.reachMonth)}に届きます。黒字の月に少しでも足すと、その分だけ早まります。` : '今のペースだと 10 年以内に届きません。毎月の先取りを少しだけ増やすか、ボーナスからの入金を予定に入れましょう。',
  }));
}

/** リボの金利の仕組み（年率の高い借入があるとき、季節の情報と同じ枠で） */
function revoMath(r: MonthlyReport): Advice[] {
  const d = r.topDebt;
  if (!d || d.rate < MONTHLY_LIMITS.highRate) return [];
  return [{
    rule: 'm_info_revo', key: `m_info_revo:${r.period.start}`, level: 'info', priority: 40, href: '#/debts',
    title: `${d.name}の年 ${d.rate}% は、10 万円あたり年約 ${yen(Math.round(100000 * d.rate / 100))}`,
    body: '投資の長い目で見た利回りは年 3〜5% 程度と言われます。それより高い金利の借入があるうちは、余ったお金は返済に回すのが一番の「運用」です。新しくリボで買い物をしないのも大事です。',
  }];
}

/** 季節の役立ち情報（来月に合わせて） */
function seasonal(r: MonthlyReport): Advice[] {
  const ym = r.next.end.slice(0, 7);
  const month = Number(ym.slice(5, 7));
  const social = r.lines.find((l) => l.name === '交際費');
  const tip = (id: string, title: string, body: string, href?: string): Advice => ({ rule: `m_info_${id}`, key: `m_info_${id}:${ym}`, level: 'info', priority: 45, title, body, ...(href ? { href } : {}) });
  const out: Advice[] = [];
  switch (month) {
    case 1:
      out.push(tip('nisa_new_year', '新しい年の NISA の枠が使えるようになります', 'NISA の年間の枠は、年をまたいで繰り越せません。積立の設定額がこれでいいか、年の初めに一度だけ見直しておきましょう。'));
      out.push(tip('new_year_sale', '初売り・福袋は「買う物を決めてから」', 'セールで安くなるのは「もともと買う予定だった物」だけです。行く前にメモに書いた物以外は買わない、と決めておくと安心です。'));
      break;
    case 2:
      out.push(tip('tax_return', '確定申告は 2/16〜3/15（医療費控除など）', '1 年の医療費（家族分も合わせて）が 10 万円を超えたら、医療費控除で税金が戻るかもしれません。病院や薬局のレシートを捨てずにまとめておきましょう。ふるさと納税を 6 か所以上にした人も確定申告が必要です。'));
      break;
    case 3:
      out.push(tip('fiscal_end', '3 月は送別会と引っ越しの季節', '送別会が重なりやすい月です。交際費の予算を少し多めにしておき、ほかで調整するのが現実的です。引っ越しの予定があるなら、3 月下旬は料金が一番高い時期なので、ずらせるなら 4 月以降に。'));
      break;
    case 4:
      out.push(tip('new_fiscal', '新年度は固定費の見直しにちょうどいい時期', '携帯のプラン、保険、使っていないサブスク。1 回見直すと、我慢しなくても毎月ずっと効きます。歓迎会も重なるので、交際費は回数を先に決めておきましょう。'));
      break;
    case 5:
      out.push(tip('gw_car_tax', 'GW の旅行と、自動車を持っているなら自動車税（5 月末まで）', '連休中は交通費・宿泊費が一番高い時期です。旅行に行くなら、予算を先に決めて「旅行」の分を別に取っておくと、ほかの月に響きません。'));
      break;
    case 6:
      out.push(tip('resident_tax', '6 月から住民税の額が変わります', '6 月の給与明細で、手取りがいくら変わったかを確かめましょう。変わっていたら、給料の自動記録の金額も直しておくと見通しがずれません。', '#/recurring'));
      out.push(tip('summer_bonus', '夏のボーナスは「入った日に分ける」', '返済・貯金・使う分の 3 つに、入った日のうちに分けるのがいちばん確実です。使う分を先に決めておくと、気持ちよく使えます。'));
      break;
    case 7:
      out.push(tip('summer_sale', '夏のセールは 48 時間ルールで', '欲しい物はカートに入れて 2 日待ってみましょう。それでも欲しければ買う。これだけで「なんとなく買い」がかなり減ります。冷房の電気代が上がる時期でもあります。'));
      break;
    case 8:
      out.push(tip('obon', 'お盆の帰省・旅行は早めの予約で', '新幹線や飛行機は早割を使うと大きく変わります。お土産や外食も重なるので、「お盆の分」を先に取っておきましょう。'));
      break;
    case 9:
      out.push(tip('half_year', '半年のふり返りにちょうどいい月です', 'サマリで 1 月からの収支を見て、ペースどおりか確かめてみましょう。年末のボーナス・ふるさと納税・忘年会の予定も、今のうちにざっくり考えておくと楽です。'));
      break;
    case 10:
      if (r.forecast.income > 0) out.push(tip('furusato_start', 'ふるさと納税は今の時期に始めると楽です', '実質 2,000 円の負担で返礼品がもらえます。上限は年収や家族構成で変わるので、源泉徴収票や各サイトのシミュレーターで確かめてから。年末にまとめてやると、上限の確認や受け取りが大変になりがちです。'));
      break;
    case 11:
      out.push(tip('year_end_adjust', '年末調整の書類を用意しましょう', '生命保険料・地震保険料の控除証明書、iDeCo の掛金の証明書などが 10〜11 月に届きます。出し忘れると、税金が戻る分を逃します。'));
      out.push(tip('black_friday', 'ブラックフライデーは 48 時間ルールで', '「安いから買う」は節約になりません。前から欲しかった物だけをリストにしてから見ましょう。'));
      break;
    case 12:
      if (r.forecast.income > 0) out.push(tip('furusato_deadline', 'ふるさと納税は 12/31 まで', 'その年の分は 12/31 の支払いまで。上限は年収で変わるので、源泉徴収票の見込みやシミュレーターで確かめてから。年末は混み合うので、早めに済ませましょう。'));
      out.push(tip('bonenkai', '12 月は忘年会が増えやすい月です', `${social ? `先月の交際費は ${yen(social.actual)}。` : ''}行く会を先に選んで回数を決めておきましょう。二次会は「行かない」と決めておくだけで、1 回あたり数千円変わります。`, '#/goals'));
      out.push(tip('nisa_year_end', 'NISA の今年の枠は繰り越せません', '使っていない枠があっても、来年に持ち越せません。無理に入れる必要はありませんが、積立の設定が止まっていないかだけ確かめておきましょう。'));
      break;
  }
  return out.slice(0, MONTHLY_LIMITS.seasonalMax);
}

/** お金の知恵（毎月 1 つ、その人の数字で。当てはまるものから月ごとに順番に） */
function evergreen(r: MonthlyReport): Advice[] {
  const ym = r.next.end.slice(0, 7);
  const living = r.forecast.fixed + r.forecast.variable;
  const hourly = r.forecast.income > 0 ? Math.round(r.forecast.income / 160) : 0;
  const rate = r.income > 0 ? r.balance / r.income : null;
  const tip = (id: string, title: string, body: string, href?: string): Advice => ({ rule: `m_info_${id}`, key: `m_info_${id}:${ym}`, level: 'info', priority: 44, title, body, ...(href ? { href } : {}) });
  const cands: Advice[] = [];
  if (living > 0) cands.push(tip('emergency_fund', `いざという時のお金は ${yen(Math.round(living * 3 / 10000) * 10000)}〜${yen(Math.round(living * 6 / 10000) * 10000)} が目安`, `あなたの 1 か月の生活費（見込み）は約 ${yen(living)}。病気や転職で収入が止まっても困らないように、その 3〜6 か月分を「使わない口座」に置いておくのが基本です。これがあると、リボやカードの分割に頼らずに済みます。`));
  if (hourly > 0) cands.push(tip('hourly', `あなたの 1 時間は約 ${yen(hourly)}`, `手取りを月 160 時間で割った額です。1 万円の買い物は約 ${Math.round(10000 / hourly * 10) / 10} 時間分の働き。迷ったら「何時間分か」で考えると、本当に欲しいかが見えてきます。`));
  if (rate !== null && r.income > 0) cands.push(tip('saving_rate', rate > 0 ? `先月は手取りの ${Math.round(rate * 100)}% が残りました` : '先月は手取りより多く使いました', '手取りの 2 割を残せると、家計はかなり安定すると言われます。いきなりではなく、毎月 1% ずつ上げるくらいが続けやすいです。先取りの金額を少しずつ増やすのが一番確実です。', '#/goals'));
  cands.push(tip('rule72', '72 の法則: 年率で 72 を割ると、お金が 2 倍になる年数', '年 3% なら 24 年、年 6% なら 12 年で 2 倍。逆に年 15% のリボは、約 5 年で借りた額が 2 倍になる計算です。増やすより、高い金利を払わないほうが確実に効きます。'));
  cands.push(tip('auto_transfer', '貯金は「自動」にしたら勝ち', '給料日の翌日に、貯金用の口座へ自動で移す設定（銀行の定額自動振替など）をしておくと、意志の力がいりません。アプリの先取りの金額と同じにしておくと、記録と実際がそろいます。'));
  cands.push(tip('cashless', 'キャッシュレスは「使った実感」が薄くなりがち', '便利な反面、現金より使いすぎやすいと言われます。使ったらすぐ記録する（このアプリ）か、カードを 1〜2 枚に絞ると、何にいくら使ったかが見えやすくなります。'));
  cands.push(tip('fixed_first', '節約は「回数の少ないもの」から', '毎日の我慢より、携帯・保険・サブスクのように 1 回見直せばずっと効くものからのほうが、楽で大きく効きます。次に、飲み会や外食のような「1 回が大きいもの」。小さな我慢は最後で大丈夫です。'));
  if (cands.length === 0) return [];
  const [y, m] = ym.split('-').map(Number);
  return [cands[(y! * 12 + m!) % cands.length]!];
}

export const MONTHLY_TIPS: ((r: MonthlyReport) => Advice[])[] = [
  mBalance, mOverBudget, mForecastOver, mRising, mEvents, mSubscriptions, mHabit, mNoSpend, mWeekend, mGoal, revoMath, seasonal, evergreen,
];

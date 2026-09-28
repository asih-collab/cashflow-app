/** 整数円を「¥12,345」形式にする。負数は「-¥1,200」 */
export function yen(n: number): string {
  const v = Math.trunc(n);
  const s = Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (v < 0 ? '-¥' : '¥') + s;
}

/** 桁区切りだけ（テンキーの表示用） */
export function group(n: number): string {
  return Math.trunc(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

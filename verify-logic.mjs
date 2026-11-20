// 验证判定公式的边界用例（与 verification.service.ts 逻辑一致）
function judge(direction, expectedMagnitude, basePrice, targetPrice) {
  const th = Math.max(expectedMagnitude ?? 0, 0.5);
  const change = ((targetPrice - basePrice) / basePrice) * 100;
  let result, directionCorrect = false, magnitudeMet = false;
  if (direction === 'up') {
    directionCorrect = change > 0;
    magnitudeMet = change >= th;
  } else if (direction === 'down') {
    directionCorrect = change < 0;
    magnitudeMet = change <= -th;
  } else {
    directionCorrect = Math.abs(change) < th;
    magnitudeMet = directionCorrect;
  }
  if (magnitudeMet && directionCorrect) result = 'hit';
  else if (directionCorrect && !magnitudeMet) result = 'partial';
  else result = 'miss';
  return { change: +change.toFixed(2), th, result };
}

const cases = [
  ['看涨 涨1.2% 预期1%', 'up', 1, 10, 10.12, 'hit'],
  ['看涨 涨0.6% 预期1%(方向对幅度不足)', 'up', 1, 10, 10.06, 'partial'],
  ['看涨 跌0.5% 预期1%', 'up', 1, 10, 9.95, 'miss'],
  ['看涨 涨0.3% 预期空(方向对幅度不足)', 'up', null, 10, 10.03, 'partial'],
  ['看涨 涨0.6% 预期空(用0.5%下限)', 'up', null, 10, 10.06, 'hit'],
  ['看跌 跌1.2% 预期1%', 'down', 1, 10, 9.88, 'hit'],
  ['看跌 涨0.4% 预期1%', 'down', 1, 10, 10.04, 'miss'],
  ['震荡 波动0.3% 预期空', 'flat', null, 10, 10.03, 'hit'],
  ['震荡 波动0.8% 预期空', 'flat', null, 10, 10.08, 'miss'],
];

let pass = 0;
for (const [name, dir, exp, base, target, want] of cases) {
  const r = judge(dir, exp, base, target);
  const ok = r.result === want;
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} => ${r.result} (变动 ${r.change}%, 阈 ${r.th}%) ${ok ? '' : '期望 ' + want}`);
}
console.log(`\n${pass}/${cases.length} 通过`);
process.exit(pass === cases.length ? 0 : 1);

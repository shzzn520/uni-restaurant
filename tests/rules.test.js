// ===============================================================
// tests/rules.test.js —— common/rules.js 的单元测试（零依赖）
// 运行：npm run test:rules
// ===============================================================
const assert = require('assert');
const rules = require('../common/rules.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('PASS  ' + name);
}

test('money 保留两位小数', () => {
  assert.strictEqual(rules.money(0.1 + 0.2), 0.3);
  assert.strictEqual(rules.money('12.345'), 12.35);
  assert.strictEqual(rules.money(undefined), 0);
});

test('会员等级按累计消费分档', () => {
  assert.strictEqual(rules.levelOf(0), '普通会员');
  assert.strictEqual(rules.levelOf(199.99), '普通会员');
  assert.strictEqual(rules.levelOf(200), '银卡');
  assert.strictEqual(rules.levelOf(500), '金卡');
  assert.strictEqual(rules.levelOf(1000), '黑卡');
});

test('等级折扣率', () => {
  assert.strictEqual(rules.levelRate('普通会员'), 1);
  assert.strictEqual(rules.levelRate('银卡'), 0.95);
  assert.strictEqual(rules.levelRate('金卡'), 0.9);
  assert.strictEqual(rules.levelRate('黑卡'), 0.85);
  assert.strictEqual(rules.levelRate('不存在的等级'), 1);
});

test('优惠券不能把订单减到 0 元', () => {
  assert.strictEqual(rules.couponDiscount(30, 5), 5);
  assert.strictEqual(rules.couponDiscount(30, 50), 29);
  assert.strictEqual(rules.couponDiscount(0.5, 10), 0);
});

test('余额最多抵券后金额的 80%', () => {
  assert.strictEqual(rules.balanceCap(100), 80);
  assert.deepStrictEqual(rules.quoteBalanceAmount(50, 100), { usable: true, amount: 50, reason: '' });
  assert.deepStrictEqual(rules.quoteBalanceAmount(200, 100), { usable: true, amount: 80, reason: '' });
  assert.strictEqual(rules.quoteBalanceAmount(0, 100).usable, false);
});

test('积分抵现：100 分抵 1 元、按整元、封顶 20%', () => {
  // 320 分 = 3 元；48.2 元的 20% = 9.64，取整 9 元，故只抵 3 元
  assert.deepStrictEqual(rules.quotePoints(320, 48.2), { usable: true, amount: 3, pointsUsed: 300, reason: '' });
  // 1000 分 = 10 元，但 20 元订单封顶 4 元
  assert.deepStrictEqual(rules.quotePoints(1000, 20), { usable: true, amount: 4, pointsUsed: 400, reason: '' });
  // 不足 100 分不可用
  assert.strictEqual(rules.quotePoints(99, 100).usable, false);
  // 金额太小，可抵不足 1 元
  assert.strictEqual(rules.quotePoints(1000, 4).usable, false);
});

test('等级折扣基数取券后金额', () => {
  const q = rules.quoteLevel(500, 100);
  assert.strictEqual(q.level, '金卡');
  assert.strictEqual(q.rate, 0.9);
  assert.strictEqual(q.amount, 10);
});

test('配送费与送达时间', () => {
  assert.strictEqual(rules.deliveryFeeOf('pickup', 10), 0);
  assert.strictEqual(rules.deliveryFeeOf('delivery', 38.99), 5);
  assert.strictEqual(rules.deliveryFeeOf('delivery', 39), 0);
  assert.strictEqual(rules.deliveryWaitMinutes(10), 25);
  assert.strictEqual(rules.deliveryWaitMinutes(55), 60);
});

console.log('\n合计: PASS=' + passed + '  FAIL=0');
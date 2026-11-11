// 临时脚本：按 DemoOrderSeeder 的确定性规则模拟新菜品池（17 个可见菜品）下的演示订单，
// 输出 6 笔会员单的 orderId/status/payAmount，供 DemoMemberSeeder 的流水种子使用。
// 用法：node _sim_demo_orders.js
const DISHES = [ // [id, price]，与 DataSeeder 一致（套餐区 6 个 price=0 会被过滤）
  ['d0', 68], ['d1', 14], ['d2', 28], ['d3', 26], ['d4', 24], ['d5', 6],
  ['d6', 12], ['d7', 10], ['d8', 18], ['d9', 0], ['d10', 0], ['d11', 0],
  ['d12', 0], ['d13', 0], ['d14', 0], ['d15', 24], ['d16', 22], ['d17', 30],
  ['d18', 9], ['d19', 13], ['d20', 8], ['d21', 12], ['d22', 7]
];
// DemoOrderSeeder: findByShopId + sorted(Comparator.comparing(Dish::getId)) → 按 id 字符串排序
const pool = DISHES.filter(d => d[1] > 0)
  .map(d => ({ id: 'demo-shop-' + d[0], price: d[1] }))
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const PLAN = [[6, 3], [5, 4], [4, 5], [3, 4], [2, 5], [1, 6], [0, 7]];
const TODAY_STATUS = ['done', 'done', 'done', 'paid', 'paid', 'preparing', 'unpaid'];

let seq = 0;
const memberOrders = [];
for (const [daysAgo, count] of PLAN) {
  for (let i = 0; i < count; i++) {
    seq++;
    const status = daysAgo === 0 ? TODAY_STATUS[i % TODAY_STATUS.length]
                                 : (seq % 7 === 0 ? 'canceled' : 'done');
    const paidLike = status !== 'unpaid' && status !== 'canceled';
    const isMember = seq % 5 === 0;

    const want = 1 + (seq % 3);
    const picked = new Set();
    for (let k = 0; picked.size < want && k < pool.length; k++) {
      picked.add((seq * 2 + k * 3) % pool.length);
    }
    let total = 0;
    const lines = [];
    for (const idx of picked) {
      const qty = 1 + ((seq + idx) % 2);
      total += pool[idx].price * qty;
      lines.push(pool[idx].id + ' x' + qty);
    }
    total = Math.round(total * 100) / 100;

    let discount = 0;
    if (paidLike && seq % 4 === 0) {
      const cap = total - 1;
      discount = cap > 0 ? Math.min(cap, 5) : 0;
    }
    const afterCoupon = total - discount;
    let levelDiscount = 0;
    if (paidLike && isMember) {
      levelDiscount = Math.round(afterCoupon * 0.05 * 100) / 100; // HALF_UP
    }
    const payAmount = Math.max(0, Math.round((afterCoupon - levelDiscount) * 100) / 100);

    if (isMember) {
      memberOrders.push({ seq, daysAgo, i, status, total, discount, levelDiscount, payAmount,
        earn: Math.floor(payAmount), lines: lines.join(' + ') });
    }
  }
}
console.log('pool.size =', pool.length);
console.log('会员单（seq%5==0，共 ' + memberOrders.length + ' 单）：');
memberOrders.forEach(o => console.log(
  '  seq=' + o.seq, 'daysAgo=' + o.daysAgo, 'i=' + o.i, o.status,
  'total=' + o.total, 'disc=' + o.discount, 'lv=' + o.levelDiscount,
  'pay=' + o.payAmount, 'earn=' + o.earn, '|', o.lines));
const spend = memberOrders.filter(o => o.status !== 'canceled')
  .reduce((s, o) => s + o.payAmount, 0);
const points = memberOrders.filter(o => o.status !== 'canceled')
  .reduce((s, o) => s + o.earn, 0);
console.log('会员累计消费（paidLike 单 payAmount 合计） =', Math.round(spend * 100) / 100);
console.log('会员积分（paidLike 单 earn 合计）         =', points);

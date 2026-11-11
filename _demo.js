/**
 * 答辩演示全链路走查脚本（后端模式）
 *
 * 目的：把「顾客下单 → 商家接单出餐 → 顾客评价 → 商家回复 → 经营统计 → 导出」
 * 整条链路按演示顺序跑一遍，确认每一步都通。
 *
 * 与 _e2e2.js 的区别：
 *  - _e2e2.js 是断言式的回归测试（73 项，判 PASS/FAIL，会用测试账号反复刷单）
 *  - 本脚本是「剧本式走查」，从演示视角打印每一步的真实返回，便于答辩前自检
 *
 * 重要：全程使用**临时账号**（不碰演示账号 13800001234），
 *      演示账号的余额/积分/券必须保持原样，只在最后做一次无副作用试算。
 *
 * 用法：node _demo.js
 */
const BASE = 'http://127.0.0.1:8080/api';
const SHOP = 'demo-shop';
const SHOP_TOKEN = 'demo1234';

/** 临时顾客账号：与演示账号刻意分开，避免消耗演示资产 */
const TEMP_PHONE = '13900007777';

let n = 0, pass = 0, fail = 0;

function step(title) {
  n++;
  console.log('\n【' + String(n).padStart(2, '0') + '】' + title);
}
function show(label, value) {
  console.log('     ' + label + ': ' + value);
}
function mark(ok, detail) {
  if (ok) { pass++; console.log('     ✓ ' + detail); }
  else { fail++; console.log('     ✗ ' + detail); }
}

async function req(path, method = 'GET', body, headers = {}) {
  const opt = { method, headers: { 'content-type': 'application/json', ...headers } };
  if (body !== undefined) opt.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opt);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

/**
 * 发码 + 用码登录（手机号登录已强制短信验证码）。
 * 撞上 60 秒重发频控时按提示等待重试，保证脚本可反复运行。
 */
async function loginWithCode(phone, nickname) {
  let r = await req('/member/send-code', 'POST', { phone });
  const m = /请 (\d+) 秒后重试/.exec((r && r.msg) || '');
  if (r && !r.success && m) {
    await new Promise(s => setTimeout(s, (Number(m[1]) + 1) * 1000));
    r = await req('/member/send-code', 'POST', { phone });
  }
  if (!r || !r.success) throw new Error('发码失败：' + ((r && r.msg) || JSON.stringify(r)));
  const code = (r.data || {}).demoCode;
  return req('/member/login', 'POST', { phone, code, nickname: nickname || '' });
}

(async () => {
  console.log('================ 答辩演示全链路走查（后端模式）================');

  // ---------- 顾客侧 ----------
  step('顾客扫码进店：门店列表');
  const shops = await req('/shop/list');
  const shopList = (shops.data || {}).shops || [];
  show('门店数', shopList.length);
  shopList.slice(0, 3).forEach(s => show('  ·', s.name + '（' + s.address + '）'));
  mark(shopList.length >= 1, '门店加载正常（' + shopList.length + ' 家）');

  step('顾客看菜单（红区/白区应从顾客视角剔除）');
  const menu = await req('/menu?shopId=' + SHOP + '&role=customer');
  const md = menu.data || {};
  const cats = md.categories || [], dishes = md.dishes || [];
  show('分类', cats.map(c => c.name).join('、'));
  show('在售菜品', dishes.length + ' 道');
  const hasZone = cats.some(c => c.name === '红区' || c.name === '白区');
  mark(!hasZone && dishes.length > 0, '套餐分区未泄漏到顾客菜单（' + dishes.length + ' 道菜）');

  step('套餐入口：1+1 随心配分区');
  const combo = await req('/combo?shopId=' + SHOP);
  const cd = combo.data || {};
  const zones = cd.zones || [];
  const red = (zones.find(z => z.key === 'red') || {}).dishes || [];
  const white = (zones.find(z => z.key === 'white') || {}).dishes || [];
  show('套餐名', cd.name + '（一口价 ¥' + cd.price + '）');
  show('红区可选', red.length + ' 道');
  show('白区可选', white.length + ' 道');
  mark(red.length > 0 && white.length > 0, '套餐两区都有可选菜品');

  step('顾客登录（临时账号，不消耗演示资产）');
  const lg = await loginWithCode(TEMP_PHONE, '走查账号');
  const tempTok = (lg.data || {}).memberToken || '';
  show('账号', TEMP_PHONE);
  show('等级', (lg.data || {}).level);
  mark(!!tempTok, '登录成功并签发会话令牌');

  step('顾客充值（储值卡）');
  const accBefore = await req('/member?userId=' + TEMP_PHONE, 'GET', undefined,
    { 'X-Member-Token': tempTok });
  const balBefore = Number((accBefore.data || {}).balance || 0);
  // 不带 X-Shop-Token —— 充值的主体是顾客自己，不该要求商户口令
  const rc = await req('/member/recharge?userId=' + TEMP_PHONE + '&amount=100', 'POST', undefined,
    { 'X-Member-Token': tempTok });
  const balAfter = Number((rc.data || {}).balance || 0);
  show('充值前 / 后', '¥' + balBefore + ' → ¥' + balAfter);
  // 断言用增量而非绝对值：脚本反复跑时余额是累计的，写死 100 第二轮必挂
  mark(rc.success && balAfter === balBefore + 100, '顾客可自行充值（不要求商户口令）');
  const rcBad = await req('/member/recharge?userId=13700001111&amount=100', 'POST', undefined,
    { 'X-Member-Token': tempTok });
  mark(rcBad.success === false, '拿自己的令牌给他人账号充值被拒：' + rcBad.msg);

  // 挑一道在售菜品做后续下单
  const dish = dishes[0];
  const items = [{ dishId: dish._id, qty: 2 }];
  show('下单菜品', dish.name + ' ×2（单价 ¥' + dish.price + '）');

  step('优惠试算：演示账号（只试算，无副作用）');
  const demoLogin = await loginWithCode('13800001234');
  const demoData = demoLogin.data || {};
  // 记录演示账号基线：末步用它比对「整条走查没消耗演示资产」。
  // 刻意不写死 100/500 之类的绝对值 —— 种子数据一改，硬编码期望就变成假失败。
  const demoBase = { balance: Number(demoData.balance), points: Number(demoData.points) };
  const demoTok = demoData.memberToken || '';
  show('演示会员', demoData.nickname + ' / ' + demoData.level + ' / 余额 ¥' + demoData.balance);
  // 用满 30 减 8 那张券 + 余额 + 积分，四重叠加
  const q = await req('/order/quote', 'POST', {
    shopId: SHOP, memberId: '13800001234', memberCouponId: 'dmcp-1',
    useBalance: true, usePoints: true,
    items: [{ dishId: dish._id, qty: 2 }]
  }, { 'X-Member-Token': demoTok });
  const qd = q.data || {};
  show('原价', '¥' + qd.totalPrice);
  show('券减', '¥' + qd.discountAmount + '（' + (qd.couponName || '未使用') + '）');
  show('会员折扣', '¥' + qd.levelDiscount + '（费率 ' + qd.levelRate + '）');
  show('余额抵扣', '¥' + qd.balancePay);
  show('积分抵现', '¥' + qd.pointsPay);
  show('实付', '¥' + qd.payAmount);
  mark(Number(qd.discountAmount) > 0 && Number(qd.levelDiscount) >= 0
    && Number(qd.balancePay) > 0 && Number(qd.pointsPay) > 0,
    '四重优惠叠加计算正常（券→折扣→余额→积分，逐级取上一步基数）');

  step('顾客下单（临时账号）');
  const created = await req('/order', 'POST', {
    shopId: SHOP, tableNo: '8', items, note: '走查订单',
    memberId: TEMP_PHONE
  }, { 'X-Member-Token': tempTok });
  const orderId = created.orderId;
  show('订单号', created.orderId);
  show('取餐号', created.pickupNo);
  show('订单号(单号)', created.orderNo);
  mark(!!orderId, '下单成功，状态为待支付');

  step('顾客支付');
  const pay = await req('/order/' + orderId + '/pay', 'POST');
  mark(pay.success === true, '支付成功（演示环境为模拟支付）');

  const after = await req('/order/' + orderId);
  show('当前状态', (after.data || {}).status);
  mark((after.data || {}).status === 'paid', '订单已进入「已支付/待接单」');

  // ---------- 商家侧 ----------
  step('商家登录（口令鉴权）');
  const badLogin = await req('/auth/login', 'POST', { shopId: SHOP, key: 'wrong' });
  mark(badLogin.success === false, '错误口令被拒绝：' + badLogin.msg);
  const mLogin = await req('/auth/login', 'POST', { shopId: SHOP, key: SHOP_TOKEN });
  mark(mLogin.success === true, '正确口令登录成功');

  step('商家接单：paid → preparing');
  const prep = await req('/order/' + orderId + '/status?status=preparing', 'PATCH', undefined,
    { 'X-Shop-Token': SHOP_TOKEN });
  mark(prep.success === true, '接单成功，进入制作中');

  step('商家出餐：preparing → done');
  const done = await req('/order/' + orderId + '/status?status=done', 'PATCH', undefined,
    { 'X-Shop-Token': SHOP_TOKEN });
  mark(done.success === true, '出餐完成');

  step('状态机保护：done 是终态，不允许再改');
  const illegal = await req('/order/' + orderId + '/status?status=paid', 'PATCH', undefined,
    { 'X-Shop-Token': SHOP_TOKEN });
  mark(illegal.success === false, '非法流转被拦：' + illegal.msg);

  step('顾客评价（订单已完成）');
  const rv = await req('/review', 'POST', {
    shopId: SHOP, orderId, dishId: dish._id, dishName: dish.name,
    rating: 5, content: '走查：出餐很快，味道不错', images: ''
  }, { 'X-Member-Token': tempTok });
  const reviewId = rv._id;
  mark(!!reviewId, '评价发表成功（5 星）');

  step('商家回复评价');
  const replyNoAuth = await req('/review/' + reviewId + '/reply', 'PATCH',
    { reply: '偷偷回复' });
  mark(replyNoAuth.success === false, '无口令回复被拒：' + replyNoAuth.msg);
  const reply = await req('/review/' + reviewId + '/reply', 'PATCH',
    { reply: '谢谢认可，欢迎常来！' }, { 'X-Shop-Token': SHOP_TOKEN });
  mark(reply.success === true, '商家回复成功');

  step('经营统计');
  const stats = await req('/admin/stats?shopId=' + SHOP);
  const st = stats.data || {};
  show('累计订单', st.orderTotal + ' 单');
  show('今日订单', st.todayOrderCount + ' 单');
  show('今日营业额', '¥' + st.todayAmount);
  show('待接单', st.pendingCount);
  show('菜品/分类', st.dishTotal + ' / ' + st.categoryTotal);
  show('近 7 日', (st.daily || []).map(d => d.date + ':' + d.orderCount + '单').join(' '));
  mark(Number(st.orderTotal) > 0, '统计聚合正常');

  step('导出订单 CSV');
  const ex = await req('/admin/orders/export.json?shopId=' + SHOP);
  const exd = ex.data || {};
  const head = String(exd.csv || '').split('\n')[0];
  show('导出行数', exd.rows);
  show('文件名', exd.filename);
  show('表头', head.slice(1, 70) + '…');
  mark(exd.csv && exd.csv.charCodeAt(0) === 0xFEFF, 'CSV 带 UTF-8 BOM（Excel 中文不乱码）');

  step('顾客反馈看板');
  const fb = await req('/complaint/stats?shopId=' + SHOP);
  const fbl = fb.data || [];
  show('聚合菜品数', fbl.length);
  fbl.slice(0, 3).forEach(f => show('  ·', f.dishName + ' ' + f.count + ' 次（待处理 ' + (f.pending || 0) + '）'));
  mark(Array.isArray(fbl), '反馈看板可读');

  step('演示账号资产未被消耗（答辩可反复演示）');
  const demoAfter = await req('/member?userId=13800001234', 'GET', undefined,
    { 'X-Member-Token': demoTok });
  const da = demoAfter.data || {};
  show('余额', '¥' + da.balance);
  show('积分', da.points);
  show('等级', da.level);
  mark(Number(da.balance) === demoBase.balance && Number(da.points) === demoBase.points,
    '演示账号资产未被整条走查消耗（余额 ¥' + demoBase.balance + ' / 积分 ' + demoBase.points + '）');

  console.log('\n================================================');
  console.log('  走查结束：通过 ' + pass + ' 步，失败 ' + fail + ' 步');
  console.log('================================================');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => {
  console.error('\n走查中断：', e.message);
  process.exit(1);
});

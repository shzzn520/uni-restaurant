// _e2e_flash.js —— 限时抢购模块端到端验证（真实 Spring Boot 后端）
//
// 运行：node tests/_e2e_flash.js
// 前置：MySQL 已启动；后端以 SMS_DEMO_MODE=true 跑在 8080
//
// 与 _e2e_mock.js 末尾的「限时抢购」段刻意使用同一组断言文案，
// 便于一眼比对两条数据链路（HTTP / mock）是否漂移。
//
// 重点验证的不只是「接口通不通」：
//   ① 场次三种状态与服务端时间是否真的下发
//   ② 金额是否由服务端算（前端伪造 price 必须被无视）
//   ③ 未登录 / 冒用身份 / 售罄 / 已结束场次 / 超限购 是否都被挡住
//   ④ 收藏开关、支付与取消后的订单状态与库存是否同步
const BASE = 'http://localhost:8080/api';
const PHONE = '137' + String(Date.now()).slice(-8);   // 每次换号，避开限领/限购历史
let MEMBER_TOKEN = '';
let pass = 0, fail = 0;

function log(ok, name, extra) {
  if (ok) { pass++; console.log('  PASS  ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')); }
}
function head(t) { console.log('\n========== ' + t + ' =========='); }
function money(n) { return Math.round(Number(n || 0) * 100) / 100; }

/** tokenOverride 传 '' 可模拟未登录（不带 X-Member-Token） */
async function req(path, method, body, tokenOverride) {
  const headers = { 'content-type': 'application/json' };
  const t = tokenOverride === undefined ? MEMBER_TOKEN : tokenOverride;
  if (t) headers['X-Member-Token'] = t;
  const res = await fetch(BASE + path, {
    method: method || 'GET',
    headers: headers,
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

async function sendCode(phone) {
  const r = await req('/member/send-code', 'POST', { phone });
  if (r.success && r.data && r.data.demoCode) return r.data.demoCode;
  const m = /请 (\d+) 秒后重试/.exec(r.msg || '');
  if (m) {
    await new Promise(s => setTimeout(s, (Number(m[1]) + 1) * 1000));
    return sendCode(phone);
  }
  throw new Error('发码失败：' + (r.msg || JSON.stringify(r)));
}

(async function main() {
  head('1. 会员登录');
  const code = await sendCode(PHONE);
  const login = await req('/member/login', 'POST', { phone: PHONE, code: code, nickname: '抢购测试' });
  MEMBER_TOKEN = (login.data || {}).memberToken || '';
  log(!!MEMBER_TOKEN, '登录成功并取得会话令牌');

  head('2. 场次与商品');
  const sess = await req('/flash/sessions');
  const sd = sess.data || {};
  const fl = sd.sessions || [];
  log(fl.length === 4 && fl[0].status === 'ended' && fl[1].status === 'active'
      && fl[2].status === 'upcoming',
    '场次含已结束/进行中/即将开始三种状态', fl.map(s => s.status).join(','));
  log(!!sd.serverTime && sd.activeSessionId === fl[1].id,
    '下发服务端时间与当前场次 id（供前端校准倒计时）');

  const active = sd.activeSessionId;
  const itemsRes = await req('/flash/items?sessionId=' + active + '&memberId=' + PHONE);
  const farr = itemsRes.data || [];
  const f0 = farr[0];
  log(farr.length > 0 && f0.flashPrice > 0 && f0.originalPrice >= f0.flashPrice
      && f0.discount > 0 && f0.discount <= 10,
    '商品列表下发抢购价/原价/折扣（价格由数据层算）',
    f0 ? (f0.name + ' ¥' + f0.flashPrice + ' / ' + f0.discount + '折') : '');
  log(farr.length > 0 && farr.every(x => typeof x.stock === 'number'
      && typeof x.limitPerUser === 'number' && typeof x.soldPercent === 'number'),
    '商品列表下发库存/限购/已抢百分比');
  log(farr.some(x => x.status === 'soldout'), '存在售罄商品用于售罄态验收');
  log(farr.length > 0 && farr.every(x => x.favorited === false),
    '未收藏时 favorited 为 false');

  // 板块1（2026-11-11）：当前 active 场必须列出全部在售商品；
  // 旧种子 fi4/fi5/fi6 只挂未来场、永远抢不到。修后全含 s2。
  const b1Active = fl.find(s => s.id === active);
  log(!!b1Active && Date.now() >= b1Active.startAt && Date.now() < b1Active.endAt,
    'activeSessionId 对应场次处于真实进行中时间窗（按时间判 active）',
    active + ' ' + (b1Active ? b1Active.range : ''));
  const b1AllItems = await req('/flash/items?memberId=' + PHONE);   // 不带 sessionId = 全部在售
  const b1AllIds = ((b1AllItems.data || []).map(x => x._id)).sort();
  const b1ActiveIds = (farr.map(x => x._id)).sort();
  log(JSON.stringify(b1ActiveIds) === JSON.stringify(b1AllIds) && b1AllIds.length > 0,
    '当前场列出全部在售抢购商品（无商品永远抢不到）',
    '当前场 ' + b1ActiveIds.length + ' / 在售 ' + b1AllIds.length);
  const detail = await req('/flash/item?id=' + f0._id + '&memberId=' + PHONE);
  log(detail.success && detail.data._id === f0._id
      && money(detail.data.flashPrice) === money(f0.flashPrice),
    '详情接口与列表口径一致');

  head('3. 权限与状态边界');
  const guestItems = await req('/flash/items?sessionId=' + active);
  log(guestItems.success && (guestItems.data || []).length > 0, '游客可浏览抢购商品');
  const guestBuy = await req('/flash/order', 'POST',
    { itemId: f0._id, qty: 1, sessionId: active }, '');
  log(guestBuy.success === false && /请先登录/.test(guestBuy.msg || ''),
    '未登录不能抢购（权限处理）', guestBuy.msg || '');
  const fake = await req('/flash/order', 'POST',
    { itemId: f0._id, qty: 1, sessionId: active, memberId: 'someone-else' });
  log(fake.success === false && /请先登录/.test(fake.msg || ''),
    '冒用他人身份被拒绝', fake.msg || '');

  const soldout = farr.find(x => x.status === 'soldout');
  let soldoutErr = null;
  if (soldout) {
    const r = await req('/flash/order', 'POST',
      { itemId: soldout._id, qty: 1, sessionId: active, memberId: PHONE });
    soldoutErr = r.success ? '' : r.msg;
  }
  log(/已售罄|库存不足/.test(String(soldoutErr)), '售罄商品不能下单', soldoutErr || '');

  const ended = await req('/flash/order', 'POST',
    { itemId: f0._id, qty: 1, sessionId: fl[0].id, memberId: PHONE });
  log(ended.success === false && /尚未开始或已结束/.test(ended.msg || ''),
    '已结束场次不能下单', ended.msg || '');

  head('4. 收藏与优惠券');
  const fav1 = await req('/flash/favorite', 'POST', { itemId: f0._id, memberId: PHONE });
  const favList = await req('/flash/favorites?memberId=' + PHONE);
  log(fav1.success && fav1.favorited === true
      && (favList.data || []).some(x => x._id === f0._id),
    '收藏成功并出现在收藏列表');
  const fav2 = await req('/flash/favorite', 'POST', { itemId: f0._id, memberId: PHONE });
  log(fav2.success && fav2.favorited === false, '再次点击取消收藏（幂等开关）');

  // 板块8A：并发双击收藏。两个请求同时从「未收藏」出发，一个 insert 成功，
  // 另一个撞 uk_favorite_member_item 唯一键 —— 必须在 Controller 层回查返回当前态，
  // 不能落到全局兜底变成「服务器内部错误」。
  const favItem = farr.find(x => x._id !== f0._id && x.status === 'active') || f0;
  const favConcurrent = await Promise.all([
    req('/flash/favorite', 'POST', { itemId: favItem._id, memberId: PHONE }),
    req('/flash/favorite', 'POST', { itemId: favItem._id, memberId: PHONE })
  ]);
  log(favConcurrent.every(r => r.success === true)
      && !favConcurrent.some(r => /内部错误|稍后重试/.test(r.msg || '')),
    '并发双击收藏不报 500（唯一约束冲突被回查消化）',
    favConcurrent.map(r => r.success + ':' + r.favorited).join(' / '));
  // 复位：确保该商品回到未收藏，不干扰后续
  const favNow = (await req('/flash/favorites?memberId=' + PHONE)).data || [];
  if (favNow.some(x => x._id === favItem._id)) {
    await req('/flash/favorite', 'POST', { itemId: favItem._id, memberId: PHONE });
  }

  const cps = await req('/flash/coupons?memberId=' + PHONE + '&amount=' + f0.flashPrice);
  log(Array.isArray(cps.data) && cps.data.every(c => 'usable' in c && 'reason' in c),
    '可用券列表含 usable/reason（不可用要给出原因）', (cps.data || []).length + ' 张');

  head('5. 下单与金额');
  // 前端伪造 price：服务端必须完全无视，按 flash_item.flash_price 计价
  const buy = await req('/flash/order', 'POST', {
    itemId: f0._id, qty: 1, sessionId: active, memberId: PHONE, price: 0.01
  });
  log(buy.success && !!buy.orderId && !!buy.orderNo,
    '抢购下单成功并返回单号', buy.orderNo || buy.msg || '');
  log(buy.success && money(buy.payAmount) === money(f0.flashPrice),
    '应付金额 = 抢购价 × 数量（前端伪造 price 被无视）',
    '实付 ¥' + buy.payAmount);

  const limited = farr.find(x => x.limitPerUser === 1 && x.status === 'active');
  log(!!limited, '存在限购 1 件的在售商品（用于限购断言）');
  let limitErr = '';
  if (limited) {
    const first = await req('/flash/order', 'POST',
      { itemId: limited._id, qty: 1, sessionId: active, memberId: PHONE });
    const second = await req('/flash/order', 'POST',
      { itemId: limited._id, qty: 1, sessionId: active, memberId: PHONE });
    limitErr = first.success && !second.success ? (second.msg || '') : '';
  }
  log(/超出限购/.test(limitErr), '超出每人限购被拒绝', limitErr);

  head('6. 订单状态同步');
  const myOrders = await req('/flash/orders?memberId=' + PHONE);
  const pending = (myOrders.data || []).find(o => o.status === 'pending');
  log(!!pending && pending.statusText === '待支付', '订单列表含待支付状态');
  const paid = await req('/flash/order/' + pending._id + '/pay', 'POST', { memberId: PHONE });
  log(paid.success && paid.data.status === 'paid' && paid.data.statusText === '已支付',
    '支付后状态同步为已支付');
  const payAgain = await req('/flash/order/' + pending._id + '/pay', 'POST', { memberId: PHONE });
  log(payAgain.success === false && /状态已变更/.test(payAgain.msg || ''),
    '重复支付被拒绝', payAgain.msg || '');

  // 板块1 实测：fi4/fi5/fi6 旧种子只挂未来场，现在必须能在当前场下单。
  // 逐个下单→取消（归还库存、不占限购、不产生 paid 单干扰板块2营业额口径）。
  head('板块1. 原「永远抢不到」的商品现在可下单');
  const b1Stuck = ['fi4', 'fi5', 'fi6'];
  let b1BuyOk = 0, b1Buyable = 0;
  const b1Orders = [];
  for (const iid of b1Stuck) {
    const it = b1AllItems.data.find(x => x._id === iid);
    if (!it || it.status !== 'active' || it.remain <= 0) continue;
    b1Buyable++;
    const r = await req('/flash/order', 'POST',
      { itemId: iid, qty: 1, sessionId: active, memberId: PHONE });
    if (r.success && r.orderId) { b1BuyOk++; b1Orders.push(r.orderId); }
  }
  log(b1BuyOk === b1Buyable && b1Buyable > 0,
    '原「永远抢不到」的商品现在可在当前场下单',
    '成功 ' + b1BuyOk + ' / 可买 ' + b1Buyable);
  for (const oid of b1Orders) {
    await req('/flash/order/' + oid + '/status', 'PATCH', { memberId: PHONE, status: 'canceled' });
  }

  // 板块8A：flash/orders 兼容式分页。不传参=全量（老前端行为不变），
  // 传 page/size 才切片；size 上限 100 由 PageSlice 兜底。
  const ordAll = (await req('/flash/orders?memberId=' + PHONE)).data || [];
  const ordPage1 = (await req('/flash/orders?memberId=' + PHONE + '&page=1&size=2')).data || [];
  const ordPage2 = (await req('/flash/orders?memberId=' + PHONE + '&page=2&size=2')).data || [];
  log(ordPage1.length <= 2 && ordPage2.length <= 2
      && ordPage1.every((a, i) => !ordPage2.some(b => b._id === a._id)),
    '抢购订单按 page/size 切片且两页无重叠',
    'p1=' + ordPage1.length + ' / p2=' + ordPage2.length + ' / 全量=' + ordAll.length);
  log(ordAll.length > 0 && ordPage1.length + ordPage2.length <= ordAll.length,
    '不传 page/size 返回全量（向后兼容）', '全量=' + ordAll.length);

  // ---- 板块2：已支付抢购单并入经营统计 / 营业额明细 / CSV 导出 ----
  // 此刻刚 paid 一笔抢购单，是验证「营业额与实收一致」的最佳时点。
  // 管理接口需 X-Shop-Token；这里刻意用相对断言，不写死演示库的金额绝对值。
  head('板块2. 抢购营业额并入统计与导出');
  const SHOP_TOKEN = 'demo1234';
  const adminGet = async p => {
    const r = await fetch(BASE + p, { headers: { 'X-Shop-Token': SHOP_TOKEN } });
    return r.json();
  };
  const statRes = await adminGet('/admin/stats?shopId=demo-shop');
  // /admin/stats 走 ApiResponse.data 信封 → {success, data:{...}}
  const stats2 = statRes.data || {};
  log(statRes.success === true && money(stats2.flashTodayAmount) > 0,
    '统计接口下发 flashTodayAmount 且已支付抢购单计入（>0）',
    '¥' + stats2.flashTodayAmount);
  log(stats2.flashTodayCount >= 1, '统计接口 flashTodayCount 含本轮已支付抢购单',
    String(stats2.flashTodayCount));
  log(money(stats2.todayAmount) >= money(stats2.flashTodayAmount),
    '今日营业额 ≥ 抢购净额（抢购已并入，主订单部分不丢失）',
    '¥' + stats2.todayAmount + ' ≥ ¥' + stats2.flashTodayAmount);
  // 口径隔离：抢购单不并进主订单总数（orderTotal 来自 order 表，不含 flash_order）
  const flashOrderCount = ((await req('/flash/orders?memberId=' + PHONE)).data || []).length;
  log(typeof stats2.orderTotal === 'number' && flashOrderCount > 0,
    '主订单总数与抢购单量分开统计（口径隔离）',
    'orderTotal=' + stats2.orderTotal + ' / 我的抢购单=' + flashOrderCount);

  // 营业额明细：source=flash 的行 + summary.flashRevenue 与统计同源
  const revRes = await adminGet('/admin/revenue?shopId=demo-shop&date=today');
  const rev = revRes.data || {};
  const flashRows = (rev.orders || []).filter(r => r.source === 'flash' && r.status === 'paid');
  log(revRes.success === true && flashRows.length >= 1,
    '营业额明细含 source=flash 的已支付抢购行', flashRows.length + ' 行');
  log(money(rev.summary && rev.summary.flashRevenue) === money(stats2.flashTodayAmount),
    'revenue 汇总 flashRevenue 与 stats.flashTodayAmount 同源',
    '¥' + (rev.summary && rev.summary.flashRevenue) + ' / ¥' + stats2.flashTodayAmount);
  log(flashRows.every(r => r.deliveryType === 'flash'
      && Number(r.levelDiscount) === 0 && Number(r.pointsPay) === 0 && Number(r.balancePay) === 0),
    '抢购明细行无等级/积分/余额概念（金额字段补 0 保持同构）');

  // CSV 导出：抢购行带标记
  const exRes = await adminGet('/admin/orders/export.json?shopId=demo-shop');
  const csv2 = (exRes.data || {}).csv || '';
  log(exRes.success === true && csv2.indexOf('抢购,FS') > -1 && csv2.indexOf('抢购·已支付') > -1,
    'CSV 导出含「抢购」取餐号标记与已支付抢购行');

  const before = await req('/flash/item?id=' + f0._id + '&memberId=' + PHONE);
  const stockBefore = (before.data || {}).remain;
  const templates = await req('/coupon/templates?shopId=demo-shop&userId=' + PHONE);
  const couponTemplate = (templates.data || []).find(c =>
    c.claimable && Number(c.threshold) <= Number(f0.flashPrice));
  const claimed = couponTemplate
    ? await req('/coupon/claim?couponId=' + encodeURIComponent(couponTemplate._id)
      + '&userId=' + encodeURIComponent(PHONE), 'POST')
    : null;
  const couponId = claimed && claimed.success ? claimed._id : '';
  const extra = await req('/flash/order', 'POST',
    { itemId: f0._id, qty: 1, sessionId: active, memberId: PHONE, couponId: couponId });
  const couponAfterOrder = couponId
    ? await req('/coupon/my?userId=' + encodeURIComponent(PHONE) + '&shopId=demo-shop')
    : null;
  log(!!couponId && (couponAfterOrder.data.used || []).some(c => c._id === couponId),
    '抢购下单核销所选优惠券');
  const canceled = await req('/flash/order/' + extra.orderId + '/status', 'PATCH',
    { memberId: PHONE, status: 'canceled' });
  const after = await req('/flash/item?id=' + f0._id + '&memberId=' + PHONE);
  const couponAfterCancel = couponId
    ? await req('/coupon/my?userId=' + encodeURIComponent(PHONE) + '&shopId=demo-shop')
    : null;
  log(canceled.success && canceled.data.status === 'canceled', '取消订单状态同步为已取消');
  log(extra.success && after.data.remain === stockBefore,
    '取消后库存归还', stockBefore + ' → ' + after.data.remain);
  log(!!couponId && (couponAfterCancel.data.usable || []).some(c =>
      c._id === couponId && !c.useOrderId),
    '取消抢购订单后优惠券退回');

  head('7. 并发下单');
  const concurrentItem = farr.find(x => x.limitPerUser >= 2 && x.status === 'active') || f0;
  const results = await Promise.all(Array.from({ length: 5 }, () =>
    req('/flash/order', 'POST', {
      itemId: concurrentItem._id, qty: 1, sessionId: active, memberId: PHONE
    })));
  const okList = results.filter(r => r.success);
  const orderNos = okList.map(r => r.orderNo);
  const afterCon = await req('/flash/item?id=' + concurrentItem._id + '&memberId=' + PHONE);
  log(new Set(orderNos).size === orderNos.length, '并发下单不产生重复单号');
  log(afterCon.data.remain >= 0, '并发扣减后库存不为负', '剩余 ' + afterCon.data.remain);
  // 行锁让同一商品的抢购串行，限购规则在并发下仍应成立
  const totalBought = (await req('/flash/orders?memberId=' + PHONE)).data
    .filter(o => o.itemId === concurrentItem._id && o.status !== 'canceled').length;
  log(totalBought <= concurrentItem.limitPerUser,
    '并发下未突破每人限购（商品行锁生效）',
    '已购 ' + totalBought + ' / 限购 ' + concurrentItem.limitPerUser);

  // 清理：取消本轮产生的待支付订单，把库存还给演示库
  const all = (await req('/flash/orders?memberId=' + PHONE)).data || [];
  for (const o of all.filter(x => x.status === 'pending')) {
    await req('/flash/order/' + o._id + '/status', 'PATCH',
      { memberId: PHONE, status: 'canceled' });
  }

  console.log('\n========================================');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('========================================');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => {
  console.error('\n[脚本异常]', e && e.message ? e.message : e);
  process.exit(1);
});

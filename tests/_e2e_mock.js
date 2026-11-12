// _e2e_mock.js —— 验证本地模拟层（useMock=true）与后端行为一致
//
// 运行：node tests/_e2e_mock.js
// 目的：mock 是演示环境的默认路径。若它与后端算出不同的金额，
//      课堂上「关掉后端用模拟数据」演示出来的结果就是错的。
//      重点比对两端的口径，不是逐字节比对响应体。
//
// 需要在 node 环境里造一个最小的 uni 桩（只有 getStorageSync/setStorageSync/removeStorageSync）

const store = {};                 // 模拟本地缓存
const fs = require('fs');
global.uni = {
  getStorageSync: k => (store[k] === undefined ? '' : store[k]),
  setStorageSync: (k, v) => { store[k] = v; },
  removeStorageSync: k => { delete store[k]; }
};

const mock = require('../common/mock.js');

let pass = 0, fail = 0;
function log(ok, name, extra) {
  if (ok) { pass++; console.log('  PASS  ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')); }
}
function head(t) { console.log('\n========== ' + t + ' =========='); }
function money(n) { return Math.round(n * 100) / 100; }

/**
 * 测试助手：走真实接口「发码 → 用码登录」。
 *
 * 频控规定同一手机号 60 秒内不可重发，测试不可能真等一分钟；
 * 这里清掉该号的验证码记录来模拟「窗口已过」，**不改变 mock 的频控逻辑**
 * （频控本身在上面有专门断言，清窗口只服务于后续用例）。
 */
async function loginWithCode(phone, nickname) {
  const db = store['mock_db_v15'];
  if (db && db.smsCodes) db.smsCodes = db.smsCodes.filter(x => x.phone !== phone);
  const sent = await mock.call('cloudMember', 'sendCode', { phone, scene: 'login' });
  return mock.call('cloudMember', 'login', {
    phone, code: sent.data.demoCode, nickname: nickname || ''
  });
}

// 与后端 OrderService.priceItems / CouponService 同规则的独立实现，用于交叉校验
const COMBO_PRICE = 12, ZONE_RED = '红区', ZONE_WHITE = '白区', COMBO_NAME = '1+1 随心配';

(async function main() {
  const PHONE = '13900001234';

  // ==================== 1) 会员 ====================
  head('1. 手机验证码登录');
  const sent = await mock.call('cloudMember', 'sendCode', { phone: PHONE, scene: 'login' });
  log(sent.success && /^\d{6}$/.test(sent.data.demoCode),
    '发送登录验证码（返回 6 位演示码）', 'demoCode=' + sent.data.demoCode);
  log(sent.data.ttl === 300 && sent.data.resendAfter === 60,
    '验证码 5 分钟有效 / 60 秒后可重发');

  // 频控：同一手机号 60 秒内第二次发送必须被拦
  let smsErr = null;
  try { await mock.call('cloudMember', 'sendCode', { phone: PHONE, scene: 'login' }); }
  catch (e) { smsErr = e; }
  log(/发送过于频繁/.test(String(smsErr)), '60 秒内重发被频控拦住', smsErr || '');

  // 不带验证码：不能再像改造前那样「只填手机号就登录」
  let noCodeErr = null;
  try { await mock.call('cloudMember', 'login', { phone: PHONE }); }
  catch (e) { noCodeErr = e; }
  log(noCodeErr === '请输入 6 位数字验证码', '不带验证码不能登录', noCodeErr || '');

  // 过期码必须明确提示重新获取，且不能开户。
  const smsRecord = store['mock_db_v15'].smsCodes.find(x => x.phone === PHONE);
  const originalExpiry = smsRecord.expireAt;
  smsRecord.expireAt = Date.now() - 1;
  let expiredErr = null;
  try { await mock.call('cloudMember', 'login', { phone: PHONE, code: sent.data.demoCode }); }
  catch (e) { expiredErr = e; }
  smsRecord.expireAt = originalExpiry;
  log(/验证码已过期，请重新获取/.test(String(expiredErr)),
    '过期验证码被拒绝并提示重新获取', expiredErr || '');

  // 错码：提示剩余尝试次数（这里避开真实验证码，免得碰巧撞对）
  const wrongCode = sent.data.demoCode === '000000' ? '111111' : '000000';
  let wrongErr = null;
  try { await mock.call('cloudMember', 'login', { phone: PHONE, code: wrongCode }); }
  catch (e) { wrongErr = e; }
  log(/验证码不正确/.test(String(wrongErr)), '错误验证码被拒绝', wrongErr || '');

  // 正确码登录
  const login = await mock.call('cloudMember', 'login', {
    phone: PHONE, code: sent.data.demoCode, nickname: '测试'
  });
  // 保存服务端签发的会话令牌：mock 的 requireIdentity 从 storage 读它，
  // 对应真实环境里 http.js 自动加的 X-Member-Token 请求头
  store['memberToken'] = (login.data || {}).memberToken || '';
  log(login.success && login.data._id === PHONE, '验证码正确，登录并开户', '余额=' + login.data.balance);
  log(login.data.level === '普通会员', '初始等级为普通会员');

  // 一次性：同一验证码不能重放（否则被截获后可在有效期内反复登录）
  let replayErr = null;
  try { await mock.call('cloudMember', 'login', { phone: PHONE, code: sent.data.demoCode }); }
  catch (e) { replayErr = e; }
  log(/验证码已使用/.test(String(replayErr)), '验证码一次性：重放被拒绝', replayErr || '');

  const again = await loginWithCode(PHONE);
  log(again.success && again.data._id === PHONE, '重复登录不重复开户');

  let threw = null;
  try { await mock.call('cloudMember', 'login', { phone: '123', code: '123456' }); } catch (e) { threw = e; }
  log(threw === '手机号格式不对', '非法手机号被拒绝（与后端同一句提示）', threw || '');

  // ==================== 1a) 会员云地址簿 ====================
  head('1a. 会员地址云端隔离');
  const memberTokenForAddress = store['memberToken'];
  store['addressBook'] = [{ id: 'guest-only', name: '访客地址' }];
  store['memberToken'] = '';
  let addressAuthError = null;
  try { await mock.call('cloudAddress', 'list'); } catch (e) { addressAuthError = e; }
  log(addressAuthError === '请先登录会员账号', '无会员会话读取云地址被拒', addressAuthError || '');
  store['memberToken'] = memberTokenForAddress;
  const addressCreate = await mock.call('cloudAddress', 'create', {
    data: { name: '测试收件人', phone: '13900001234', detail: '测试路 1 号', isDefault: true }
  });
  const addressId = addressCreate.data._id;
  let addressList = await mock.call('cloudAddress', 'list');
  log(addressList.data.length === 1 && addressList.data[0]._id === addressId
      && addressList.data[0].isDefault,
    '新增会员地址后可从云端列表读回', addressId);
  await mock.call('cloudAddress', 'update', {
    id: addressId, data: { name: '测试收件人2', phone: '13900001234', detail: '测试路 2 号', isDefault: false }
  });
  addressList = await mock.call('cloudAddress', 'list');
  log(addressList.data[0].name === '测试收件人2' && addressList.data[0].detail === '测试路 2 号',
    '更新会员地址及默认标记');
  await mock.call('cloudAddress', 'delete', { id: addressId });
  addressList = await mock.call('cloudAddress', 'list');
  log(addressList.data.length === 0, '删除会员云地址');
  log(store['addressBook'][0].id === 'guest-only', '会员地址操作不覆盖访客本地地址簿');

  // ==================== 1b) 微信一键登录 ====================
  // 与 _e2e2.js 的 1b 段**刻意写成同一组断言**，方便一眼比对两端是否漂移。
  // 后端那侧曾漏发会话令牌（mock 这侧一直是对的），正是这类漂移的典型。
  head('1b. 微信一键登录');
  const sessionToken = store['memberToken'];
  const wx = await mock.call('cloudMember', 'wxLogin', { code: 'mock-code' });
  log(wx.success && !!wx.data._id, '微信登录返回会员档案',
    wx.data ? ('_id=' + wx.data._id + ' demo=' + wx.data.demo) : JSON.stringify(wx));
  log(!!wx.data.memberToken, '微信登录同样签发会话令牌（memberToken）',
    wx.data.memberToken ? '已获取' : '未获取 —— 会导致登录后处处说未登录');
  log(wx.data.balance !== undefined && wx.data.level !== undefined
      && wx.data.levelBenefit !== undefined,
    '微信登录下发完整档案（余额/等级/权益），与手机号登录字段一致');

  // 模拟「带着微信登录的令牌去充值」——用户报障的原始场景
  store['memberToken'] = wx.data.memberToken;
  const wxBalBefore = Number(wx.data.balance) || 0;
  let wxRecharge = null;
  try {
    wxRecharge = await mock.call('cloudMember', 'recharge',
      { userId: wx.data._id, amount: 1 });
  } catch (e) { wxRecharge = { success: false, msg: e }; }
  log(wxRecharge.success && money(wxRecharge.data.balance) === money(wxBalBefore + 1),
    '微信登录后能充值（用户报障的原始场景）', wxRecharge.msg || '');

  let wxMy = null;
  try {
    wxMy = await mock.call('cloudCoupon', 'my', { shopId: 'demo-shop', userId: wx.data._id });
  } catch (e) { wxMy = { success: false, msg: e }; }
  log(wxMy.success && Array.isArray(wxMy.data.usable), '微信登录后能查券包', wxMy.msg || '');

  // 反面：不带令牌必须被拒（否则上面成功可能只是「压根没校验」）
  store['memberToken'] = '';
  let wxNoToken = null;
  try {
    wxNoToken = await mock.call('cloudMember', 'recharge', { userId: wx.data._id, amount: 1 });
  } catch (e) { wxNoToken = { success: false, msg: e }; }
  log(wxNoToken.success === false, '不带令牌给微信会员充值被拒', wxNoToken.msg || '');
  store['memberToken'] = sessionToken;   // 换回手机号账号的会话

  // 券模板必须下发「每人限领」，否则前端渲染成「限领 undefined 张」
  const tplsWx = await mock.call('cloudCoupon', 'templates', { shopId: 'demo-shop', userId: PHONE });
  log(tplsWx.data.every(c => c.perUserLimit !== undefined && c.perUserLimit !== null),
    '券模板下发 perUserLimit（前端「限领 N 张」不再显示 undefined）',
    tplsWx.data.map(c => c.perUserLimit).join(','));

  // ---- 登出：服务端会话必须真的被吊销（与后端 /member/logout 同语义）----
  // 此前 mock 也没有这一步：登出只清本机 storage，令牌在 db.memberSessions 里继续有效，
  // 等于「登了个假登录」。这段与后端 _e2e_p0.js 的第 ③ 组对应。
  const beforeOut = await mock.call('cloudMember', 'info', { userId: PHONE });
  log(beforeOut.success, '登出前：令牌可正常查档案');

  const outRes = await mock.call('cloudMember', 'logout', {});
  log(outRes.success, '调用 logout 成功', 'revoked=' + outRes.revoked);

  // 旧令牌仍在 store 里，但服务端记录已删 → 再查档案必须被拒
  let afterOut = null;
  try {
    afterOut = await mock.call('cloudMember', 'info', { userId: PHONE });
  } catch (e) { afterOut = { success: false, msg: e }; }
  log(afterOut.success === false, '登出后：旧令牌查档案被拒（会话已吊销）', afterOut.msg || '');

  const outAgain = await mock.call('cloudMember', 'logout', {});
  log(outAgain.success, '重复登出不报错（幂等）', 'revoked=' + outAgain.revoked);

  // 重新登录拿一个新会话，后续用例还要用 PHONE 这个账号
  const relogin = await loginWithCode(PHONE);
  store['memberToken'] = (relogin.data || {}).memberToken || '';
  log(!!store['memberToken'], '重新登录可拿到新会话（登出不影响账号本身）');

  // ==================== 2) 领券 ====================
  head('2. 优惠券');
  const tpls = await mock.call('cloudCoupon', 'templates', { shopId: 'demo-shop', userId: PHONE });
  log(tpls.data.length === 4, '领券中心 4 张券模板');
  log(tpls.data[0].claimable === true, '首张券可领');

  const before = tpls.data[0].claimedQty;
  const claim = await mock.call('cloudCoupon', 'claim', { couponId: tpls.data[0]._id, userId: PHONE });
  log(claim.success, '领取成功', claim._id || '');

  const tpls2 = await mock.call('cloudCoupon', 'templates', { shopId: 'demo-shop', userId: PHONE });
  log(tpls2.data[0].claimedQty === before + 1, '模板已领数量 +1', before + ' → ' + tpls2.data[0].claimedQty);
  log(tpls2.data[0].claimable === false, '限领 1 张后不可再领');

  threw = null;
  try { await mock.call('cloudCoupon', 'claim', { couponId: tpls.data[0]._id, userId: PHONE }); } catch (e) { threw = e; }
  log(threw === '每人限领 1 张，你已领过', '重复领被限领规则拦下（与后端同一句提示）', threw || '');

  // 门槛券
  let big = null;
  tpls.data.forEach(t => { if (t.threshold >= 60 && !big) big = t; });
  await mock.call('cloudCoupon', 'claim', { couponId: big._id, userId: PHONE });

  const my = await mock.call('cloudCoupon', 'my', { shopId: 'demo-shop', userId: PHONE });
  log(my.data.usable.length === 2, '券包可用区有 2 张', '实得 ' + my.data.usable.length);

  // 商家优惠券模板 CRUD 与启停状态
  const couponCreate = await mock.call('cloudCoupon', 'adminCreate', {
    data: { shopId: 'demo-shop', name: 'E2E 测试券', threshold: 10, amount: 2, validDays: 5, totalQty: 20, perUserLimit: 2 }
  });
  const managedCouponId = couponCreate.data._id;
  let managedCoupons = await mock.call('cloudCoupon', 'adminList', { shopId: 'demo-shop' });
  log(managedCoupons.data.some(c => c._id === managedCouponId), '商家优惠券列表包含新模板');
  await mock.call('cloudCoupon', 'adminUpdate', {
    id: managedCouponId,
    data: { shopId: 'demo-shop', name: 'E2E 编辑券', threshold: 15, amount: 3, validDays: 9, totalQty: 20, perUserLimit: 3 }
  });
  await mock.call('cloudCoupon', 'adminToggle', { id: managedCouponId, status: 'off' });
  managedCoupons = await mock.call('cloudCoupon', 'adminList', { shopId: 'demo-shop' });
  const editedCoupon = managedCoupons.data.find(c => c._id === managedCouponId);
  log(editedCoupon.name === 'E2E 编辑券' && editedCoupon.threshold === 15 && editedCoupon.status === 'off',
    '编辑优惠券字段并停用模板');
  await mock.call('cloudCoupon', 'adminToggle', { id: managedCouponId, status: 'on' });
  managedCoupons = await mock.call('cloudCoupon', 'adminList', { shopId: 'demo-shop' });
  log(managedCoupons.data.find(c => c._id === managedCouponId).status === 'on', '重新启用优惠券模板');

  // ==================== 3) 金额口径：与后端逐项对齐 ====================
  head('3. 优惠计算口径（与后端一致）');

  // 独立算一遍期望值，再和 mock 的返回值比对
  const menu = await mock.call('cloudMenu', 'getShopMenu', { shopId: 'demo-shop', role: 'customer' });
  const dishes = menu.data.dishes;
  const d1 = dishes[0], d2 = dishes[1];

  // 骗价：传 0.01
  const items = [{ dishId: d1._id, name: '伪造名', price: 0.01, qty: 2 }];
  const q1 = await mock.call('cloudOrder', 'quote', { shopId: 'demo-shop', items });
  const expect = money(Number(d1.price) * 2);
  log(q1.data.totalPrice === expect, '前端传 0.01 被忽略，按库价计',
    '算得 ' + q1.data.totalPrice + ' / 期望 ' + expect);

  const noThreshold = my.data.usable.find(c => Number(c.threshold) === 0);
  // 注意区分两种 id：big._id 是「券模板」id，
  // 下单要传的是「持有记录」id（member_coupon 表的 _id），两者不同
  const bigHeld = my.data.usable.find(c => Number(c.threshold) >= 60);
  log(!!bigHeld, '找到门槛券的持有记录', bigHeld && bigHeld.couponName);
  const q2 = await mock.call('cloudOrder', 'quote', {
    shopId: 'demo-shop', memberId: PHONE, memberCouponId: noThreshold._id, items
  });
  log(q2.data.couponUsable === true, '无门槛券可用');
  log(q2.data.discountAmount === Number(noThreshold.amount),
    '减免额 = 券面额', '减 ' + q2.data.discountAmount);
  log(q2.data.payAmount === money(q2.data.totalPrice - q2.data.discountAmount),
    '实付 = 原价 - 减免', '实付 ' + q2.data.payAmount);

  // 冒用他人身份：请求里填别人的 memberId，但手上没有对方的会话令牌。
  // 这一层在券归属之前拦下 —— 身份都不对，没必要再谈券。
  threw = null;
  try {
    await mock.call('cloudOrder', 'quote', {
      shopId: 'demo-shop', memberId: '13911112222', memberCouponId: noThreshold._id, items
    });
  } catch (e) { threw = e; }
  log(threw === '请先登录后再使用该会员权益',
    '冒用他人身份被拒（须持有对方会话令牌）', threw || '');

  // 用别人的券：身份是自己的（令牌有效），但券属于播种的演示会员
  // → 落到券归属校验，与后端同一句提示
  const q3 = await mock.call('cloudOrder', 'quote', {
    shopId: 'demo-shop', memberId: PHONE, memberCouponId: 'mc-seed-1', items
  });
  log(q3.data.couponUsable === false && q3.data.couponReason === '这张券不属于当前账号',
    '用别人的券被拒绝（与后端同一句提示）', q3.data.couponReason);

  // 门槛不足：用持有记录 id，不是模板 id
  const cheap = [{ dishId: d2._id, qty: 1 }];
  const q4 = await mock.call('cloudOrder', 'quote', {
    shopId: 'demo-shop', memberId: PHONE, memberCouponId: bigHeld._id, items: cheap
  });
  if (q4.data.couponUsable === false) {
    log(/还差 ¥/.test(q4.data.couponReason), '门槛不足时提示还差多少',
      q4.data.couponReason);
  } else {
    log(q4.data.discountAmount === Number(bigHeld.amount), '够门槛时减满额',
      '减 ' + q4.data.discountAmount);
  }

  // ==================== 4) 储值余额 ====================
  head('4. 储值余额');
  let r = await mock.call('cloudMember', 'recharge', { userId: PHONE, amount: 50 });
  log(r.success && r.data.balance === 50, '充值 50 元', '余额=' + r.data.balance);

  threw = null;
  try { await mock.call('cloudMember', 'recharge', { userId: PHONE, amount: -5 }); } catch (e) { threw = e; }
  log(threw === '充值金额必须大于 0', '负数充值被拒', threw || '');

  const q5 = await mock.call('cloudOrder', 'quote', {
    shopId: 'demo-shop', memberId: PHONE, useBalance: true, items
  });
  // 余额 50 与 80% 上限取小者：本单原价 56 → 上限 44.8 < 50，故实抵 44.8。
  // 写死「抵扣 50」是错的：订单越小，80% 上限越先生效。
  const q5Cap = money(q5.data.totalPrice * 0.8);
  const q5Expect = Math.min(50, q5Cap);
  log(q5.data.balancePay === q5Expect, '余额抵扣 = min(余额, 订单80%)',
    '余额 50 / 上限 ' + q5Cap + ' → 实抵 ' + q5.data.balancePay);
  log(q5.data.payAmount === money(q5.data.totalPrice - q5.data.balancePay),
    '实付 = 原价 - 余额抵扣', '实付=' + q5.data.payAmount);

  const q6 = await mock.call('cloudOrder', 'quote', {
    shopId: 'demo-shop', memberId: PHONE, useBalance: true, items: cheap
  });
  const cap = money(q6.data.totalPrice * 0.8);
  log(q6.data.balancePay <= cap, '余额抵扣不超过实付 80%',
    '订单 ' + q6.data.totalPrice + ' → 上限 ' + cap + '，实抵 ' + q6.data.balancePay);

  const q7 = await mock.call('cloudOrder', 'quote', {
    shopId: 'demo-shop', memberId: PHONE, useBalance: false, items
  });
  log(q7.data.balancePay === 0, '开关关掉就不抵扣');

  // ==================== 5) 端到端：下单 → 核销 → 积分 ====================
  head('5. 端到端下单');
  const created = await mock.call('cloudOrder', 'create', {
    shopId: 'demo-shop', tableNo: '9', memberId: PHONE,
    memberCouponId: noThreshold._id, items
  });
  log(created.success, '创建订单成功', '实付=' + created.payAmount);
  log(created.payAmount < created.totalPrice, '实付小于原价');
  log(created.discountAmount > 0, '记录了减免额', String(created.discountAmount));

  const after = await mock.call('cloudCoupon', 'my', { shopId: 'demo-shop', userId: PHONE });
  const used = after.data.used.find(c => c._id === noThreshold._id);
  log(!!used && used.useOrderId === created.orderId, '券已核销并记下订单号');

  await mock.call('cloudOrder', 'pay', { orderId: created.orderId });

  const m2 = await mock.call('cloudMember', 'info', { userId: PHONE });
  log(m2.data.orderCount === 1, '消费次数 +1', String(m2.data.orderCount));
  log(m2.data.points === Math.floor(created.payAmount), '积分 = 实付向下取整',
    m2.data.points + ' vs ' + Math.floor(created.payAmount));
  log(m2.data.totalSpend === created.payAmount, '累计消费 = 实付');

  // 复用已核销券
  threw = null;
  try {
    await mock.call('cloudOrder', 'create', {
      shopId: 'demo-shop', memberId: PHONE, memberCouponId: noThreshold._id, items
    });
  } catch (e) { threw = e; }
  log(threw === '该券已使用', '已使用券不能再核销（与后端同一句提示）', threw || '');

  // ==================== 6) 评价 ====================
  head('6. 菜品评价');
  threw = null;
  try {
    await mock.call('cloudReview', 'create', {
      shopId: 'demo-shop', orderId: created.orderId, dishId: d1._id, rating: 5, content: 'x'
    });
  } catch (e) { threw = e; }
  log(threw === '订单完成后才能评价', '未完成订单不能评价', threw || '');

  await mock.call('cloudOrder', 'updateStatus', { orderId: created.orderId, status: 'preparing' });
  await mock.call('cloudOrder', 'updateStatus', { orderId: created.orderId, status: 'done' });

  const rv = await mock.call('cloudReview', 'create', {
    shopId: 'demo-shop', orderId: created.orderId, dishId: d1._id,
    rating: 5, content: 'mock 层测试', images: '/static/food/x.jpg'
  });
  log(rv.success, '发表评价成功', rv._id || '');

  threw = null;
  try {
    await mock.call('cloudReview', 'create', {
      shopId: 'demo-shop', orderId: created.orderId, dishId: d1._id, rating: 3
    });
  } catch (e) { threw = e; }
  log(threw === '这道菜已经评价过了', '重复评价被拒（与后端同一句提示）', threw || '');

  threw = null;
  try {
    await mock.call('cloudReview', 'create', {
      shopId: 'demo-shop', orderId: created.orderId, dishId: 'not-in-order', rating: 5
    });
  } catch (e) { threw = e; }
  log(threw === '该订单中没有这道菜', '评价未购买的菜被拒', threw || '');

  // 评分汇总：期望值从库里独立重算，不能写死「全是 5 星」——
  // v5 起启动会播种 7 条混合评分（含 4 星、3 星）的历史评价，
  // 写死 5 星这条断言在播种上线后就成了摆设。
  const sum = await mock.call('cloudReview', 'summary', { shopId: 'demo-shop' });
  const rawDb = store['mock_db_v15'];
  const expCount = rawDb.reviews.length;
  const expAvg = Math.round(rawDb.reviews.reduce((s, r) => s + r.rating, 0) / expCount * 10) / 10;
  log(sum.data.count === expCount && sum.data.avgRating === expAvg, '评分汇总正确（与库内评价独立重算一致）',
    '均分 ' + sum.data.avgRating + ' / ' + sum.data.count + ' 条（期望 ' + expAvg + ' / ' + expCount + '）');

  // ==================== 7) 旧能力回归 ====================
  head('7. 原有能力回归');
  const plain = await mock.call('cloudOrder', 'create', { shopId: 'demo-shop', items });
  log(plain.success && plain.payAmount === plain.totalPrice, '不用券不用余额时实付=原价');

  const comboId = 'combo@d9@d13';
  const comboQ = await mock.call('cloudOrder', 'quote', {
    shopId: 'demo-shop', items: [{ dishId: comboId, qty: 1 }]
  });
  log(comboQ.success && comboQ.data.totalPrice === COMBO_PRICE,
    '套餐按一口价 ¥12（与后端一致）', '合计=' + comboQ.data.totalPrice);

  threw = null;
  try { await mock.call('cloudOrder', 'create', { shopId: 'demo-shop', items: [{ dishId: 'nope', qty: 1 }] }); }
  catch (e) { threw = e; }
  log(threw === '菜品不存在：nope', '不存在的菜品被拒', threw || '');

  threw = null;
  try { await mock.call('cloudOrder', 'create', { shopId: 'demo-shop', items: [{ dishId: d1._id, qty: 9999 }] }); }
  catch (e) { threw = e; }
  log(threw === '单道菜最多点 99 份', '单品数量超上限被拒（与后端同一句提示）', threw || '');

  // 售罄校验（缓存键跟随 mock.js 的 STORE_KEY，升版时这里要一起改）
  const db = store['mock_db_v15'];
  const target = db.dishes.find(x => x._id === d2._id);
  const oldStatus = target.status;
  target.status = 'off';
  threw = null;
  try { await mock.call('cloudOrder', 'create', { shopId: 'demo-shop', items: [{ dishId: d2._id, qty: 1 }] }); }
  catch (e) { threw = e; }
  target.status = oldStatus;
  log(threw === '「' + target.name + '」已售罄，请换一道', '售罄菜品被拒', threw || '');

  // 状态机（现已与后端对齐：mock 也校验流转）
  threw = null;
  try { await mock.call('cloudOrder', 'updateStatus', { orderId: created.orderId, status: 'unpaid' }); }
  catch (e) { threw = e; }
  log(threw === '订单状态不能从 done 变更为 unpaid，当前允许：无（终态）',
    '终态订单不能回退（与后端同一句提示）', threw || '');

  threw = null;
  try { await mock.call('cloudOrder', 'updateStatus', { orderId: created.orderId, status: 'preparing' }); }
  catch (e) { threw = e; }
  log(threw === '订单状态不能从 done 变更为 preparing，当前允许：无（终态）',
    '已完成的订单不能倒退到制作中', threw || '');

  // 合法流转仍要放行；越级流转必须被拒
  const fresh = await mock.call('cloudOrder', 'create', { shopId: 'demo-shop', items });
  threw = null;
  try { await mock.call('cloudOrder', 'updateStatus', { orderId: fresh.orderId, status: 'preparing' }); }
  catch (e) { threw = e; }
  log(threw === '订单状态不能从 unpaid 变更为 preparing，当前允许：paid/canceled',
    'unpaid 不能越级跳到 preparing', threw || '');

  const okPay = await mock.call('cloudOrder', 'pay', { orderId: fresh.orderId });
  const okPrep2 = await mock.call('cloudOrder', 'updateStatus', { orderId: fresh.orderId, status: 'preparing' });
  log(okPay.success && okPrep2.success, '合法路径 unpaid → paid → preparing 放行');

  const okDone = await mock.call('cloudOrder', 'updateStatus', { orderId: fresh.orderId, status: 'done' });
  log(okDone.success, '合法路径 preparing → done 放行');

  // ==================== 8) 经营统计 ====================
  // cloudAdmin/stats 与后端 AdminController.stats 逐字段同源，
  // 这里用一份独立实现重算期望值，防止某天改了 mock 忘了改后端（或反过来）。
  head('8. 经营统计（cloudAdmin/stats）');
  const rawForStats = store['mock_db_v15'];
  const shopOrders = rawForStats.orders.filter(o => o.shopId === 'demo-shop');
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const todayStart = midnight.getTime();
  const paidLike = s => s === 'paid' || s === 'preparing' || s === 'done'
    || s === 'delivering' || s === 'delivered';
  const expStats = {
    orderTotal: shopOrders.length,
    todayOrderCount: shopOrders.filter(o => o.createTime >= todayStart).length,
    // 营业额口径：总价 − 券减免 − 等级折扣 − 积分抵现 + 配送费
    // （余额抵扣不扣减，充值时钱已收过；配送费是顾客额外付的收入）
    todayAmount: money(shopOrders.filter(o => o.createTime >= todayStart && paidLike(o.status))
      .reduce((n, o) => n + Math.max(0, o.totalPrice - (o.discountAmount || 0) - (o.levelDiscount || 0) - (o.pointsPay || 0) + (o.deliveryFee || 0)), 0)),
    pendingCount: shopOrders.filter(o => o.status === 'paid').length,
    dishTotal: rawForStats.dishes.filter(x => x.shopId === 'demo-shop').length,
    categoryTotal: rawForStats.categories.filter(x => x.shopId === 'demo-shop').length
  };

  const stats = await mock.call('cloudAdmin', 'stats', { shopId: 'demo-shop' });
  const st = stats.data;
  log(st.orderTotal === expStats.orderTotal, '订单总数与独立重算一致',
    st.orderTotal + '（期望 ' + expStats.orderTotal + '）');
  log(st.todayOrderCount === expStats.todayOrderCount, '今日订单数与独立重算一致',
    st.todayOrderCount + '（期望 ' + expStats.todayOrderCount + '）');
  log(money(st.todayAmount) === expStats.todayAmount, '今日营业额与独立重算一致',
    st.todayAmount + '（期望 ' + expStats.todayAmount + '）');
  log(st.pendingCount === expStats.pendingCount, '待接单数与独立重算一致',
    st.pendingCount + '（期望 ' + expStats.pendingCount + '）');
  log(st.dishTotal === expStats.dishTotal && st.categoryTotal === expStats.categoryTotal,
    '菜品/分类数按门店过滤', st.dishTotal + ' / ' + st.categoryTotal);

  // 营业额口径：未支付与已取消都不算钱，扣除让利三项、加回配送费
  log(money(st.todayAmount) === money(shopOrders
    .filter(o => o.createTime >= todayStart && paidLike(o.status))
    .reduce((n, o) => n + Math.max(0, o.totalPrice - (o.discountAmount || 0) - (o.levelDiscount || 0) - (o.pointsPay || 0) + (o.deliveryFee || 0)), 0)),
    '营业额只算已支付及之后的订单，扣除让利三项并计入配送费');

  // 状态分布：七键齐全（含配送中/已送达——外卖单不能在两态里凭空消失）、合计对得上
  const stKeys = ['unpaid', 'paid', 'preparing', 'done', 'delivering', 'delivered', 'canceled'];
  const stCnt = st.statusCount || {};
  log(stKeys.every(k => typeof stCnt[k] === 'number'), '状态分布七键齐全（含配送中/已送达）', JSON.stringify(stCnt));
  // 合计按「实际返回的键」求和，不写死键集合：将来再加状态不用改这条断言
  log(Object.keys(stCnt).reduce((n, k) => n + stCnt[k], 0) === st.orderTotal, '状态分布合计 = 订单总数');

  // 近 7 日趋势：长度、日期递增、末位是今天、每日数值独立重算
  const expDaily = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(todayStart - i * 86400000);
    const start = day.getTime(), end = start + 86400000;
    const inDay = shopOrders.filter(o => o.createTime >= start && o.createTime < end);
    // 当日状态分布期望值：与 daily[i].statusCount 逐键比对。
    // 这是「点选日期看当天构成」功能的地基——只有汇总量的话，
    // 统计页点过去也看不到那天什么状态各多少单。
    const expDayStatus = {};
    stKeys.forEach(k => { expDayStatus[k] = inDay.filter(o => o.status === k).length; });
    expDaily.push({
      date: day,
      orderCount: inDay.length,
      amount: money(inDay.filter(o => paidLike(o.status))
        .reduce((n, o) => n + Math.max(0, o.totalPrice - (o.discountAmount || 0) - (o.levelDiscount || 0) - (o.pointsPay || 0) + (o.deliveryFee || 0)), 0)),
      statusCount: expDayStatus
    });
  }
  log(Array.isArray(st.daily) && st.daily.length === 7, 'daily 为近 7 日（含今天）',
    st.daily ? st.daily.length + ' 天' : 'undefined');
  let dailyOk = st.daily.length === 7;
  let dayStatusOk = st.daily.length === 7;
  st.daily.forEach((d, i) => {
    if (d.orderCount !== expDaily[i].orderCount) dailyOk = false;
    if (money(d.amount) !== expDaily[i].amount) dailyOk = false;
    const sc = d.statusCount || {};
    if (!stKeys.every(k => typeof sc[k] === 'number')) dayStatusOk = false;
    if (Object.keys(sc).reduce((n, k) => n + sc[k], 0) !== d.orderCount) dayStatusOk = false;
    stKeys.forEach(k => { if (sc[k] !== expDaily[i].statusCount[k]) dayStatusOk = false; });
  });
  log(dailyOk, '每日单量与营业额与独立重算一致');
  log(dayStatusOk, '每日状态分布七键齐全、合计=当日单数、与独立重算一致');
  const pad2 = n => (n < 10 ? '0' : '') + n;
  const todayStr = pad2(midnight.getMonth() + 1) + '-' + pad2(midnight.getDate());
  log(st.daily[6].date === todayStr, '趋势最后一天是今天', st.daily.map(d => d.date).join(' '));

  threw = null;
  try { await mock.call('cloudAdmin', 'nope', { shopId: 'demo-shop' }); } catch (e) { threw = e; }
  log(threw === 'unknown action', '未知 action 被拒（与后端同一句提示）', threw || '');

  // ==================== 9) 支付补偿与取消退款闭环 ====================
  // 覆盖真实资损路径：下单那一刻券已核销、余额已扣，若支付失败或顾客取消，
  // 必须能把券/余额/积分原样退回去。此前只有临时脚本验证，删掉后就没覆盖了。
  head('9. 支付补偿与取消退款');
  const P2 = '13900003333';
  const acc0Res = await loginWithCode(P2);
  const acc0 = acc0Res.data;
  store['memberToken'] = (acc0 || {}).memberToken || '';
  await mock.call('cloudMember', 'recharge', { userId: P2, amount: 100 });
  const tpl9 = (await mock.call('cloudCoupon', 'templates', { shopId: 'demo-shop', userId: P2 })).data[0];
  const cp9 = await mock.call('cloudCoupon', 'claim', { couponId: tpl9._id, userId: P2 });
  // 3 碗面 = 84；满 30 减 8 → 券后 76；余额 100，单笔最多抵 80% = 60.8
  const ord9 = await mock.call('cloudOrder', 'create', {
    shopId: 'demo-shop', tableNo: '9',
    items: [{ dishId: d1._id, name: d1.name, price: d1.price, qty: 3 }],
    memberId: P2, memberCouponId: cp9._id, useBalance: true
  });
  log(ord9.success, '带券带余额下单成功',
    '券减 ' + ord9.discountAmount + '，余额抵 ' + ord9.balancePay + '，实付 ' + ord9.payAmount);

  // ① create 之后：券已核销、余额已扣（这是「支付失败必须能退」的前提）
  const mc9a = store['mock_db_v15'].memberCoupons.find(x => x._id === cp9._id);
  const acc1 = (await mock.call('cloudMember', 'info', { userId: P2 })).data;
  log(mc9a.status === 'used', '下单即核销券（证明退款不是空操作）', mc9a.status);
  log(acc1.balance === money(100 - ord9.balancePay), '下单即扣余额',
    '100 → ' + acc1.balance);

  // ② 支付：积分与累计消费在这一刻才累加
  await mock.call('cloudOrder', 'pay', { orderId: ord9.orderId });
  const acc2 = (await mock.call('cloudMember', 'info', { userId: P2 })).data;
  log(acc2.points === Math.floor(ord9.payAmount), '支付后积分已累加',
    acc2.points + '（实付 ' + ord9.payAmount + '）');

  // ③ 重复支付必须被状态机挡住（否则积分可刷）
  threw = null;
  try { await mock.call('cloudOrder', 'pay', { orderId: ord9.orderId }); } catch (e) { threw = e; }
  log(String(threw).indexOf('不能从 paid 变更为 paid') > -1, '重复支付被拒（积分不可刷）', threw || '');

  // ④ 取消：券、余额、积分、累计消费、订单数全部退回
  await mock.call('cloudOrder', 'updateStatus', { orderId: ord9.orderId, status: 'canceled' });
  const mc9b = store['mock_db_v15'].memberCoupons.find(x => x._id === cp9._id);
  const acc3 = (await mock.call('cloudMember', 'info', { userId: P2 })).data;
  log(mc9b.status === 'unused' && !mc9b.useOrderId, '取消后券已退回', mc9b.status);
  log(acc3.balance === money(100), '取消后余额已退回', String(acc3.balance));
  log(acc3.points === 0, '取消后积分已扣回', String(acc3.points));
  log(acc3.orderCount === acc0.orderCount, '取消后订单数已扣回',
    acc3.orderCount + '（原 ' + acc0.orderCount + '）');

  // ==================== 10) 本轮新增：会员权益 / 评价回复 / 导出 / 分页 ====================
  head('10. 会员权益 / 评价回复 / 导出 CSV / 分页');

  const P3 = '13900007777';
  const l3 = await loginWithCode(P3, '权益测试');
  store['memberToken'] = (l3.data || {}).memberToken || '';

  // 直接把累计消费与积分写成目标值，比真跑几单快得多。
  // 分档阈值（200/500/1000）必须与后端 CouponService.levelOf 一致。
  const db10 = store['mock_db_v15'];
  db10.members[P3].totalSpend = 300;   // 银卡档
  db10.members[P3].points = 500;

  // ---- 等级折扣 ----
  const q10 = await mock.call('cloudOrder', 'quote', {
    shopId: 'demo-shop', memberId: P3, items: [{ dishId: 'd0', qty: 2 }]
  });
  const d10 = q10.data;
  const expectLv = Math.floor(d10.totalPrice * 0.05 * 100) / 100;
  log(d10.level === '银卡' && d10.levelRate === 0.95, '累计 300 判为银卡（95 折）',
    d10.level + ' / 费率 ' + d10.levelRate);
  log(money(d10.levelDiscount) === money(expectLv), '等级折扣 = 券后金额 × 5%（基数不含未打折的原价之外的东西）',
    d10.levelDiscount + ' / 预期 ' + expectLv);
  log(money(d10.payAmount) === money(d10.totalPrice - d10.levelDiscount),
    '实付 = 原价 - 等级折扣（未用券与余额时）', d10.payAmount);

  // ---- 积分抵现 ----
  const q11 = await mock.call('cloudOrder', 'quote', {
    shopId: 'demo-shop', memberId: P3, usePoints: true, items: [{ dishId: 'd0', qty: 2 }]
  });
  const d11 = q11.data;
  const afterLevel11 = money(d11.totalPrice - d11.levelDiscount);
  const cap11 = Math.floor(afterLevel11 * 0.2);          // 单笔上限 20%，向下取整到元
  const byPoints11 = Math.floor(500 / 100);              // 500 分 = 5 元
  const expectPts = Math.min(byPoints11, cap11);
  log(d11.pointsPay === expectPts && d11.pointsUsed === expectPts * 100,
    '积分按整元抵扣且不超应付 20% 上限',
    '抵 ' + d11.pointsPay + ' 元 / 用 ' + d11.pointsUsed + ' 分（上限 ' + cap11 + '）');

  db10.members[P3].points = 50;   // 不足 100
  const q12 = await mock.call('cloudOrder', 'quote', {
    shopId: 'demo-shop', memberId: P3, usePoints: true, items: [{ dishId: 'd0', qty: 2 }]
  });
  log(q12.data.pointsPay === 0 && q12.data.pointsUsable === false,
    '积分不足 100 时不可抵扣', q12.data.pointsReason);

  // ---- 下单扣积分 / 取消退积分 ----
  db10.members[P3].points = 500;
  const c10 = await mock.call('cloudOrder', 'create', {
    shopId: 'demo-shop', memberId: P3, usePoints: true, items: [{ dishId: 'd0', qty: 2 }]
  });
  const ptsAfterCreate = db10.members[P3].points;
  log(ptsAfterCreate === 500 - c10.pointsPay * 100, '下单即扣积分',
    '500 → ' + ptsAfterCreate + '（抵 ' + c10.pointsPay + ' 元）');

  await mock.call('cloudOrder', 'updateStatus', { orderId: c10.orderId, status: 'canceled' });
  log(db10.members[P3].points === 500, '取消订单后花掉的积分原额退回',
    String(db10.members[P3].points));

  // ---- 商家回复评价 ----
  const rv10 = db10.reviews.find(r => r._id === 'rvseed0') || db10.reviews[0];
  const rep10 = await mock.call('cloudReview', 'reply', { _id: rv10._id, reply: '感谢反馈，已改进' });
  log(rep10.success && rv10.reply === '感谢反馈，已改进' && rv10.replyTime > 0,
    '商家回复评价成功并记下时间', rv10.reply);

  threw = null;
  try { await mock.call('cloudReview', 'reply', { _id: rv10._id, reply: '   ' }); } catch (e) { threw = e; }
  log(String(threw).indexOf('不能为空') > -1, '空回复被拒绝', String(threw));

  await mock.call('cloudReview', 'deleteReply', { _id: rv10._id });
  log(!rv10.reply, '撤回回复后评价回到「待回复」');

  // ---- 导出 CSV ----
  const ex10 = await mock.call('cloudAdmin', 'exportOrders', { shopId: 'demo-shop' });
  const csv10 = ex10.data.csv;
  const lines10 = csv10.split('\n').filter(l => l !== '');   // 末尾有一个换行，过滤空行
  const shopOrders10 = db10.orders.filter(o => o.shopId === 'demo-shop');
  log(csv10.charCodeAt(0) === 0xFEFF, 'CSV 开头带 UTF-8 BOM（否则 Excel 中文乱码）');
  log(lines10[0].indexOf('取餐号') > -1 && lines10[0].indexOf('积分抵现') > -1,
    'CSV 表头含新增的会员折扣/积分抵现列', lines10[0].slice(1, 40) + '…');
  log(ex10.data.rows === shopOrders10.length && lines10.length === shopOrders10.length + 1,
    'CSV 行数与订单数一致', ex10.data.rows + ' 行 + 1 行表头');
  // 末尾换行必须与后端一致，否则两端导出的文件差一个字节，拿去对账会对不上
  log(csv10.charAt(csv10.length - 1) === '\n', 'CSV 以换行结尾（与后端逐字节同构）');

  // ---- 分页 ----
  const pg1 = await mock.call('cloudOrder', 'list', { shopId: 'demo-shop', page: 1, size: 5 });
  const pg2 = await mock.call('cloudOrder', 'list', { shopId: 'demo-shop', page: 2, size: 5 });
  log(pg1.data.list.length === 5 && pg1.data.total === shopOrders10.length && pg1.data.hasMore === true,
    '第 1 页返回 size 条、total 正确、hasMore 为真',
    pg1.data.list.length + ' 条 / 共 ' + pg1.data.total + ' 单');
  const dup10 = pg2.data.list.filter(a => pg1.data.list.some(b => b._id === a._id));
  log(pg2.data.page === 2 && pg2.data.list.length > 0 && dup10.length === 0,
    '第 2 页与第 1 页无重叠', '第 2 页 ' + pg2.data.list.length + ' 条');

  // 桌号过滤必须在「切片之前」发生，否则本桌订单会被分页切丢
  const TB10 = '1';
  const tp10 = await mock.call('cloudOrder', 'list', { shopId: 'demo-shop', tableNo: TB10, page: 1, size: 3 });
  const expectT10 = shopOrders10.filter(o => String(o.tableNo || '') === TB10).length;
  log(tp10.data.list.every(o => String(o.tableNo) === TB10) && tp10.data.total === expectT10,
    '桌号在服务端过滤，total 只统计本桌',
    tp10.data.total + ' 单（全店 ' + shopOrders10.length + ' 单）');

  // ---- 营业额口径：券 + 会员折扣 + 积分抵现 三者都要扣 ----
  // 三者都是「商家没收到的那部分钱」：券是营销成本、等级折扣是权益让利、
  // 积分是早就欠下的负债。只扣券会系统性高估营业额。
  const lvOrder10 = shopOrders10.find(o => o.levelDiscount > 0);
  const ptOrder10 = shopOrders10.find(o => o.pointsPay > 0);
  log(!!lvOrder10 && !!ptOrder10, '演示数据里同时存在带会员折扣与积分抵现的订单',
    '折扣 ' + (lvOrder10 && lvOrder10.levelDiscount) + ' 元 / 积分 ' + (ptOrder10 && ptOrder10.pointsPay) + ' 元');

  const d10start = new Date(); d10start.setHours(0, 0, 0, 0);
  const todayStart10 = d10start.getTime();
  const paidLike10 = s => s === 'paid' || s === 'preparing' || s === 'done'
    || s === 'delivering' || s === 'delivered';
  const expRev10 = money(shopOrders10
    .filter(o => o.createTime >= todayStart10 && paidLike10(o.status))
    .reduce((n, o) => n + Math.max(0, o.totalPrice - (o.discountAmount || 0)
      - (o.levelDiscount || 0) - (o.pointsPay || 0) + (o.deliveryFee || 0)), 0));
  const st10 = (await mock.call('cloudAdmin', 'stats', { shopId: 'demo-shop' })).data;
  log(money(st10.todayAmount) === expRev10, '营业额扣除券+会员折扣+积分抵现（三者都是让利），并计入配送费',
    st10.todayAmount + ' / 重算 ' + expRev10);

  // ==================== 11) 本轮新增：会员资产流水 ====================
  head('11. 会员资产流水（充值/抵扣/赠分/退款逐笔记账）');

  // 末笔快照助手：流水按时间倒序，第一条就是「最近一笔之后」的状态
  const ledgerOf = uid => (store['mock_db_v15'].memberTransactions || [])
    .filter(t => t.memberId === uid)
    .sort((a, b) => b.createTime - a.createTime);

  // ① 演示账号自带历史流水，且末笔快照与档案现值严格一致 ——
  //    这是流水页的地基：对不上账的话，页面一打开就是在演示「假账」
  const demoUid = '13800001234';
  const demoLed = ledgerOf(demoUid);
  log(demoLed.length >= 8, '演示账号带历史流水（充值+赠分+抵扣+积分抵现）', demoLed.length + ' 笔');
  const demoM = db10.members[demoUid];
  log(money(demoLed[0].balanceAfter) === money(demoM.balance)
      && demoLed[0].pointsAfter === (demoM.points || 0),
    '流水末笔快照与档案现值一致（余额/积分对账）',
    '流水 ¥' + demoLed[0].balanceAfter + '/' + demoLed[0].pointsAfter + '分'
    + '，档案 ¥' + demoM.balance + '/' + demoM.points + '分');

  // ② 充值：记一笔 recharge，金额为正，快照=充值后余额
  const rc11 = await mock.call('cloudMember', 'recharge', { userId: P3, amount: 30 });
  const rcEntry = ledgerOf(P3)[0];
  log(rc11.success && rcEntry && rcEntry.type === 'recharge' && money(rcEntry.amount) === 30
      && money(rcEntry.balanceAfter) === money(db10.members[P3].balance),
    '充值记入流水（类型/金额/变动后余额）',
    rcEntry.type + ' +¥' + rcEntry.amount + ' → 余额 ¥' + rcEntry.balanceAfter);

  // ③ 下单同时用余额与积分：两笔资产各记一笔，金额/积分都为负
  db10.members[P3].balance = 40;
  db10.members[P3].points = 500;
  const c11 = await mock.call('cloudOrder', 'create', {
    shopId: 'demo-shop', memberId: P3, useBalance: true, usePoints: true,
    items: [{ dishId: 'd0', qty: 2 }]
  });
  const led11 = ledgerOf(P3);
  const balEntry = led11.find(t => t.type === 'consume' && t.orderId === c11.orderId);
  const ptsEntry = led11.find(t => t.type === 'points_pay' && t.orderId === c11.orderId);
  log(!!balEntry && money(balEntry.amount) === -money(c11.balancePay)
      && money(balEntry.balanceAfter) === money(db10.members[P3].balance),
    '下单余额抵扣记入流水（金额为负、快照为扣后余额）',
    balEntry ? ('-¥' + (-balEntry.amount) + ' → 余额 ¥' + balEntry.balanceAfter) : '无流水');
  log(!!ptsEntry && ptsEntry.points === -c11.pointsUsed
      && ptsEntry.pointsAfter === (db10.members[P3].points || 0),
    '下单积分抵现记入流水（积分为负、快照为扣后积分）',
    ptsEntry ? (ptsEntry.points + ' 分 → ' + ptsEntry.pointsAfter + ' 分') : '无流水');

  // ④ 支付：赠分跟着支付走，挂真实订单号
  await mock.call('cloudOrder', 'pay', { orderId: c11.orderId });
  const earnEntry = ledgerOf(P3).find(t => t.type === 'earn' && t.orderId === c11.orderId);
  log(!!earnEntry && earnEntry.points === Math.floor(c11.payAmount),
    '支付赠分记入流水（1 元 1 分向下取整）',
    earnEntry ? ('+' + earnEntry.points + ' 分 → ' + earnEntry.pointsAfter + ' 分') : '无流水');

  // ⑤ 取消：退余额、退花掉的积分、收挣到的积分，三笔方向互不混淆
  await mock.call('cloudOrder', 'updateStatus', { orderId: c11.orderId, status: 'canceled' });
  const led11c = ledgerOf(P3).filter(t => t.orderId === c11.orderId);
  const refundBal = led11c.find(t => t.type === 'refund');
  const refundPts = led11c.find(t => t.type === 'refund_points');
  const reclaimPts = led11c.find(t => t.type === 'reclaim_points');
  log(!!refundBal && money(refundBal.amount) === money(c11.balancePay),
    '取消订单退余额记入流水', refundBal ? ('+¥' + refundBal.amount) : '无流水');
  log(!!refundPts && refundPts.points === c11.pointsUsed,
    '取消订单退回花掉的积分（原额退回，不与奖励混账）',
    refundPts ? ('+' + refundPts.points + ' 分') : '无流水');
  log(!!reclaimPts && reclaimPts.points === -Math.floor(c11.payAmount),
    '取消订单收回挣到的积分（单取消了才收回）',
    reclaimPts ? (reclaimPts.points + ' 分') : '无流水');

  // ⑥ 闭环对账：充值→抵扣→支付→取消整套走完，末笔快照仍与档案一致
  const latest11 = ledgerOf(P3)[0];
  log(money(latest11.balanceAfter) === money(db10.members[P3].balance)
      && latest11.pointsAfter === (db10.members[P3].points || 0),
    '全套操作后流水末笔快照仍与档案一致（闭环对账）',
    '流水 ¥' + latest11.balanceAfter + '/' + latest11.pointsAfter + '分'
    + '，档案 ¥' + db10.members[P3].balance + '/' + db10.members[P3].points + '分');

  // ⑦ 隐私：流水有快照与订单号，与 info/recharge 同规则，凭会话认人
  threw = null;
  try { await mock.call('cloudMember', 'transactions', { userId: '13900009999' }); } catch (e) { threw = e; }
  log(threw === '请先登录后再使用该会员权益', '查他人流水被拒（凭会话认人）', threw || '');

  // ==================== 12) 三门店菜单一致性（F10 回归）====================
  // F10：mock 曾只给 demo-shop 播种菜单，首页「就近推荐」按定位切到另两家后菜单空白。
  // 把「每个门店都能查到完整菜单」固化成断言，防止以后又退回单店种子。
  head('12. 三门店菜单一致性（F10 回归）');
  const MENU_SHOP_IDS = ['demo-shop', 'shop-tiyuxi', 'shop-zhujiang'];
  const menuCounts = {};
  for (const sid of MENU_SHOP_IDS) {
    const m = await mock.call('cloudMenu', 'getShopMenu', { shopId: sid, role: 'customer' });
    const cats = (m.data && m.data.categories) || [];
    const ds = (m.data && m.data.dishes) || [];
    menuCounts[sid] = ds.length;
    // 47 = 原 50 道 − 3 道已移除（麻辣小龙虾 / 黄金流沙包 / 板烧鸡腿堡，见 REMOVED_DISHES）。
    // 加菜/删菜时同步改这里；三门店一致性由下一条断言保证。
    log(cats.length >= 4 && ds.length === 47,
      '门店 ' + sid + ' 有完整菜单', '分类 ' + cats.length + ' / 菜品 ' + ds.length);
  }
  log(menuCounts[MENU_SHOP_IDS[0]] === menuCounts[MENU_SHOP_IDS[1]]
      && menuCounts[MENU_SHOP_IDS[1]] === menuCounts[MENU_SHOP_IDS[2]],
    '三门店可见菜品数一致（就近推荐切店不再空白）',
    MENU_SHOP_IDS.map(s => s + '=' + menuCounts[s]).join(' / '));

  // 已移除菜品：菜单里彻底不出现（不是「售罄置灰」），抢购商品也不能还挂着它们。
  // 实现方式是 categoryId 挂到不存在的分类（99 哨兵位）—— 前端按分类分组时自然落不进去，
  // 而 dish 行、id、订单历史引用全部保留。这两条断言防止以后又被「顺手改回 0 分类」。
  const REMOVED_DISHES = ['麻辣小龙虾', '黄金流沙包', '板烧鸡腿堡'];
  const allMenuDishes = [];
  for (const sid of MENU_SHOP_IDS) {
    const m = await mock.call('cloudMenu', 'getShopMenu', { shopId: sid, role: 'customer' });
    allMenuDishes.push(...(((m.data && m.data.dishes) || [])));
  }
  log(REMOVED_DISHES.every(n => !allMenuDishes.some(d => d.name === n)),
    '已移除的 3 道菜不再出现在任何门店的顾客菜单',
    '移除 ' + REMOVED_DISHES.join(' / ') + '，其余 ' + menuCounts[MENU_SHOP_IDS[0]] + ' 道');
  const flashData = ((await mock.call('cloudFlash', 'items', {})).data) || [];
  log(REMOVED_DISHES.every(n => !flashData.some(f => f.name === n)),
    '已移除的 3 道菜不再作为抢购商品出现', '在售抢购商品 ' + flashData.length + ' 个');

  // 异国风味：分类存在 + 21 道菜描述都冠「国家 · 」小字 + 图片指向 d35~d55
  const mWorld = await mock.call('cloudMenu', 'getShopMenu', { shopId: 'demo-shop', role: 'customer' });
  const worldCats = (mWorld.data && mWorld.data.categories) || [];
  const worldDishes = (mWorld.data && mWorld.data.dishes) || [];
  const worldCat = worldCats.find(c => c.name === '异国风味');
  const worldList = worldCat ? worldDishes.filter(d => d.categoryId === worldCat._id) : [];
  const worldCountryOk = worldList.length === 21 && worldList.every(d =>
    /^[^·]{2,6}\s*·\s/.test(d.desc || '') && /\/static\/food\/d(3[5-9]|4\d|5[0-5])-.*\.jpg$/.test(d.image || ''));
  log(!!worldCat && worldCountryOk,
    '异国风味 21 道菜均带「国家 · 」小字标注且图片路径对应 d35~d55',
    '分类 ' + (worldCat ? '有' : '无') + ' / 菜品 ' + worldList.length + ' / 合规 ' +
      worldList.filter(d => /^[^·]{2,6}\s*·\s/.test(d.desc || '')).length);
  const worldCountries = [...new Set(worldList.map(d => (d.desc || '').split('·')[0].trim()))];
  log(worldCountries.length >= 16,
    '异国风味覆盖 16+ 个国家', worldCountries.join('/'));

  // 多人份菜必须标份量：不标会被当成「一人价」看，这是「价格看着虚高」的主要来源。
  // 口径固定为「国家 · 份量 · 口味」，份量必须排在口味之前 —— .dish-desc 是单行 ellipsis，
  // 排到末尾会被截掉，等于没写。
  const MULTI_SERVING = ['韩式炸鸡', '部队锅', '西班牙海鲜饭', '瑞士芝士火锅', '美式BBQ肋排', '巴西烤肉拼盘'];
  const servingSeg = n => {
    const d = worldList.find(x => x.name === n);
    const parts = ((d && d.desc) || '').split('·').map(s => s.trim());
    return parts.length >= 3 ? parts[1] : '';
  };
  log(MULTI_SERVING.every(n => /(人份|整只|半架)/.test(servingSeg(n))),
    '多人份菜在描述第 2 段标注份量（人份/整只/半架）',
    MULTI_SERVING.map(n => n + '=' + servingSeg(n)).join(' / '));

  // 核价回归：这 4 道曾高于原产国菜单价 1.3~2.3 倍，已对齐到 1.5 倍内并锁死，防止以后改回。
  const PRICE_FIX = { '三文鱼寿司': 58, '泰式菠萝炒饭': 34, '海南鸡饭': 40, '玛格丽特披萨': 58 };
  log(Object.keys(PRICE_FIX).every(n => {
    const d = worldList.find(x => x.name === n);
    return d && Number(d.price) === PRICE_FIX[n];
  }), '4 道偏高菜已按原产国价下调并锁定',
    Object.keys(PRICE_FIX).map(n => {
      const d = worldList.find(x => x.name === n) || {};
      return n + '=' + d.price;
    }).join(' / '));

  // cloudShop/get 必须按 shopId 返回对应门店（切店后顶栏/门店卡片不能串店名）
  const SHOP_NAME_HINT = {
    'demo-shop': '天河北路', 'shop-tiyuxi': '体育西路', 'shop-zhujiang': '珠江新城'
  };
  for (const sid of MENU_SHOP_IDS) {
    const s = await mock.call('cloudShop', 'get', { shopId: sid });
    const nm = (s.data && s.data.name) || '';
    log(nm.indexOf(SHOP_NAME_HINT[sid]) >= 0, 'cloudShop/get 返回对应门店：' + sid, nm);
  }

  // ==================== 13) 外卖配送（麦乐送模式）====================
  // 配送费铁律：金额只由服务端算（前端不传配送费字段），满 39 免、否则 5 元；
  // 配送费不参与任何优惠，直接加在优惠后应付之上。外卖必须留全收货信息。
  head('13. 外卖配送（配送费服务端算 / 满免 / 地址校验 / B 取餐号）');
  const db13 = store['mock_db_v15'];

  // ① 试算：不满 39 的外卖单要收 5 元配送费，且实付 = 商品优惠后应付 + 配送费
  const q13a = (await mock.call('cloudOrder', 'quote', {
    shopId: 'demo-shop', items: [{ dishId: 'd1', qty: 1 }, { dishId: 'd5', qty: 1 }],
    deliveryType: 'delivery'
  })).data;
  // 商品原价 14 + 6 = 20 < 39 → 配送费 5；自取同明细配送费应为 0
  const q13b = (await mock.call('cloudOrder', 'quote', {
    shopId: 'demo-shop', items: [{ dishId: 'd1', qty: 1 }, { dishId: 'd5', qty: 1 }]
  })).data;
  log(money(q13a.deliveryFee) === 5, '外卖试算收配送费 5 元（原价未满 39）', '¥' + q13a.deliveryFee);
  log(money(q13b.deliveryFee) === 0, '到店自取不收配送费', '¥' + q13b.deliveryFee);
  log(money(q13a.payAmount) === money(Math.max(0, q13a.totalPrice - q13a.discountAmount - q13a.levelDiscount - q13a.balancePay - q13a.pointsPay) + 5),
    '外卖实付 = 优惠后应付 + 配送费（配送费不打折）', '¥' + q13a.payAmount);
  log(q13a.waitMinutes > q13b.waitMinutes, '外卖送达预估 = 制作时间 + 配送时间',
    q13b.waitMinutes + ' 分钟 → ' + q13a.waitMinutes + ' 分钟');

  // ② 满 39 免配送费：原价 28 + 26 = 54 ≥ 39
  const q13c = (await mock.call('cloudOrder', 'quote', {
    shopId: 'demo-shop', items: [{ dishId: 'd0', qty: 1 }, { dishId: 'd1', qty: 1 }],
    deliveryType: 'delivery'
  })).data;
  log(money(q13c.deliveryFee) === 0, '商品原价满 39 免配送费', '原价 ¥' + q13c.totalPrice + ' → ¥' + q13c.deliveryFee);

  // ③ 下单：外卖单落库收货信息、取餐号用 B 前缀；不带地址被拒
  threw = null;
  try {
    await mock.call('cloudOrder', 'create', {
      shopId: 'demo-shop', deliveryType: 'delivery',
      items: [{ dishId: 'd1', qty: 1 }]
    });
  } catch (e) { threw = e; }
  log(threw === '外卖订单请填写收货地址', '外卖单不带地址被拒（服务端硬校验）', threw || '未被拦截');

  const c13 = await mock.call('cloudOrder', 'create', {
    shopId: 'demo-shop', deliveryType: 'delivery',
    receiver: '测试收货', phone: '13900001234', address: '天河区测试路 1 号',
    items: [{ dishId: 'd1', qty: 1 }]
  });
  const o13 = db13.orders.find(x => x._id === c13.orderId);
  log(!!o13 && o13.deliveryType === 'delivery' && o13.address === '天河区测试路 1 号'
      && o13.receiver === '测试收货' && o13.phone === '13900001234',
    '外卖单落库配送方式与收货信息', o13 ? (o13.deliveryType + ' / ' + o13.address) : '订单不存在');
  log(money(o13.payAmount) === money(o13.totalPrice - o13.discountAmount - o13.levelDiscount - o13.balancePay - o13.pointsPay + o13.deliveryFee),
    '外卖订单实付含配送费', '¥' + o13.payAmount + '（含配送费 ¥' + o13.deliveryFee + '）');
  log(String(o13.pickupNo).indexOf('B') === 0, '外卖取餐号用 B 前缀', o13.pickupNo);

  // ④ 前端传配送费字段会被无视：金额一律服务端算
  const c13b = await mock.call('cloudOrder', 'create', {
    shopId: 'demo-shop', deliveryType: 'delivery', deliveryFee: 0,
    receiver: '测试收货', phone: '13900001234', address: '天河区测试路 1 号',
    items: [{ dishId: 'd1', qty: 1 }]
  });
  const o13b = db13.orders.find(x => x._id === c13b.orderId);
  log(money(o13b.deliveryFee) === 5, '前端传 deliveryFee=0 被无视（服务端定价）', '实际 ¥' + o13b.deliveryFee);

  // ⑤ 演示数据里要有外卖单（商家端能看到配送标签、顾客端能看到送达预估）
  const seedDel = db13.orders.filter(x => x.deliveryType === 'delivery');
  log(seedDel.length >= 2, '演示数据含外卖单（含一单满 39 免配送费）',
    seedDel.length + ' 单，配送费 ' + seedDel.map(x => x.deliveryFee).join('/') + ' 元');

  // ⑥ 状态机：外卖单 done 之后必须能推进 delivering→delivered（与后端 allowedNext 同一张表）。
  //    这条是本次加的「商家端外卖处理」按钮对应的状态流转，mock 必须和真后端一致，
  //    否则课堂上切数据源时「标记配送中/已送达」按钮点了没反应或行为相反。
  const c13f = await mock.call('cloudOrder', 'create', {
    shopId: 'demo-shop', deliveryType: 'delivery',
    receiver: '状态流转', phone: '13900005678', address: '天河区状态路 9 号',
    items: [{ dishId: 'd1', qty: 1 }]
  });
  const find13f = () => db13.orders.find(x => x._id === c13f.orderId);
  await mock.call('cloudOrder', 'pay', { orderId: c13f.orderId });
  await mock.call('cloudOrder', 'updateStatus', { orderId: c13f.orderId, status: 'preparing' });
  await mock.call('cloudOrder', 'updateStatus', { orderId: c13f.orderId, status: 'done' });
  log(find13f().status === 'done', '外卖单推进到 已完成', find13f().status);
  const rDeliv = await mock.call('cloudOrder', 'updateStatus', { orderId: c13f.orderId, status: 'delivering' });
  log(rDeliv && find13f().status === 'delivering', '外卖单 已完成→配送中（done→delivering 放行）', find13f().status);
  const rArr = await mock.call('cloudOrder', 'updateStatus', { orderId: c13f.orderId, status: 'delivered' });
  log(rArr && find13f().status === 'delivered', '外卖单 配送中→已送达（delivering→delivered 放行）', find13f().status);
  // delivered 为终态：再退回任何状态都被拒
  threw = null;
  try { await mock.call('cloudOrder', 'updateStatus', { orderId: c13f.orderId, status: 'delivering' }); } catch (e) { threw = e; }
  log(threw != null, '外卖单 已送达为终态（不能再退回配送中）', threw || '未被拦截');

  // ⑦ 镜像校验：自取单 done 之后不能进入配送中（与外卖单行为相反，确保两张表一致）
  const c13g = await mock.call('cloudOrder', 'create', {
    shopId: 'demo-shop', items: [{ dishId: 'd1', qty: 1 }]
  });
  const find13g = () => db13.orders.find(x => x._id === c13g.orderId);
  await mock.call('cloudOrder', 'pay', { orderId: c13g.orderId });
  await mock.call('cloudOrder', 'updateStatus', { orderId: c13g.orderId, status: 'preparing' });
  await mock.call('cloudOrder', 'updateStatus', { orderId: c13g.orderId, status: 'done' });
  threw = null;
  try { await mock.call('cloudOrder', 'updateStatus', { orderId: c13g.orderId, status: 'delivering' }); } catch (e) { threw = e; }
  log(threw != null, '自取单 已完成→配送中 被拒（自取无物流态，与外卖单相反）', threw || '未被拦截');

  // 清理本节产生的四张测试单，避免污染后续统计断言（本节在全部统计断言之后执行）。
  // storage 桩存的是对象引用，直接改属性即生效（与第 11 节改会员资产同手法）
  db13.orders = db13.orders.filter(x =>
    x._id !== c13.orderId && x._id !== c13b.orderId && x._id !== c13f.orderId && x._id !== c13g.orderId);

  // ==================== 14) 售后退款申请（仅审核，不模拟退款到账）====================
  head('14. 售后申请与商家审核（不触发真实退款）');
  const freshMemberSession = await loginWithCode(PHONE);
  store['memberToken'] = freshMemberSession.data.memberToken;
  const refundOrder = await mock.call('cloudOrder', 'create', {
    shopId: 'demo-shop', memberId: PHONE, items: [{ dishId: 'd1', qty: 1 }]
  });
  await mock.call('cloudOrder', 'pay', { orderId: refundOrder.orderId });
  const noRefundLookup = await mock.call('cloudRefund', 'get', { orderId: refundOrder.orderId });
  log(noRefundLookup.data === null, '尚无售后申请时状态查询返回 data:null');
  const validRefundToken = store['memberToken'];
  store['memberToken'] = '';
  let refundAuthError = null;
  try {
    await mock.call('cloudRefund', 'create', { orderId: refundOrder.orderId, reason: '商品质量问题' });
  } catch (e) { refundAuthError = e; }
  log(refundAuthError === '无权申请该订单售后', '缺少订单会员会话时售后申请被拒', refundAuthError || '');
  store['memberToken'] = validRefundToken;
  const refundCreated = await mock.call('cloudRefund', 'create', {
    orderId: refundOrder.orderId, reason: '商品质量问题'
  });
  const refundRequestId = refundCreated.data.requestId;
  const refundLookup = await mock.call('cloudRefund', 'get', { orderId: refundOrder.orderId });
  log(refundLookup.data.status === 'pending' && refundLookup.data.reason === '商品质量问题',
    '订单售后状态查询返回最新申请');
  const pendingRefunds = await mock.call('cloudRefund', 'list', { shopId: 'demo-shop', status: 'pending' });
  log(refundCreated.data.status === 'pending'
      && pendingRefunds.data.some(r => r.requestId === refundRequestId),
    '会员订单申请创建并进入商家待审核列表', refundRequestId);
  threw = null;
  try {
    await mock.call('cloudRefund', 'create', { orderId: refundOrder.orderId, reason: '重复提交' });
  } catch (e) { threw = e; }
  log(threw === '该订单已有售后申请', '同一订单不能重复提交售后申请', threw || '');
  await mock.call('cloudRefund', 'decision', {
    requestId: refundRequestId, decision: 'approve', note: '请按商家流程人工处理'
  });
  const approvedRefunds = await mock.call('cloudRefund', 'list', { shopId: 'demo-shop', status: 'approved_pending_manual_refund' });
  const approvedLookup = await mock.call('cloudRefund', 'get', { orderId: refundOrder.orderId });
  const refundOrderAfterDecision = (await mock.call('cloudOrder', 'get', { orderId: refundOrder.orderId })).data;
  log(approvedRefunds.data.some(r => r.requestId === refundRequestId
      && r.decisionNote === '请按商家流程人工处理')
      && approvedLookup.data.status === 'approved_pending_manual_refund'
      && approvedLookup.data.decisionNote === '请按商家流程人工处理',
    '批准状态从订单状态查询与审核列表同步返回');
  log(refundOrderAfterDecision.status === 'paid',
    '批准售后不自动取消订单或模拟退款到账（需人工处理）', refundOrderAfterDecision.status);

  const canceledRefundOrder = await mock.call('cloudOrder', 'create', {
    shopId: 'demo-shop', memberId: PHONE, items: [{ dishId: 'd1', qty: 1 }]
  });
  await mock.call('cloudOrder', 'pay', { orderId: canceledRefundOrder.orderId });
  await mock.call('cloudRefund', 'create', {
    orderId: canceledRefundOrder.orderId, reason: '订单售后后取消'
  });
  await mock.call('cloudOrder', 'updateStatus', {
    orderId: canceledRefundOrder.orderId, status: 'canceled'
  });
  const closedRefundLookup = await mock.call('cloudRefund', 'get', { orderId: canceledRefundOrder.orderId });
  log(closedRefundLookup.data.status === 'closed_by_cancellation',
    '订单取消后查询返回 closed_by_cancellation');

  // HTTP adapter contract probes: stub uni.request so routes, verbs, payloads and identity headers
  // are checked without a running backend or network access.
  head('15. HTTP 路由契约（stub uni.request）');
  const http = require('../common/http.js');
  const sessionApi = require('../common/session.js');
  store['shopToken'] = 'merchant-session';
  sessionApi.setOwnerKey('contract-order', 'order-owner');
  let lastHttpRequest = null;
  global.uni.request = opts => {
    lastHttpRequest = opts;
    opts.success({ statusCode: 200, data: { success: true, data: [] } });
  };
  const probe = (name, action, data) => http.call(name, action, data || {});

  await probe('cloudCoupon', 'adminList', { shopId: 'demo-shop' });
  log(lastHttpRequest.method === 'GET' && lastHttpRequest.url.endsWith('/admin/coupons?shopId=demo-shop'),
    'GET 优惠券管理列表路由');
  const couponBody = { shopId: 'demo-shop', name: '契约券', threshold: 10, amount: 2, validDays: 7, totalQty: 10, perUserLimit: 1 };
  await probe('cloudCoupon', 'adminCreate', { data: couponBody });
  log(lastHttpRequest.method === 'POST' && lastHttpRequest.url.endsWith('/admin/coupons')
      && JSON.stringify(lastHttpRequest.data) === JSON.stringify(couponBody),
    'POST 优惠券创建使用契约字段');
  await probe('cloudCoupon', 'adminUpdate', { id: 'cp-1', data: couponBody });
  log(lastHttpRequest.method === 'PUT' && lastHttpRequest.url.endsWith('/admin/coupons/cp-1'),
    'PUT 优惠券更新路由');
  await probe('cloudCoupon', 'adminToggle', { id: 'cp-1', status: 'off' });
  log(lastHttpRequest.method === 'PATCH' && lastHttpRequest.url.endsWith('/admin/coupons/cp-1/status?status=off'),
    'PATCH 优惠券状态路由');

  await probe('cloudAddress', 'list');
  log(lastHttpRequest.method === 'GET' && lastHttpRequest.url.endsWith('/member/addresses')
      && lastHttpRequest.header['X-Member-Token'] === store['memberToken'],
    'GET 会员地址使用 X-Member-Token 且不传会员编号');
  const addressBody = { name: '契约收件人', phone: '13900001234', detail: '契约地址', isDefault: true };
  await probe('cloudAddress', 'create', { data: addressBody });
  log(lastHttpRequest.method === 'POST' && lastHttpRequest.url.endsWith('/member/addresses')
      && JSON.stringify(lastHttpRequest.data) === JSON.stringify(addressBody),
    'POST 地址使用准确请求体');
  await probe('cloudAddress', 'update', { id: 'addr-1', data: addressBody });
  log(lastHttpRequest.method === 'PUT' && lastHttpRequest.url.endsWith('/member/addresses/addr-1')
      && JSON.stringify(lastHttpRequest.data) === JSON.stringify(addressBody),
    'PUT 地址使用准确请求体');
  await probe('cloudAddress', 'delete', { id: 'addr-1' });
  log(lastHttpRequest.method === 'DELETE' && lastHttpRequest.url.endsWith('/member/addresses/addr-1'),
    'DELETE 地址路由');

  await probe('cloudRefund', 'create', { orderId: 'contract-order', reason: '测试退款理由' });
  log(lastHttpRequest.method === 'POST' && lastHttpRequest.url.endsWith('/order/contract-order/refund-request')
      && JSON.stringify(lastHttpRequest.data) === JSON.stringify({ reason: '测试退款理由' })
      && lastHttpRequest.header['X-Order-Token'] === 'order-owner',
    'POST 顾客售后使用准确理由体与订单凭证');
  await probe('cloudRefund', 'get', { orderId: 'contract-order' });
  log(lastHttpRequest.method === 'GET'
      && lastHttpRequest.url.endsWith('/order/contract-order/refund-request')
      && lastHttpRequest.header['X-Order-Token'] === 'order-owner',
    'GET 订单售后状态使用订单所有者凭证');
  await probe('cloudRefund', 'list', { shopId: 'demo-shop', status: 'pending' });
  log(lastHttpRequest.method === 'GET' && lastHttpRequest.url.endsWith('/admin/refund-requests?shopId=demo-shop&status=pending'),
    'GET 商家售后列表路由');
  await probe('cloudRefund', 'decision', { requestId: 'rr-1', decision: 'approve', note: '人工处理' });
  log(lastHttpRequest.method === 'POST' && lastHttpRequest.url.endsWith('/admin/refund-requests/rr-1/decision')
      && JSON.stringify(lastHttpRequest.data) === JSON.stringify({ decision: 'approve', note: '人工处理' })
      && lastHttpRequest.header['X-Shop-Token'] === 'merchant-session',
    'POST 商家售后决定使用准确请求体及商家凭证');

  // Customer-visible wording must not imply an external payment/refund completed.
  head('16. 支付与售后状态文案');
  // 页面逻辑已抽到 mixins/order-detail.js，文案断言需同时读页面与混入
  const customerOrderUi = fs.readFileSync('pages/customer/order/order.vue', 'utf8')
    + fs.readFileSync('mixins/order-detail.js', 'utf8');
  const merchantRefundUi = fs.readFileSync('pages/merchant/refundRequests/refundRequests.vue', 'utf8');
  const readme = fs.readFileSync('README.md', 'utf8');
  log(customerOrderUi.includes('继续模拟支付')
      && customerOrderUi.includes('模拟支付完成·待接单')
      && customerOrderUi.includes('本单支付为模拟流程，未发生真实扣款'),
    '顾客订单页明确显示模拟支付及演示售后响应');
  log(customerOrderUi.includes("})[status] || '状态待确认'")
      && merchantRefundUi.includes("})[status] || '状态待确认'")
      && !customerOrderUi.includes('已退款')
      && !merchantRefundUi.includes('已退款'),
    '未知售后状态不显示已退款或原始状态值');
  log(customerOrderUi.includes('approved_pending_manual_refund')
      && customerOrderUi.includes('closed_by_cancellation')
      && merchantRefundUi.includes('approved_pending_manual_refund')
      && merchantRefundUi.includes('closed_by_cancellation')
      && customerOrderUi.includes("call('cloudRefund', 'get'")
      && !customerOrderUi.includes("getStorageSync('refundRequest_"),
    '订单页只读云售后状态并识别审核批准、取消关闭状态');
  log(merchantRefundUi.includes('不会自动退款到账')
      && readme.includes('生产支付未实现')
      && readme.includes('尚未接入支付网关'),
    '商家批准文案与 README 明确生产支付未实现');

  // ==================== 限时抢购（与 _e2e_flash.js 同一组断言文案）====================
  head('限时抢购');
  const fsess = await mock.call('cloudFlash', 'sessions', {});
  const fsd = fsess.data || {};
  const fss = fsd.sessions || [];
  log(fss.length === 4 && fss[0].status === 'ended' && fss[1].status === 'active'
      && fss[2].status === 'upcoming',
    '场次含已结束/进行中/即将开始三种状态');
  log(!!fsd.serverTime && fsd.activeSessionId === fss[1].id,
    '下发服务端时间与当前场次 id（供前端校准倒计时）');

  const fActive = fsd.activeSessionId;
  const fitems = await mock.call('cloudFlash', 'items', { sessionId: fActive, memberId: PHONE });
  const farr = fitems.data || [];
  const f0 = farr[0];
  log(farr.length > 0 && f0.flashPrice > 0 && f0.originalPrice >= f0.flashPrice
      && f0.discount > 0 && f0.discount <= 10,
    '商品列表下发抢购价/原价/折扣（价格由数据层算）');
  log(farr.every(x => typeof x.stock === 'number' && typeof x.limitPerUser === 'number'
      && typeof x.soldPercent === 'number'),
    '商品列表下发库存/限购/已抢百分比');
  log(farr.some(x => x.status === 'soldout'), '存在售罄商品用于售罄态验收');
  log(farr.every(x => x.favorited === false), '未收藏时 favorited 为 false');

  // 板块1（2026-11-11）：当前 active 场必须能列出「全部在售商品」。
  // 旧种子 fi4/fi5/fi6 只挂未来场 s3/s4，永远轮不到 active → 用户永远抢不到。
  // 修后所有在售商品 sessionIds 都含 s2（当前场恒 active 槽位）。
  const b1db = store['mock_db_v15'];
  const onSaleIds = (b1db.flashItems || []).filter(x => x.status === 'on').map(x => x._id).sort();
  const inActiveIds = farr.map(x => x._id).sort();
  log(JSON.stringify(inActiveIds) === JSON.stringify(onSaleIds),
    '当前场列出全部在售抢购商品（无商品永远抢不到）',
    '当前场 ' + inActiveIds.length + ' / 在售 ' + onSaleIds.length);
  // activeSessionId 必须由真实时间窗选出，且该场确实处于 [startAt,endAt)
  const b1Active = fss.find(s => s.id === fActive);
  log(!!b1Active && Date.now() >= b1Active.startAt && Date.now() < b1Active.endAt,
    'activeSessionId 对应场次处于真实进行中时间窗（按时间判 active）',
    fActive + ' ' + (b1Active ? b1Active.range : ''));

  const fDetail = await mock.call('cloudFlash', 'item', { id: f0._id, memberId: PHONE });
  log(fDetail.success && fDetail.data._id === f0._id
      && money(fDetail.data.flashPrice) === money(f0.flashPrice),
    '详情接口与列表口径一致');

  // mock 的令牌存在全局 storage（等价于 http.js 自动加的 X-Member-Token）。
  // 要模拟「未登录」，必须临时清空它，否则即使不传 memberId，数据层也会按会话认出会员。
  const savedToken = store['memberToken'];
  store['memberToken'] = '';
  const fGuest = await mock.call('cloudFlash', 'items', { sessionId: fActive });
  let fGuestErr = null;
  try { await mock.call('cloudFlash', 'createOrder', { itemId: f0._id, qty: 1, sessionId: fActive }); }
  catch (e) { fGuestErr = e; }
  store['memberToken'] = savedToken;
  log(fGuest.success && fGuest.data.length > 0, '游客可浏览抢购商品');
  log(/请先登录/.test(String(fGuestErr)), '未登录不能抢购（权限处理）', fGuestErr || '');
  let fFakeErr = null;
  try {
    await mock.call('cloudFlash', 'createOrder', {
      itemId: f0._id, qty: 1, sessionId: fActive, memberId: 'someone-else'
    });
  } catch (e) { fFakeErr = e; }
  log(/请先登录/.test(String(fFakeErr)), '冒用他人身份被拒绝', fFakeErr || '');

  const soldout = farr.find(x => x.status === 'soldout');
  let soldoutErr = null;
  try {
    await mock.call('cloudFlash', 'createOrder', {
      itemId: soldout._id, qty: 1, sessionId: fActive, memberId: PHONE
    });
  } catch (e) { soldoutErr = e; }
  log(/已售罄|库存不足/.test(String(soldoutErr)), '售罄商品不能下单', soldoutErr || '');

  let endedErr = null;
  try {
    await mock.call('cloudFlash', 'createOrder', {
      itemId: f0._id, qty: 1, sessionId: fss[0].id, memberId: PHONE
    });
  } catch (e) { endedErr = e; }
  log(/尚未开始或已结束/.test(String(endedErr)), '已结束场次不能下单', endedErr || '');

  const fav1 = await mock.call('cloudFlash', 'toggleFavorite', { itemId: f0._id, memberId: PHONE });
  const favList = await mock.call('cloudFlash', 'favorites', { memberId: PHONE });
  log(fav1.favorited === true && favList.data.some(x => x._id === f0._id),
    '收藏成功并出现在收藏列表');
  const fav2 = await mock.call('cloudFlash', 'toggleFavorite', { itemId: f0._id, memberId: PHONE });
  log(fav2.favorited === false, '再次点击取消收藏（幂等开关）');

  const fcps = await mock.call('cloudFlash', 'coupons', { memberId: PHONE, amount: f0.flashPrice });
  log(Array.isArray(fcps.data) && fcps.data.every(c => 'usable' in c && 'reason' in c),
    '可用券列表含 usable/reason（不可用要给出原因）');

  // 伪造 price 必须被无视，金额按 flash_item.flash_price 算
  const fBuy = await mock.call('cloudFlash', 'createOrder', {
    itemId: f0._id, qty: 1, sessionId: fActive, memberId: PHONE, price: 0.01
  });
  log(fBuy.success && !!fBuy.orderId && !!fBuy.orderNo, '抢购下单成功并返回单号');
  log(money(fBuy.payAmount) === money(f0.flashPrice),
    '应付金额 = 抢购价 × 数量（前端伪造 price 被无视）');

  const fLimited = farr.find(x => x.limitPerUser === 1 && x.status === 'active');
  log(!!fLimited, '存在限购 1 件的在售商品（用于限购断言）');
  let fLimitErr = null;
  if (fLimited) {
    await mock.call('cloudFlash', 'createOrder', {
      itemId: fLimited._id, qty: 1, sessionId: fActive, memberId: PHONE
    });
    try {
      await mock.call('cloudFlash', 'createOrder', {
        itemId: fLimited._id, qty: 1, sessionId: fActive, memberId: PHONE
      });
    } catch (e) { fLimitErr = e; }
  }
  log(/超出限购/.test(String(fLimitErr)), '超出每人限购被拒绝', fLimitErr || '');

  const fOrders = await mock.call('cloudFlash', 'orders', { memberId: PHONE });
  const fPending = (fOrders.data || []).find(o => o.status === 'pending');
  log(!!fPending && fPending.statusText === '待支付', '订单列表含待支付状态');
  const fPaid = await mock.call('cloudFlash', 'pay', { orderId: fPending._id, memberId: PHONE });
  log(fPaid.data.status === 'paid' && fPaid.data.statusText === '已支付',
    '支付后状态同步为已支付');
  let fPayAgain = null;
  try { await mock.call('cloudFlash', 'pay', { orderId: fPending._id, memberId: PHONE }); }
  catch (e) { fPayAgain = e; }
  log(/状态已变更/.test(String(fPayAgain)), '重复支付被拒绝', fPayAgain || '');

  // 板块1 实测：fi4/fi5/fi6 旧种子只挂未来场，现在必须能在当前场下单。
  // 逐个下单→取消（归还库存、不占限购、不产生 paid 单干扰板块2口径）。
  const b1WasStuck = ['fi4', 'fi5', 'fi6'];
  let b1BuyOk = 0;
  const b1MadeOrders = [];
  for (const iid of b1WasStuck) {
    const it = (b1db.flashItems || []).find(x => x._id === iid);
    if (!it || it.status !== 'on' || it.stock <= 0) continue;   // 售罄/下架不计
    try {
      const r = await mock.call('cloudFlash', 'createOrder', {
        itemId: iid, qty: 1, sessionId: fActive, memberId: PHONE
      });
      if (r.success && r.orderId) { b1BuyOk++; b1MadeOrders.push(r.orderId); }
    } catch (e) { /* 记为失败 */ }
  }
  const b1Buyable = b1WasStuck.filter(iid => {
    const it = (b1db.flashItems || []).find(x => x._id === iid);
    return it && it.status === 'on' && it.stock > 0;
  }).length;
  log(b1BuyOk === b1Buyable && b1Buyable > 0,
    '原「永远抢不到」的商品现在可在当前场下单',
    '成功 ' + b1BuyOk + ' / 可买 ' + b1Buyable);
  for (const oid of b1MadeOrders) {
    await mock.call('cloudFlash', 'status', { orderId: oid, status: 'canceled', memberId: PHONE });
  }

  const fBefore = await mock.call('cloudFlash', 'item', { id: f0._id, memberId: PHONE });
  const fStockBefore = fBefore.data.remain;
  const dbFlash = store['mock_db_v15'];
  const fTemplates = await mock.call('cloudCoupon', 'templates', {
    shopId: 'demo-shop', userId: PHONE
  });
  const fTemplate = (fTemplates.data || []).find(c =>
    c.claimable && Number(c.threshold) <= Number(f0.flashPrice));
  const fClaim = fTemplate
    ? await mock.call('cloudCoupon', 'claim', { couponId: fTemplate._id, userId: PHONE })
    : null;
  const fCoupon = fClaim && fClaim.success
    ? dbFlash.memberCoupons.find(mc => mc._id === fClaim._id)
    : null;
  const fExtra = await mock.call('cloudFlash', 'createOrder', {
    itemId: f0._id, qty: 1, sessionId: fActive, memberId: PHONE,
    couponId: fCoupon ? fCoupon._id : ''
  });
  log(!!fCoupon && fCoupon.status === 'used' && fCoupon.useOrderId === fExtra.orderId,
    '抢购下单核销所选优惠券');
  const fCanceled = await mock.call('cloudFlash', 'status', {
    orderId: fExtra.orderId, status: 'canceled', memberId: PHONE
  });
  const fAfter = await mock.call('cloudFlash', 'item', { id: f0._id, memberId: PHONE });
  log(fCanceled.data.status === 'canceled', '取消订单状态同步为已取消');
  log(fAfter.data.remain === fStockBefore, '取消后库存归还',
    fStockBefore + ' → ' + fAfter.data.remain);
  log(!!fCoupon && fCoupon.status === 'unused' && !fCoupon.useOrderId,
    '取消抢购订单后优惠券退回');

  // ---- 板块2：抢购营业额并入经营统计 / 导出（与后端 AdminController 同源）----
  // 此刻库里已有 paid 抢购单（fPaid）与 canceled 单（fExtra），是验证口径的最佳时点。
  // 独立重算：只算 paid、只算今日、净额 = payAmount；订单数/状态分布不受抢购影响。
  head('抢购营业额并入统计与导出（板块2）');
  const dbB2 = store['mock_db_v15'];
  // 注意：必须用「此刻」的主订单重算，不能复用第 8 段的 shopOrders 快照 ——
  // 第 10/11/13 段又下过主订单，快照已过时（固化绝对值正是本项目反复强调要避开的坑）。
  const shopOrdersB2 = (dbB2.orders || []).filter(o => o.shopId === 'demo-shop');
  const flashPaidToday = (dbB2.flashOrders || []).filter(o =>
    o.status === 'paid' && o.createTime >= todayStart);
  const expFlashAmt = money(flashPaidToday.reduce((n, o) => n + Math.max(0, Number(o.payAmount) || 0), 0));
  const statsB2 = (await mock.call('cloudAdmin', 'stats', { shopId: 'demo-shop' })).data;

  log(money(statsB2.flashTodayAmount) === expFlashAmt,
    '今日抢购营业额与独立重算一致', statsB2.flashTodayAmount + '（期望 ' + expFlashAmt + '）');
  log(statsB2.flashTodayCount === flashPaidToday.length,
    '今日抢购已支付单量与独立重算一致',
    statsB2.flashTodayCount + '（期望 ' + flashPaidToday.length + '）');
  // 关键自洽：todayAmount 的增量必须恰好等于抢购净额，主订单部分原样
  const mainOnlyAmount = money(shopOrdersB2
    .filter(o => o.createTime >= todayStart && paidLike(o.status))
    .reduce((n, o) => n + Math.max(0, o.totalPrice - (o.discountAmount || 0)
      - (o.levelDiscount || 0) - (o.pointsPay || 0) + (o.deliveryFee || 0)), 0));
  log(money(statsB2.todayAmount) === money(mainOnlyAmount + expFlashAmt),
    '今日营业额 = 主订单净额 + 抢购净额（未重复计入未支付/已取消）',
    statsB2.todayAmount + '（主 ' + mainOnlyAmount + ' + 抢购 ' + expFlashAmt + '）');
  log(statsB2.orderTotal === shopOrdersB2.length,
    '抢购单未污染主订单总数（状态分布口径隔离）',
    statsB2.orderTotal + '（期望 ' + shopOrdersB2.length + '）');
  log((dbB2.flashOrders || []).some(o => o.status === 'paid'),
    '前置条件：库中存在已支付抢购单（口径断言才有意义）');

  // 导出：抢购行必须带「抢购」标记且行数 = 主订单数 + 抢购单数
  const exB2 = (await mock.call('cloudAdmin', 'exportOrders', { shopId: 'demo-shop' })).data;
  const exB2Lines = exB2.csv.split('\n').filter(l => l !== '');
  const flashAllCount = (dbB2.flashOrders || []).length;
  log(exB2.rows === shopOrdersB2.length + flashAllCount
      && exB2Lines.length === shopOrdersB2.length + flashAllCount + 1,
    'CSV 行数 = 主订单 + 抢购单 + 表头',
    exB2.rows + ' 行（主 ' + shopOrdersB2.length + ' + 抢购 ' + flashAllCount + '）');
  log(exB2.csv.indexOf('抢购,FS') > -1 && exB2.csv.indexOf('抢购·已支付') > -1,
    'CSV 抢购行带「抢购」取餐号标记与已支付状态文案');
  log(exB2.csv.indexOf('抢购·已取消') > -1,
    'CSV 含已取消抢购行（当天发生了什么完整可见）');

  console.log('\n========================================');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('========================================');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => {
  console.error('\n[脚本异常]', e && e.message ? e.message : e);
  process.exit(1);
});
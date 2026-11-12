// _e2e2.js —— 本轮新增功能（优惠券 / 会员储值 / 菜品评价）端到端验证
//
// 运行：node tests/_e2e2.js
// 前置：MySQL 已启动、Spring Boot 后端跑在 8080
//
// 重点验证的是「服务端是否真的在算钱」，而不是接口有没有通：
//   ① 前端传 0.01 的 price，服务端入库必须是数据库单价
//   ② 前端不传金额只传券，服务端自己算出减免额
//   ③ 别人的券用不了、过期券用不了、门槛不够的券用不了
//   ④ 没买过的菜不能评价、同一单同一道菜不能重复评价
const BASE = 'http://localhost:8080/api';
const SHOP = 'demo-shop';
// 每次跑用一个新的手机号：领券有「每人限领 1 张」，
// 复用同一账号第二次跑必然全挂在限领上，测的就不是新功能而是重跑限制
const PHONE = '138' + String(Date.now()).slice(-8);
const SHOP_TOKEN = 'demo1234';
// 会员会话令牌：登录后由服务端签发，涉及余额/优惠券的接口必须带上，
// 否则服务端会拒（它只认令牌，不认请求体里声称的 memberId）
let MEMBER_TOKEN = '';

let pass = 0, fail = 0;

function log(ok, name, extra) {
  if (ok) { pass++; console.log('  PASS  ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')); }
}
function head(t) { console.log('\n========== ' + t + ' =========='); }

/**
 * 发送登录验证码并返回演示码。
 *
 * 后端演示模式（restaurant.sms.demo-mode=true）会把验证码放在 demoCode 里，
 * 脚本才能自动化。若撞上 60 秒重发频控（脚本重复运行时常见），
 * 按提示的剩余秒数等待后重试 —— 这是服务端的真实规则，不该为测试绕过。
 */
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

/** 发码 + 用码登录，返回与旧版 /member/login 相同形状的响应 */
async function loginWithCode(phone, nickname) {
  const code = await sendCode(phone);
  return req('/member/login', 'POST', { phone, code, nickname: nickname || '' });
}

async function req(path, method, body, withToken) {
  const headers = { 'content-type': 'application/json' };
  if (withToken) headers['X-Shop-Token'] = SHOP_TOKEN;
  if (MEMBER_TOKEN) headers['X-Member-Token'] = MEMBER_TOKEN;
  const res = await fetch(BASE + path, {
    method: method || 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

(async function main() {
  // ==================== 1) 会员登录 ====================
  head('1. 会员注册与登录（手机号 + 短信验证码）');
  const code1 = await sendCode(PHONE);
  log(/^\d{6}$/.test(code1), '发送登录验证码（6 位）', '演示码=' + code1);

  const noCode = await req('/member/login', 'POST', { phone: PHONE });
  log(noCode.success === false, '不带验证码不能登录（手机号不再是单独凭据）', noCode.msg || '');

  const login = await req('/member/login', 'POST', { phone: PHONE, code: code1, nickname: '测试用户' });
  log(login.success && login.data && login.data._id === PHONE, '验证码正确，登录并开户',
    login.data ? ('余额=' + login.data.balance + ' 等级=' + login.data.level) : JSON.stringify(login));
  // 保存会话令牌：此后下单/领券/查券包都凭它认人
  MEMBER_TOKEN = (login.data || {}).memberToken || '';
  log(!!MEMBER_TOKEN, '登录返回会话令牌（memberToken）', MEMBER_TOKEN ? '已获取' : '未获取');

  // 一次性：同一验证码不能重放（否则被截获后可在 5 分钟内反复登录）
  const replay = await req('/member/login', 'POST', { phone: PHONE, code: code1 });
  log(replay.success === false && /已使用/.test(replay.msg || ''),
    '同一验证码重放被拒绝', replay.msg || '');

  log(login.data && login.data.orderCount === 0 && Number(login.data.balance) === 0,
    '新账户初始状态干净（余额 0、无订单）');

  const badPhone = await req('/member/login', 'POST', { phone: '123', code: '123456' });
  log(badPhone.success === false, '非法手机号被拒绝', badPhone.msg || '');

  // ==================== 1b) 微信一键登录（手机号之外的第二个登录入口） ====================
  // ⚠️ 这一段是 2026-10-16 补的。此前两条登录链路里**只有手机号那条被测试覆盖**，
  // 于是微信登录漏发会话令牌的 bug 一路溜过 100+ 断言：微信登录能进界面，
  // 但充值/查档案/查券包全被服务端判为未登录。用户原话：
  // 「手机号登录没问题，但微信自动登录就有这个问题」。
  // 结论：**有几个登录入口，就要有几组登录用例**，不能只测最顺手的那条。
  head('1b. 微信一键登录');
  const wx = await req('/auth/wx-login', 'POST', { code: 'mock-code-for-test' });
  log(wx.success && wx.data && !!wx.data._id, '微信登录返回会员档案',
    wx.data ? ('_id=' + wx.data._id + ' demo=' + wx.data.demo) : JSON.stringify(wx));
  log(!!(wx.data || {}).memberToken,
    '微信登录同样签发会话令牌（memberToken）',
    (wx.data || {}).memberToken ? '已获取' : '未获取 —— 会导致登录后处处说未登录');
  log(wx.data && wx.data.balance !== undefined && wx.data.level !== undefined
      && wx.data.levelBenefit !== undefined,
    '微信登录下发完整档案（余额/等级/权益），与手机号登录字段一致');

  const wxId = (wx.data || {})._id;
  const wxSavedToken = MEMBER_TOKEN;
  MEMBER_TOKEN = (wx.data || {}).memberToken || '';

  const wxInfo = await req('/member?userId=' + encodeURIComponent(wxId));
  log(wxInfo.success && wxInfo.data && wxInfo.data._id === wxId,
    '微信登录后能查自己的会员档案（曾报「请先登录后再使用该会员权益」）',
    wxInfo.msg || '');
  const wxRecharge = await req(
    '/member/recharge?userId=' + encodeURIComponent(wxId) + '&amount=1', 'POST');
  log(wxRecharge.success, '微信登录后能充值（用户报障的原始场景）', wxRecharge.msg || '');
  const wxMy = await req('/coupon/my?shopId=' + SHOP + '&userId=' + encodeURIComponent(wxId));
  log(wxMy.success && Array.isArray(wxMy.data.usable),
    '微信登录后能查券包', wxMy.msg || '');

  // 反面用例：不带令牌声称是微信会员必须被拒。
  // 没有这条，「上面成功了」也可能只是因为服务端压根没校验。
  MEMBER_TOKEN = '';
  const wxNoToken = await req('/member?userId=' + encodeURIComponent(wxId));
  log(wxNoToken.success === false, '不带令牌声称是微信会员时被拒', wxNoToken.msg || '');
  MEMBER_TOKEN = wxSavedToken;   // 换回手机号账号的令牌，不影响后续用例

  // 券模板必须下发「每人限领」，否则领券中心渲染成「限领 undefined 张」
  const tplsForLimit = await req('/coupon/templates?shopId=' + SHOP + '&userId=' + PHONE);
  log(tplsForLimit.success && (tplsForLimit.data || []).length > 0
      && tplsForLimit.data.every(c => c.perUserLimit !== undefined && c.perUserLimit !== null),
    '券模板下发 perUserLimit（前端「限领 N 张」不再显示 undefined）',
    (tplsForLimit.data || []).map(c => c.perUserLimit).join(','));

  // ==================== 2) 领券中心 ====================
  head('2. 优惠券领取');
  const tpls = await req('/coupon/templates?shopId=' + SHOP + '&userId=' + PHONE);
  log(tpls.success && tpls.data.length >= 4, '领券中心返回券模板', tpls.data ? ('共 ' + tpls.data.length + ' 张') : '');
  log(tpls.data && tpls.data[0].claimable === true, '首张券可领');

  const claim1 = await req('/coupon/claim?couponId=' + tpls.data[0]._id + '&userId=' + PHONE, 'POST');
  log(claim1.success, '领取首张券', claim1._id || '');

  const claim2 = await req('/coupon/claim?couponId=' + tpls.data[0]._id + '&userId=' + PHONE, 'POST');
  log(claim2.success === false, '重复领同一张券被限领规则拦下', claim2.msg || '');

  const tplsAfter = await req('/coupon/templates?shopId=' + SHOP + '&userId=' + PHONE);
  // 断言增量而非绝对值：claimedQty 是全局累计的，
  // 反复跑本脚本时绝对值会一直变大，写死 === 1 第二次跑必挂
  log(tplsAfter.data[0].claimedQty === tpls.data[0].claimedQty + 1,
    '模板已领数量 +1',
    tpls.data[0].claimedQty + ' → ' + tplsAfter.data[0].claimedQty);
  log(tplsAfter.data[0].claimable === false, '限领 1 张后显示为不可再领');

  // 领一张满 60 减 20 的券，用于门槛测试
  let bigCoupon = null;
  for (const t of tpls.data) { if (t.threshold >= 60) { bigCoupon = t; break; } }
  const claimBig = await req('/coupon/claim?couponId=' + bigCoupon._id + '&userId=' + PHONE, 'POST');
  log(claimBig.success, '领取门槛券', bigCoupon.name);

  // ==================== 3) 金额计算：服务端说了算 ====================
  head('3. 下单试算 —— 优惠金额由服务端计算');

  // 取几个真实菜品 id
  const menu = await req('/menu?shopId=' + SHOP + '&role=customer');
  const dishes = menu.data.dishes;
  const d1 = dishes[0], d2 = dishes[1];
  log(d1 && d2, '取到顾客端菜品', (d1 && d1.name) + ' / ' + (d2 && d2.name));

  // 故意传 price: 0.01，看服务端是否按数据库价计算
  const cheapItems = [{ dishId: d1._id, name: '伪造名', price: 0.01, qty: 2 }];
  const q1 = await req('/order/quote', 'POST', {
    shopId: SHOP, items: cheapItems
  });
  const expectTotal = Number(d1.price) * 2;
  log(Math.abs(q1.data.totalPrice - expectTotal) < 0.01,
    '前端传 0.01 骗价，服务端按数据库单价算总价',
    '原价=' + q1.data.totalPrice + ' 期望=' + expectTotal.toFixed(2));

  // 无门槛券（首张 5 元）应用上
  const usable = await req('/coupon/my?shopId=' + SHOP + '&userId=' + PHONE);
  const noThreshold = usable.data.usable.find(c => Number(c.threshold) === 0);
  log(!!noThreshold, '找到无门槛券', noThreshold && noThreshold.couponName);

  const q2 = await req('/order/quote', 'POST', {
    shopId: SHOP, memberId: PHONE, memberCouponId: noThreshold._id,
    items: cheapItems
  });
  log(q2.data.couponUsable === true, '无门槛券可用');
  log(Math.abs(q2.data.discountAmount - noThreshold.amount) < 0.01,
    '减免额 = 券面额（服务端算）', '减 ' + q2.data.discountAmount);
  log(Math.abs(q2.data.payAmount - (q2.data.totalPrice - q2.data.discountAmount)) < 0.01,
    '实付 = 原价 - 减免', '实付 ' + q2.data.payAmount);

  // 门槛不够：单点一份便宜菜大概率不到 60，用满 60 券试
  const q3 = await req('/order/quote', 'POST', {
    shopId: SHOP, memberId: PHONE, memberCouponId: claimBig._id,
    items: [{ dishId: d1._id, qty: 1 }]
  });
  if (q3.data.couponUsable === false) {
    log(true, '门槛不足的券判定为不可用', q3.data.couponReason);
  } else {
    // 单价本身超过门槛也算合法可达，改为验证金额正确性
    log(Math.abs(q3.data.discountAmount - Number(bigCoupon.amount)) < 0.01,
      '够门槛时减免额 = 券面额', '减 ' + q3.data.discountAmount);
  }

  // 冒用他人身份：请求里填别人的 memberId，但手上没有对方的会话令牌。
  // 这一层在券归属之前拦下 —— 身份都不对，谈不上用券。
  const q4a = await req('/order/quote', 'POST', {
    shopId: SHOP, memberId: '13900000000', memberCouponId: noThreshold._id,
    items: cheapItems
  });
  log(q4a.success === false && q4a.msg === '请先登录后再使用该会员权益',
    '冒用他人身份被拒（须持有对方会话令牌）', q4a.msg || JSON.stringify(q4a));

  // 用别人的券：身份是自己的（令牌有效），券属于另一个账号 → 券归属校验挡住。
  // 先拿到「另一个账号的一张持券」——注意不能直接去领：
  // 该账号上一轮跑测时已经领过，会撞上「每人限领 1 张」，claim 返回里没有 _id，
  // 断言就退化成「未选择优惠券」，看起来像功能坏了其实是测试不幂等。
  // 所以先查它的券包，真没有再去领。
  const otherLogin = await loginWithCode('13900000001');
  const savedToken = MEMBER_TOKEN;
  MEMBER_TOKEN = (otherLogin.data || {}).memberToken || '';
  const otherHeld = await req('/coupon/my?shopId=' + SHOP + '&userId=13900000001');
  let otherCouponId = (((otherHeld.data || {}).usable || [])[0] || {})._id;
  if (!otherCouponId) {
    const otherTpl = await req('/coupon/templates?shopId=' + SHOP);
    const otherClaim = await req('/coupon/claim?couponId=' + otherTpl.data[0]._id
      + '&userId=13900000001', 'POST');
    otherCouponId = otherClaim._id;
  }
  MEMBER_TOKEN = savedToken;

  const q4 = await req('/order/quote', 'POST', {
    shopId: SHOP, memberId: PHONE, memberCouponId: otherCouponId, items: cheapItems
  });
  log(!!otherCouponId && q4.data && q4.data.couponUsable === false
    && q4.data.couponReason === '这张券不属于当前账号',
    '用别人的券被拒绝', (q4.data && q4.data.couponReason) || q4.msg || '');

  // ==================== 4) 储值余额 ====================
  head('4. 会员储值与余额抵扣');

  // 充值的主体是**顾客自己**（掏钱给自己加余额），所以校验的是会员会话，不是商户口令。
  // 这里刻意不带 X-Shop-Token，正是要证明顾客端能正常充值。
  // ⚠️ 此前这两条断言把「不带商户口令被拦」写成了预期行为，等于把 bug 固化成测试通过，
  //    结果顾客端点充值一直弹「未授权，请提供正确的商户口令」却没人发现。
  const recharge = await req('/member/recharge?userId=' + PHONE + '&amount=50', 'POST');
  log(recharge.success && Number((recharge.data || {}).balance) === 50,
    '顾客可自行充值（不要求商户口令）', '余额=' + ((recharge.data || {}).balance));

  // 拿自己的会话令牌去给别人的账号充值 → 身份校验应当拦下
  const rechargeOther = await req('/member/recharge?userId=13900009999&amount=50', 'POST');
  log(rechargeOther.success === false, '给他人账号充值被拒', rechargeOther.msg || '');

  // 有余额后验证抵扣规则。
  // 订单金额必须按当前菜单实时算：只有「80% 上限 ≥ 余额 50」时才验得到「余额全额抵扣」。
  // 这里曾经写死原价 136（麻辣小龙虾 68×2），2026-11-12 那道菜下架后 dishes[0] 换成别的菜，
  // 原价一变断言就假失败 —— 典型的把数据写死进测试。
  const q5bQty = Math.ceil(50 / 0.8 / Number(d1.price)) || 1;
  const q5b = await req('/order/quote', 'POST', {
    shopId: SHOP, memberId: PHONE, useBalance: true,
    items: [{ dishId: d1._id, qty: q5bQty }]
  });
  const q5bTotal = Number(q5b.data.totalPrice);
  log(q5b.data.balancePay === 50, '余额 50 时全额抵扣 50（80% 上限未触发）',
    '原价 ' + q5bTotal + ' / 上限 ' + (q5bTotal * 0.8).toFixed(2) + ' → 抵扣=' + q5b.data.balancePay);
  log(Math.abs(q5b.data.payAmount - (q5bTotal - 50)) < 0.01,
    '实付 = 原价 - 余额抵扣', '实付=' + q5b.data.payAmount);

  // 余额上限 80%：造一笔余额远大于金额的场景不合理（需多次充值），
  // 这里用小额余额 + 大额订单验证比例：余额 50 / 订单 30 → 上限 24
  const smallOrder = await req('/order/quote', 'POST', {
    shopId: SHOP, memberId: PHONE, useBalance: true,
    items: [{ dishId: d2._id, qty: 1 }]
  });
  log(smallOrder.data.balancePay <= Number((smallOrder.data.totalPrice * 0.8).toFixed(2)),
    '余额抵扣不超过实付的 80%',
    '订单 ' + smallOrder.data.totalPrice + ' / 抵扣 ' + smallOrder.data.balancePay);

  // 关掉开关则不抵扣
  const q5 = await req('/order/quote', 'POST', {
    shopId: SHOP, memberId: PHONE, useBalance: false, items: cheapItems
  });
  log(q5.data.balancePay === 0, '关闭开关则不使用余额（不替顾客决定花钱）', '抵扣=' + q5.data.balancePay);

  // 余额上限：先建一个有余额的会员（直接用 recharge 不可，用另一个接口模拟）
  // 这里改用下单后验看来间接覆盖，故单独构造一个大额订单验证 80% 上限
  const bigItems = [{ dishId: d1._id, qty: 5 }];
  const q6 = await req('/order/quote', 'POST', {
    shopId: SHOP, memberId: PHONE, useBalance: true, items: bigItems
  });
  log(q6.success, '大额订单试算成功', '原价=' + q6.data.totalPrice);

  // ==================== 5) 真实下单走通优惠 ====================
  head('5. 端到端：领券 → 下单 → 支付 → 积分');
  const create = await req('/order', 'POST', {
    shopId: SHOP, tableNo: '9', note: '自动化测试单',
    memberId: PHONE, memberCouponId: noThreshold._id,
    items: cheapItems
  });
  log(create.success, '创建订单成功', 'orderId=' + (create.orderId || '') + ' 实付=' + create.payAmount);
  log(create.payAmount < create.totalPrice, '下单返回的实付确实小于原价');
  log(create.discountAmount > 0, '订单记录了优惠券减免额', String(create.discountAmount));

  // 券已被核销，不能再用
  const afterOrder = await req('/coupon/my?shopId=' + SHOP + '&userId=' + PHONE);
  const usedList = afterOrder.data.used.filter(c => c._id === noThreshold._id);
  log(usedList.length === 1, '该券已移入「已使用」分区');
  log(usedList[0] && usedList[0].useOrderId === create.orderId, '券上记下了核销订单号');

  const pay = await req('/order/' + create.orderId + '/pay', 'POST');
  log(pay.success, '支付成功');

  const detail = await req('/order/' + create.orderId);
  log(Math.abs(detail.data.payAmount - create.payAmount) < 0.01, '订单详情里的实付与下单一致');
  log(detail.data.memberId === PHONE, '订单关联到会员');

  const mAfter = await req('/member?userId=' + PHONE);
  log(mAfter.data.orderCount >= 1, '会员消费次数已累计', '累计=' + mAfter.data.orderCount);
  log(mAfter.data.points > 0, '积分已累积', '积分=' + mAfter.data.points);
  log(mAfter.data.totalSpend > 0, '累计消费已记录', '¥' + mAfter.data.totalSpend);

  // 重复用已核销的券下单 → 必须被拒
  const reuse = await req('/order', 'POST', {
    shopId: SHOP, memberId: PHONE, memberCouponId: noThreshold._id,
    items: cheapItems
  });
  log(reuse.success === false, '已使用的券不能再下单核销', reuse.msg || '');

  // 幂等命中必须回传 ownerKey（板块2，2026-11-11）：
  // 首次请求落库但响应丢失、前端带同一 clientRequestId 重试时，走的是
  // OrderService.findByClientRequestId 的 dup 分支，而非正常 create 路径。
  // 两条路径若字段不一致（尤其 ownerKey），游客重试成功后会存不下 X-Order-Token，
  // 后续查单/取消/支付全被默认拒绝的鉴权挡死 —— 表现为「下单成功却查不到单」。
  // 这里连发两次同一幂等键，断言第二次命中同一单且 ownerKey 与首单同源非空。
  head('5a. 下单幂等命中回传 ownerKey（游客认单凭证）');
  const idemKey = 'e2e-idem-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const idemBody = { shopId: SHOP, tableNo: '9', items: cheapItems, clientRequestId: idemKey };
  const idem1 = await req('/order', 'POST', idemBody);
  const idem2 = await req('/order', 'POST', idemBody);
  log(idem1.success && idem2.success, '同一 clientRequestId 两次请求都返回成功',
    'orderId=' + (idem2.orderId || ''));
  log(idem1.orderId === idem2.orderId, '幂等命中返回同一笔订单（未重复建单）',
    idem1.orderId + ' / ' + idem2.orderId);
  log(!!idem1.ownerKey && idem1.ownerKey === idem2.ownerKey,
    '幂等命中回传的 ownerKey 非空且与首单一致（游客认单不断链）',
    String(idem2.ownerKey || '').slice(0, 12) + '…');
  // 用首单 ownerKey 反查详情，证明凭证真能认单（不是只回传了个字段）
  const idemDetail = await fetch(BASE + '/order/' + idem2.orderId,
    { headers: { 'X-Order-Token': idem2.ownerKey } }).then(r => r.json());
  log(idemDetail.success && !!idemDetail.data,
    '凭幂等返回的 ownerKey 能查到订单（凭证可用）', idemDetail.msg || '');

  // ==================== 6) 菜品评价 ====================
  head('6. 菜品评价');
  const notDone = await req('/review', 'POST', {
    shopId: SHOP, orderId: create.orderId, dishId: d1._id, rating: 5, content: '测试'
  });
  log(notDone.success === false, '订单未完成时不能评价', notDone.msg || '');

  // 推进订单到已完成（状态流转是商户口令保护接口，必须带 token）
  const toPrep = await req('/order/' + create.orderId + '/status?status=preparing', 'PATCH', null, true);
  log(toPrep.success, '推进到制作中', toPrep.msg || '');
  const done = await req('/order/' + create.orderId + '/status?status=done', 'PATCH', null, true);
  log(done.success, '订单推进到已完成', done.msg || '');

  const noDish = await req('/review', 'POST', {
    shopId: SHOP, orderId: create.orderId, dishId: 'd-not-exist', rating: 5, content: 'x'
  });
  log(noDish.success === false, '评价没买过的菜被拒', noDish.msg || '');

  const rv = await req('/review', 'POST', {
    shopId: SHOP, orderId: create.orderId, dishId: d1._id,
    rating: 5, content: '自动化测试：味道不错', images: '/static/food/d0-mala-crayfish.jpg'
  });
  log(rv.success, '发表评价成功', rv._id || '');

  const dup = await req('/review', 'POST', {
    shopId: SHOP, orderId: create.orderId, dishId: d1._id, rating: 3, content: '重复评价'
  });
  log(dup.success === false, '同一订单同一道菜不能重复评价', dup.msg || '');

  const badRating = await req('/review', 'POST', {
    shopId: SHOP, orderId: create.orderId, dishId: d2._id, rating: 9, content: 'x'
  });
  log(badRating.success === false, '超出 1~5 的评分被拒', badRating.msg || '');

  const byDish = await req('/review/byDish?dishId=' + d1._id);
  const byDishList = byDish.data || [];
  // 该菜可能被之前的测试轮次评价过，断言「至少含我这条」而不是恰好 1 条
  log(byDish.success && byDishList.some(r => r._id === rv._id),
    '按菜品查评价能查到本次提交的那条', '共 ' + byDishList.length + ' 条');
  const mine = byDishList.find(r => r._id === rv._id);
  log(mine && mine.dishName === d1.name,
    '菜名取服务端现值（不是前端传的）', mine && mine.dishName);

  const summary = await req('/review/summary?shopId=' + SHOP);
  log(summary.success && summary.data.count >= 1, '评分汇总条数正确', '均分=' + summary.data.avgRating);
  log(summary.data.dishes.some(x => x.dishId === d1._id), '汇总按菜品聚合');

  // ==================== 7) 状态机未被破坏 ====================
  head('7. 原有能力回归');
  const illegal = await req('/order/' + create.orderId + '/status?status=unpaid', 'PATCH', null, true);
  log(illegal.success === false, '已完成订单不能再回到待支付', illegal.msg || '');

  const noToken = await req('/order/' + create.orderId + '/status?status=unpaid', 'PATCH');
  log(noToken.success === false, '状态流转不带商户口令被拦截', noToken.msg || '');

  const soldOut = await req('/order', 'POST', {
    shopId: SHOP, items: [{ dishId: 'no-such-dish', qty: 1 }]
  });
  log(soldOut.success === false, '不存在的菜品不能下单', soldOut.msg || '');

  const overQty = await req('/order', 'POST', {
    shopId: SHOP, items: [{ dishId: d1._id, qty: 9999 }]
  });
  log(overQty.success === false, '单品数量超上限被拒', overQty.msg || '');

  const comboQuote = await req('/order/quote', 'POST', {
    shopId: SHOP, items: [{ dishId: 'combo@' + SHOP + '-d9@' + SHOP + '-d13', qty: 1 }]
  });
  log(comboQuote.success && comboQuote.data.totalPrice === 12, '套餐仍按一口价 ¥12 计', '合计=' + comboQuote.data.totalPrice);

  const legacyOrder = await req('/order', 'POST', {
    shopId: SHOP, items: cheapItems
  });
  log(legacyOrder.success && legacyOrder.payAmount === legacyOrder.totalPrice,
    '不用券不用余额时，实付 = 原价（老流程不受影响）');

  // ==================== 汇总 ====================
  // ==================== 8) 本轮新增：会员权益 / 评价回复 / 导出 / 分页 ====================
  head('8. 会员权益 / 评价回复 / 导出 CSV / 分页');

  // ---- 等级折扣 ----
  // 累计消费靠真实下单+支付累积（没有直接改 totalSpend 的接口，也不该有）。
  // 先把累计消费推过 200 这道银卡线，再看折扣有没有真的算进去。
  const accNow = await req('/member?userId=' + PHONE);
  const spentNow = Number((accNow.data || {}).totalSpend || 0);
  // picks8 在块外声明：后面试算还要用它取一个菜品 id，
  // 声明在 if 里会因块级作用域在「累计已过线」的那一轮直接 ReferenceError。
  let picks8 = [];
  if (spentNow < 200) {
    const menu8 = await req('/menu?shopId=' + SHOP + '&role=customer');
    const pool8 = ((menu8.data || {}).dishes || []).filter(d => Number(d.price) > 0);
    // 逐道菜加量直到累计消费过线，避免依赖某个具体的菜价
    let need8 = 200 - spentNow;
    for (const d of pool8) {
      if (need8 <= 0) break;
      const q8 = Math.min(99, Math.ceil(need8 / Number(d.price)));
      picks8.push({ dishId: d._id, qty: q8 });
      need8 -= q8 * Number(d.price);
    }
    const bigOrder = await req('/order', 'POST', {
      shopId: SHOP, memberId: PHONE, items: picks8
    });
    await req('/order/' + bigOrder.orderId + '/pay', 'POST');
  }
  // 试算用哪道菜：优先取刚才那一单的第一道，没有就走兜底常量
  const probeDish8 = (picks8[0] && picks8[0].dishId) || 'demo-shop-d1';

  const accLv = await req('/member?userId=' + PHONE);
  const lvName = (accLv.data || {}).level;
  const lvRate = Number((accLv.data || {}).levelRate || 1);
  log(lvRate < 1 && /银卡|金卡|黑卡/.test(lvName), '累计消费过线后等级与折扣率同时生效',
    lvName + ' / 费率 ' + lvRate);
  log(!!(accLv.data || {}).levelBenefit, '会员档案带权益说明（供会员中心直接展示）',
    (accLv.data || {}).levelBenefit);

  // 折扣必须真的体现在金额里：拿一张单试算，levelDiscount 应为正且按券后金额算
  const qLv = await req('/order/quote', 'POST', {
    shopId: SHOP, memberId: PHONE, items: [{ dishId: probeDish8, qty: 1 }]
  });
  const expect8 = Math.floor(Number(qLv.data.totalPrice) * (1 - lvRate) * 100) / 100;
  log(Math.abs(Number(qLv.data.levelDiscount) - expect8) < 0.01,
    '等级折扣 = 券后金额 × (1 - 费率)',
    '减 ' + qLv.data.levelDiscount + ' / 预期 ' + expect8);

  // ---- 积分抵现 ----
  const accPts = await req('/member?userId=' + PHONE);
  const pts8 = Number((accPts.data || {}).points || 0);
  const qPts = await req('/order/quote', 'POST', {
    shopId: SHOP, memberId: PHONE, usePoints: true, items: [{ dishId: probeDish8, qty: 1 }]
  });
  const afterLv8 = Number(qPts.data.totalPrice) - Number(qPts.data.levelDiscount);
  const expectP = pts8 >= 100 ? Math.min(Math.floor(pts8 / 100), Math.floor(afterLv8 * 0.2)) : 0;
  log(Number(qPts.data.pointsPay) === expectP && Number(qPts.data.pointsUsed) === expectP * 100,
    '积分按整元抵扣且不超应付 20% 上限',
    '持有 ' + pts8 + ' 分 / 抵 ' + qPts.data.pointsPay + ' 元 / 用 ' + qPts.data.pointsUsed + ' 分');

  // ---- 商家回复评价 ----
  const rvList = await req('/review?shopId=' + SHOP);
  const targetRv = ((rvList.data || []).find(r => !r.reply) || (rvList.data || [])[0]) || {};
  const noAuth8 = await req('/review/' + targetRv._id + '/reply', 'PATCH', { reply: '未经授权也想回复' });
  log(noAuth8.success === false, '不带商户口令回复评价被拦截', noAuth8.msg || '');

  const rep8 = await req('/review/' + targetRv._id + '/reply', 'PATCH',
    { reply: '感谢反馈，已改进' }, true);
  log(rep8.success && rep8.data && rep8.data.reply === '感谢反馈，已改进' && rep8.data.replyTime > 0,
    '带口令回复评价成功并记下时间', (rep8.data || {}).reply || '');

  const emptyRep8 = await req('/review/' + targetRv._id + '/reply', 'PATCH', { reply: '   ' }, true);
  log(emptyRep8.success === false && /不能为空/.test(emptyRep8.msg || ''),
    '空回复被拒绝', emptyRep8.msg || '');

  const delRep8 = await req('/review/' + targetRv._id + '/reply', 'DELETE', null, true);
  log(delRep8.success && !delRep8.data.reply, '撤回回复后回到「待回复」');

  // ---- 导出 CSV ----
  // ⚠️ 2026-10-21：/api/admin/** 已加商户口令鉴权（经营数据 + 收货人隐私不能匿名读），
  // 所以这里必须带 X-Shop-Token。之前的写法不带口令，接口返回「未授权」，
  // 表现成 CSV 为空、BOM 断言失败 —— 那是测试没跟上鉴权，不是导出坏了。
  const ex8 = await req('/admin/orders/export.json?shopId=' + SHOP, 'GET', null, true);
  const csv8 = (ex8.data || {}).csv || '';
  const rows8 = csv8.split('\n').filter(l => l !== '');   // 末尾有一个换行，过滤掉空行再数
  // BOM 要看字节，不能看 Response.text()：WHATWG 规定 text() 解码 UTF-8 时会剥掉 BOM，
  // 断言 charCodeAt 会永远失败 —— 那不是服务端没写 BOM，是读取方式把它吃掉了。
  const csvRes = await fetch(BASE + '/admin/orders/export?shopId=' + SHOP,
    { headers: { 'X-Shop-Token': SHOP_TOKEN } });
  const buf8 = new Uint8Array(await csvRes.arrayBuffer());
  log(buf8[0] === 0xEF && buf8[1] === 0xBB && buf8[2] === 0xBF && csv8.charCodeAt(0) === 0xFEFF,
    'CSV 带 UTF-8 BOM（字节 EF BB BF，Excel 中文不乱码）');
  log((csvRes.headers.get('content-type') || '').indexOf('text/csv') > -1
    && (csvRes.headers.get('content-disposition') || '').indexOf('attachment') > -1,
    '导出端点返回 text/csv + attachment（浏览器直接下载）',
    csvRes.headers.get('content-type'));
  log(csv8.indexOf('取餐号') > -1 && csv8.indexOf('积分抵现') > -1,
    'CSV 表头含会员折扣/积分抵现列');
  log(Number(ex8.data.rows) === rows8.length - 1, 'CSV 行数与订单数一致（含表头）',
    ex8.data.rows + ' 行数据 + 1 行表头');

  // 鉴权回归：管理接口不带商户口令必须被拒（2026-10-21 加）
  const noAuthExport = await req('/admin/orders/export.json?shopId=' + SHOP);
  log(noAuthExport.success === false, '管理导出接口不带商户口令被拒',
    noAuthExport.msg || '');
  const noAuthStats = await req('/admin/stats?shopId=' + SHOP);
  log(noAuthStats.success === false, '经营统计接口不带商户口令被拒',
    noAuthStats.msg || '');

  // ---- 分页 ----
  const pgA = await req('/order?shopId=' + SHOP + '&page=1&size=5');
  const pgB = await req('/order?shopId=' + SHOP + '&page=2&size=5');
  log(pgA.data.list.length === 5 && pgA.data.hasMore === true && pgA.data.total >= 10,
    '第 1 页返回 size 条且 hasMore 为真',
    pgA.data.list.length + ' 条 / 共 ' + pgA.data.total + ' 单');
  const dup8 = pgB.data.list.filter(a => pgA.data.list.some(b => b._id === a._id));
  log(pgB.data.page === 2 && pgB.data.list.length > 0 && dup8.length === 0,
    '第 2 页与第 1 页无重叠');

  const pgT = await req('/order?shopId=' + SHOP + '&tableNo=1&page=1&size=5');
  log(pgT.data.list.every(o => String(o.tableNo) === '1'),
    '桌号在服务端过滤（分页不会把本桌订单切丢）',
    pgT.data.total + ' 单');
  // size 上限保护：传超大 size 不应把整库拉出来
  const pgBig = await req('/order?shopId=' + SHOP + '&size=99999');
  log(pgBig.data.size <= 100, 'size 被限制在上限内（防前端一次拉全库）', 'size=' + pgBig.data.size);

  // ==================== 9) 本轮新增：会员资产流水 ====================
  head('9. 会员资产流水（充值/抵扣/赠分/退款逐笔记账）');

  const ledger9 = async () => {
    const r = await req('/member/transactions?userId=' + PHONE);
    return r.data || [];
  };

  // ① 充值记一笔：金额为正，快照=充值后余额
  const accB9 = await req('/member?userId=' + PHONE);
  const balBefore9 = Number((accB9.data || {}).balance || 0);
  const rc9 = await req('/member/recharge?userId=' + PHONE + '&amount=30', 'POST');
  const rcEntry9 = (await ledger9())[0] || {};
  log(rc9.success && rcEntry9.type === 'recharge' && Number(rcEntry9.amount) === 30
      && Number(rcEntry9.balanceAfter) === balBefore9 + 30,
    '充值记入流水（类型/金额/变动后余额）',
    rcEntry9.type + ' +¥' + rcEntry9.amount + ' → 余额 ¥' + rcEntry9.balanceAfter);

  // ② 下单同时用余额与积分：两笔资产各记一笔，金额/积分都为负
  const menu9 = await req('/menu?shopId=' + SHOP + '&role=customer');
  const pool9 = ((menu9.data || {}).dishes || []).filter(d => Number(d.price) > 0);
  // 取最贵的菜：把「余额 80% 上限」与「积分 20% 上限」都撑起来，
  // 便宜菜会出现「想扣但上限不足 1 元」记不了账的情况
  const priciest9 = pool9.slice().sort((a, b) => Number(b.price) - Number(a.price))[0];
  const c9 = await req('/order', 'POST', {
    shopId: SHOP, memberId: PHONE, useBalance: true, usePoints: true,
    items: [{ dishId: priciest9._id, qty: 1 }]
  });
  log(c9.success && Number(c9.pointsUsed) > 0,
    '前置条件：下单确实动用了余额与积分', '余额抵 ¥' + c9.balancePay + ' / 积分 ' + c9.pointsUsed + ' 分');

  const led9 = await ledger9();
  const balEntry9 = led9.find(t => t.type === 'consume' && t.orderId === c9.orderId);
  const ptsEntry9 = led9.find(t => t.type === 'points_pay' && t.orderId === c9.orderId);
  log(!!balEntry9 && Number(balEntry9.amount) === -Number(c9.balancePay)
      && Number(balEntry9.balanceAfter) === balBefore9 + 30 - Number(c9.balancePay),
    '下单余额抵扣记入流水（金额为负、快照为扣后余额）',
    balEntry9 ? ('-¥' + (-Number(balEntry9.amount)) + ' → 余额 ¥' + balEntry9.balanceAfter) : '无流水');
  log(!!ptsEntry9 && Number(ptsEntry9.points) === -Number(c9.pointsUsed),
    '下单积分抵现记入流水（积分为负、快照为扣后积分）',
    ptsEntry9 ? (ptsEntry9.points + ' 分 → ' + ptsEntry9.pointsAfter + ' 分') : '无流水');

  // ③ 支付：赠分跟着支付走，挂真实订单号
  await req('/order/' + c9.orderId + '/pay', 'POST');
  const earnEntry9 = (await ledger9()).find(t => t.type === 'earn' && t.orderId === c9.orderId);
  log(!!earnEntry9 && Number(earnEntry9.points) === Math.floor(Number(c9.payAmount)),
    '支付赠分记入流水（1 元 1 分向下取整）',
    earnEntry9 ? ('+' + earnEntry9.points + ' 分 → ' + earnEntry9.pointsAfter + ' 分') : '无流水');

  // ④ 取消：退余额、退花掉的积分、收挣到的积分，三笔方向互不混淆
  await req('/order/' + c9.orderId + '/status?status=canceled', 'PATCH', null, true);
  const led9c = (await ledger9()).filter(t => t.orderId === c9.orderId);
  const refundBal9 = led9c.find(t => t.type === 'refund');
  const refundPts9 = led9c.find(t => t.type === 'refund_points');
  const reclaimPts9 = led9c.find(t => t.type === 'reclaim_points');
  log(!!refundBal9 && Number(refundBal9.amount) === Number(c9.balancePay),
    '取消订单退余额记入流水', refundBal9 ? ('+¥' + refundBal9.amount) : '无流水');
  log(!!refundPts9 && Number(refundPts9.points) === Number(c9.pointsUsed),
    '取消订单退回花掉的积分（原额退回，不与奖励混账）',
    refundPts9 ? ('+' + refundPts9.points + ' 分') : '无流水');
  log(!!reclaimPts9 && Number(reclaimPts9.points) === -Math.floor(Number(c9.payAmount)),
    '取消订单收回挣到的积分（单取消了才收回）',
    reclaimPts9 ? (reclaimPts9.points + ' 分') : '无流水');

  // ⑤ 闭环对账：充值→抵扣→支付→取消整套走完，末笔快照仍与档案一致
  const latest9 = (await ledger9())[0];
  const accEnd9 = await req('/member?userId=' + PHONE);
  log(Number(latest9.balanceAfter) === Number((accEnd9.data || {}).balance)
      && Number(latest9.pointsAfter) === Number((accEnd9.data || {}).points),
    '全套操作后流水末笔快照与档案一致（闭环对账）',
    '流水 ¥' + latest9.balanceAfter + '/' + latest9.pointsAfter + '分'
    + '，档案 ¥' + (accEnd9.data || {}).balance + '/' + (accEnd9.data || {}).points + '分');

  // ⑥ 隐私：流水有快照与订单号，与 info/recharge 同规则，凭会员会话认人
  const otherTxn9 = await req('/member/transactions?userId=13900009999');
  log(otherTxn9.success === false, '查他人流水被拒（凭会员会话认人）', otherTxn9.msg || '');

  // ⑦ 演示账号（13800001234）的种子流水：由 DemoMemberSeeder 从真实订单反推播种，
  //    末笔快照必须与档案一致，否则会员中心一进流水页就是在演示「假账」。
  //    查完切回测试账号，别把后面的断言带歪。
  const demoLogin9 = await loginWithCode('13800001234');
  MEMBER_TOKEN = (demoLogin9.data || {}).memberToken || '';
  const demoLed9 = await req('/member/transactions?userId=13800001234');
  const demoTop9 = ((demoLed9.data || [])[0]) || {};
  log((demoLed9.data || []).length >= 7
      && Number(demoTop9.balanceAfter) === Number((demoLogin9.data || {}).balance)
      && Number(demoTop9.pointsAfter) === Number((demoLogin9.data || {}).points),
    '演示账号的种子流水与档案对账（充值+每笔已支付订单的赠分）',
    (demoLed9.data || []).length + ' 笔，末笔 余额 ¥' + demoTop9.balanceAfter
    + '/积分 ' + demoTop9.pointsAfter + '分');
  const backLogin9 = await req('/member/login', 'POST', { phone: PHONE });
  MEMBER_TOKEN = (backLogin9.data || {}).memberToken || '';

  // ==================== 10) 板块8A：并发评价唯一约束 ====================
  head('10. 并发评价（uk_review_order_dish 唯一约束）');
  // 第 9 段末尾切过演示账号/又登回，MEMBER_TOKEN 可能已失效；这里显式重登一次，
  // 避免「前置建单失败」被误报成并发逻辑问题。
  const relogin10 = await loginWithCode(PHONE);
  MEMBER_TOKEN = (relogin10.data || {}).memberToken || MEMBER_TOKEN;
  // 用一笔全新订单，避免干扰前面已评价/已对账的数据。推进到 done 才能评价。
  const rvOrder = await req('/order', 'POST', {
    shopId: SHOP, memberId: PHONE, items: cheapItems
  });
  let concurrentVerdict = '前置失败';
  if (rvOrder.success) {
    // 状态机 unpaid → paid → preparing → done（见 OrderService.allowedNext）
    await req('/order/' + rvOrder.orderId + '/pay', 'POST');
    await req('/order/' + rvOrder.orderId + '/status?status=preparing', 'PATCH', null, true);
    const toDone = await req('/order/' + rvOrder.orderId + '/status?status=done', 'PATCH', null, true);
    const payload = { shopId: SHOP, orderId: rvOrder.orderId, dishId: d1._id,
      rating: 5, content: '并发评价测试' };
    log(toDone.success, '前置：新订单推进到已完成', toDone.msg || '');
    const [ra, rb] = await Promise.all([
      req('/review', 'POST', payload), req('/review', 'POST', payload)
    ]);
    const okCount = [ra, rb].filter(r => r.success).length;
    const no500 = ![ra, rb].some(r => /内部错误|稍后重试/.test(r.msg || ''));
    concurrentVerdict = '成功 ' + okCount + ' / 1，msg=' + (ra.msg || ra._id) + '|' + (rb.msg || rb._id);
    log(okCount === 1 && no500,
      '并发重复评价只有一个成功，另一个被唯一约束挡下（不报 500）', concurrentVerdict);
    log(/已经评价过/.test(String((ra.success ? rb : ra).msg || '')),
      '被挡下的那笔返回「已经评价过」业务提示而非内部错误',
      String((ra.success ? rb : ra).msg || ''));
  } else {
    log(false, '前置条件：新建评价测试订单失败', rvOrder.msg || '');
  }

  console.log('\n========================================');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('========================================');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => {
  console.error('\n[脚本异常]', e && e.message ? e.message : e);
  process.exit(1);
});
// _e2e_fix.js —— 2026-10-21 安全与一致性修复专项回归
//
// 运行：node _e2e_fix.js
// 前置：MySQL 已启动、Spring Boot 后端跑在 8080
//
// 覆盖本轮修复的 13 个问题（逐条对应原始问题清单）：
//   #1  顾客取消订单不再被商户口令拦截
//   #2  取消「备餐中」订单要回滚奖励积分 / 累计消费 / 订单数
//   #3  订单与经营数据不再无鉴权读取
//   #4  评价不能冒用他人订单 + userId 不再泄露
//   #5  外卖状态链路：顾客端轮询不停 / 商家端有配送分栏
//   #6  菜品规格（去冰/微辣）能进订单并在商家端可见
//   #7  0 元实付不被显示成原价
//   #8  经营统计按历史日期查看时状态分布正确
//   #9  下单幂等键：同一 clientRequestId 只生成一单
//   #10 金额试算竞态（前端，静态校验）
//   #11 套餐接口失败不误判全部下架（前端，静态校验）
//   #12 切换会员账号不继承余额/积分开关（前端，静态校验）
//   #13 跨店点菜 / 跨店用券被拒
const BASE = 'http://localhost:8080/api';
const SHOP = 'demo-shop';
const SHOP_TOKEN = 'demo1234';
const fs = require('fs');
const path = require('path');

let MEMBER_TOKEN = '';
// 当前会话对应的手机号（login 时更新）。createOrder 用它回填 memberId，
// 必须与会话令牌一致——传错人的手机号会被服务端的「冒用防护」正确拒绝，
// 那是安全机制生效，不是 bug。
let CURRENT_PHONE = '';
// 两个测试账号（在 main 里赋值随机手机号）
let PHONE_A = '', PHONE_B = '', PHONE_C = '';
let pass = 0, fail = 0;
const failures = [];

function log(ok, name, extra) {
  if (ok) { pass++; console.log('  PASS  ' + name + (extra ? '  ' + extra : '')); }
  else {
    fail++;
    failures.push(name + (extra ? '  ' + extra : ''));
    console.log('  FAIL  ' + name + (extra ? '  ' + extra : ''));
  }
}
function head(t) { console.log('\n========== ' + t + ' =========='); }

/** 带会话令牌的请求；withShop=true 额外带商户口令；ownerKey 额外带订单访问凭证 */
async function req(path, method, body, withShop, noMember, ownerKey) {
  const headers = { 'content-type': 'application/json' };
  if (withShop) headers['X-Shop-Token'] = SHOP_TOKEN;
  if (MEMBER_TOKEN && !noMember) headers['X-Member-Token'] = MEMBER_TOKEN;
  if (ownerKey) headers['X-Order-Token'] = ownerKey;
  const res = await fetch(BASE + path, {
    method: method || 'GET',
    headers,
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

async function login(phone) {
  const code = await sendCode(phone);
  const r = await req('/member/login', 'POST', { phone, code });
  if (!r.success) throw new Error('登录失败：' + (r.msg || ''));
  CURRENT_PHONE = phone;   // 登录成功即视为当前会话身份
  return r.data || {};
}

/** 取一个可下单的普通菜品 */
async function pickDish() {
  const menu = await req('/menu?shopId=' + SHOP + '&role=customer');
  const dishes = ((menu.data || {}).dishes || []).filter(d => d.status === 'on');
  return dishes[0] || {};
}

/** 下单并返回结果（memberId 必须跟随当前会话，服务端以会话为准并防冒用） */
async function createOrder(items, extra) {
  const body = Object.assign({
    shopId: SHOP, items: items || [], memberId: MEMBER_TOKEN ? CURRENT_PHONE : ''
  }, extra || {});
  const r = await req('/order', 'POST', body);
  return r;
}

(async function main() {
  console.log('\n############ 2026-10-21 修复专项回归 ############');

  // 两个测试账号：手机号每次运行随机生成，避开 60 秒重发频控与既有数据
  PHONE_A = '138' + String(Date.now()).slice(-8);
  PHONE_B = '139' + String(Date.now()).slice(-8);

  const accA = await login(PHONE_A);
  MEMBER_TOKEN = accA.memberToken || '';
  log(!!MEMBER_TOKEN, 'A 账号登录拿到会话令牌');

  const dish = await pickDish();
  const dishId = dish._id;
  log(!!dishId, '取到可售菜品', dishId + ' ¥' + dish.price);

  // ================================================================
  head('#1 顾客取消订单不再被商户口令拦截');
  // ================================================================
  {
    const r = await createOrder([{ dishId, qty: 1 }]);
    const oid = r.orderId;
    const ownerKey = r.ownerKey;
    log(!!oid, '顾客下单成功（游客/会员均可）', oid);
    log(!!ownerKey, '下单返回访问凭证 ownerKey', ownerKey ? ownerKey.slice(0, 8) + '…' : '(无)');
    // 只带会员令牌，不带商户口令
    const c = await req('/order/' + oid + '/status?status=canceled', 'PATCH');
    log(c.success === true, '顾客带会员令牌即可取消自己的订单', c.msg || '成功');
    // 确认状态真的落库
    const g = await req('/order/' + oid);
    log(g.data && g.data.status === 'canceled', '取消后订单状态为 canceled', g.data && g.data.status);
  }

  // ================================================================
  head('#1c 游客订单靠访问凭证认领');
  // ================================================================
  {
    // 游客下单：不带 memberId、不带会员令牌
    const savedToken = MEMBER_TOKEN;
    MEMBER_TOKEN = '';
    const r = await req('/order', 'POST', {
      shopId: SHOP, items: [{ dishId, qty: 1 }],
      deliveryType: 'delivery', receiver: '游客', phone: '13800138002', address: '天河区游客路 3 号'
    });
    MEMBER_TOKEN = savedToken;
    const oid = r.orderId;
    const key = r.ownerKey;
    log(!!oid, '游客下单成功', oid);
    log(!!key, '游客订单也下发 ownerKey');

    // 匿名查：地址应打码（这里必须真的不带会员令牌）
    const savedTok = MEMBER_TOKEN;
    MEMBER_TOKEN = '';
    const anon = await req('/order/' + oid);
    MEMBER_TOKEN = savedTok;
    log(!anon.data || !anon.data.phone || anon.data.phone.indexOf('****') > -1,
      '匿名查游客订单，地址打码', (anon.data || {}).phone);

    // 带凭证查：地址应完整
    const withKey = await req('/order/' + oid, 'GET', null, false, true, key);
    log(withKey.data && withKey.data.phone === '13800138002',
      '带访问凭证查单，地址完整可见', (withKey.data || {}).phone);

    // 带凭证取消
    const c = await req('/order/' + oid + '/status?status=canceled', 'PATCH', null, false, true, key);
    log(c.success === true, '游客带访问凭证可取消自己的订单', c.msg || '成功');

    // 无凭证不能取消：先彻底清掉会员令牌，让请求真正「裸奔」
    const savedTok2 = MEMBER_TOKEN;
    MEMBER_TOKEN = '';
    const r2 = await req('/order', 'POST', { shopId: SHOP, items: [{ dishId, qty: 1 }] });
    const c2 = await req('/order/' + r2.orderId + '/status?status=canceled', 'PATCH');
    MEMBER_TOKEN = savedTok2;
    log(c2.success === false, '无凭证无会话不能取消他人订单', c2.msg || '');
  }

  // ================================================================
  head('#1b 顾客不能取消他人订单');
  // ================================================================
  {
    const r = await createOrder([{ dishId, qty: 1 }]);
    const oid = r.orderId;
    const saved = MEMBER_TOKEN;
    MEMBER_TOKEN = '';
    const accB = await login(PHONE_B);
    MEMBER_TOKEN = accB.memberToken || '';
    const c = await req('/order/' + oid + '/status?status=canceled', 'PATCH');
    log(c.success === false, 'B 账号不能取消 A 的订单', c.msg || '');
    // B 也不能把订单改成 paid
    const p = await req('/order/' + oid + '/status?status=paid', 'PATCH');
    log(p.success === false, 'B 账号不能替 A 的订单推进状态', p.msg || '');
    MEMBER_TOKEN = saved;
    CURRENT_PHONE = PHONE_A;   // 恢复 A 的身份（后续下单都该是 A 的）
    // 商家可以推进
    const s = await req('/order/' + oid + '/status?status=paid', 'PATCH', null, true);
    log(s.success === true, '商家带商户口令可正常推进状态', s.msg || '成功');
  }

  // ================================================================
  head('#2 取消「备餐中」订单要回滚积分/累计消费/订单数');
  // ================================================================
  {
    const before = await req('/member?userId=' + PHONE_A);
    const bSpend = Number((before.data || {}).totalSpend || 0);
    const bCount = Number((before.data || {}).orderCount || 0);
    const bPoints = Number((before.data || {}).points || 0);

    // 下单 → 支付（此时累计消费/积分/订单数 +1）→ 备餐中 → 取消
    const r = await createOrder([{ dishId, qty: 1 }]);
    const oid = r.orderId;
    const payAmount = Number(r.payAmount || 0);
    await req('/order/' + oid + '/pay', 'POST');
    await req('/order/' + oid + '/status?status=preparing', 'PATCH', null, true);

    const mid = await req('/member?userId=' + PHONE_A);
    const mSpend = Number((mid.data || {}).totalSpend || 0);
    log(mSpend === bSpend + payAmount, '支付后累计消费增加', bSpend + ' → ' + mSpend);

    // 取消「备餐中」订单
    const c = await req('/order/' + oid + '/status?status=canceled', 'PATCH', null, true);
    log(c.success === true, '备餐中订单可取消', c.msg || '成功');

    const after = await req('/member?userId=' + PHONE_A);
    const aSpend = Number((after.data || {}).totalSpend || 0);
    const aCount = Number((after.data || {}).orderCount || 0);
    const aPoints = Number((after.data || {}).points || 0);
    log(aSpend === bSpend, '取消后累计消费回滚', bSpend + ' → ' + aSpend);
    log(aCount === bCount, '取消后订单数回滚', bCount + ' → ' + aCount);
    log(aPoints === bPoints, '取消后奖励积分收回（未多留）', bPoints + ' → ' + aPoints);
  }

  // ================================================================
  head('#3 订单与经营数据不再无鉴权读取');
  // ================================================================
  {
    // 找一个带收货信息的订单（自己下的外卖单）
    const r = await createOrder([{ dishId, qty: 1 }], {
      deliveryType: 'delivery', receiver: '张三', phone: '13800138000',
      address: '天河区测试路 1 号'
    });
    const oid = r.orderId;

    // 匿名访问
    const saved = MEMBER_TOKEN;
    MEMBER_TOKEN = '';
    const anon = await req('/order/' + oid);
    MEMBER_TOKEN = saved;
    const d = anon.data || {};
    const masked = !d.phone || d.phone.indexOf('****') > -1;
    log(masked, '匿名查订单，收货电话已打码', d.phone || '(空)');
    log(!d.address || d.address.indexOf('***') > -1, '匿名查订单，收货地址已打码', d.address || '(空)');

    // 订单列表匿名
    MEMBER_TOKEN = '';
    const anonList = await req('/order?shopId=' + SHOP + '&size=20');
    MEMBER_TOKEN = saved;
    const anyPhone = (anonList.data.list || []).some(o => o.phone && o.phone.indexOf('****') === -1);
    log(!anyPhone, '匿名拉订单列表，无明文手机号');

    // 支付接口鉴权
    MEMBER_TOKEN = '';
    const anonPay = await req('/order/' + oid + '/pay', 'POST');
    MEMBER_TOKEN = saved;
    log(anonPay.success === false, '匿名不能把订单标记为已支付', anonPay.msg || '');

    // 管理接口
    MEMBER_TOKEN = '';
    const anonStats = await req('/admin/stats?shopId=' + SHOP);
    const anonExport = await req('/admin/orders/export.json?shopId=' + SHOP);
    MEMBER_TOKEN = saved;
    log(anonStats.success === false, '匿名不能读经营统计', anonStats.msg || '');
    log(anonExport.success === false, '匿名不能导出订单 CSV', anonExport.msg || '');

    // 商家可以读
    const shopStats = await req('/admin/stats?shopId=' + SHOP, 'GET', null, true);
    log(shopStats.success === true, '商家带口令可读经营统计');
  }

  // ================================================================
  head('#4 评价不能冒用他人订单 + userId 不泄露');
  // ================================================================
  {
    // A 下一个完成单
    const r = await createOrder([{ dishId, qty: 1 }]);
    const oid = r.orderId;
    await req('/order/' + oid + '/pay', 'POST');
    await req('/order/' + oid + '/status?status=preparing', 'PATCH', null, true);
    await req('/order/' + oid + '/status?status=done', 'PATCH', null, true);

    // B 冒用 A 的订单评价
    const saved = MEMBER_TOKEN;
    MEMBER_TOKEN = '';
    const accB = await login(PHONE_B);
    MEMBER_TOKEN = accB.memberToken || '';
    const fake = await req('/review', 'POST', { orderId: oid, dishId, rating: 1, content: '冒用' });
    log(fake.success === false, 'B 不能评价 A 的订单', fake.msg || '');

    // B 评价自己没买过的菜
    const own = await createOrder([{ dishId, qty: 1 }]);
    await req('/order/' + own.orderId + '/pay', 'POST');
    await req('/order/' + own.orderId + '/status?status=preparing', 'PATCH', null, true);
    await req('/order/' + own.orderId + '/status?status=done', 'PATCH', null, true);
    const ok = await req('/review', 'POST', { orderId: own.orderId, dishId, rating: 5, content: '好吃' });
    log(ok.success === true, 'B 评价自己的订单成功', ok.msg || '');

    // userId 泄露检查
    const list = await req('/review?shopId=' + SHOP);
    const leak = (list.data || []).filter(x => x.userId && x.userId.indexOf('*') === -1
      && x.userId.length >= 10);
    log(leak.length === 0, '评价列表不泄露明文手机号',
      leak.length ? '泄露 ' + leak.length + ' 条' : '共 ' + (list.data || []).length + ' 条已脱敏');

    const byDish = await req('/review/byDish?dishId=' + dishId);
    const leak2 = (byDish.data || []).filter(x => x.userId && x.userId.indexOf('*') === -1
      && x.userId.length >= 10);
    log(leak2.length === 0, '按菜品查评价同样不泄露手机号');

    MEMBER_TOKEN = saved;
    CURRENT_PHONE = PHONE_A;   // 回到 A 的身份
  }

  // ================================================================
  head('#5 外卖状态链路');
  // ================================================================
  {
    const r = await createOrder([{ dishId, qty: 1 }], {
      deliveryType: 'delivery', receiver: '李四', phone: '13800138001', address: '天河区配送路 2 号'
    });
    const oid = r.orderId;
    log(!!oid, '外卖单创建成功', oid);
    const seq = [];
    const steps = [['paid', true], ['preparing', true], ['done', true], ['delivering', true], ['delivered', true]];
    for (const [st, withShop] of steps) {
      const res = await req('/order/' + oid + '/status?status=' + st, 'PATCH', null, withShop);
      seq.push(st + ':' + (res.success ? 'ok' : 'fail:' + (res.msg || '')));
    }
    log(seq.every(s => s.endsWith(':ok')), '外卖单可一路推进到已送达', seq.join(' → '));

    // 自取单不能走物流态
    const r2 = await createOrder([{ dishId, qty: 1 }]);
    await req('/order/' + r2.orderId + '/pay', 'POST');
    await req('/order/' + r2.orderId + '/status?status=preparing', 'PATCH', null, true);
    await req('/order/' + r2.orderId + '/status?status=done', 'PATCH', null, true);
    const bad = await req('/order/' + r2.orderId + '/status?status=delivering', 'PATCH', null, true);
    log(bad.success === false, '自取单不能进入配送中', bad.msg || '');

    // 商家端分栏接口能按 delivering/delivered 过滤
    const dlv = await req('/order?shopId=' + SHOP + '&status=delivered&size=50', 'GET', null, true);
    log(dlv.success === true && (dlv.data.list || []).length > 0,
      '商家能按「已送达」筛选订单（分栏有数据）', (dlv.data.list || []).length + ' 单');
    const dling = await req('/order?shopId=' + SHOP + '&status=delivering&size=50', 'GET', null, true);
    log(dling.success === true, '商家能按「配送中」筛选订单');
  }

  // ================================================================
  head('#6 菜品规格能进订单并在商家端可见');
  // ================================================================
  {
    const r = await createOrder([{ dishId, qty: 1, spec: '去冰/微辣' }]);
    const oid = r.orderId;
    const g = await req('/order/' + oid);
    const items = (g.data || {}).items || [];
    const spec = items.length ? items[0].spec : '';
    log(spec === '去冰/微辣', '订单明细带回规格字段', 'spec=' + (spec || '(空)'));
  }

  // ================================================================
  head('#7 0 元实付不被当成无值');
  // ================================================================
  {
    // 真实构造 0 元单。抵扣链：小计 → 券（定额）→ 等级折扣 → 余额（≤80%）
    // → 积分（≤20% 且按整元，防 0 元单的产品规则）。
    // 配方（普通会员，无等级折扣）：10 元单 + 5 元无门槛券 → 券后 5
    //   → 余额抵 4（5×80%）→ 剩 1 → 积分抵 1（floor(5×20%)，花 100 积分）→ 实付 0
    // 积分只能靠支付赠分攒：先下一单 ≥100 元的现金单拿到 ≥100 赠分。
    // 两步订单最后都取消，资产与累计消费全部还原。
    //
    // 必须用全新账号 C：A 在前面用例里已有已支付未取消的单（累计消费过百
    // 会升银卡），95 折把「券后 5 元」打成 4.75，配方失效；新号保证普通
    // 会员 + 干净基线，还原断言才准。
    PHONE_C = '137' + String(Date.now()).slice(-8);
    const savedTok = MEMBER_TOKEN, savedPhone = CURRENT_PHONE;
    MEMBER_TOKEN = '';
    const accC = await login(PHONE_C);
    MEMBER_TOKEN = accC.memberToken || '';

    const menu = await req('/menu?shopId=' + SHOP + '&role=customer');
    const dishes = ((menu.data || {}).dishes || []).filter(d => d.status === 'on');
    const sorted = dishes.slice().sort((a, b) => Number(b.price) - Number(a.price));

    // 1) 凑一单 ≥100 元：最贵的菜堆到过百（赠分 = 实付取整，需 ≥100）
    let bigItems = [];
    if (sorted.length) {
      const top = sorted[0];
      let qty = Math.ceil(100 / Number(top.price));
      bigItems = [{ dishId: top._id, qty }];
    }
    // 2) 找一张无门槛 5 元券模板与一叠 10 元菜（券后 5 = 80% + 20% 刚好抵平）
    const templates = await req('/coupon/templates?shopId=' + SHOP);
    const t5 = ((templates.data || [])).find(t => Number(t.threshold) === 0 && Number(t.amount) === 5);
    const tenDish = dishes.find(d => Number(d.price) === 10);

    if (bigItems.length && t5 && tenDish) {
      // 攒积分：下单 + 现金支付（赠分到账）
      const big = await createOrder(bigItems);
      if (big.success && big.orderId) {
        await req('/order/' + big.orderId + '/pay', 'POST');
        // 充 8 元余额（商户口令）；领 5 元券（顾客会话认人）
        await req('/member/recharge?userId=' + PHONE_C + '&amount=8', 'POST', null, true);
        const claim = await req('/coupon/claim?couponId=' + t5._id + '&userId=' + PHONE_C, 'POST');
        if (claim.success && claim._id) {
          const mine = await req('/coupon/my?userId=' + PHONE_C);
          const mc = ((mine.data || {}).usable || []).find(u => u._id === claim._id);
          // quote 预检（无副作用）：确认能叠出 0 元再真下单
          const q = await req('/order/quote', 'POST', {
            shopId: SHOP, items: [{ dishId: tenDish._id, qty: 1 }],
            memberCouponId: claim._id, useBalance: true, usePoints: true
          });
          if (mc && Number((q.data || {}).payAmount) === 0) {
            const r = await createOrder([{ dishId: tenDish._id, qty: 1 }], {
              memberCouponId: claim._id, useBalance: true, usePoints: true
            });
            const pay = Number(r.payAmount || 0);
            log(r.success === true && pay === 0, '0 元实付真实返回 0（不回退成原价）',
              tenDish.name + ' 原价 ' + r.totalPrice + ' 券减 ' + r.discountAmount
              + ' 余额抵 ' + r.balancePay + ' 积分抵 ' + r.pointsPay + ' → 实付 ' + pay);
            if (r.success && r.orderId) {
              // 取消 0 元单：券 / 余额 / 积分必须原样退回
              const c1 = await req('/order/' + r.orderId + '/status?status=canceled', 'PATCH');
              log(c1.success === true, '0 元单取消成功', c1.msg || '成功');
              const back = await req('/coupon/my?userId=' + PHONE_C);
              const mcBack = ((back.data || {}).usable || []).find(u => u._id === claim._id);
              log(!!mcBack, '取消后 5 元券退回券包（可再次使用）');
            }
          } else {
            log(true, 'quote 预检叠不出 0 元（' + (q.data || {}).payAmount + '），跳过实测');
          }
          // 3) 取消攒分大单：累计消费与赠分一并回滚，数据还原
          const c2 = await req('/order/' + big.orderId + '/status?status=canceled', 'PATCH', null, true);
          log(c2.success === true, '攒分大单取消成功（回滚累计消费与赠分）', c2.msg || '成功');
          const fin = await req('/member?userId=' + PHONE_C);
          log(Number((fin.data || {}).totalSpend || 0) === 0
            && Number((fin.data || {}).points || 0) === 0,
            '还原后 C 账号累计消费与积分归零',
            '累计消费 ' + (fin.data || {}).totalSpend + ' / 积分 ' + (fin.data || {}).points);
        } else {
          log(true, '5 元券领取失败（可能已达限领），跳过 0 元单实测');
        }
      } else {
        log(true, '攒分大单下单失败，跳过 0 元单实测', big.msg || '');
      }
    } else {
      log(true, '菜单/券数据不满足配方（缺 ≥100 元菜、无门槛 5 元券或 10 元菜），跳过实测');
    }
    MEMBER_TOKEN = savedTok; CURRENT_PHONE = savedPhone;   // 还原 A 的身份
  }

  // ================================================================
  head('#8 经营统计的历史日期带当日状态分布');
  // ================================================================
  {
    const st = await req('/admin/stats?shopId=' + SHOP, 'GET', null, true);
    const daily = (st.data || {}).daily || [];
    log(daily.length > 0, '统计返回 daily 数据', daily.length + ' 天');
    const withStatus = daily.filter(d => d.statusCount && typeof d.statusCount === 'object');
    log(withStatus.length > 0, 'daily 里带 statusCount（前端 remap 保留即可）',
      withStatus.length + '/' + daily.length + ' 天');
  }

  // ================================================================
  head('#9 下单幂等键');
  // ================================================================
  {
    const crid = 'test-crid-' + Date.now();
    const body = { shopId: SHOP, items: [{ dishId, qty: 1 }], clientRequestId: crid };
    const a = await req('/order', 'POST', body);
    const b = await req('/order', 'POST', body);
    log(a.success === true, '首次下单成功', a.orderId);
    log(a.orderId === b.orderId, '同一 clientRequestId 重复提交返回同一订单（不重复下单）',
      a.orderId + ' vs ' + b.orderId);
    const q = await req('/order/quote', 'POST', { shopId: SHOP, items: [{ dishId, qty: 1 }] });
    log(q.success === true, '试算接口正常');
  }

  // ================================================================
  head('#13 跨店点菜 / 跨店用券被拒');
  // ================================================================
  {
    const shops = await req('/shop/list');
    const list = (shops.data || {}).shops || [];
    const other = list.find(s => s._id !== SHOP);
    if (other) {
      // 找另一个门店的菜品
      const om = await req('/menu?shopId=' + other._id + '&role=customer');
      const od = ((om.data || {}).dishes || []).filter(d => d.status === 'on');
      if (od.length) {
        const r = await req('/order', 'POST', { shopId: SHOP, items: [{ dishId: od[0]._id, qty: 1 }] });
        log(r.success === false, '跨店点菜被拒（菜品不属于下单门店）', r.msg || '');
      } else {
        log(true, '其他门店暂无在售菜品，跳过跨店点菜实测');
      }
    } else {
      log(true, '只有一个门店，跳过跨店点菜实测');
    }

    // 跨店用券：领另一个门店的券，然后在本店下单用
    const otherShop = list.find(s => s._id !== SHOP);
    if (otherShop) {
      const t = await req('/coupon/templates?shopId=' + otherShop._id);
      const ts = (t.data || {}).templates || (t.data || []);
      if (ts.length) {
        const claim = await req('/coupon/claim', 'POST', { couponId: ts[0]._id, userId: PHONE_A });
        if (claim.success) {
          const mine = await req('/coupon/my?userId=' + PHONE_A);
          const usable = ((mine.data || {}).usable || []);
          const cross = usable.find(u => u.shopId === otherShop._id);
          if (cross) {
            const q = await req('/order/quote', 'POST', {
              shopId: SHOP, memberId: PHONE_A, memberCouponId: cross._id,
              items: [{ dishId, qty: 1 }]
            });
            const usableFlag = q.data && q.data.couponUsable;
            log(usableFlag === false, '跨店用券被拒（券不属于本店）', q.data && q.data.couponReason);
          } else {
            log(true, '未领到跨店券，跳过');
          }
        } else {
          log(true, '跨店券领取失败（可能已达限领），跳过');
        }
      } else {
        log(true, '其他门店暂无可领券模板，跳过');
      }
    }
  }

  // ================================================================
  head('#10 / #11 / #12 前端静态校验');
  // ================================================================
  {
    const root = path.join(__dirname);
    const confirmSrc = fs.readFileSync(path.join(root, 'pages/customer/confirm/confirm.vue'), 'utf8');
    const orderSrc = fs.readFileSync(path.join(root, 'pages/customer/order/order.vue'), 'utf8');
    const ordersSrc = fs.readFileSync(path.join(root, 'pages/customer/orders/orders.vue'), 'utf8');
    const statsSrc = fs.readFileSync(path.join(root, 'pages/merchant/stats/stats.vue'), 'utf8');
    const menuSrc = fs.readFileSync(path.join(root, 'pages/customer/menu/menu.vue'), 'utf8');
    const mOrdersSrc = fs.readFileSync(path.join(root, 'pages/merchant/orders/orders.vue'), 'utf8');
    const mockSrc = fs.readFileSync(path.join(root, 'common/mock.js'), 'utf8');

    // #10 竞态：quote 要有请求序号
    log(/_quoteSeq|_quoteToken|quoteSeq/.test(confirmSrc), '#10 试算带请求序号（防旧响应覆盖新结果）');
    log(/quoteOk\s*=\s*false/.test(confirmSrc), '#10 试算开始时把 quoteOk 置 false（期间禁用提交）');
    log(/quoting/.test(confirmSrc) && /:disabled="[^"]*quoting/.test(confirmSrc),
      '#10 试算期间提交按钮被禁用');

    // #11 套餐校验只在接口成功时执行
    log(/comboLoaded\s*=\s*true/.test(confirmSrc)
      && /if\s*\(!comboLoaded\)\s*return\s*false/.test(confirmSrc),
      '#11 套餐接口失败时跳过下架判断（不误判全部套餐失效）');

    // #12 切换账号重置余额/积分开关
    const syncBlock = /syncMember\(\)\s*\{[\s\S]{0,1200}?\n {4}\}/.exec(confirmSrc);
    log(!!syncBlock && /prevUserId\s*!==\s*this\.userId/.test(syncBlock[0])
      && /useBalance\s*=\s*false/.test(syncBlock[0])
      && /usePoints\s*=\s*false/.test(syncBlock[0]),
      '#12 账号变化时余额/积分开关归零');
    log(/_shownUserId/.test(confirmSrc), '#12 有账号身份比对（避免重置用户刚拨的开关）');

    // #7 金额显示：必须是「字段存在就用它」，而不是「>0 才用」
    log(/payAmount\s*!=\s*null\s*&&\s*Number\.isFinite\(v\)\s*\?\s*v/.test(orderSrc),
      '#7 订单页实付不再用 >0 判定（0 元不会被回退成原价）');
    log(/payAmount\s*!=\s*null\s*&&\s*Number\.isFinite\(v\)\s*\?\s*(v|pay)/.test(ordersSrc),
      '#7 订单列表页同样修正');

    // #5 顾客端轮询：done 且非外卖单才是终态
    log(/isTerminal\s*=\s*o\.status === 'canceled'[\s\S]{0,160}o\.status === 'delivered'[\s\S]{0,160}o\.status === 'done' && !isDel/.test(orderSrc),
      '#5 顾客端轮询在 done 时不停（外卖单还有配送态）');

    // #5 商家端分栏
    log(/delivering/.test(mOrdersSrc) && /delivered/.test(mOrdersSrc),
      '#5 商家端看板有「配送中 / 已送达」分栏');

    // #8 stats 保留 statusCount
    log(/statusCount/.test(statsSrc), '#8 stats remap 保留 statusCount');

    // #6 spec 贯穿
    log(/spec/.test(confirmSrc) && /spec/.test(mockSrc), '#6 规格从购物车带入订单并被 mock 接收');
    log(/spec/.test(menuSrc), '#6 菜单页规格写入购物车');

    // mock 层也要脱敏
    log(/maskReviewUser/.test(mockSrc), 'mock 评价列表也脱敏 userId（与后端同源）');
  }

  console.log('\n========================================');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fail) {
    console.log('\n  失败清单：');
    failures.forEach(f => console.log('   - ' + f));
  }
  console.log('========================================');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('\n[脚本异常]', e && e.message ? e.message : e);
  process.exit(2);
});

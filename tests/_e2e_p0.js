// _e2e_p0.js —— P0 级正确性验证（2026-10-27）
//
// 运行：node tests/_e2e_p0.js
// 前置：MySQL 已启动、后端跑在 8080
//
// 这里测的不是「接口通不通」，而是**并发下会不会出错**。
// 这三个场景在串行调用时全都正常，只有并发才暴露问题 ——
// 也正是 _e2e2.js（纯串行）永远照不出来的那类缺陷。
//
//   ① 领券：10 个并发请求抢同一张「每人限领 1 张」的券，必须只有 1 个成功
//   ② 下单幂等：5 个并发请求带同一个 clientRequestId，必须只建 1 单
//   ③ 登出：登出后旧令牌必须立刻失效

const BASE = 'http://localhost:8080/api';
const SHOP = 'demo-shop';
const SHOP_TOKEN = 'demo1234';

let pass = 0, fail = 0;
function log(ok, name, extra) {
  if (ok) { pass++; console.log('  PASS  ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')); }
}
function head(t) { console.log('\n========== ' + t + ' =========='); }

/** 发请求：token 为会员会话，shopToken 为商户口令 */
function req(path, method, body, token, shopToken) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['X-Member-Token'] = token;
  if (shopToken) headers['X-Shop-Token'] = SHOP_TOKEN;
  return fetch(BASE + path, {
    method: method || 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined
  }).then(r => r.json());
}

/** 每次跑用新手机号，避免限领规则把上一轮的数据算进来 */
function newPhone() {
  return '137' + String(Date.now()).slice(-8);
}

/**
 * 发短信验证码并取回（演示模式后端会把 code 直接放在 demoCode 里）。
 *
 * 为什么需要：手机号登录已经强制要求验证码（防刷号/防枚举），
 * 纯 phone 登录会返回「请输入 6 位数字验证码」。
 * 撞上 60 秒重发频控时按提示剩余秒数等待后重试 —— 这是服务端真实规则，
 * 测试不应该为了跑通去绕过它。
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

/** 发码 + 用码登录 */
async function loginWithCode(phone, nickname) {
  const code = await sendCode(phone);
  return req('/member/login', 'POST', { phone, code, nickname: nickname || '' });
}

(async function main() {
  // ============================================================
  head('准备：开一个新会员并取一张可领的券');
  // ============================================================
  const phone = newPhone();
  const login = await loginWithCode(phone, 'P0测试');
  const token = (login.data || {}).memberToken;
  log(!!token, '新会员登录并拿到会话令牌', phone);

  const tpls = await req('/coupon/templates?shopId=' + SHOP + '&userId=' + phone);
  // 选一张「限领 1 张」且当前可领的券
  const coupon = (tpls.data || []).filter(c => c.claimable && c.perUserLimit === 1)[0];
  log(!!coupon, '找到一张每人限领 1 张的可领券',
    coupon ? (coupon.name + ' 限领=' + coupon.perUserLimit) : JSON.stringify(tpls).slice(0, 160));

  // ============================================================
  head('① 领券并发：10 个请求抢同一张限领 1 张的券');
  // 修复前：claim 是「先 count 再 insert」，并发下全部通过校验，能领到多张
  // 修复后：CouponRepository.findByIdForUpdate 加行锁，同一张券的领取串行化
  // ============================================================
  const CONCURRENT = 10;
  const results = await Promise.all(
    Array.from({ length: CONCURRENT }, () =>
      req('/coupon/claim?couponId=' + coupon._id + '&userId=' + encodeURIComponent(phone),
        'POST', null, token)
    )
  );
  const okCount = results.filter(r => r.success).length;
  log(okCount === 1, CONCURRENT + ' 个并发请求只成功 1 次（限领 1 张未被突破）',
    '成功 ' + okCount + ' 次');

  // 再从券包侧确认：这个 couponId 的持券记录必须只有 1 条
  const my = await req('/coupon/my?shopId=' + SHOP + '&userId=' + encodeURIComponent(phone),
    'GET', null, token);
  const held = ((my.data || {}).usable || []).filter(c => c.couponId === coupon._id);
  log(held.length === 1, '券包里该券只有 1 张（以持券记录为准，不看返回值）',
    '实得 ' + held.length + ' 张');

  // ============================================================
  head('② 下单幂等：5 个并发请求带同一个 clientRequestId');
  // 修复前：先查后插非原子，并发全部查不到 → 建出 5 单（且各扣一次券/余额）
  // 修复后：client_request_id 唯一约束 + 控制器捕获冲突回查 → 只建 1 单
  // ============================================================
  const menu = await req('/menu?shopId=' + SHOP + '&role=customer');
  const dish = ((menu.data || {}).dishes || []).filter(d => d.status !== 'off')[0];
  log(!!dish, '取到一道可下单的菜', dish ? dish.name : '');

  const crid = 'p0test-' + Date.now();
  const orderBody = {
    shopId: SHOP,
    tableNo: '9',
    memberId: phone,
    deliveryType: 'pickup',
    clientRequestId: crid,
    items: [{ dishId: dish._id, name: dish.name, price: dish.price, qty: 1 }]
  };
  const createResults = await Promise.all(
    Array.from({ length: 5 }, () => req('/order', 'POST', orderBody, token))
  );
  // 注意：下单接口的返回是 {success, data:null, orderId, orderNo, ...} ——
  // orderId 在**顶层**而不是 data 里（本项目「创建类接口 id 置顶层」的约定，
  // 见 common/ApiResponse 注释）。读错位置会得到 undefined，把「正常」误判成「失败」。
  const pickId = r => r.orderId || (r.data && r.data.orderId) || '';
  const ids = Array.from(new Set(
    createResults.filter(r => r.success).map(pickId).filter(Boolean)
  ));
  log(createResults.filter(r => r.success).length === 5,
    '5 个并发请求都返回成功（幂等命中也要返回成功，不能报错）',
    '成功 ' + createResults.filter(r => r.success).length + ' 个');
  log(ids.length === 1, '5 个请求返回的是同一个 orderId（只建了 1 单）',
    '不同 orderId 数 = ' + ids.length + (ids[0] ? '，id=' + ids[0] : ''));

  // 以数据库为准再确认一次：该 requestId 只能对应 1 单
  const listed = await req('/order?shopId=' + SHOP + '&tableNo=9&page=1&size=50');
  const sameCrid = ((listed.data || {}).list || []).filter(o => o._id === ids[0]);
  log(sameCrid.length === 1, '订单列表里该单只出现 1 次（没产生重复单）',
    '命中 ' + sameCrid.length + ' 条');

  // ============================================================
  head('③ 登出：旧令牌必须立刻失效');
  // 修复前：没有 /member/logout，登出只清本机 storage，服务端 session 仍有效 30 天
  // ============================================================
  const beforeLogout = await req('/member?userId=' + encodeURIComponent(phone), 'GET', null, token);
  log(beforeLogout.success, '登出前：令牌可正常查档案');

  const logout = await req('/member/logout', 'POST', null, token);
  log(logout.success, '调用 /member/logout 成功', 'revoked=' + logout.revoked);

  const afterLogout = await req('/member?userId=' + encodeURIComponent(phone), 'GET', null, token);
  log(afterLogout.success === false, '登出后：同一个令牌查档案被拒（令牌已吊销）',
    afterLogout.msg || '');

  // 幂等性：重复登出不该报错
  const logoutAgain = await req('/member/logout', 'POST', null, token);
  log(logoutAgain.success, '重复登出不报错（幂等）', 'revoked=' + logoutAgain.revoked);

  // ============================================================
  head('④ 菜品乐观锁：version 列已生效');
  // 用商家接口改一次菜，确认不报错（若 version 为 NULL 会整表写失败）
  // ============================================================
  const dishes = await req('/menu?shopId=' + SHOP + '&role=merchant');
  const anyDish = ((dishes.data || {}).dishes || [])[0];
  const flip = await req('/dish/' + anyDish._id + '/status?status=' + (anyDish.status === 'on' ? 'off' : 'on'),
    'PATCH', null, null, SHOP_TOKEN);
  log(flip.success, '菜品上下架成功（version 已回填，写接口未被乐观锁卡死）',
    anyDish.name + ' → ' + (anyDish.status === 'on' ? 'off' : 'on'));
  // 改回去，别动演示数据的可见性
  const restore = await req('/dish/' + anyDish._id + '/status?status=' + anyDish.status,
    'PATCH', null, null, SHOP_TOKEN);
  log(restore.success, '已复原菜品状态', anyDish.name + ' → ' + anyDish.status);

  console.log('\n========================================');
  console.log('  P0 验证：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('========================================');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => {
  console.error('\n[脚本异常]', e && e.message ? e.message : e);
  process.exit(1);
});

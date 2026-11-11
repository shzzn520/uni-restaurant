/**
 * 2026-11-05 收尾改动专项验证（需后端运行在 8080）。
 *
 * 覆盖四类本轮新增/重构行为：
 *   ① 可选分页：不传 page/size = 全量（兼容旧前端），传了才切片，越界返回空
 *   ② AdminController.stats 单次遍历重构后，返回结构与聚合口径仍完整
 *   ③ 未映射路径不再被误报成「服务器内部错误」
 *   ④ 根路径返回服务入口页且带 no-store
 *
 * 用 127.0.0.1 而非 localhost：浏览器侧 localhost 这个源曾残留 Service Worker，
 * 但 Node 直连不受影响；统一用 IP 也避免任何代理干扰。
 */
const BASE = 'http://127.0.0.1:8080';
let pass = 0, fail = 0;

function log(ok, name, detail) {
  (ok ? pass++ : fail++);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  ' + detail : ''));
}

async function get(path, headers) {
  const r = await fetch(BASE + path, { headers: headers || {} });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch (e) { body = text; }
  return { status: r.status, headers: r.headers, body, raw: text };
}

(async () => {
  try {
    // ---------- ① 可选分页 ----------
    console.log('\n========== 1. 列表可选分页 ==========');
    const full = await get('/api/review?shopId=demo-shop');
    const p1 = await get('/api/review?shopId=demo-shop&page=1&size=2');
    const p9 = await get('/api/review?shopId=demo-shop&page=999&size=2');
    const n = (full.body.data || []).length;
    log(full.success !== false, '评价列表不传分页参数可正常返回', n + ' 条');
    log(n === 0 || (p1.body.data || []).length === Math.min(2, n),
      '不传 = 全量、传 page=1&size=2 = 最多 2 条', '全量 ' + n + ' → 切片 ' + (p1.body.data || []).length);
    log(Array.isArray(p9.body.data) && p9.body.data.length === 0,
      '越界页返回空列表（便于上拉加载判空结束）');

    // 用真实有评价的菜品，避免「0 条 → 0 条」这种等于没验的弱断言
    const firstDish = (full.body.data || [])[0] && full.body.data[0].dishId;
    const dishFull = await get('/api/review/byDish?dishId=' + encodeURIComponent(firstDish || ''));
    const dishPage = await get('/api/review/byDish?dishId=' + encodeURIComponent(firstDish || '') + '&page=1&size=1');
    const dishN = (dishFull.body.data || []).length;
    log(dishN > 0, '选中的菜品确有评价数据（保证切片断言有效）', firstDish + ': ' + dishN + ' 条');
    log(Array.isArray(dishPage.body.data) && dishPage.body.data.length === Math.min(1, dishN),
      'byDish 分页切片正确', dishN + ' → ' + (dishPage.body.data || []).length);

    const cpFull = await get('/api/complaint?shopId=demo-shop');
    const cpPage = await get('/api/complaint?shopId=demo-shop&page=1&size=1');
    log(Array.isArray(cpPage.body.data) && cpPage.body.data.length <= 1,
      '投诉列表分页生效', (cpFull.body.data || []).length + ' → ' + (cpPage.body.data || []).length);

    // 用演示账号（有 8 笔种子流水）而非新号，避免「0 条 → 0 条」的弱断言，
    // 也不产生额外的资产数据（只新增一条会话记录）。
    console.log('\n========== 2. 流水分页（需会员令牌） ==========');
    const phone = '13800001234';
    // 演示账号可能被其他脚本或手动验证在 60 秒内发过码。按服务端频控提示
    // 等待后重试（与 _e2e2.js 的 sendCode 同一套处理），不绕过规则、不改配置。
    async function sendDemoCode() {
      for (let i = 0; i < 4; i++) {
        const r = await fetch(BASE + '/api/member/send-code', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ phone })
        }).then(x => x.json());
        if (r.success && r.data && r.data.demoCode) return { res: r, code: r.data.demoCode };
        const m = /请 (\d+) 秒后重试/.exec(r.msg || '');
        if (!m) return { res: r, code: '' };
        await new Promise(s => setTimeout(s, (Number(m[1]) + 1) * 1000));
      }
      return { res: {}, code: '' };
    }
    const sentWrap = await sendDemoCode();
    const sent = sentWrap.res;
    const code = sentWrap.code;
    log(!!code, 'demo 模式可取到验证码（SMS_DEMO_MODE=true 已注入）', code || JSON.stringify(sent).slice(0, 80));
    if (code) {
      const login = await fetch(BASE + '/api/member/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone, code })
      }).then(r => r.json());
      const token = (login.data || {}).memberToken || '';
      if (token) {
        const h = { 'X-Member-Token': token };
        const tf = await get('/api/member/transactions?userId=' + phone, h);
        const tp = await get('/api/member/transactions?userId=' + phone + '&page=1&size=3', h);
        const txnN = (tf.body.data || []).length;
        log(txnN > 3, '演示账号流水多于 3 笔（切片断言有效）', txnN + ' 条');
        log(Array.isArray(tp.body.data) && tp.body.data.length === 3,
          '流水 size=3 正好返回 3 条', txnN + ' → ' + (tp.body.data || []).length);
      } else {
        log(false, '会员登录未返回令牌', JSON.stringify(login).slice(0, 120));
      }
    }

    // ---------- ② 统计重构 ----------
    console.log('\n========== 3. 统计接口（单次遍历重构） ==========');
    const st = await get('/api/admin/stats?shopId=demo-shop', { 'X-Shop-Token': 'demo1234' });
    const d = st.body.data || {};
    log(st.body.success === true, '统计接口返回成功');
    ['orderTotal', 'todayOrderCount', 'todayAmount', 'pendingCount', 'dishTotal', 'categoryTotal', 'statusCount', 'daily']
      .forEach(k => log(Object.prototype.hasOwnProperty.call(d, k), '字段存在：' + k));
    log(Array.isArray(d.daily) && d.daily.length === 7, 'daily 恰好 7 天');
    log(Array.isArray(d.daily) && d.daily.every(x => x.date && x.orderCount !== undefined
        && x.amount !== undefined && x.statusCount), '每天都有 date/orderCount/amount/statusCount');
    const daySum = (d.daily || []).reduce((a, x) => a + (x.orderCount || 0), 0);
    log(daySum <= (d.orderTotal || 0), '7 天订单数不超过总订单数（窗口口径自洽）',
      '窗口 ' + daySum + ' / 总计 ' + d.orderTotal);

    // ---------- ③ ④ 路径语义 ----------
    console.log('\n========== 4. 根路径与未映射路径 ==========');
    const root = await get('/');
    log(root.raw.includes('餐厅扫码点单系统'), '根路径返回服务入口页');
    log((root.headers.get('cache-control') || '').includes('no-store'), '入口页带 Cache-Control: no-store');
    const missing = await get('/api/definitely-not-exist');
    log(missing.body && missing.body.msg === '接口不存在或路径错误',
      '未映射路径不再误报「服务器内部错误」', missing.body && missing.body.msg);
  } catch (e) {
    fail++;
    console.log('  [脚本异常] ' + (e && e.message ? e.message : String(e)));
  }

  console.log('\n========================================');
  console.log('  11-05 专项：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('========================================');
  process.exit(fail ? 1 : 0);
})();

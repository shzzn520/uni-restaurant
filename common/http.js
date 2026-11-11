// ===============================================================
// common/http.js —— 调用本地 Spring Boot 后端的适配层
// ===============================================================
// 作用：把小程序原来的「云函数 action」翻译成 REST 接口。
//
// 为什么要这一层？
//   页面里写的是 call('cloudMenu', 'getShopMenu', {...})，
//   这种「模块名 + action」的调用方式与数据源无关。
//   这里把同样的调用翻译成 HTTP 请求，返回结构也保持一致，
//   于是页面代码一行都不用改，就能从「本地模拟」切到「真后端」。
//
// 后端接口一览（详见 restaurant-server/README.md）：
//   GET    /api/shop?shopId=
//   GET    /api/shop/list
//   POST   /api/shop/init-demo
//   GET    /api/menu?shopId=&role=
//   GET    /api/combo?shopId=          ← 1+1 随心配套餐分区数据
//   POST   /api/dish            PUT /api/dish/{id}    DELETE /api/dish/{id}
//   PATCH  /api/dish/{id}/status?status=
//   POST   /api/category        DELETE /api/category/{id}
//   POST   /api/order    GET /api/order    GET /api/order/{id}
//   POST   /api/order/quote            ← 下单前试算优惠（无副作用）
//   POST   /api/order/{id}/pay     PATCH /api/order/{id}/status?status=
//   GET    /api/coupon/templates   GET /api/coupon/my   POST /api/coupon/claim
//   POST   /api/member/send-code       ← 发送手机登录验证码（演示模式回传 demoCode）
//   POST   /api/member/login           ← 手机号 + 验证码登录，返回会员档案与会话令牌
//   GET    /api/member   POST /api/member/recharge
//   POST   /api/review   GET /api/review   GET /api/review/byDish   GET /api/review/summary
// ===============================================================

const config = require('./config.js');
const session = require('./session.js');

const BASE = config.apiBase;
const DEFAULT_SHOP = 'demo-shop';

/**
 * 发起请求的底层封装
 * @param {string} url    以 / 开头的接口路径
 * @param {string} method GET / POST / PUT / DELETE / PATCH
 * @param {object} body   请求体（GET/DELETE 时忽略）
 * @returns {Promise} 统一解析为后端返回的 JSON
 */
function request(url, method = 'GET', body, orderId) {
  return new Promise((resolve, reject) => {
    // 商户写接口需携带操作口令（X-Shop-Token）；读取类接口忽略即可
    const header = { 'content-type': 'application/json' };
    const token = uni.getStorageSync('shopToken');
    if (token) header['X-Shop-Token'] = token;
    // 会员会话令牌：涉及余额/优惠券/券包的接口，服务端凭它认人，
    // 不认请求体里声称的 memberId。没有它就用不了任何会员权益。
    const mToken = uni.getStorageSync('memberToken');
    if (mToken) header['X-Member-Token'] = mToken;
    // 订单访问凭证：下单时服务端一次性下发，存在本机。
    // 带上它，游客订单也能被识别为本机下的单（2026-10-21 加）
    if (orderId) {
      const ownerKey = session.getOwnerKey(orderId);
      if (ownerKey) header['X-Order-Token'] = ownerKey;
    }
    uni.request({
      url: BASE + url,
      method: method,
      data: body || {},
      header: header,
      timeout: 8000,
      success(res) {
        // 后端异常已被 GlobalExceptionHandler 统一转成 {success:false,msg}
        if (res.data && res.data.success === false) {
          reject(res.data.msg || '请求失败');
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject('HTTP ' + res.statusCode);
          return;
        }
        resolve(res.data);
      },
      fail(err) {
        // 最常见的是后端没启动 / 地址写错
        reject('无法连接后端 ' + BASE + '，请确认后端已启动（' + (err.errMsg || '网络错误') + '）');
      }
    });
  });
}

/** 拼接查询串，过滤掉 undefined / null / 空串 */
function qs(obj) {
  const parts = [];
  Object.keys(obj).forEach(k => {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') {
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    }
  });
  return parts.length ? '?' + parts.join('&') : '';
}

// ===============================================================
// 各 action 的路由表
// key = "模块名/action"，与云函数保持一一对应
// ===============================================================
const routes = {
  // ---------------- 门店 ----------------
  'cloudShop/get': d =>
    request('/shop' + qs({ shopId: d.shopId })),

  // 门店列表（含地址/距离）：带 lat/lng 时后端实时算距并就近排序，
  // 供「门店定位栏 / 门店选择页」展示与切换（仿麦当劳外卖）
  'cloudShop/list': d =>
    request('/shop/list' + qs({ lat: d.lat, lng: d.lng })),

  // ---------------- 套餐（1+1 随心配） ----------------
  // 返回信封 {success,data:{name,price,zones:[{key,name,pick,dishes}]}}
  // 红区/白区复用 Category 实现，不额外建表，详见后端 ComboService
  'cloudCombo/get': d =>
    request('/combo' + qs({ shopId: d.shopId })),

  'cloudShop/login': d =>
    request('/auth/login', 'POST', { shopId: d.shopId, key: d.key }),

  'cloudShop/initDemo': () =>
    request('/shop/init-demo', 'POST'),

  // ---------------- 菜单与菜品 ----------------
  'cloudMenu/getShopMenu': d =>
    request('/menu' + qs({ shopId: d.shopId, role: d.role || 'customer' })),

  'cloudMenu/addDish': d =>
    // 后端 DishDto 是扁平结构，必须把 dish 字段摊平到顶层，且带上 shopId
    request('/dish', 'POST', Object.assign({ shopId: d.shopId || DEFAULT_SHOP }, d.data)),

  'cloudMenu/updateDish': d =>
    request('/dish/' + d.data._id, 'PUT', d.data),

  'cloudMenu/deleteDish': d =>
    request('/dish/' + d._id, 'DELETE'),

  'cloudMenu/toggleDish': d =>
    request('/dish/' + d._id + '/status' + qs({ status: d.status }), 'PATCH'),

  'cloudMenu/addCategory': d =>
    request('/category', 'POST', { shopId: d.shopId || DEFAULT_SHOP, name: d.name, sort: d.sort || 0 }),

  'cloudMenu/deleteCategory': d =>
    request('/category/' + d._id, 'DELETE'),

  // ---------------- 订单 ----------------
  'cloudOrder/create': d =>
    request('/order', 'POST', {
      shopId: d.shopId || DEFAULT_SHOP,
      tableNo: d.tableNo || '',
      note: d.note || '',
      // 会员与优惠券：只传「用哪个」，减免金额一律服务端算，不传任何金额字段
      memberId: d.memberId || '',
      memberCouponId: d.memberCouponId || '',
      useBalance: !!d.useBalance,
      usePoints: !!d.usePoints,
      items: d.items || [],
      // 配送方式（delivery=外卖 / pickup=自取）与收货信息。
      // 配送费不在前端传 —— 由服务端按「满 39 免、否则 5 元」计算
      deliveryType: d.deliveryType || 'pickup',
      receiver: d.receiver || '',
      phone: d.phone || '',
      address: d.address || '',
      // 期望配送时间（文案，如「立即送」或预约时段），仅外卖单有意义
      deliveryTime: d.deliveryTime || '',
      // 幂等键：防止网络超时后重试导致重复下单
      clientRequestId: d.clientRequestId || ''
    }).then(res => {
      // 访问凭证落本机：下单成功时服务端一次性下发 ownerKey，后续查单/取消/支付
      // 都靠它（X-Order-Token）——游客没有会员会话，只有这条路能认自己的单。
      // confirm.vue 也存了一份；这里在适配层统一存，双保险且幂等。
      if (res && res.success && res.ownerKey && res.orderId) {
        session.setOwnerKey(res.orderId, res.ownerKey);
      }
      return res;
    }),

  // 下单前试算优惠：结算页切换优惠券/余额开关时实时调，返回原价/券减/余额抵/实付
  'cloudOrder/quote': d =>
    request('/order/quote', 'POST', {
      shopId: d.shopId || DEFAULT_SHOP,
      memberId: d.memberId || '',
      memberCouponId: d.memberCouponId || '',
      useBalance: !!d.useBalance,
      usePoints: !!d.usePoints,
      items: d.items || [],
      deliveryType: d.deliveryType || 'pickup'
    }),

  'cloudOrder/pay': d =>
    request('/order/' + d.orderId + '/pay', 'POST', null, d.orderId),

  'cloudOrder/get': d =>
    request('/order/' + d.orderId, 'GET', null, d.orderId),

  'cloudOrder/list': d =>
    request('/order' + qs({
      shopId: d.shopId, status: d.status, tableNo: d.tableNo,
      page: d.page, size: d.size
    })),

  'cloudOrder/updateStatus': d =>
    request('/order/' + d.orderId + '/status' + qs({ status: d.status }), 'PATCH', null, d.orderId),

  // ---------------- 投诉/反馈 ----------------
  'cloudFeedback/create': d =>
    request('/complaint', 'POST', {
      shopId: d.shopId || DEFAULT_SHOP,
      orderId: d.orderId || '',
      dishId: d.dishId || '',
      dishName: d.dishName || '',
      reason: d.reason,
      detail: d.detail || ''
    }),

  'cloudFeedback/list': d =>
    request('/complaint' + qs({ shopId: d.shopId, orderId: d.orderId })),

  'cloudFeedback/stats': d =>
    request('/complaint/stats' + qs({ shopId: d.shopId })),

  // 商家把一条反馈标记为已处理（处理闭环）。后端受 X-Shop-Token 保护
  'cloudFeedback/handled': d =>
    request('/complaint/' + d.id + '/status' + qs({ status: 'handled' }), 'PATCH'),

  // ---------------- 优惠券 ----------------
  // 领券中心：券模板 + 我已领几张 + 是否还能领
  'cloudCoupon/templates': d =>
    request('/coupon/templates' + qs({ shopId: d.shopId, userId: d.userId })),

  // 我的券包：{ usable:[], used:[], expired:[] }
  'cloudCoupon/my': d =>
    request('/coupon/my' + qs({ shopId: d.shopId, userId: d.userId })),

  // 领一张券，返回持券记录 id
  'cloudCoupon/claim': d =>
    request('/coupon/claim' + qs({ couponId: d.couponId, userId: d.userId }), 'POST'),

  'cloudCoupon/adminList': d =>
    request('/admin/coupons' + qs({ shopId: d.shopId })),

  'cloudCoupon/adminCreate': d =>
    request('/admin/coupons', 'POST', d.data),

  'cloudCoupon/adminUpdate': d =>
    request('/admin/coupons/' + encodeURIComponent(d.id), 'PUT', d.data),

  'cloudCoupon/adminToggle': d =>
    request('/admin/coupons/' + encodeURIComponent(d.id) + '/status' + qs({ status: d.status }), 'PATCH'),

  // ---------------- 收货地址 ----------------
  // 地址身份仅由 X-Member-Token 决定；不把 memberId 放进查询串或请求体。
  'cloudAddress/list': () =>
    request('/member/addresses'),

  'cloudAddress/create': d =>
    request('/member/addresses', 'POST', d.data),

  'cloudAddress/update': d =>
    request('/member/addresses/' + encodeURIComponent(d.id), 'PUT', d.data),

  'cloudAddress/delete': d =>
    request('/member/addresses/' + encodeURIComponent(d.id), 'DELETE'),

  // ---------------- 售后退款申请 ----------------
  'cloudRefund/create': d =>
    request('/order/' + encodeURIComponent(d.orderId) + '/refund-request', 'POST', { reason: d.reason }, d.orderId),

  'cloudRefund/get': d =>
    request('/order/' + encodeURIComponent(d.orderId) + '/refund-request', 'GET', null, d.orderId),

  'cloudRefund/list': d =>
    request('/admin/refund-requests' + qs({ shopId: d.shopId, status: d.status })),

  'cloudRefund/decision': d =>
    request('/admin/refund-requests/' + encodeURIComponent(d.requestId) + '/decision', 'POST', {
      decision: d.decision,
      note: d.note || ''
    }),

  // ---------------- 会员（储值卡 + 积分） ----------------
  // 微信登录：前端 wx.login 的 code 换自定义登录态（openid 会员档案）
  'cloudMember/wxLogin': d =>
    request('/auth/wx-login', 'POST', { code: d.code }),

  // 发送登录验证码。顾客侧接口，不需要商户口令；
  // 仅后端演示模式可返回 demoCode；生产短信配置由服务端管理，不能放在客户端。
  'cloudMember/sendCode': d =>
    request('/member/send-code', 'POST', { phone: d.phone, scene: d.scene || 'login' }),

  // 手机号 + 短信验证码登录，返回会员档案。
  // 验证码由服务端校验（5 分钟有效、一次性、错 5 次作废），前端只负责传值。
  'cloudMember/login': d =>
    request('/member/login', 'POST', {
      phone: d.phone, code: d.code || '', nickname: d.nickname || ''
    }),

  'cloudMember/info': d =>
    request('/member' + qs({ userId: d.userId })),

  // 退出登录：吊销服务端会话令牌（2026-10-27 加）。
  // 此前登出只清本机 storage，服务端 session 仍有效 30 天 —— 令牌泄露后无法作废。
  // 操作主体是顾客自己，只认 X-Member-Token（http.js 会自动带上）。
  'cloudMember/logout': () =>
    request('/member/logout', 'POST'),

  // 充值：后端受 X-Shop-Token 保护
  'cloudMember/recharge': d =>
    request('/member/recharge' + qs({ userId: d.userId, amount: d.amount }), 'POST'),

  // 资产流水：余额/积分逐笔变动（顾客侧接口，凭 X-Member-Token 认人）
  'cloudMember/transactions': d =>
    request('/member/transactions' + qs({ userId: d.userId })),

  // ---------------- 菜品评价 ----------------
  'cloudReview/create': d =>
    request('/review', 'POST', {
      shopId: d.shopId || DEFAULT_SHOP,
      orderId: d.orderId || '',
      dishId: d.dishId || '',
      dishName: d.dishName || '',
      rating: d.rating,
      content: d.content || '',
      images: d.images || ''
    }),

  'cloudReview/list': d =>
    request('/review' + qs({ shopId: d.shopId, orderId: d.orderId })),

  // 某道菜的评价列表（顾客端菜品详情弹层用）。
  // 此前 mock 有、http 没有，切到真后端后评价永远为空且被 console.warn 吞掉，属静默失败。
  'cloudReview/byDish': d =>
    request('/review/byDish' + qs({ dishId: d.dishId })),

  // 评分汇总：{ avgRating, count, dishes:[{dishId,rating,count,latest}] }
  'cloudReview/summary': d =>
    request('/review/summary' + qs({ shopId: d.shopId })),

  // 商家回复评价（需商户口令；AuthInterceptor 只放行 PATCH/DELETE 这两条，
  // POST /review 是顾客发表评价，刻意不受保护）
  'cloudReview/reply': d =>
    request('/review/' + d._id + '/reply', 'PATCH', { reply: d.reply }),

  'cloudReview/deleteReply': d =>
    request('/review/' + d._id + '/reply', 'DELETE'),

  // ---------------- 经营统计 ----------------
  // 商家后台首页概览：订单总数 / 今日营业额 / 待接单 / 菜品分类数 / 状态分布 / 近 7 日趋势
  'cloudAdmin/stats': d =>
    request('/admin/stats' + qs({ shopId: d.shopId })),

  // 订单导出 CSV。走 .json 变体而不是 text/csv：
  // uni.request 会把响应当 JSON 解析，直接打 text/csv 会解析失败。
  // 浏览器想直接下载文件可用 /api/admin/orders/export（同一个生成函数）。
  'cloudAdmin/exportOrders': d =>
    request('/admin/orders/export.json' + qs({ shopId: d.shopId, from: d.from, to: d.to })),

  // ---------------- 限时抢购 ----------------
  // 与 common/mock.js 的 cloudFlash 同一组 action、同一套返回结构。
  // memberId 只在已登录时传；未登录留空，服务端按游客放行读接口、拒绝写接口。
  'cloudFlash/sessions': () =>
    request('/flash/sessions'),

  'cloudFlash/items': d =>
    request('/flash/items' + qs({ sessionId: d.sessionId, memberId: d.memberId })),

  'cloudFlash/item': d =>
    request('/flash/item' + qs({ id: d.id, memberId: d.memberId })),

  'cloudFlash/favorites': d =>
    request('/flash/favorites' + qs({ memberId: d.memberId })),

  'cloudFlash/toggleFavorite': d =>
    request('/flash/favorite', 'POST', { itemId: d.itemId, memberId: d.memberId }),

  'cloudFlash/coupons': d =>
    request('/flash/coupons' + qs({ memberId: d.memberId, amount: d.amount })),

  'cloudFlash/createOrder': d =>
    request('/flash/order', 'POST', {
      itemId: d.itemId, qty: d.qty, couponId: d.couponId,
      sessionId: d.sessionId, memberId: d.memberId
    }),

  'cloudFlash/orders': d =>
    request('/flash/orders' + qs({ memberId: d.memberId })),

  'cloudFlash/pay': d =>
    request('/flash/order/' + encodeURIComponent(d.orderId) + '/pay', 'POST',
      { memberId: d.memberId }),

  'cloudFlash/status': d =>
    request('/flash/order/' + encodeURIComponent(d.orderId) + '/status', 'PATCH',
      { memberId: d.memberId, status: d.status })
};

/**
 * 对外暴露的调用入口，与 common/mock.js 的 call 签名一致
 * @param {string} name   模块名：cloudShop / cloudMenu / cloudOrder
 * @param {string} action 动作名
 * @param {object} data   参数
 */
function call(name, action, data = {}) {
  const key = name + '/' + action;
  const handler = routes[key];

  if (!handler) {
    return Promise.reject('后端未实现该接口：' + key);
  }
  // 仅记录接口名称，不输出请求参数（可能包含收货人、电话和地址）
  console.log('[http] ->', key);

  return handler(Object.assign({ shopId: DEFAULT_SHOP }, data))
    .then(res => {
      console.log('[http] <-', key, 'success =', res && res.success);
      return res;
    })
    .catch(err => {
      console.error('[http] <-', key, '失败：', err);
      throw err;
    });
}

module.exports = { call, BASE };
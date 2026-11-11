// ===============================================================
// common/merchant.js —— 商家端登录守卫
// ===============================================================
// 背景（2026-10-21）：后端给 /api/admin/** 加了商户口令鉴权
// （经营统计、CSV 导出含经营数据与收货人隐私，不能匿名读）。
// 商家端页面此前**没有登录守卫**——直接 navigateTo 到「经营统计」
// 也能打开，只是接口返回「未授权」，页面显示一片空白/错误。
//
// 现在口径统一为：商家端 5 个页面（订单看板、订单详情、反馈、统计、菜单）
// 进入前先校验本地有没有 shopToken，没有就跳回商家登录页。
//
// 注意：
//   ① 这里只做「前端体验层」的守卫，真正的防护在后端（AuthInterceptor）。
//      前端守卫可被绕过，后端才是权威。
//   ② 顾客端不共用本文件 —— 顾客端与商家端是两套完全不同的身份。
//   ③ 登出时必须清 shopToken（见 logout()），否则守卫会误判为已登录。
// ===============================================================

/** 商家端登录页路径（子包内，路径不带前导斜杠） */
const LOGIN_PAGE = '/pages/merchant/login/login';

/**
 * 商家端是否已登录（本地有有效口令令牌）。
 * @returns {boolean}
 */
function isLogged() {
  const token = uni.getStorageSync('shopToken');
  return !!(token && String(token).trim());
}

/**
 * 商家端守卫：未登录则跳回登录页并返回 false。
 * 在页面的 onLoad / onShow 里调用，返回 false 时应立即 return，
 * 避免未登录状态继续发请求。
 *
 * @param {object} vm 页面实例（用于 toast）
 * @param {string} tip 提示文案
 * @returns {boolean} true = 已登录，可继续；false = 已跳转登录页
 */
function requireLogin(vm, tip) {
  if (isLogged()) return true;
  if (vm && typeof vm.$set === 'object') { /* 兼容 Vue2 实例，仅占位 */ }
  uni.showToast({ title: tip || '请先登录商家后台', icon: 'none' });
  // 用 redirectTo 而不是 navigateTo：避免在登录页上叠一层返回栈，
  // 商家登录后应该直接回到目标页，而不是先看到登录页再返回。
  setTimeout(() => {
    uni.redirectTo({ url: LOGIN_PAGE });
  }, 600);
  return false;
}

/**
 * 商家端退出登录：清掉口令令牌与门店 id。
 * 顾客端登录态（memberToken / userId）不受影响 —— 两套身份各自独立。
 */
function logout() {
  uni.removeStorageSync('shopToken');
  uni.removeStorageSync('m_shopId');
}

module.exports = { LOGIN_PAGE, isLogged, requireLogin, logout };

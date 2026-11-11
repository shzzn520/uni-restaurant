// ===============================================================
// common/session.js —— 会员身份与本地会话状态
// ===============================================================
// 小程序没有后端 session，登录态就落在 storage 里。
// 这里只做存取与派生计算，不发请求；
// 需要校验有效性时由页面用 cloudMember/info 去后端确认。
//
// 约定：userId 即后端会员主键 —— 手机号登录是手机号，
// 微信登录是 openid（后端 jscode2session 换取后作为 memberId 下发）。
// ===============================================================

/** 存储键：会员身份 */
const USER_KEY = 'memberId';
/** 存储键：会员档案缓存（含余额/积分，充值后需要刷新） */
const PROFILE_KEY = 'memberProfile';
/** 存储键：本次结算选中的优惠券（跨页保留，退回购物车不丢） */
const PICKED_COUPON_KEY = 'pickedCouponId';
/**
 * 存储键：会员会话令牌（登录后由服务端签发）。
 *
 * 为什么需要它：此前「会员身份」只是 storage 里的一个手机号字符串，
 * 请求时原样发给后端，任何人改一下 memberId 就能花别人的余额、烧别人的券。
 * 现在登录返回 memberToken，涉及资产的接口都带上它，服务端只认令牌。
 */
const MEMBER_TOKEN_KEY = 'memberToken';

/**
 * 取当前登录会员编号；未登录返回空串
 * @returns {string}
 */
function getUserId() {
  return uni.getStorageSync(USER_KEY) || '';
}

/**
 * 是否已登录
 * @returns {boolean}
 */
function isLogin() {
  return !!getUserId();
}

/**
 * 写入选中的券（结算页选完券，回列表再回来还能看到）
 * @param {string} couponId 持券记录 id，空串表示不使用
 */
function setPickedCoupon(couponId) {
  uni.setStorageSync(PICKED_COUPON_KEY, couponId || '');
}

/**
 * 取上次选中的券
 * @returns {string}
 */
function getPickedCoupon() {
  return uni.getStorageSync(PICKED_COUPON_KEY) || '';
}

/**
 * 缓存会员档案，避免会员中心每次进入都闪一下空白
 * @param {object} profile cloudMember/login 或 info 的返回
 */
function setProfile(profile) {
  uni.setStorageSync(PROFILE_KEY, profile || null);
}

/**
 * 读取缓存的会员档案，未登录返回 null
 * @returns {object|null}
 */
function getProfile() {
  return uni.getStorageSync(PROFILE_KEY) || null;
}

/**
 * 保存登录态。
 *
 * 登录后后端会在档案里带回 memberToken，这里连同 userId 一起落盘。
 * 只存手机号不存令牌等于没登录——服务端现在凭令牌认人。
 *
 * @param {string} userId   会员编号（手机号 / openid）
 * @param {object} profile  会员档案（可含 memberToken）
 */
function saveLogin(userId, profile) {
  uni.setStorageSync(USER_KEY, userId || '');
  if (profile) setProfile(profile);
  const token = profile && profile.memberToken;
  if (token) uni.setStorageSync(MEMBER_TOKEN_KEY, token);
}

/**
 * 取会话令牌；未登录返回空串
 * @returns {string}
 */
function getMemberToken() {
  return uni.getStorageSync(MEMBER_TOKEN_KEY) || '';
}

/**
 * 退出登录：清掉身份、档案与会话令牌。
 *
 * 刻意<b>不</b>清理已持有的优惠券 —— 券属于账号而非设备，
 * 换回来时重新登录就还能用；清了反而像把券吞了。
 */
function logout() {
  uni.removeStorageSync(USER_KEY);
  uni.removeStorageSync(PROFILE_KEY);
  uni.removeStorageSync(MEMBER_TOKEN_KEY);
}

/**
 * 自愈：清掉「有会员编号但没有会话令牌」的残缺登录态。
 *
 * <p>为什么要它：登录态由「memberId + memberToken」两半组成，缺了令牌，
 * 服务端 requireIdentity 一律按未登录处理，可界面还显示着已登录 ——
 * 用户看到的就是「明明登录了，却处处说我没登录」。
 *
 * <p>2026-10-16 就真出过这事：微信一键登录走的后端接口漏了签发令牌
 * （手机号登录那条路是签了的），于是微信登录进来的会员充值、查档案、查券包
 * 全被拒，而手机号登录一切正常。
 *
 * <p>存量用户的自愈：本地已经存着的这种残缺登录态，光靠修服务端救不回来
 * （memberToken 本来就没下发过），只能清掉让用户重登一次。清掉比留着强 ——
 * 留着就是个「看着已登录、实际什么都干不了」的假状态。
 *
 * @returns {boolean} 是否清理过（true 表示调用方可以提示用户重新登录）
 */
function healLoginState() {
  if (getUserId() && !getMemberToken()) {
    logout();
    return true;
  }
  return false;
}

// ===============================================================
// 订单访问凭证（2026-10-21 加）
// ===============================================================
// 下单时服务端返回一枚 ownerKey，前端存本机；之后查单/取消/支付时带回
// （X-Order-Token 头）。它解决的是「游客订单无人认领」的问题：
// 游客没有会员身份，订单 memberId 为空，光靠会员会话认不了单，
// 顾客自己都查不全地址、也取消不了。
//
// 存在 storage 的一个对象里，按 orderId 索引 —— 一个用户可能有多张单。
// 最多留最近 20 张，避免 storage 无限膨胀。

const OWNER_KEYS = 'orderOwnerKeys';
const OWNER_KEYS_MAX = 20;

/**
 * 记下某张单的访问凭证
 * @param {string} orderId 订单号
 * @param {string} key 下单接口返回的 ownerKey
 */
function setOwnerKey(orderId, key) {
  if (!orderId || !key) return;
  const all = uni.getStorageSync(OWNER_KEYS) || {};
  all[orderId] = key;
  const ids = Object.keys(all);
  if (ids.length > OWNER_KEYS_MAX) {
    // 超出上限时删掉最早插入的（对象键序即插入序）
    ids.slice(0, ids.length - OWNER_KEYS_MAX).forEach(k => delete all[k]);
  }
  uni.setStorageSync(OWNER_KEYS, all);
}

/**
 * 取某张单的访问凭证；没有返回空串
 * @param {string} orderId
 * @returns {string}
 */
function getOwnerKey(orderId) {
  if (!orderId) return '';
  const all = uni.getStorageSync(OWNER_KEYS) || {};
  return all[orderId] || '';
}

module.exports = {
  getUserId,
  isLogin,
  getProfile,
  setProfile,
  setPickedCoupon,
  getPickedCoupon,
  saveLogin,
  getMemberToken,
  logout,
  healLoginState,
  setOwnerKey,
  getOwnerKey
};
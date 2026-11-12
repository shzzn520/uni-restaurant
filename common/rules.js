// ===============================================================
// common/rules.js —— 业务规则的唯一实现（前端 mock 与页面共用）
// ===============================================================
// 为什么单独抽出来：
//   优惠券门槛、会员等级折扣、余额 80% 上限、积分抵现比例这些规则
//   以前散落在 common/mock.js 里，页面只能照抄数字写提示文案。
//   现在规则只在这里定义一次：
//     - mock.js 调用它计算金额；
//     - 页面调用它生成「满 39 免配送费」「每 100 分抵 1 元」等文案；
//     - tests/rules.test.js 直接对它做单元测试。
//
// 与后端 restaurant-server（CouponService / OrderService）保持同口径。
// 改规则时请同步后端常量，并跑 tests/rules.test.js 与 tests/_e2e_mock.js。
// ===============================================================

/** 单笔最多用余额支付实付的 80%，防止叠出 0 元单 */
const BALANCE_PAY_RATIO = 0.8;

/** 积分抵现：100 分抵 1 元，单笔最多抵应付金额的 20% */
const POINTS_PER_YUAN = 100;
const POINTS_PAY_RATIO = 0.2;

/** 会员等级：按累计消费分档，rate 为该等级折扣率 */
const LEVELS = [
  { min: 1000, name: '黑卡', rate: 0.85 },
  { min: 500, name: '金卡', rate: 0.9 },
  { min: 200, name: '银卡', rate: 0.95 },
  { min: 0, name: '普通会员', rate: 1 }
];

/** 外卖配送费：5 元，商品原价满 39 元免配送费；不参与任何优惠 */
const DELIVERY_FEE = 5;
const FREE_DELIVERY_THRESHOLD = 39;
const DELIVERY_EXTRA_MINUTES = 15; // 外卖在制作时间上追加的骑手配送时间
const DELIVERY_MAX_MINUTES = 60;

/** 金额统一保留两位小数，避免 0.1 + 0.2 的浮点尾巴出现在页面上 */
function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** 向下取整到分：等级折扣与积分抵扣都用它，宁可少减一分也不多减 */
function floor2(n) {
  // 加 1e-9 抵消浮点误差：100 * 0.1 在二进制里是 10.000000000000002，
  // 直接 floor 会得到 9.99；这个 epsilon 让整数结果不被误砍一分。
  return Math.floor((Number(n) || 0) * 100 + 1e-9) / 100;
}

/** 按累计消费取会员等级名 */
function levelOf(totalSpend) {
  const s = Number(totalSpend) || 0;
  for (const lv of LEVELS) {
    if (s >= lv.min) return lv.name;
  }
  return '普通会员';
}

/** 按等级名取折扣率；未知等级按原价（1.0）处理 */
function levelRate(level) {
  const hit = LEVELS.find(lv => lv.name === level);
  return hit ? hit.rate : 1;
}

/**
 * 优惠券实际减免额。
 * 最多减到剩 1 元，不把订单打成 0 元。
 */
function couponDiscount(orderAmount, couponAmount) {
  const total = Number(orderAmount) || 0;
  const cap = Math.max(0, total - 1);
  return money(Math.min(Number(couponAmount) || 0, cap));
}

/** 余额抵扣上限：基数是券后金额，单笔最多 80% */
function balanceCap(afterCoupon) {
  return money((Number(afterCoupon) || 0) * BALANCE_PAY_RATIO);
}

/**
 * 余额实际抵扣额：不超过余额，也不超过上限。
 * 返回 { usable, amount, reason }
 */
function quoteBalanceAmount(balance, afterCoupon) {
  const bal = Number(balance) || 0;
  if (bal <= 0) return { usable: false, amount: 0, reason: '余额为 0' };
  const amount = money(Math.min(bal, balanceCap(afterCoupon)));
  return { usable: true, amount, reason: '' };
}

/**
 * 积分实际抵现额。
 * 规则：100 分抵 1 元、按整元、单笔最多抵应付金额的 20%。
 * 返回 { usable, amount, pointsUsed, reason }
 */
function quotePoints(points, afterCoupon) {
  const owned = Number(points) || 0;
  if (owned < POINTS_PER_YUAN) {
    return { usable: false, amount: 0, pointsUsed: 0, reason: '积分不足 ' + POINTS_PER_YUAN + '，暂时不能抵扣' };
  }
  const cap = Math.floor((Number(afterCoupon) || 0) * POINTS_PAY_RATIO); // 上限取整元
  const byPoints = Math.floor(owned / POINTS_PER_YUAN);                 // 持有积分能换几元
  const used = Math.min(byPoints, cap);
  if (used <= 0) {
    return { usable: false, amount: 0, pointsUsed: 0, reason: '本单金额较小，积分可抵金额不足 1 元' };
  }
  return { usable: true, amount: used, pointsUsed: used * POINTS_PER_YUAN, reason: '' };
}

/** 会员等级折扣：基数取券后金额，券的让利不再被折扣折一次 */
function quoteLevel(totalSpend, afterCoupon) {
  const level = levelOf(totalSpend);
  const rate = levelRate(level);
  const amount = Math.max(0, floor2((Number(afterCoupon) || 0) * (1 - rate)));
  return { level, rate, amount };
}

/** 配送费：仅外卖且未满免送门槛才收 */
function deliveryFeeOf(deliveryType, goodsTotal) {
  if (deliveryType !== 'delivery') return 0;
  return Number(goodsTotal) >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE;
}

/** 外卖送达预估：制作时间 + 骑手配送时间，封顶 60 分钟 */
function deliveryWaitMinutes(cookMinutes) {
  return Math.min(DELIVERY_MAX_MINUTES, (Number(cookMinutes) || 0) + DELIVERY_EXTRA_MINUTES);
}

module.exports = {
  BALANCE_PAY_RATIO,
  POINTS_PER_YUAN,
  POINTS_PAY_RATIO,
  LEVELS,
  DELIVERY_FEE,
  FREE_DELIVERY_THRESHOLD,
  DELIVERY_EXTRA_MINUTES,
  DELIVERY_MAX_MINUTES,
  money,
  floor2,
  levelOf,
  levelRate,
  couponDiscount,
  balanceCap,
  quoteBalanceAmount,
  quotePoints,
  quoteLevel,
  deliveryFeeOf,
  deliveryWaitMinutes
};
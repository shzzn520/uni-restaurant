// common/format.js —— 订单状态与金额格式化
// 订单状态机：unpaid(待支付) -> paid(已支付/待接单) -> preparing(备餐中) -> done(已完成)
// canceled(已取消) 为终态
const STATUS_TEXT = {
  unpaid: '待支付',
  paid: '已支付·待接单',
  preparing: '备餐中',
  done: '已完成',
  delivering: '配送中',
  delivered: '已送达',
  canceled: '已取消'
};

// 状态排序，用于进度条计算
// 外卖单在 done（已出餐）之后追加 delivering（配送中）/ delivered（已送达）两个物流环节
const STATUS_ORDER = ['unpaid', 'paid', 'preparing', 'done', 'delivering', 'delivered', 'canceled'];

// 金额格式化：分 -> 元，保留两位小数
function yuan(n) {
  n = Number(n) || 0;
  return '¥' + n.toFixed(2);
}

// 时间戳 -> MM-DD HH:mm
function shortTime(t) {
  if (!t) return '';
  const d = new Date(t);
  const p = n => (n < 10 ? '0' : '') + n;
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 顾客投诉原因选项（顾客端 actionSheet / 商家端展示共用）
// 注意：微信 showActionSheet 最多 6 项，故不超过 6 个
const FEEDBACK_REASONS = ['味道不好', '太咸', '太淡', '不新鲜', '分量少', '其他'];

module.exports = { STATUS_TEXT, STATUS_ORDER, yuan, shortTime, FEEDBACK_REASONS };
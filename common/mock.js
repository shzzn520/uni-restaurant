// common/mock.js —— 本地模拟数据层
// 作用：在未开通云开发时，用本地缓存(uni.storage)模拟云函数，跑通完整业务流。
// 通过 config.js 的 useMock 开关由 utils/cloud.js 路由过来。
// 数据结构与真实云函数保持一致（shops/categories/dishes/orders）。
// v4：新增优惠券、会员储值、菜品评价三块数据，与后端 CouponService 同一套规则。
// 数据结构变了，换 key 自动重建，避免旧缓存缺字段。
// v4→v5：新增订单/评价/投诉/会员的演示数据播种。
// 旧库里这些集合是空数组，只加播种逻辑不够——必须换键让 load() 走一遍重建，
// 否则老用户（含开发者自己反复调试的缓存）看到的仍是空白看板。
// v5→v6：订单里新增 levelDiscount / pointsPay（会员等级折扣与积分抵现），
// 演示数据也相应带上。旧库里这两列是 undefined，商家端导出的 CSV 与统计会缺列，
// 因此必须换键让 load() 走一遍重建。
// 升键时记得同步测试脚本里硬编码的 'mock_db_vN'（历史上漏改过一次，读到 undefined 直接抛异常）。
const STORE_KEY = 'mock_db_v15'; // 本地缓存键（v15：麻辣小龙虾/黄金流沙包/板烧鸡腿堡 从菜单移除，seed 结构变更必须升版）
const SHOP_ID = 'demo-shop';    // 演示店铺 ID
const session = require('./session.js');

const rules = require('./rules.js');
// 金额与业务规则统一走 common/rules.js，避免 mock 与页面各写一套
const {
  BALANCE_PAY_RATIO, POINTS_PER_YUAN, POINTS_PAY_RATIO,
  money, deliveryFeeOf, deliveryWaitMinutes
} = rules;

/** 兼容旧调用：mock 内部传会员对象，规则层只认累计消费 */
function levelOf(member) {
  return rules.levelOf(member && member.totalSpend);
}
function levelRate(level) {
  return rules.levelRate(level);
}

function levelBenefit(level) {
  const r = levelRate(level);
  if (r >= 1) return '累计消费满 ¥200 升银卡，享 95 折';
  const zhe = Math.round(r * 10);
  if (r <= 0.85) return '最高等级，享 ' + zhe + ' 折';
  return '已享 ' + zhe + ' 折';
}

// ---- 会员资产流水（与后端 MemberTransactionService 的类型/文案逐字同源）----
// 每一笔余额/积分变动都记一条：充值、下单抵扣、积分抵现、消费赠分、
// 取消订单的退余额/退积分/收积分。前端流水页按 type 匹配图标颜色，按 remark 显示文字。
const TXN = {
  recharge: '充值',
  consume: '余额抵扣',
  points_pay: '积分抵现',
  earn: '消费赠分',
  refund: '取消订单退余额',
  refund_points: '退回抵扣积分',
  reclaim_points: '收回奖励积分'
};

// 流水时间戳游标：保证同一会员的连续记账严格递增（与后端 nextStamp 同思路）。
// 取消订单连记三笔（退余额/退积分/收积分）都发生在同一毫秒，时间戳相同则
// 倒序查询时顺序不稳定，账单页按「首笔=最新」取快照会拿到倒数第二笔的旧值。
let lastTxnAt = 0;
function nextTxnStamp() {
  const now = Date.now();
  lastTxnAt = now > lastTxnAt ? now : lastTxnAt + 1;
  return lastTxnAt;
}

/**
 * 记一笔会员资产流水。必须在余额/积分改动之后调用：
 * 快照（balanceAfter/pointsAfter）取调用时刻的真实值，也就是这笔变动后的结果。
 * @returns {object} 记下的流水（null 表示会员不存在，调用方无需关心）
 */
function recordTxn(db, memberId, type, amount, points, orderId) {
  const m = db.members[memberId];
  if (!m) return null;
  const t = {
    _id: 'mt' + (db.seq++),
    memberId,
    type,
    amount: money(amount || 0),          // 余额变动（元，正入负出）
    points: Math.round(points || 0),     // 积分变动（正入负出）
    balanceAfter: money(m.balance),      // 变动后快照：对账就看这一列
    pointsAfter: m.points || 0,
    orderId: orderId || '',
    remark: TXN[type] || type,
    createTime: nextTxnStamp()
  };
  db.memberTransactions = db.memberTransactions || [];
  db.memberTransactions.unshift(t);
  return t;
}

// 门店列表：与后端 DataSeeder 保持一致，供「门店定位栏」展示与切换。
// latitude/longitude 为 GCJ-02 坐标（广州市天河区），cloudShop/list 带定位时
// 用与后端 ShopController 完全相同的 haversine 公式实时算距 —— 两端必须同源。
const SHOP_LIST = [
  { _id: 'demo-shop',     name: '麦当劳（天河北路店）',   address: '天河区天河北路 233 号 1F', distance: '1.2km', latitude: 23.1443, longitude: 113.3246 },
  { _id: 'shop-tiyuxi',   name: '麦当劳（体育西路店）',   address: '天河区体育西路 101 号',    distance: '2.8km', latitude: 23.1328, longitude: 113.3222 },
  { _id: 'shop-zhujiang', name: '麦当劳（珠江新城店）',   address: '天河区珠江东路 12 号',     distance: '4.5km', latitude: 23.1190, longitude: 113.3230 }
];

/**
 * haversine 球面直线距离（km）—— 与后端 ShopController.haversineKm 逐字同源。
 * 两端公式若有出入，mock 模式与后端模式展示的「距你 x km」就会对不上。
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371.0;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** 距离文案：1km 内按米、超出按公里 1 位小数 —— 与后端 distanceText 同规则 */
function distanceText(km) {
  if (km < 1) return Math.round(km * 1000) + 'm';
  return km.toFixed(1) + 'km';
}

/**
 * 门店列表加工：带定位时附加实时距离并按「距你最近」升序（仿 i麦当劳门店选择）。
 * 无定位 / 门店缺坐标时保持原序，前端用静态 distance 文案兜底。
 */
function locateShops(shops, lat, lng) {
  if (lat === undefined || lng === undefined || lat === null || lng === null) return shops;
  const items = shops.map(s => {
    const out = Object.assign({}, s);
    if (s.latitude !== undefined && s.latitude !== null) {
      const km = haversineKm(Number(lat), Number(lng), s.latitude, s.longitude);
      out.distanceKm = km;
      out.distanceText = distanceText(km);
    }
    return out;
  });
  items.sort((a, b) => {
    if (a.distanceKm === undefined) return 1;
    if (b.distanceKm === undefined) return -1;
    return a.distanceKm - b.distanceKm;
  });
  return items;
}

// 1+1 随心配一口价，红白区任选其一，无差价
const COMBO_NAME = '1+1 随心配';
const COMBO_PRICE = 12;
const ZONE_RED = '红区';
const ZONE_WHITE = '白区';

// 订单状态机：与后端 OrderService.allowedNext 同一张表（按配送方式区分自取/外卖终态）。
// 外卖单 done 之后还要 delivering（配送中）→ delivered（已送达）两个物流状态；
// 自取单 done 即终态（顾客到店取餐，没有后续物流）。
// 提到模块级是为了让 updateStatus 与 pay 共用同一套校验——原先只有 updateStatus 校验，
// pay 直接置 paid，导致已完成的订单也能「再付一次」并重复累计积分。
function allowedNextStatus(from, deliveryType) {
  const delivery = deliveryType === 'delivery';
  switch (from) {
    case 'unpaid':     return ['paid', 'canceled'];
    case 'paid':       return ['preparing', 'canceled'];
    case 'preparing':  return ['done', 'canceled'];
    case 'done':       return delivery ? ['delivering'] : [];
    case 'delivering': return delivery ? ['delivered'] : [];
    case 'delivered':  return [];
    case 'canceled':   return [];
    default:           return null;
  }
}

// 状态中文名，**逐字对齐后端 OrderService.statusText**，只用于导出 CSV。
//
// 为什么不复用 common/format.js 的 STATUS_TEXT：两者文案本来就有差异
// （format.js 是「已支付·待接单」「备餐中」，后端是「已支付/待接单」「制作中」），
// 那是界面用语可以各自斟酌；但导出的 CSV 是拿去对账的，mock 与后端导出的文件
// 必须逐格相同，否则课堂切换数据源时两张表对不上。改这里必须同步改后端。
const STATUS_LABEL = {
  unpaid: '待支付',
  paid: '已支付/待接单',
  preparing: '制作中',
  done: '已完成',
  delivering: '配送中',
  delivered: '已送达',
  canceled: '已取消'
};

// 菜品图片表：**以菜名为键**，而不是靠数组下标与播种顺序对齐。
//
// 为什么不用数组：播种数组 raw 的排列是「主食→饮品→小吃→热销」（书写时按分类分组），
// 图片若也用数组，迟早会因为任一侧增删或调序而整体错位。
// 曾经就错过一次——raw 里第 0 个是「招牌牛肉面」，却取到了 IMAGES[0]=麻辣小龙虾的图，
// 9 个真实菜品全部图文不符。菜名做键之后，这个 bug 在结构上就不可能再发生。
//
// 前 17 张为 jpg 实拍图（顾客端菜单列表），后 6 张为透明分层 PNG（仅供套餐页做伪 3D 叠加）
const IMAGES = {
  // —— 真实实拍图 ——
  '麻辣小龙虾':   'd0-mala-crayfish.jpg',
  '黄金流沙包':   'd1-custard-bun.jpg',
  '招牌牛肉面':   'd2-beef-noodle.jpg',
  '黄焖鸡米饭':   'd3-braised-chicken-rice.jpg',
  '宫保鸡丁饭':   'd4-kungpao-chicken.jpg',
  '可乐':         'd5-cola.jpg',
  '鲜榨橙汁':     'd6-orange-juice.jpg',
  '薯条':         'd7-fries.jpg',
  '招牌烤翅':     'd8-chicken-wings.jpg',
  // —— 2026-10-17 新增 8 个菜品（AI 生成实拍风配图，144px 压缩，单张 ≤6KB，文件名下标=菜品下标）——
  '板烧鸡腿堡':   'd15-grilled-chicken-burger.jpg',
  '台式卤肉饭':   'd16-braised-pork-rice.jpg',
  '酸菜鱼面':     'd17-fish-noodle-soup.jpg',
  '柠檬红茶':     'd18-lemon-black-tea.jpg',
  '香芋奶茶':     'd19-taro-milk-tea.jpg',
  '葡式蛋挞':     'd20-egg-tarts.jpg',
  '黄金洋葱圈':   'd21-onion-rings.jpg',
  '香甜玉米杯':   'd22-corn-cup.jpg',
  // —— 2026-11-12 新增 12 道国宴菜（AI 生成实拍风配图，144px 压缩，单张约 5KB）——
  '开水白菜':     'd23-kai-shui-bai-cai.jpg',
  '蟹粉狮子头':   'd24-crab-meat-lion-head.jpg',
  '松鼠桂鱼':     'd25-squirrel-mandarin-fish.jpg',
  '龙井虾仁':     'd26-longjing-shrimp.jpg',
  '东坡肉':       'd27-dongpo-pork.jpg',
  '干焖大虾':     'd28-braised-prawns.jpg',
  '葱烧海参':     'd29-scallion-sea-cucumber.jpg',
  '鸡汁煮干丝':   'd30-chicken-tofu-shreds.jpg',
  '文思豆腐':     'd31-wensi-tofu-soup.jpg',
  '北京烤鸭':     'd32-peking-duck.jpg',
  '桂花糯米藕':   'd33-osmanthus-lotus-root.jpg',
  '豌豆黄':       'd34-pea-cake.jpg',
  // —— 2026-11-12 新增 21 道异国风味菜（AI 生成实拍风配图，144px 压缩，单张约 3.3KB）——
  '关东煮':       'd35-oden.jpg',
  '三文鱼寿司':   'd36-salmon-sushi.jpg',
  '豚骨拉面':     'd37-tonkotsu-ramen.jpg',
  '石锅拌饭':     'd38-bibimbap.jpg',
  '韩式炸鸡':     'd39-korean-fried-chicken.jpg',
  '部队锅':       'd40-budae-jjigae.jpg',
  '冬阴功汤':     'd41-tom-yum-goong.jpg',
  '泰式菠萝炒饭': 'd42-thai-pineapple-fried-rice.jpg',
  '越南牛肉河粉': 'd43-vietnamese-beef-pho.jpg',
  '海南鸡饭':     'd44-hainanese-chicken-rice.jpg',
  '黄油咖喱鸡':   'd45-butter-chicken.jpg',
  '玛格丽特披萨': 'd46-margherita-pizza.jpg',
  '墨西哥牛肉塔可': 'd47-beef-tacos.jpg',
  '德式香肠拼盘': 'd48-german-sausage-platter.jpg',
  '西班牙海鲜饭': 'd49-spanish-paella.jpg',
  '瑞士芝士火锅': 'd50-swiss-fondue.jpg',
  '葡萄牙烤沙丁鱼': 'd51-portuguese-sardines.jpg',
  '挪威烟熏三文鱼': 'd52-norwegian-salmon.jpg',
  '美式BBQ肋排':  'd53-american-bbq-ribs.jpg',
  '巴西烤肉拼盘': 'd54-brazilian-churrasco.jpg',
  '哥伦比亚炖鸡': 'd55-colombian-ajiaco.jpg',
  // —— 1+1 随心配套餐素材 ——
  '双层吉士汉堡': 'asset_beef_cheese_burger.png',
  '麦香鸡':       'asset_spicy_chicken_burger.png',
  '麦乐鸡(5块)':  'asset_chicken_nuggets.png',
  '小薯条':       'asset_medium_fries.png',
  '中杯可乐':     'asset_coke.png',
  '中杯雪碧':     'asset_sprite.png'
};

// 生成订单号：ORD + 日期 + 4 位随机
function genOrderNo() {
  const d = new Date();
  const pad = n => (n < 10 ? '0' : '') + n;
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `ORD${date}${rand}`;
}

/**
 * 生成订单访问凭证（与后端 OrderService.newOwnerKey 同规则）。
 *
 * <p>游客没有会员会话，订单 memberId 为空，靠它认「这是本机下的单」，
 * 否则游客单成了无主单：地址打码、也取消不了。
 */
function newOwnerKey() {
  return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)
    + Math.random().toString(16).slice(2);
}

// 取餐号：A + 当日三位流水号，与后端 OrderService.nextPickupNo 同规则
function nextPickupNo(db, shopId, isDelivery) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const todayStart = d.getTime();
  const cnt = (db.orders || []).filter(o => o.shopId === shopId && o.createTime >= todayStart).length;
  const seq = cnt + 1;
  // 只补前导零，seq 本身在末尾拼一次即可。
  // 前缀区分方式：A = 到店自取，B = 外卖配送（与后端 nextPickupNo 同规则）
  return (isDelivery ? 'B' : 'A') + (seq < 10 ? '00' : (seq < 100 ? '0' : '')) + seq;
}

// ===============================================================
// 预计等候时间（与后端 OrderService.estimateWaitMinutes 逐字同源）
//
// 规则：基础备餐 2 分钟 + 菜品件数 × 1 分钟，封顶 30 分钟。
// 取「件数」而不是「品类数」：5 份薯条确实比 1 份薯条 + 1 杯可乐更慢，
// 按件算才反映后厨真实工作量。封顶是防止超大单给出「两小时后可取」
// 这种反而没人信的数字。
// ===============================================================
const WAIT_BASE_MINUTES = 2;
const WAIT_MAX_MINUTES = 30;

function estimateWaitMinutes(items) {
  let count = 0;
  (items || []).forEach(it => { count += (Number(it && it.qty) || 0); });
  return Math.min(WAIT_MAX_MINUTES, WAIT_BASE_MINUTES + count);
}

// 优惠券模板：与后端 DataSeeder.seedCoupons() 播种的 4 张券保持一致
// [名称, 门槛, 减免额, 有效天数, 总量, 每人限领]
const COUPON_SEED = [
  ['新客首单立减 5 元', 0, 5, 30, 1000, 1],
  ['满 30 减 8', 30, 8, 15, 500, 1],
  ['满 60 减 20', 60, 20, 15, 200, 1],
  ['免配送费券', 0, 3, 7, 300, 1]
];

// 演示会员手机号：答辩时登录这个号，能直接看到余额、积分与已领的券
const DEMO_MEMBER_PHONE = '13800001234';

// ===============================================================
// 演示数据播种：订单 / 评价 / 投诉 / 会员
//
// 为什么必须单独种：菜单有种子，但 orders / reviews / complaints 初始都是空数组。
// 直接后果是首次进入演示时——商家端订单管理与反馈看板一片空白、顾客端「本桌订单」
// 是空状态、首页口碑卡片因 avgRating>0 不成立而不显示、会员没有余额积分等级可看。
// 答辩演示不能靠现场点几单凑数据，启动时就得有一批自洽的历史数据。
//
// 自洽性约束（否则 cloudReview / cloudFeedback / quoteCoupon 的校验会判为非法）：
//   · review 的 orderId 必须存在、该单 status 必须为 done、且订单 items 里得有这道菜
//   · 同一 (orderId, dishId) 只能有一条评价
//   · pickupNo 为 A+当日三位流水，同门店同一天不得重复
//   · 订单金额必须自洽：totalPrice = Σ price×qty，payAmount = totalPrice-优惠-余额
// ===============================================================
function seedDemoData(dishes, now) {
  const DAY = 86400000;

  // 取菜助手：按下标取库中真实菜品，保证 _id / name / price 与菜单完全一致
  const D = i => dishes[i];
  const line = (i, qty) => {
    const d = D(i);
    return { dishId: d._id, name: d.name, price: d.price, qty };
  };
  const sum = ls => ls.reduce((s, l) => s + l.price * l.qty, 0);
  const pad3 = n => (n < 10 ? '00' : (n < 100 ? '0' : '')) + n;

  // [距今小时, 桌号, 状态, 菜品行, 备注, 券减免, 余额抵扣, 外卖?]
  // 状态刻意铺开：待支付/待接单/备餐中/已完成/已取消都要有，
  // 这样进度条、状态徽标、取消态、取餐号隐藏逻辑在演示里都能被看到。
  // 桌号 1 安排两单，让默认桌号「本桌订单」页一进入就有内容。
  // 第 8 位为 1 表示外卖单（麦乐送模式）：无桌号、带收货信息、收配送费。
  // 两单刻意覆盖配送费两种情况：一单不满 39 收 5 元、一单满 39 免配送费。
  const spec = [
    [-74, '8', 'done',      [line(1,1), line(4,1), line(8,1)], '请尽快上',        0, 0],
    [-52, '3', 'canceled',  [line(2,1), line(5,1)],             '点错了',        0, 0],
    [-51, '7', 'done',      [line(0,1), line(3,1)],             '',              0, 0],
    [-50, '5', 'done',      [line(7,1), line(8,1)],             '多加点辣',      0, 0],
    [-28, '6', 'canceled',  [line(1,1)],                        '临时有事',      0, 0],
    [-27, '4', 'done',      [line(6,1), line(4,1)],             '打包',          0, 0],
    [-26, '2', 'done',      [line(0,2), line(3,2)],             '',              8, 0],
    [-2.2,'1', 'done',      [line(0,1), line(3,2)],             '少放辣',        0, 0],
    [-1.8,'2', 'done',      [line(1,1), line(4,1)],             '',              0, 0],
    [-1.4,'3', 'done',      [line(7,1), line(3,1)],             '',              0, 0],
    [-1.1,'3', 'preparing', [line(6,2), line(5,1)],             '',              0, 0],
    [-0.8,'5', 'paid',      [line(2,1), line(3,1)],             '不要葱',        0, 0],
    [-0.5,'1', 'paid',      [line(0,1), line(8,1)],             '',              0, 10],
    [-0.25,'8','unpaid',    [line(1,1), line(3,1)],             '',              0, 0],
    // 外卖演示单（放最后保证不改变既有行的下标：会员标记 i%3、积分单 i===3 都不动）
    [-0.9, '', 'done', [line(1,1), line(5,1)],  '放门口即可', 0, 0, 1],
    [-0.6, '', 'paid', [line(0,1), line(3,2)],  '到了打电话', 0, 0, 1]
  ];

  // 先按时间正序铺开，再按「同一天内第几单」分配取餐号，与 nextPickupNo 同规则
  const orders = spec.map((s, i) => {
    const [hoursAgo, tableNo, status, items, note, discount, balance, isDel] = s;
    const totalPrice = sum(items);
    const paid = status !== 'canceled';
    const discountAmount = paid ? discount : 0;
    const balancePay = paid ? balance : 0;
    // 外卖单字段（麦乐送模式）：配送费与后端 deliveryFeeOf 同公式
    const deliveryType = isDel ? 'delivery' : 'pickup';
    const deliveryFee = paid ? deliveryFeeOf(deliveryType, totalPrice) : 0;

    // 会员权益（等级折扣 + 积分抵现）也要出现在演示数据里，
    // 否则商家端「营业额」永远只体现券这一种让利，看不出会员体系的作用。
    // 挂在 i % 3 === 0 的会员单上（与下面的 memberId 同一条判据），银卡 95 折，
    // 基数取券后金额 —— 与后端 CouponService 同规则。
    // 外卖演示单刻意不算会员单（游客点外卖），避免改动演示会员的资产基线。
    const isMemberOrder = (i % 3 === 0 && !isDel);
    const afterCoupon = Math.round((totalPrice - discountAmount) * 100) / 100;
    const levelDiscount = (paid && isMemberOrder)
      ? Math.floor(afterCoupon * 0.05 * 100) / 100 : 0;
    const afterLevel = Math.round((afterCoupon - levelDiscount) * 100) / 100;
    // 只让一单用积分抵现（100 分抵 1 元、按整元），免得演示数据里到处是零头
    const pointsPay = (paid && i === 3 && afterLevel >= 10) ? 2 : 0;

    return {
      _id: 'oseed' + i,
      shopId: SHOP_ID,
      deliveryType,
      // 外卖收货信息：演示用的示例地址（不指向真实个人）
      receiver: isDel ? '演示顾客' : '',
      phone: isDel ? '13800001234' : '',
      address: isDel ? (i === 15 ? '天河区体育西路 101 号 2201 室' : '天河区天河北路 36 号 3 栋 502') : '',
      deliveryTime: isDel ? '立即送' : '',
      deliveryFee,
      tableNo,
      items,
      note,
      totalPrice,
      discountAmount,
      levelDiscount,
      balancePay,
      pointsPay,
      // 实付 = 优惠后应付 + 配送费（配送费不参与优惠，与后端 create 同规则）
      payAmount: Math.round((totalPrice - discountAmount - levelDiscount - balancePay - pointsPay + deliveryFee) * 100) / 100,
      memberCouponId: discountAmount > 0 ? 'mc-seed-used' : '',
      memberId: isMemberOrder ? DEMO_MEMBER_PHONE : '',
      status,
      orderNo: 'ORD20261012' + (1000 + i),
      pickupNo: '',              // 下面统一按天分配
      // 预计等候分钟：按件数算（与后端同公式），外卖单含骑手配送时间；
      // 演示订单一并带上，顾客端订单页对历史单也能展示一致的等候口径
      waitMinutes: isDel ? deliveryWaitMinutes(estimateWaitMinutes(items))
                         : estimateWaitMinutes(items),
      createTime: now - Math.round(-hoursAgo * 3600000)
    };
  }).sort((a, b) => a.createTime - b.createTime);

  const perDay = {};
  orders.forEach(o => {
    const d = new Date(o.createTime);
    d.setHours(0, 0, 0, 0);
    const k = d.getTime();
    perDay[k] = (perDay[k] || 0) + 1;
    // 前缀区分取餐方式：A = 到店自取，B = 外卖配送（与 nextPickupNo 同规则）
    o.pickupNo = (o.deliveryType === 'delivery' ? 'B' : 'A') + pad3(perDay[k]);
  });

  // ---- 评价：只挂到「已完成」订单的菜上，且一单一道菜只评一次 ----
  // [orders 中已完成单的下标, 该单 items 下标, 评分, 内容]
  const doneList = orders.map((o, i) => ({ o, i })).filter(x => x.o.status === 'done');
  const reviewSpec = [
    [0, 0, 5, '汤底很正宗，面条筋道，会再来'],
    [0, 1, 4, '冰镇够凉，解腻正好'],
    [1, 0, 5, '鸡肉嫩，酱汁下饭，分量足'],
    [2, 0, 4, '麻辣够劲，就是剥壳有点麻烦'],
    [3, 0, 3, '烤翅偏咸，希望改进'],
    [4, 0, 5, '第二次点了，味道稳定'],
    [5, 1, 5, '流沙包爆浆，甜度刚好']
  ];
  // 商家回复只给其中 2 条：一条是最低分那条（3 星「烤翅偏咸」，体现"差评有回应"），
  // 一条是高分（体现"好评也致谢"）。
  // 故意不全回，好让商家端「待回复」仍是真实存在的状态，答辩演示时能现场回一条。
  const seedReply = {
    4: '看到这条评价当天就复核了出品，已把腌料配比下调，出餐前加一道试味。欢迎再来尝尝改进后的。',
    6: '谢谢认可！流沙包每天现蒸现出，欢迎常来～'
  };

  const reviews = reviewSpec.map((r, i) => {
    const { o } = doneList[r[0]];
    const it = o.items[r[1]];
    return {
      _id: 'rvseed' + i,
      shopId: SHOP_ID,
      orderId: o._id,
      dishId: it.dishId,
      dishName: it.name,
      rating: r[2],
      content: r[3],
      images: '',
      userId: o.memberId || '',
      createTime: o.createTime + 1800000,
      reply: seedReply[i] || '',
      // 回复时间晚于评价，且只在真的有回复时才给时间戳
      replyTime: seedReply[i] ? o.createTime + 5400000 : 0
    };
  });

  // ---- 投诉：挂到真实订单的真实菜上，理由取自 FEEDBACK_REASONS ----
  // [orders 下标, items 下标, 理由, 详情, 是否已处理]
  const complaintSpec = [
    [doneList[3].i, 0, '太咸',   '烤翅腌料偏咸，建议减盐',        true],
    [doneList[2].i, 0, '分量少', '小龙虾看着多，肉不多',          false],
    [orders.length - 4, 0, '太淡', '宫保鸡丁饭味道偏淡',           false]
  ];
  const complaints = complaintSpec.map((c, i) => {
    const o = orders[c[0]];
    const it = o.items[c[1]];
    return {
      _id: 'cfseed' + i,
      shopId: SHOP_ID,
      orderId: o._id,
      dishId: it.dishId,
      dishName: it.name,
      reason: c[2],
      detail: c[3],
      createTime: o.createTime + 900000,
      status: c[4] ? 'handled' : 'new',
      handledAt: c[4] ? o.createTime + 3600000 : 0
    };
  });

  // ---- 会员：一个看得见余额/积分/等级的账号 ----
  const members = {
    [DEMO_MEMBER_PHONE]: {
      _id: DEMO_MEMBER_PHONE,
      phone: DEMO_MEMBER_PHONE,
      nickname: '老顾客',
      balance: 50,
      points: 320,
      totalSpend: 468,
      orderCount: 6,
      createTime: now - 30 * DAY
    }
  };

  // ---- 持券：两张未用 + 一张已用（已用的指向真实订单，便于会员中心对账）----
  // 字段名必须是 couponName（后端 MemberCoupon 同名字段，cloudCoupon/my 读的也是它）。
  // 此前写成 name，导致内置演示券在券包里名字全空白——只有现场领的新券才有名字。
  // getTime 是领取时间，券包按它倒序排；此前缺失会让排序比较器得到 NaN，排序失效。
  const memberCoupons = [
    {
      _id: 'mc-seed-1', userId: DEMO_MEMBER_PHONE, couponId: SHOP_ID + '-cp0',
      shopId: SHOP_ID, couponName: '新客首单立减 5 元', threshold: 0, amount: 5,
      getTime: now - 2 * DAY, expireAt: now + 30 * DAY, status: 'unused',
      useOrderId: '', useTime: 0
    },
    {
      _id: 'mc-seed-2', userId: DEMO_MEMBER_PHONE, couponId: SHOP_ID + '-cp1',
      shopId: SHOP_ID, couponName: '满 30 减 8', threshold: 30, amount: 8,
      getTime: now - 1 * DAY, expireAt: now + 15 * DAY, status: 'unused',
      useOrderId: '', useTime: 0
    },
    {
      // 已用的那张：useTime 必须早于阈值判断，且指向真实存在的订单 oseed6
      _id: 'mc-seed-used', userId: DEMO_MEMBER_PHONE, couponId: SHOP_ID + '-cp1',
      shopId: SHOP_ID, couponName: '满 30 减 8', threshold: 30, amount: 8,
      getTime: now - 3 * DAY, expireAt: now + 15 * DAY, status: 'used',
      useOrderId: 'oseed6', useTime: now - 26 * 3600000
    }
  ];

  // ---- 会员资产流水：与 members 演示账号的现值（余额 50 / 积分 320）严格对账 ----
  // 每笔金额都从上面的演示订单**程序化反推**（赠分=实付取整、积分抵现/余额抵扣=订单实扣），
  // 时间对齐订单的创建/支付时刻。
  // 曾经这里逐笔手写数字，订单种子一改（菜品调价 / 菜品池扩充）流水就和订单对不上——
  // 顾客在流水页一眼看穿「这单实付 53.2，流水怎么只赠 49 分」。改成反推后，
  // 只要订单种子自洽，流水永远自洽，不需要人跟着同步。
  // 会员单判据与上面 orders 一致：i % 3 === 0（oseed0/3/6/9/12）。
  const MP = DEMO_MEMBER_PHONE;
  const memberOrders = orders.filter(o => o.memberId === MP && o.status !== 'canceled');
  const earnedInWindow = memberOrders.reduce((s, o) => s + Math.floor(o.payAmount), 0);
  const spentInWindow = memberOrders.reduce((s, o) => s + Math.floor(o.pointsPay || 0) * POINTS_PER_YUAN, 0);
  const balanceUsed = memberOrders.reduce((s, o) => s + (o.balancePay || 0), 0);
  const firstMemberAt = memberOrders.length ? memberOrders[0].createTime : now - 5 * DAY;
  const PROFILE_BALANCE = 50;  // 与 members 表逐项一致（改这里必须同步改 members）
  const PROFILE_POINTS = 320;
  // 早期历史：早于演示订单窗口的消费赠分（无订单号）。
  // 由「档案现值 − 窗口内赠分 + 窗口内抵现」反推，重放后严格等于现值。
  const historyEarn = PROFILE_POINTS - earnedInWindow + spentInWindow;
  // 充值额 = 现值 + 窗口内抵扣：保证「充值 → 逐单抵扣」重放后余额等于现值
  const rechargeAmt = money(PROFILE_BALANCE + balanceUsed);
  const memberTransactions = [
    { _id: 'mt-seed-0', memberId: MP, type: 'earn', amount: 0, points: historyEarn,
      balanceAfter: 0, pointsAfter: historyEarn, orderId: '', remark: TXN.earn,
      createTime: firstMemberAt - 2 * DAY },
    { _id: 'mt-seed-1', memberId: MP, type: 'recharge', amount: rechargeAmt, points: 0,
      balanceAfter: rechargeAmt, pointsAfter: historyEarn, orderId: '', remark: TXN.recharge,
      createTime: firstMemberAt - 1 * DAY }
  ];
  // 窗口内：跟着每笔会员订单逐笔对账（支付时刻=下单+2 分钟，与订单状态推进一致）
  let seq = 2;
  let bal = rechargeAmt;
  let pts = historyEarn;
  memberOrders.forEach(o => {
    if (o.balancePay > 0) {
      bal = money(bal - o.balancePay);
      memberTransactions.push({ _id: 'mt-seed-' + seq++, memberId: MP, type: 'consume',
        amount: -o.balancePay, points: 0, balanceAfter: bal, pointsAfter: pts,
        orderId: o._id, remark: TXN.consume, createTime: o.createTime });
    }
    if (o.pointsPay > 0) {
      pts -= Math.floor(o.pointsPay) * POINTS_PER_YUAN;
      memberTransactions.push({ _id: 'mt-seed-' + seq++, memberId: MP, type: 'points_pay',
        amount: 0, points: -Math.floor(o.pointsPay) * POINTS_PER_YUAN, balanceAfter: bal,
        pointsAfter: pts, orderId: o._id, remark: TXN.points_pay, createTime: o.createTime });
    }
    const earn = Math.floor(o.payAmount);
    if (earn > 0) {
      pts += earn;
      memberTransactions.push({ _id: 'mt-seed-' + seq++, memberId: MP, type: 'earn',
        amount: 0, points: earn, balanceAfter: bal, pointsAfter: pts,
        orderId: o._id, remark: TXN.earn, createTime: o.createTime + 120000 });
    }
  });

  return { orders, reviews, complaints, members, memberCoupons, memberTransactions };
}

// 构造演示数据（3 门店 + 6 分类 + 17 菜品 ×3 门店 + 4 张券）
function buildSeed() {
  const now = Date.now();
  // 门店列表，含 address / distance 供定位栏展示
  const shops = SHOP_LIST.map(s => Object.assign({
    desc: '扫码点单门店 · 微信 uni-app 小程序 + Spring Boot + MySQL',
    logo: ''
  }, s));

  // 分类模板：c4/c5 为套餐分区（复用分类，不额外建表），c6 为 2026-11-12 新增的「国宴」正餐线
  const catTpl = [
    { name: '热销', sort: 0 },
    { name: '主食', sort: 1 },
    { name: '饮品', sort: 2 },
    { name: '小吃', sort: 3 },
    { name: ZONE_RED, sort: 4 },
    { name: ZONE_WHITE, sort: 5 },
    { name: '国宴', sort: 6 },
    { name: '异国风味', sort: 7 }
  ];
  // [名称, 价格, 分类下标, 描述]
  const raw = [
    ['招牌牛肉面', 28, 1, '秘制汤底，手工面条'],
    ['黄焖鸡米饭', 26, 1, '鸡肉鲜嫩，酱香浓郁'],
    ['宫保鸡丁饭', 24, 1, '经典川味，微辣'],
    ['可乐', 6, 2, '冰镇 330ml'],
    ['鲜榨橙汁', 12, 2, '无添加，现榨'],
    ['薯条', 10, 3, '黄金脆薯'],
    ['招牌烤翅', 18, 3, '秘制腌料，外焦里嫩'],
    // 分类号填 99 = 已从菜单移除（哨兵位，与后端 DataSeeder.DISH_ROWS 同源）。
    // 不删数组行是因为菜品 id 由下标决定，删行会让后面所有菜 id 前移：演示订单按下标
    // 取菜、套餐虚拟 ID 写死 d9@d13 会整片错位。填 99 后 categoryId 指向不存在的分类，
    // 前端按分类分组时自然不出现，而 id / 订单引用 / 图片全部不变。
    ['麻辣小龙虾', 68, 99, '夏季限定，麻辣鲜香'],   // 2026-11-12 按用户要求下架
    ['黄金流沙包', 14, 99, '爆浆流沙，招牌甜点'],   // 2026-11-12 按用户要求下架
    // ↓↓↓ 1+1 随心配套餐可选商品，一口价时不参与算价（price 置 0）
    ['双层吉士汉堡', 0, 4, '双片吉士两块纯牛肉饼'],
    ['麦香鸡', 0, 4, '鲜蔬搭配脆鸡排'],
    ['麦乐鸡(5块)', 0, 4, '鲜嫩开胃，激情开蘸'],
    ['小薯条', 0, 4, '外脆内软，经典标配'],
    ['中杯可乐', 0, 5, '吃堡神搭档，畅快过瘾'],
    ['中杯雪碧', 0, 5, '柠檬清香，沁润心底'],
    // ↓↓↓ 2026-10-17 新增 8 个菜品：补全「热销/主食/饮品/小吃」各线，可见菜品从 9 个扩到 17 个。
    // 刻意整体接在套餐分区之后追加，不打乱前 15 项的下标 —— seedDemoData 按下标取菜，
    // 且 _e2e_mock/_e2e2 的套餐虚拟 ID 写死了 d9@d13（双层吉士汉堡@中杯可乐），
    // 插在前面会让演示订单与套餐测试整片错位。块内顺序即下标顺序，图片文件名与之对齐。
    ['板烧鸡腿堡', 24, 99, '炭烤鸡腿排，秘制酱料'],  // 2026-11-12 按用户要求下架
    ['台式卤肉饭', 22, 1, '卤肉软糯，酱汁拌饭'],
    ['酸菜鱼面', 30, 1, '酸辣鱼片，手工面条'],
    ['柠檬红茶', 9, 2, '鲜柠檬现泡，冰爽回甘'],
    ['香芋奶茶', 13, 2, '芋香绵密，Q弹珍珠'],
    ['葡式蛋挞', 8, 3, '酥皮蛋香，现烤出炉'],
    ['黄金洋葱圈', 12, 3, '外脆内软，蘸酱更香'],
    ['香甜玉米杯', 7, 3, '清甜玉米粒，便携杯装'],
    // ↓↓↓ 2026-11-12 新增 12 道「国宴」菜（c6）：参照开国第一宴与钓鱼台国宴菜单，
    // 覆盖川/淮扬/苏/杭/鲁/京各帮口。与后端 DataSeeder.DISH_ROWS 的追加段**同序**，
    // 保证 d23~d34 在两端指向同一道菜；仍然只追加在末尾，不动前 22 项下标。
    ['开水白菜', 68, 6, '清汤澄澈，川菜国宴首菜'],
    ['蟹粉狮子头', 78, 6, '淮扬经典，松软即化'],
    ['松鼠桂鱼', 128, 6, '苏帮名菜，外酥里嫩'],
    ['龙井虾仁', 98, 6, '杭帮名菜，茶香清鲜'],
    ['东坡肉', 58, 6, '慢火细炖，酥而不散'],
    ['干焖大虾', 88, 6, '开国第一宴热菜，鲜香浓郁'],
    ['葱烧海参', 138, 6, '鲁菜经典，浓香软糯'],
    ['鸡汁煮干丝', 48, 6, '淮扬细作，汤鲜味醇'],
    ['文思豆腐', 42, 6, '刀工绝技，细如发丝'],
    ['北京烤鸭', 158, 6, '皮脆肉嫩，国宴常客'],
    ['桂花糯米藕', 32, 6, '江南甜品，桂花清香'],
    ['豌豆黄', 26, 6, '宫廷小吃，细腻清甜'],
    // ↓↓↓ 2026-11-12 新增 21 道「异国风味」菜（c7）：与后端 DataSeeder.DISH_ROWS 追加段**同序**，
    // 保证 d35~d55 在两端指向同一道菜。描述统一冠「国家 · 」，前端 .dish-desc（24rpx 灰色小字）
    // 天然把国家渲染成小字，无需加字段或改模板。仍然只追加在末尾，不动前面下标。
    // 价格口径与后端 DataSeeder.DISH_ROWS 同源：按各菜原产国当地菜单价折人民币核定（2026-11）。
    // 描述格式「国家 · 份量 · 口味」—— .dish-desc 是单行 ellipsis，份量必须排在口味之前才不会被截掉。
    ['关东煮', 28, 7, '日本 · 昆布高汤慢炖萝卜鱼丸'],
    ['三文鱼寿司', 58, 7, '日本 · 8贯 · 厚切三文鱼手捏醋饭'],
    ['豚骨拉面', 42, 7, '日本 · 浓白汤底配溏心蛋叉烧'],
    ['石锅拌饭', 38, 7, '韩国 · 滚烫石锅锅巴焦香'],
    ['韩式炸鸡', 52, 7, '韩国 · 整只1kg · 甜辣脆皮炸鸡'],
    ['部队锅', 68, 7, '韩国 · 2-3人份 · 午餐肉泡面锅'],
    ['冬阴功汤', 45, 7, '泰国 · 酸辣虾汤配香茅南姜'],
    ['泰式菠萝炒饭', 34, 7, '泰国 · 菠萝盅盛装腰果肉松'],
    ['越南牛肉河粉', 38, 7, '越南 · 牛骨清汤配生牛肉片'],
    ['海南鸡饭', 40, 7, '新加坡 · 鸡油饭配姜蓉'],
    ['黄油咖喱鸡', 55, 7, '印度 · 番茄奶油咖喱配烤饼'],
    ['玛格丽特披萨', 58, 7, '意大利 · 9寸 · 番茄罗勒水牛芝士'],
    ['墨西哥牛肉塔可', 38, 7, '墨西哥 · 3个 · 玉米饼夹牛肉莎莎'],
    ['德式香肠拼盘', 58, 7, '德国 · 酸菜土豆泥配烤肠'],
    ['西班牙海鲜饭', 98, 7, '西班牙 · 2人份 · 藏红花烩饭配虾贝'],
    ['瑞士芝士火锅', 88, 7, '瑞士 · 2-3人份 · 格鲁耶尔芝士蘸面包'],
    ['葡萄牙烤沙丁鱼', 52, 7, '葡萄牙 · 炭烤沙丁鱼挤柠檬'],
    ['挪威烟熏三文鱼', 68, 7, '挪威 · 冷熏三文鱼配莳萝'],
    ['美式BBQ肋排', 98, 7, '美国 · 半架6根 · 慢烤猪肋排烟熏酱'],
    ['巴西烤肉拼盘', 108, 7, '巴西 · 2人份 · 炭烤牛羊配木薯粉'],
    ['哥伦比亚炖鸡', 48, 7, '哥伦比亚 · 土豆玉米浓汤炖鸡']
  ];

  // 三门店共用同一套菜单（连锁门店菜单一致，与后端 DataSeeder 给 3 门店各插 17 菜同源）：
  // demo-shop 沿用历史 id（c0..c5 / d0..d16），保证套餐虚拟 ID「d9@d13」与既有 e2e 用例、
  // 订单种子按下标取菜不被打乱；其余门店加 shopId 前缀避免 _id 撞车。
  // 此前只有 demo-shop 有菜单数据，首页「就近推荐」一旦把运营 shopId 切到另外两家，
  // getShopMenu 按那个门店查就会返回空 —— 线上 H5 是 https，定位会真生效，于是普遍「没有菜单」。
  const categories = [];
  const dishes = [];
  SHOP_LIST.forEach(shop => {
    const isDemo = shop._id === SHOP_ID;
    catTpl.forEach((c, ci) => {
      categories.push({
        _id: isDemo ? ('c' + ci) : (shop._id + '-c' + ci),
        shopId: shop._id,
        name: c.name,
        sort: c.sort,
        createTime: now
      });
    });
    raw.forEach((r, i) => {
      dishes.push({
        _id: isDemo ? ('d' + i) : (shop._id + '-d' + i),
        shopId: shop._id,
        categoryId: isDemo ? ('c' + r[2]) : (shop._id + '-c' + r[2]),
        name: r[0],
        price: r[1],
        desc: r[3],
        // 真实美食实拍图（Pexels 免费图库，非 AI 生成），打包在 static/food/ 下。
        // 按菜名取图，不按下标——菜名写错会立刻暴露成 undefined，不会悄悄配错图
        image: '/static/food/' + (IMAGES[r[0]] || ''),
        status: 'on',
        createTime: now - i * 1000
      });
    });
  });

  // 演示订单/评价/投诉/会员只挂在 demo-shop（沿用既有演示数据，与历史下标/虚拟 ID 一致）
  const demoDishes = dishes.filter(d => d.shopId === SHOP_ID);
  // 本店真实存在的分类 id 集合。菜品 categoryId 不在其中 = 已从菜单移除（99 哨兵位）。
  const validCatIds = new Set(categories.filter(c => c.shopId === SHOP_ID).map(c => c._id));

  return {
    seq: 100,           // 自增序号，用于生成新 _id
    // 单店视图（cloudShop/get 用），补齐地址与距离字段
    shop: {
      _id: SHOP_ID,
      name: SHOP_LIST[0].name,
      address: SHOP_LIST[0].address,
      distance: SHOP_LIST[0].distance,
      latitude: SHOP_LIST[0].latitude,
      longitude: SHOP_LIST[0].longitude,
      desc: '扫码点单演示店铺（本地模拟模式）',
      logo: ''
    },
    shops,              // 门店列表（cloudShop/list 用）
    categories,
    dishes,
    // 订单/评价/投诉/会员：启动即播种，保证商家端看板与顾客端历史首次进入就有内容
    ...seedDemoData(demoDishes, now),
    coupons: COUPON_SEED.map((c, i) => ({
      _id: SHOP_ID + '-cp' + i,
      shopId: SHOP_ID,
      name: c[0],
      threshold: c[1],
      amount: c[2],
      validDays: c[3],
      totalQty: c[4],
      claimedQty: 0,
      perUserLimit: c[5],
      status: 'on',
      createTime: now - i * 1000
    })),
    // 限时抢购：从 demo-shop 的在售菜品生成活动商品（与后端 FlashSaleService.run 同源）。
    // 只取「分类仍然存在」且有真实售价的菜：挂到 99 哨兵位的菜已从菜单移除；
    // 0 元套餐料（双层吉士汉堡/麦香鸡/可乐等）单独不成餐，做成抢购商品会算出
    // 「原价 10 → 抢购价 1」这种假折扣，一并排除。
    flashItems: buildFlashSeed(dishes.filter(d =>
      d.shopId === SHOP_ID && d.status === 'on' && validCatIds.has(d.categoryId)
      && Number(d.price) > 0), now),
    flashOrders: [],
    favorites: []
    // memberCoupons / members 由上面的 seedDemoData 提供，不要再写空值覆盖
  };
}

// 读取本地库；无则初始化
function load() {
  let db = uni.getStorageSync(STORE_KEY);
  if (!db || !db.dishes) {
    db = buildSeed();
    uni.setStorageSync(STORE_KEY, db);
  }
  // 兼容旧数据：确保自增序号存在
  if (typeof db.seq !== 'number') db.seq = 100;
  // 兼容旧数据：投诉列表可能不存在
  if (!db.complaints) db.complaints = [];
  // 兼容旧数据：营销与会员三块数据是 v4 新增
  if (!db.reviews) db.reviews = [];
  if (!db.memberCoupons) db.memberCoupons = [];
  if (!db.members) db.members = {};
  // 兼容旧数据：资产流水是 v8 新增（老缓存里没有这张表）
  if (!db.memberTransactions) db.memberTransactions = [];
  // 兼容旧数据：短信验证码是手机号登录改造新增（老缓存里没有）
  // 结构为数组而非单条：每日发送上限需要按当天条数统计，删旧记录会丢计数
  if (!db.smsCodes) db.smsCodes = [];
  if (!db.customerAddresses) db.customerAddresses = {};
  if (!db.refundRequests) db.refundRequests = [];
  // 兼容旧数据：限时抢购是 v11 新增（老缓存里没有这三块集合）
  if (!db.flashItems || db.flashItems.length === 0) db.flashItems = buildSeed().flashItems;
  // 幂等校准场次归属（与后端 FlashSaleService.run 同源，2026-11-11）：
  // 旧种子里 fi4/fi5/fi6 只挂未来场，永远抢不到；这里按 fi0..fi7 的 id 校准
  // sessionIds，不碰 stock/sold/status。
  // 注：这个校准本身只是配置值修正、不需要升版；但 2026-11-12 新增「国宴」分类
  // 与 12 道菜属于 seed 结构变更，STORE_KEY 已升到 v12，本函数负责把老缓存整体重建。
  (db.flashItems || []).forEach(f => {
    const idx = /^fi(\d+)$/.exec(f._id || '');
    if (idx && FLASH_SESSIONS[Number(idx[1])] && f.sessionIds !== FLASH_SESSIONS[Number(idx[1])]) {
      f.sessionIds = FLASH_SESSIONS[Number(idx[1])];
    }
  });
  if (!db.flashOrders) db.flashOrders = [];
  if (!db.favorites) db.favorites = [];
  if (!db.coupons || db.coupons.length === 0) {
    db.coupons = buildSeed().coupons;
  }
  return db;
}
// 写回本地库
function save(db) {
  uni.setStorageSync(STORE_KEY, db);
  return db;
}
function ok(obj) { return Object.assign({ success: true }, obj || {}); }
function fail(msg) { return { success: false, msg }; }

// ===============================================================
// 限时抢购（与后端 FlashSaleService 逐字段同源）
// 场次为每日固定 4 个整点场（08:00 / 12:00 / 18:00 / 22:00，末场跨到次日 08:00），
// 展示「上一场已结束 / 本场进行中 / 后两场即将开始」，全天无空档，
// 保证任何时刻界面上三种状态都可见，便于演示与验收。
// ===============================================================
const FLASH_RATES = [0.5, 0.6, 0.55, 0.7, 0.5, 0.65, 0.6, 0.75];
const FLASH_STOCKS = [30, 20, 0, 25, 15, 40, 10, 18];
const FLASH_SOLD = [0, 0, 30, 0, 0, 0, 0, 0];
const FLASH_LIMITS = [2, 1, 2, 3, 1, 2, 1, 2];
// 与后端 FlashSaleService.SESSIONS 同源（2026-11-11）：滚动窗口下 s2 恒为当前场，
// 所有在售商品必须含 s2 才轮得到 active、才抢得到；保留 s1/s3/s4 让场次切换有差异。
const FLASH_SESSIONS = ['s1,s2', 's2', 's2,s3', 's2,s3', 's2,s3,s4', 's2,s3,s4', 's1,s2,s4', 's2,s4'];

/** 从现有菜单取前 8 道在售菜生成活动商品，菜名/图片/原价做快照 */
function buildFlashSeed(dishes, now) {
  return dishes.slice(0, FLASH_SESSIONS.length).map((d, i) => {
    const original = Number(d.price) || 10;
    let flash = Math.round(original * FLASH_RATES[i] * 100) / 100;
    if (flash < 1) flash = 1;
    return {
      _id: 'fi' + i,
      shopId: SHOP_ID,
      dishId: d._id,
      name: d.name,
      image: d.image,
      description: d.desc,
      originalPrice: original,
      flashPrice: flash,
      stock: FLASH_STOCKS[i],
      sold: FLASH_SOLD[i],
      limitPerUser: FLASH_LIMITS[i],
      sessionIds: FLASH_SESSIONS[i],
      status: 'on',
      sortNo: i,
      createTime: now
    };
  });
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

/** 每日固定场次起始整点，与后端 FlashSaleService.SLOT_START_HOURS 完全一致：
 *  早市场 08:00 / 午市场 12:00 / 夜市场 18:00 / 宵夜场 22:00（跨到次日 08:00）。 */
const FLASH_SLOT_HOURS = [8, 12, 18, 22];

function flashSessions(nowMs) {
  const now = new Date(nowMs);
  const hhmm = ts => {
    const d = new Date(ts);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  };
  const len = FLASH_SLOT_HOURS.length;
  const dayShift = idx => Math.floor(idx / len);
  const norm = idx => ((idx % len) + len) % len;
  const slotStart = idx => new Date(
    now.getFullYear(), now.getMonth(), now.getDate() + dayShift(idx),
    FLASH_SLOT_HOURS[norm(idx)], 0, 0, 0).getTime();
  const slotEnd = idx => {
    const i = norm(idx);
    const d = dayShift(idx);
    return i + 1 < len
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + d,
          FLASH_SLOT_HOURS[i + 1], 0, 0, 0).getTime()
      : new Date(now.getFullYear(), now.getMonth(), now.getDate() + d + 1,
          FLASH_SLOT_HOURS[0], 0, 0, 0).getTime();
  };
  // 当前时刻落在第几场；早于首场（0~7 点）属于前一天的末场 → -1
  let curIdx = -1;
  const hour = now.getHours();
  for (let i = 0; i < len; i++) if (hour >= FLASH_SLOT_HOURS[i]) curIdx = i;

  const list = [];
  for (let i = 0; i < 4; i++) {
    const idx = curIdx + i - 1;
    const start = slotStart(idx);
    const end = slotEnd(idx);
    let status, target;
    if (nowMs < start) { status = 'upcoming'; target = start; }
    else if (nowMs < end) { status = 'active'; target = end; }
    else { status = 'ended'; target = end; }
    list.push({
      id: 's' + (i + 1),
      title: hhmm(start) + ' 场',
      range: hhmm(start) + '-' + hhmm(end),
      status: status,
      secondsLeft: status === 'ended' ? 0 : Math.max(0, Math.floor((target - nowMs) / 1000)),
      startAt: start,
      endAt: end,
      label: status === 'active' ? '抢购中' : (status === 'ended' ? '已结束' : '即将开抢')
    });
  }
  // active 按「真实时间窗是否含 now」选出，与后端 FlashSaleService.isActive 同源，
  // 不写死 list[1]（位置符号）：滚动窗口下恰好是第 2 场，但语义由时间决定。
  const activeSession = list.find(s => nowMs >= s.startAt && nowMs < s.endAt);
  return {
    serverTime: nowMs,
    sessions: list,
    activeSessionId: activeSession ? activeSession.id : list[1].id,
    date: now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate())
  };
}

function flashFavIds(db, memberId) {
  if (!memberId) return {};
  const out = {};
  (db.favorites || []).forEach(f => {
    if (f.memberId === memberId) out[f.itemId] = true;
  });
  return out;
}

/** 已购件数：只算有效订单，取消的不占限购额度 */
function flashBought(db, memberId, itemId) {
  if (!memberId) return 0;
  return (db.flashOrders || []).reduce((sum, o) =>
    sum + ((o.memberId === memberId && o.itemId === itemId &&
      (o.status === 'pending' || o.status === 'paid')) ? (o.qty || 0) : 0), 0);
}

function flashItemView(db, f, memberId, favIds) {
  const favs = favIds || flashFavIds(db, memberId);
  const bought = flashBought(db, memberId, f._id);
  const total = Math.max(1, f.stock + f.sold);
  return {
    _id: f._id,
    dishId: f.dishId,
    name: f.name,
    image: f.image,
    description: f.description,
    originalPrice: f.originalPrice,
    flashPrice: f.flashPrice,
    discount: f.originalPrice > 0
      ? Math.round(f.flashPrice * 100 / f.originalPrice) / 10 : 10,
    stock: f.stock,
    sold: f.sold,
    remain: Math.max(0, f.stock),
    soldPercent: Math.min(100, Math.round(f.sold * 100 / total)),
    limitPerUser: f.limitPerUser,
    sessionIds: f.sessionIds,
    status: f.status === 'on' ? (f.stock <= 0 ? 'soldout' : 'active') : 'off',
    favorited: !!favs[f._id],
    bought: bought,
    canBuy: !f.limitPerUser || bought < f.limitPerUser
  };
}

function flashInSession(f, sid) {
  return !!sid && String(f.sessionIds || '').split(',').indexOf(sid) >= 0;
}

/** 身份解析：与后端 MemberSessionService.effectiveMemberId 同语义（会话优先） */
function flashIdentity(db, claimed) {
  const real = resolveSession(db, uni.getStorageSync('memberToken') || '');
  if (real) {
    if (claimed && claimed !== real) return { err: '请先登录后再使用该会员权益' };
    return { id: real };
  }
  if (claimed) return { err: '请先登录后再使用该会员权益' };
  return { id: '' };
}

/** 本单可用券：复用券试算，不可用也返回原因供详情页置灰 */
function flashCoupons(db, memberId, amount) {
  if (!memberId) return [];
  const base = Number(amount) || 0;
  return (db.memberCoupons || [])
    .filter(mc => mc.userId === memberId && mc.shopId === SHOP_ID)
    .map(mc => {
      const q = quoteCoupon(db, mc._id, memberId, base, SHOP_ID);
      return {
        _id: mc._id,
        couponName: mc.couponName,
        threshold: money(mc.threshold),
        amount: money(mc.amount),
        usable: q.usable,
        reason: q.reason,
        discount: q.amount
      };
    });
}

function flashOrderView(o) {
  const text = { pending: '待支付', paid: '已支付', canceled: '已取消' };
  return {
    _id: o._id,
    orderId: o._id,
    orderNo: o.orderNo,
    itemId: o.itemId,
    itemName: o.itemName,
    qty: o.qty,
    unitPrice: o.unitPrice,
    subtotal: o.subtotal,
    couponAmount: o.couponAmount,
    payAmount: o.payAmount,
    status: o.status,
    statusText: text[o.status] || '待支付',
    sessionId: o.sessionId,
    createTime: o.createTime,
    payTime: o.payTime || 0
  };
}

// ===============================================================
// 优惠试算（与后端 CouponService 同一套规则）
// 原则与后端一致：前端只传「用哪张券」，减免额一律由数据层算出来。
// ===============================================================

// ===============================================================
// 会员会话（与后端 MemberSessionService 同语义）
//
// 此前「会员身份」就是请求里的一串手机号，改一下 memberId 就能花别人的钱。
// 现在登录后签发随机令牌存进 storage，涉及资产的接口凭令牌认人。
// 令牌从 storage 直接取 —— 对应 HTTP 模式里 http.js 自动加的 X-Member-Token 头，
// 调用方不需要（也不应该）自己传。
// ===============================================================
const SESSION_TTL = 30 * 86400000;

function issueSession(db, userId) {
  const token = 'ms' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  db.memberSessions = db.memberSessions || {};
  db.memberSessions[token] = {
    userId,
    createTime: Date.now(),
    expireAt: Date.now() + SESSION_TTL
  };
  return token;
}

function resolveSession(db, token) {
  if (!token) return '';
  const s = db.memberSessions && db.memberSessions[token];
  if (!s) return '';
  if (!s.expireAt || s.expireAt < Date.now()) return '';
  return s.userId;
}

/**
 * 校验「请求里声称的身份」是否真的持有有效会话。
 * 游客（claimed 为空）放行；非空则必须持有属于该身份的会话。
 * @returns {string} 空串表示通过，非空是错误原因
 */
function requireIdentity(db, claimed) {
  if (!claimed) return '';   // 游客：不享受会员权益，但允许继续下单
  const real = resolveSession(db, uni.getStorageSync('memberToken') || '');
  if (!real || real !== claimed) return '请先登录后再使用该会员权益';
  return '';
}

/**
 * 评价列表脱敏：userId 不对外暴露（手机号登录时 userId 就是手机号）。
 * 与后端 ReviewController.maskUserId 同规则：前 3 位 + ***。
 * 注意必须复制一份再改，不能就地改 db 里的对象（会把存储数据也改了）。
 */
function maskReviewUser(r) {
  if (!r) return r;
  const uid = r.userId;
  const masked = (!uid || String(uid).length <= 3) ? '***' : String(uid).substring(0, 3) + '***';
  return Object.assign({}, r, { userId: masked });
}

/** 券试算：返回 {usable, reason, amount, couponName, memberCouponId} */
function quoteCoupon(db, memberCouponId, userId, orderAmount, shopId) {
  const out = { usable: false, reason: '', amount: 0 };
  if (!memberCouponId) {
    out.reason = '未选择优惠券';
    return out;
  }
  const mc = db.memberCoupons.find(x => x._id === memberCouponId);
  if (!mc) {
    out.reason = '优惠券不存在';
    return out;
  }
  // 归属校验：改一下 id 就能用别人的券，必须服务端（此处数据层）挡住。
  // 刻意「强制」校验：原先写成 if (userId && ...)，不传 memberId 就整段跳过，
  // 等于未登录也能核销任意他人的券（后端 CouponService 同款缺陷，已同步修复）。
  if (!userId || mc.userId !== userId) {
    out.reason = userId ? '这张券不属于当前账号' : '请先登录后再使用优惠券';
    return out;
  }
  // 跨店校验（2026-10-21 加）：券只能在领取门店使用
  if (shopId && mc.shopId && mc.shopId !== shopId) {
    out.reason = '这张券只能在其他门店使用';
    return out;
  }
  if (mc.status === 'used') {
    out.reason = '该券已使用';
    return out;
  }
  if (mc.status !== 'unused' || mc.expireAt <= Date.now()) {
    out.reason = '该券已过期';
    return out;
  }
  if (mc.threshold > 0 && orderAmount < mc.threshold) {
    out.reason = '还差 ¥' + money(mc.threshold - orderAmount) + ' 可用';
    return out;
  }
  // 最多减到剩 1 元，不把订单打成 0（规则见 common/rules.js）
  const discount = rules.couponDiscount(orderAmount, mc.amount);

  out.usable = true;
  out.amount = money(discount);
  out.couponName = mc.couponName;
  out.memberCouponId = mc._id;
  return out;
}

/** 余额试算：抵扣基数是「券后金额」，单笔最多抵 80% */
function quoteBalance(db, memberId, useBalance, afterCoupon) {
  const out = { usable: false, reason: '', amount: 0, balance: 0 };
  if (!useBalance || !memberId) return out;

  const m = db.members[memberId];
  if (!m) {
    out.reason = '余额为 0';
    return out;
  }
  // 上限与余额取小值，规则见 common/rules.js
  const q = rules.quoteBalanceAmount(m.balance, afterCoupon);
  out.usable = q.usable;
  out.amount = q.amount;
  out.reason = q.reason;
  out.balance = money(m.balance);
  out.memberId = memberId;
  return out;
}

/**
 * 会员等级折扣（与后端 CouponService.quoteLevel 同源）。
 * 基数取「券后金额」：券是活动让利，不该再被会员折扣折一次。
 */
function quoteLevel(db, memberId, orderAmount) {
  const m = memberId ? db.members[memberId] : null;
  const q = rules.quoteLevel(m && m.totalSpend, orderAmount);
  return { usable: !!m && q.amount > 0, level: q.level, rate: q.rate, amount: q.amount };
}

/**
 * 积分抵现（与后端 CouponService.quotePoints 同源）。
 * 每 100 分抵 1 元、按整元、单笔最多抵应付金额的 20%。
 */
function quotePoints(db, memberId, usePoints, orderAmount) {
  const m = memberId ? db.members[memberId] : null;
  const points = (m && m.points) || 0;
  const out = { usable: false, reason: '', amount: 0, points, pointsUsed: 0 };

  if (!usePoints || !m) {
    out.reason = usePoints && !m ? '会员不存在' : '未使用积分';
    return out;
  }
  const q = rules.quotePoints(points, orderAmount);
  out.usable = q.usable;
  out.reason = q.reason;
  out.amount = q.amount;
  out.pointsUsed = q.pointsUsed;
  return out;
}

// 各模块的 action 处理器（与云函数一一对应）
const handlers = {
  // 店铺
  cloudShop(e) {
    if (e.action === 'get') {
      const db = load();
      // 返回被查询的门店本身（让「切换门店」后首页顶栏/门店卡片显示对应店名地址）；
      // 查不到时回退到默认演示店，避免门店选择页选了某店却显示成另一家。
      const s = (db.shops || []).find(x => x._id === (e.shopId || SHOP_ID)) || db.shop;
      return ok({ data: s });
    }
    if (e.action === 'list') {
      // 门店列表：带定位时服务端（此处为本地模拟层）算距并就近排序，
      // 与后端 GET /api/shop/list?lat=&lng= 行为一致
      const db = load();
      // 注意：mock 的 call 把参数摊平在 e 顶层（非 e.data），见文件底部 call()
      const raw = db.shops || [Object.assign({ distance: '', address: '' }, db.shop)];
      return ok({ data: { shops: locateShops(raw, e.lat, e.lng) } });
    }
    if (e.action === 'initDemo') {
      save(buildSeed()); // 重置演示数据
      return ok({ shopId: SHOP_ID, msg: '演示数据已重置' });
    }
    if (e.action === 'login') {
      // 本地模拟模式无需真实鉴权，直接回假 token
      return ok({ token: 'mock-token', shopId: e.shopId || SHOP_ID });
    }
    return fail('unknown action');
  },

  // 套餐（1+1 随心配）
  // 与后端 ComboService 同源：按「红区」「白区」两个分类名切分区，各选 1 件，一口价
  cloudCombo(e) {
    const db = load();
    const shopId = e.shopId || SHOP_ID;

    if (e.action === 'get') {
      const zoneFromName = (key, name) => {
        const cat = db.categories.find(c => c.shopId === shopId && c.name === name);
        const dishes = (cat ? db.dishes.filter(d => d.categoryId === cat._id && d.status === 'on') : [])
          .map(d => ({
            _id: d._id, name: d.name, image: d.image, desc: d.desc, price: d.price
          }));
        return { key, name, pick: 1, dishes };
      };
      return ok({
        data: {
          name: COMBO_NAME,
          price: COMBO_PRICE,
          zones: [
            zoneFromName('red', ZONE_RED),
            zoneFromName('white', ZONE_WHITE)
          ]
        }
      });
    }
    return fail('unknown action');
  },

  // 菜单与菜品
  cloudMenu(e) {
    const db = load();
    const shopId = e.shopId || SHOP_ID;

    if (e.action === 'getShopMenu') {
      const role = e.role || 'customer';
      let categories = db.categories
        .filter(c => c.shopId === shopId)
        .sort((a, b) => a.sort - b.sort);
      let dishes = db.dishes.filter(d => d.shopId === shopId);

      if (role !== 'merchant') {
        // 与后端 MenuService.forCustomer 保持一致的两条规则：
        // 1) 剔除套餐专用分区（红区/白区），避免 0 元的套餐商品被单点
        // 2) 售罄菜品仍然返回，由页面置灰标注，不从菜单里消失
        categories = categories.filter(c => c.name !== ZONE_RED && c.name !== ZONE_WHITE);
        const visibleCatIds = categories.map(c => c._id);
        dishes = dishes.filter(d => visibleCatIds.indexOf(d.categoryId) >= 0);
      }
      // 与后端保持一致的信封结构：data 内含 categories / dishes
      return ok({ data: { categories, dishes } });
    }
    if (e.action === 'addDish') {
      const d = Object.assign({}, e.data, {
        _id: 'd' + (db.seq++), shopId, status: 'on', createTime: Date.now()
      });
      db.dishes.push(d); save(db);
      return ok({ _id: d._id });
    }
    if (e.action === 'updateDish') {
      const id = e.data._id;
      db.dishes = db.dishes.map(x => (x._id === id ? Object.assign({}, x, e.data) : x));
      save(db);
      return ok({});
    }
    if (e.action === 'deleteDish') {
      db.dishes = db.dishes.filter(x => x._id !== e._id);
      save(db);
      return ok({});
    }
    if (e.action === 'toggleDish') {
      db.dishes = db.dishes.map(x => (x._id === e._id ? Object.assign({}, x, { status: e.status }) : x));
      save(db);
      return ok({});
    }
    if (e.action === 'addCategory') {
      const c = { _id: 'c' + (db.seq++), shopId, name: e.name, sort: e.sort || 0, createTime: Date.now() };
      db.categories.push(c); save(db);
      return ok({ _id: c._id });
    }
    if (e.action === 'deleteCategory') {
      db.dishes = db.dishes.filter(x => x.categoryId !== e._id);
      db.categories = db.categories.filter(x => x._id !== e._id);
      save(db);
      return ok({});
    }
    return fail('unknown action');
  },

  // 订单
  cloudOrder(e) {
    const db = load();
    const shopId = e.shopId || SHOP_ID;

    // 逐项回查菜品并重算明细，供 create 与 quote 共用
    // 与后端 OrderService.priceItems 同一套规则：
    // ① 不信任前端价格 ② 已售罄的不允许下单 ③ 套餐按服务端一口价 ④ 单品数量上限 99
    const priceItems = () => {
      const checked = [];
      for (let i = 0; i < e.items.length; i++) {
        const it = e.items[i];
        const qty = Math.max(1, parseInt(it.qty, 10) || 1);
        if (qty > 99) return { err: '单道菜最多点 99 份' };

        const dish = db.dishes.find(x => x._id === it.dishId);
        if (dish) {
          // 跨店校验（2026-10-21 加）：菜品必须属于当前下单门店
          if (dish.shopId && shopId && dish.shopId !== shopId) {
            return { err: '「' + dish.name + '」不属于当前门店' };
          }
          if (dish.status && dish.status !== 'on') {
            return { err: '「' + dish.name + '」已售罄，请换一道' };
          }
          checked.push({ dishId: dish._id, name: dish.name, price: money(dish.price), qty, spec: it.spec || '' });
        } else if (it.dishId && it.dishId.indexOf('combo@') === 0) {
          // 虚拟套餐：名称按所选单品重拼，价格取一口价常量
          const parts = it.dishId.split('@');
          const rn = db.dishes.find(x => x._id === parts[1]);
          const wn = db.dishes.find(x => x._id === parts[2]);
          if (!rn || !wn) return { err: '套餐搭配已失效，请重新选择' };
          checked.push({
            dishId: it.dishId,
            name: COMBO_NAME + '（' + rn.name + ' + ' + wn.name + '）',
            price: COMBO_PRICE,
            qty
          });
        } else {
          return { err: '菜品不存在：' + it.dishId };
        }
      }
      return { checked };
    };

    // 下单前试算优惠：不落库、不占券、不扣余额
    if (e.action === 'quote') {
      // 试算会读别人的券与余额，同样要认人（与后端 OrderController.quote 一致）
      const idErr = requireIdentity(db, e.memberId);
      if (idErr) return fail(idErr);
      const priced = priceItems();
      if (priced.err) return fail(priced.err);

      const totalPrice = money(priced.checked.reduce((s, i) => s + i.price * i.qty, 0));
      const cq = quoteCoupon(db, e.memberCouponId, e.memberId, totalPrice, shopId);
      const afterCoupon = money(totalPrice - cq.amount);
      // 等级折扣以券后金额为基数；余额与积分再以「券+等级折后」为基数共用同一分母
      const lq = quoteLevel(db, e.memberId, afterCoupon);
      const afterLevel = money(afterCoupon - lq.amount);
      const bq = quoteBalance(db, e.memberId, e.useBalance, afterLevel);
      const pq = quotePoints(db, e.memberId, e.usePoints, afterLevel);
      // 配送费：不参与优惠，直接加在优惠后应付之上（与后端 quote 同公式）
      const deliveryFee = deliveryFeeOf(e.deliveryType, totalPrice);
      const payAmount = money(Math.max(0, afterLevel - bq.amount - pq.amount + deliveryFee));

      return ok({
        data: {
          totalPrice,
          discountAmount: cq.amount,
          levelDiscount: lq.amount,
          level: lq.level,
          levelRate: lq.rate,
          balancePay: bq.amount,
          pointsPay: pq.amount,
          pointsUsed: pq.pointsUsed,
          deliveryFee,
          payAmount,
          // 预计等候分钟：外卖单为「制作 + 配送」的送达预估（与后端 quote 同字段）
          waitMinutes: e.deliveryType === 'delivery'
            ? deliveryWaitMinutes(estimateWaitMinutes(priced.checked))
            : estimateWaitMinutes(priced.checked),
          couponUsable: cq.usable,
          couponReason: cq.reason,
          couponName: cq.couponName || '',
          balanceUsable: bq.usable,
          balance: bq.balance,
          points: pq.points,
          pointsUsable: pq.usable,
          pointsReason: pq.reason
        }
      });
    }

    if (e.action === 'create') {
      // 幂等判重（2026-10-21 加）：同一 clientRequestId 的请求只处理一次
      if (e.clientRequestId) {
        const dup = db.orders.find(x => x.clientRequestId === e.clientRequestId);
        if (dup) {
          return ok({
            orderId: dup._id,
            orderNo: dup.orderNo,
            pickupNo: dup.pickupNo,
            totalPrice: dup.totalPrice,
            discountAmount: dup.discountAmount,
            levelDiscount: dup.levelDiscount,
            balancePay: dup.balancePay,
            pointsPay: dup.pointsPay,
            payAmount: dup.payAmount,
            waitMinutes: dup.waitMinutes,
            // 幂等命中也要把凭证带回去：前端第一次可能没存上，重试时补上
            ownerKey: dup.ownerKey
          });
        }
      }
      // 下单会核销券、扣余额，而 memberId 来自调用方。
      // 只要带了 memberId 就必须持有属于它的会话，否则谁都能花别人的钱。
      const idErr = requireIdentity(db, e.memberId);
      if (idErr) return fail(idErr);
      const priced = priceItems();
      if (priced.err) return fail(priced.err);
      const checked = priced.checked;

      const totalPrice = money(checked.reduce((s, i) => s + i.price * i.qty, 0));

      // ---- 优惠核销（券 → 等级折扣 → 余额 → 积分）----
      const cq = quoteCoupon(db, e.memberCouponId, e.memberId, totalPrice, shopId);
      if (e.memberCouponId && !cq.usable) return fail(cq.reason);
      if (cq.usable) {
        const mc = db.memberCoupons.find(x => x._id === cq.memberCouponId);
        mc.status = 'used';
        mc.useTime = Date.now();
      }

      const afterCoupon = money(totalPrice - cq.amount);

      // 等级折扣：顾客攒消费换来的权益，不再问一次「要不要用」
      const lq = quoteLevel(db, e.memberId, afterCoupon);
      const afterLevel = money(afterCoupon - lq.amount);

      const bq = quoteBalance(db, e.memberId, e.useBalance, afterLevel);
      const pq = quotePoints(db, e.memberId, e.usePoints, afterLevel);

      // ---- 外卖配送（麦乐送模式）----
      // 配送方式只认 delivery，其他一律按自取（与后端同规则）；
      // 外卖必须留全收货信息，校验放服务端 —— 直接打接口绕过表单也下不了无地址单
      const deliveryType = e.deliveryType === 'delivery' ? 'delivery' : 'pickup';
      if (deliveryType === 'delivery') {
        if (!e.address || !String(e.address).trim()) return fail('外卖订单请填写收货地址');
        if (!e.phone || !String(e.phone).trim()) return fail('外卖订单请填写联系电话');
      }

      // 余额与积分都是会员资产，一次落库
      if (e.memberId && db.members[e.memberId]) {
        const m = db.members[e.memberId];
        if (bq.amount > 0) m.balance = money(m.balance - bq.amount);
        if (pq.pointsUsed > 0) m.points = Math.max(0, (m.points || 0) - pq.pointsUsed);
      }
      // 配送费不参与优惠，直接加在优惠后应付之上（与后端 create 同函数）
      const deliveryFee = deliveryFeeOf(deliveryType, totalPrice);
      const payAmount = money(Math.max(0, afterLevel - bq.amount - pq.amount + deliveryFee));

      const order = {
        _id: 'o' + (db.seq++),
        shopId: shopId,
        deliveryType,
        receiver: e.receiver || '',
        phone: e.phone || '',
        address: e.address || '',
        // 期望配送时间：外卖单透传前端选择（默认「立即送」），自取单为空
        deliveryTime: deliveryType === 'delivery' ? (e.deliveryTime || '立即送') : '',
        deliveryFee,
        tableNo: e.tableNo || '',
        items: checked,
        note: e.note || '',
        clientRequestId: e.clientRequestId || '',
        totalPrice,
        discountAmount: cq.amount,
        levelDiscount: lq.amount,
        balancePay: bq.amount,
        pointsPay: pq.amount,
        payAmount,
        memberCouponId: cq.memberCouponId || '',
        memberId: e.memberId || '',
        status: 'unpaid',
        orderNo: genOrderNo(),
        pickupNo: nextPickupNo(db, shopId, deliveryType === 'delivery'),
        // 访问凭证：游客没有会员身份，靠它认「这是本机下的单」（与后端同规则）
        ownerKey: newOwnerKey(),
        // 预计等候分钟：外卖单为送达预估。下单时算定并随订单持久化，
        // 订单页轮询刷新时展示值不会漂（不是每次现算）
        waitMinutes: deliveryType === 'delivery'
          ? deliveryWaitMinutes(estimateWaitMinutes(checked))
          : estimateWaitMinutes(checked),
        createTime: Date.now()
      };

      // 券核销要记下用在哪一单，便于会员中心对账
      if (cq.memberCouponId) {
        db.memberCoupons.find(x => x._id === cq.memberCouponId).useOrderId = order._id;
      }

      // 资产流水：下单扣了余额/积分就要留痕（先余额后积分，两笔各自对账）。
      // 快照取扣减后的真实值，顾客在流水页能看到「这笔之后余额/积分是多少」。
      if (e.memberId && db.members[e.memberId]) {
        if (bq.amount > 0) recordTxn(db, e.memberId, 'consume', -bq.amount, 0, order._id);
        if (pq.pointsUsed > 0) recordTxn(db, e.memberId, 'points_pay', 0, -pq.pointsUsed, order._id);
      }

      db.orders.unshift(order); save(db);
      return ok({
        orderId: order._id,
        orderNo: order.orderNo,
        pickupNo: order.pickupNo,
        totalPrice,
        discountAmount: cq.amount,
        levelDiscount: lq.amount,
        balancePay: bq.amount,
        pointsPay: pq.amount,
        deliveryFee: order.deliveryFee,
        deliveryType: order.deliveryType,
        deliveryTime: order.deliveryTime,
        // 用掉多少积分要与试算响应同口径下发：少了它，前端想展示
        // 「本单抵扣 500 积分」只能拿 pointsPay 反推，多此一举
        pointsUsed: pq.pointsUsed,
        payAmount,
        waitMinutes: order.waitMinutes,
        // 访问凭证：前端存本机，后续查单/取消/支付时带回
        ownerKey: order.ownerKey
      });
    }
    if (e.action === 'pay') {
      // 与后端 OrderService.pay 同款校验：只允许 unpaid → paid。
      // 原先 mock 直接置 paid，两个后果：① 已完成/已取消的订单还能「付款」；
      // ② 重复 pay 会重复累加积分与累计消费（下单→支付→再支付，积分翻倍）。
      const target = db.orders.find(x => x._id === e.orderId);
      if (!target) return fail('订单不存在：' + e.orderId);
      const payAllowed = allowedNextStatus(target.status, target.deliveryType);
      if (!payAllowed) return fail('未知订单状态：' + target.status);
      if (payAllowed.indexOf('paid') < 0) {
        return fail('订单状态不能从 ' + target.status + ' 变更为 paid'
          + '，当前允许：' + (payAllowed.length ? payAllowed.join('/') : '无（终态）'));
      }
      db.orders = db.orders.map(o => {
        if (o._id !== e.orderId) return o;
        // 支付成功这一刻才累计会员消费与积分：
        // 下单时订单还是 unpaid，那时累计会让「下单又取消」也白嫖到积分
        const m = o.memberId && db.members[o.memberId];
        if (m) {
          m.totalSpend = money(m.totalSpend + o.payAmount);
          m.orderCount = (m.orderCount || 0) + 1;
          m.points = (m.points || 0) + Math.floor(o.payAmount);
        }
        return Object.assign({}, o, { status: 'paid', payTime: Date.now() });
      });
      // 流水：赠分跟着支付走，挂真实订单号（与后端 accumulate 同口径）
      if (target.memberId && db.members[target.memberId]) {
        const earned = Math.floor(target.payAmount || 0);
        if (earned > 0) recordTxn(db, target.memberId, 'earn', 0, earned, target._id);
      }
      save(db);
      return ok({});
    }
    if (e.action === 'get') {
      const o = db.orders.find(x => x._id === e.orderId) || null;
      return ok({ data: o });
    }
    if (e.action === 'list') {
      // 分页返回 {list,total,page,size,hasMore}，与后端 OrderService.page 同口径。
      // 筛选（状态、桌号）在「切片之前」做——先前顾客端本桌订单是把全店拉回来再前端过滤，
      // 一旦分页，第 2 页里的本桌订单就永远看不到。
      let list = db.orders.filter(o => o.shopId === (e.shopId || SHOP_ID));
      if (e.status) list = list.filter(o => o.status === e.status);
      if (e.tableNo !== undefined && e.tableNo !== null && e.tableNo !== '') {
        list = list.filter(o => String(o.tableNo || '') === String(e.tableNo));
      }
      list = list.slice().sort((a, b) => b.createTime - a.createTime);

      const page = Math.max(1, parseInt(e.page, 10) || 1);
      const size = Math.min(Math.max(1, parseInt(e.size, 10) || 20), 100);
      const total = list.length;
      const start = (page - 1) * size;
      return ok({
        data: {
          list: list.slice(start, start + size),
          total,
          page,
          size,
          hasMore: start + size < total
        }
      });
    }
    if (e.action === 'updateStatus') {
      // 与后端 OrderService.NEXT_STATUS 同一张状态机表（已提到模块级 ORDER_NEXT_STATUS）。
      // 之前 mock 这里不做校验，导致演示模式下能把已完成的订单改回待支付，
      // 和真后端行为不一致 —— 课堂上演示换数据源时结论就会对不上。
      const cur = db.orders.find(x => x._id === e.orderId);
      if (!cur) return fail('订单不存在：' + e.orderId);
      const allowed = allowedNextStatus(cur.status, cur.deliveryType);
      if (!allowed) return fail('未知订单状态：' + cur.status);
      if (allowed.indexOf(e.status) < 0) {
        return fail('订单状态不能从 ' + cur.status + ' 变更为 ' + e.status
          + '，当前允许：' + (allowed.length ? allowed.join('/') : '无（终态）'));
      }

      // ---- 取消订单必须把已消耗的权益退回去 ----
      // 券是在 create() 时核销的、余额是在 create() 时扣的、积分是在 pay() 时累积的。
      // 若不退：顾客用券下单再取消，券白白烧掉；用余额支付再取消，钱凭空消失。
      // 这是资损，也是答辩时最容易被问住的点。
      if (e.status === 'canceled') {
        (db.refundRequests || [])
          .filter(r => r.orderId === cur._id && r.status === 'pending')
          .forEach(r => {
            r.status = 'closed_by_cancellation';
            r.decisionNote = '订单已取消，申请已关闭';
            r.decisionTime = Date.now();
          });
        // ① 退券：该单核销过的持有券恢复为未使用，并清掉使用记录
        if (cur.memberCouponId) {
          const mc = db.memberCoupons.find(x => x._id === cur.memberCouponId);
          if (mc && mc.status === 'used') {
            mc.status = 'unused';
            mc.useOrderId = '';
            mc.useTime = 0;
          }
        }
        const m = cur.memberId && db.members[cur.memberId];
        // ② 退余额：把抵扣部分加回账户，并记一笔退款流水
        if (m && cur.balancePay > 0) {
          m.balance = money(m.balance + cur.balancePay);
          recordTxn(db, cur.memberId, 'refund', cur.balancePay, 0, cur._id);
        }
        // ③ 退积分：「下单时花掉的」与「支付时挣到的」是两笔方向相反的动作。
        //    花掉的是顾客原有资产，必须原额退回；挣到的是本单奖励，单取消了才收回。
        //    混在一起抵账会出现「花了 500 分、只挣到 30 分」的单取消后倒亏 470 分。
        //    流水同样分两笔记，快照各取变动后值（与后端 CouponService.refund 同结构）。
        //
        //    「是否已支付」不能只看 status === 'paid'：状态机允许 paid → preparing → canceled，
        //    而 preparing 单早已在 pay() 时领过奖励积分，只认 paid 会漏回滚。
        //    也不能只看 payTime：演示种子订单不写 payTime。
        //    因此与后端 OrderService.updateStatus 同规则用状态白名单兜底。
        const wasPaid = !!cur.payTime
          || (cur.status !== 'unpaid' && cur.status !== 'canceled');
        if (m) {
          const spent = Math.floor(cur.pointsPay || 0) * POINTS_PER_YUAN;
          const earned = wasPaid ? Math.floor(cur.payAmount || 0) : 0;
          if (spent > 0) {
            m.points = Math.max(0, (m.points || 0) + spent);
            recordTxn(db, cur.memberId, 'refund_points', 0, spent, cur._id);
          }
          if (earned > 0) {
            m.points = Math.max(0, (m.points || 0) - earned);
            recordTxn(db, cur.memberId, 'reclaim_points', 0, -earned, cur._id);
          }
        }
        // ④ 退累计与单数：只有「已支付」的单才在 pay() 里累积过
        if (m && wasPaid) {
          m.totalSpend = money(Math.max(0, (m.totalSpend || 0) - (cur.payAmount || 0)));
          m.orderCount = Math.max(0, (m.orderCount || 0) - 1);
        }
      }

      db.orders = db.orders.map(o =>
        o._id === e.orderId ? Object.assign({}, o, { status: e.status, updateTime: Date.now() }) : o);
      save(db);
      return ok({});
    }
    return fail('unknown action');
  },

  // 投诉/反馈：顾客对某道菜提交"不好吃"类反馈，商家端按菜品聚合改进
  cloudFeedback(e) {
    const db = load();
    const shopId = e.shopId || SHOP_ID;

    if (e.action === 'create') {
      if (!e.reason) return fail('请选择投诉原因');
      const c = {
        _id: 'cf' + Date.now(),
        shopId,
        orderId: e.orderId || '',
        dishId: e.dishId || '',
        dishName: e.dishName || '',
        reason: e.reason,
        detail: e.detail || '',
        createTime: Date.now(),
        status: 'new',
        handledAt: 0
      };
      db.complaints.unshift(c); save(db);
      return ok({ _id: c._id });
    }
    if (e.action === 'handled') {
      // 商家标记已处理：幂等，重复标记不报错
      const c = db.complaints.find(x => x._id === e.id);
      if (!c) return fail('反馈不存在');
      if (c.status !== 'handled') {
        c.status = 'handled';
        c.handledAt = Date.now();
        save(db);
      }
      return ok({});
    }
    if (e.action === 'list') {
      let list = db.complaints.filter(c => c.shopId === shopId);
      if (e.orderId) list = list.filter(c => c.orderId === e.orderId);
      return ok({ data: list });
    }
    if (e.action === 'stats') {
      // 按菜品聚合：哪道菜被投诉得多、都是什么原因
      const grouped = {};
      db.complaints.filter(c => c.shopId === shopId).forEach(c => {
        const key = c.dishId || ('name:' + c.dishName);
        const g = grouped[key] || (grouped[key] = {
          dishId: c.dishId, dishName: c.dishName, count: 0, pending: 0, reasons: [], lastTime: c.createTime
        });
        g.count++;
        if (c.status !== 'handled') g.pending++;
        if (!g.reasons.includes(c.reason) && g.reasons.length < 6) g.reasons.push(c.reason);
      });
      const data = Object.values(grouped).sort((a, b) => b.count - a.count);
      return ok({ data });
    }
    return fail('unknown action');
  },

  // ===============================================================
  // 优惠券：与后端 CouponService / CouponController 行为一一对应
  // ===============================================================
  cloudCoupon(e) {
    const db = load();
    const shopId = e.shopId || SHOP_ID;

    // 领券中心：券模板 + 我已领几张 + 是否还能领
    if (e.action === 'templates') {
      const list = (db.coupons || []).filter(c => c.shopId === shopId && c.status === 'on');
      const data = list.map(c => {
        const myClaimed = (e.userId
          ? db.memberCoupons.filter(mc => mc.userId === e.userId && mc.couponId === c._id).length
          : 0);
        // 「限量售罄」与「每人限领」是两回事，都要算，只看模板字段会误判
        const soldOut = c.totalQty > 0 && c.claimedQty >= c.totalQty;
        return {
          _id: c._id,
          name: c.name,
          threshold: money(c.threshold),
          amount: money(c.amount),
          validDays: c.validDays,
          totalQty: c.totalQty,
          claimedQty: c.claimedQty,
          // 前端领券中心要显示「限领 N 张」，漏了就是「限领 undefined 张」
          // （后端 CouponService.listTemplates 已同步补上，两端必须一致）
          perUserLimit: c.perUserLimit,
          myClaimed,
          claimable: c.status === 'on' && !soldOut && myClaimed < c.perUserLimit
        };
      });
      return ok({ data });
    }

    // 我的券包：按可用/已用/已过期三段分区
    if (e.action === 'my') {
      // 券包属于个人隐私，凭会话认人（与后端 CouponController.my 一致）
      const idErr = requireIdentity(db, e.userId);
      if (idErr) return fail(idErr);
      const now = Date.now();
      const usable = [], used = [], expired = [];
      db.memberCoupons
        .filter(mc => mc.userId === e.userId && mc.shopId === shopId)
        .sort((a, b) => b.getTime - a.getTime)
        .forEach(mc => {
          const view = {
            _id: mc._id,
            couponId: mc.couponId,
            couponName: mc.couponName,
            threshold: money(mc.threshold),
            amount: money(mc.amount),
            getTime: mc.getTime,
            expireAt: mc.expireAt,
            status: mc.status,
            useOrderId: mc.useOrderId || ''
          };
          // 过期是按 expireAt 惰性判定，不依赖库里的 status 是否被刷过
          if (mc.status === 'unused' && mc.expireAt > now) usable.push(view);
          else if (mc.status === 'used') used.push(view);
          else expired.push(view);
        });
      return ok({ data: { usable, used, expired } });
    }

    // 领一张券
    if (e.action === 'claim') {
      if (!e.userId) return fail('请先登录会员账号');
      // 领券是往账户里塞资产，必须认人
      const idErr = requireIdentity(db, e.userId);
      if (idErr) return fail(idErr);
      const c = (db.coupons || []).find(x => x._id === e.couponId);
      if (!c) return fail('优惠券不存在');
      if (c.status !== 'on') return fail('该券已停止发放');
      if (c.totalQty > 0 && c.claimedQty >= c.totalQty) return fail('该券已领完');

      const myClaimed = db.memberCoupons.filter(mc => mc.userId === e.userId && mc.couponId === c._id).length;
      if (myClaimed >= c.perUserLimit) return fail('每人限领 ' + c.perUserLimit + ' 张，你已领过');

      const now = Date.now();
      const mc = {
        _id: 'mc' + now + Math.floor(Math.random() * 900 + 100),
        userId: e.userId,
        couponId: c._id,
        shopId: c.shopId,
        couponName: c.name,
        threshold: money(c.threshold),
        amount: money(c.amount),
        getTime: now,
        expireAt: now + c.validDays * 24 * 3600 * 1000,
        status: 'unused',
        useTime: 0,
        useOrderId: ''
      };
      db.memberCoupons.push(mc);
      c.claimedQty++;
      save(db);
      return ok({ _id: mc._id });
    }
    if (e.action === 'adminList') {
      return ok({ data: (db.coupons || [])
        .filter(c => c.shopId === shopId)
        .slice()
        .sort((a, b) => b.createTime - a.createTime) });
    }
    if (e.action === 'adminCreate') {
      const input = e.data || {};
      const name = String(input.name || '').trim();
      const threshold = Number(input.threshold);
      const amount = Number(input.amount);
      const validDays = Number(input.validDays);
      const totalQty = Number(input.totalQty);
      const perUserLimit = Number(input.perUserLimit);
      if (!name || !Number.isFinite(threshold) || threshold < 0 || !(amount > 0) || !(validDays > 0)
        || !Number.isFinite(totalQty) || totalQty < 0 || !(perUserLimit > 0)) return fail('优惠券信息不完整或无效');
      const coupon = {
        _id: 'cp' + (db.seq++),
        shopId: input.shopId || shopId,
        name, threshold: money(threshold), amount: money(amount),
        validDays: Math.floor(validDays), totalQty: Math.floor(totalQty),
        claimedQty: 0, perUserLimit: Math.floor(perUserLimit),
        status: 'on', createTime: Date.now()
      };
      db.coupons.push(coupon);
      save(db);
      return ok({ data: coupon });
    }
    if (e.action === 'adminUpdate') {
      const coupon = (db.coupons || []).find(c => c._id === e.id && c.shopId === shopId);
      if (!coupon) return fail('优惠券不存在');
      const input = e.data || {};
      const name = String(input.name || '').trim();
      const threshold = Number(input.threshold);
      const amount = Number(input.amount);
      const validDays = Number(input.validDays);
      const totalQty = Number(input.totalQty);
      const perUserLimit = Number(input.perUserLimit);
      if (!name || !Number.isFinite(threshold) || threshold < 0 || !(amount > 0) || !(validDays > 0)
        || !Number.isFinite(totalQty) || totalQty < coupon.claimedQty || !(perUserLimit > 0)) return fail('优惠券信息不完整或无效');
      Object.assign(coupon, {
        name, threshold: money(threshold), amount: money(amount),
        validDays: Math.floor(validDays), totalQty: Math.floor(totalQty),
        perUserLimit: Math.floor(perUserLimit)
      });
      save(db);
      return ok({ data: coupon });
    }
    if (e.action === 'adminToggle') {
      const coupon = (db.coupons || []).find(c => c._id === e.id && c.shopId === shopId);
      if (!coupon) return fail('优惠券不存在');
      if (e.status !== 'on' && e.status !== 'off') return fail('优惠券状态无效');
      coupon.status = e.status;
      save(db);
      return ok({ data: coupon });
    }
    return fail('unknown action');
  },

  // 会员地址按当前有效会话归属，不接受调用方传来的会员编号。
  cloudAddress(e) {
    const db = load();
    const userId = resolveSession(db, uni.getStorageSync('memberToken') || '');
    if (!userId) return fail('请先登录会员账号');
    const list = db.customerAddresses[userId] || (db.customerAddresses[userId] = []);
    if (e.action === 'list') return ok({ data: list.slice() });
    if (e.action === 'create' || e.action === 'update') {
      const input = e.data || {};
      const name = String(input.name || '').trim();
      const phone = String(input.phone || '').trim();
      const detail = String(input.detail || '').trim();
      if (!name || !phone || !detail) return fail('请填写完整地址信息');
      const isDefault = !!input.isDefault || (e.action === 'create' && list.length === 0);
      if (isDefault) list.forEach(a => { a.isDefault = false; });
      if (e.action === 'create') {
        const address = { _id: 'addr' + (db.seq++), name, phone, detail, isDefault, createTime: Date.now() };
        list.push(address);
        save(db);
        return ok({ data: address });
      }
      const address = list.find(a => a._id === e.id);
      if (!address) return fail('收货地址不存在');
      Object.assign(address, { name, phone, detail, isDefault });
      save(db);
      return ok({ data: address });
    }
    if (e.action === 'delete') {
      const index = list.findIndex(a => a._id === e.id);
      if (index < 0) return fail('收货地址不存在');
      list.splice(index, 1);
      save(db);
      return ok({});
    }
    return fail('unknown action');
  },

  cloudRefund(e) {
    const db = load();
    if (e.action === 'create') {
      const order = db.orders.find(o => o._id === e.orderId);
      if (!order) return fail('订单不存在');
      if (['paid', 'preparing', 'done', 'delivering', 'delivered'].indexOf(order.status) < 0) {
        return fail('当前订单状态不可申请售后');
      }
      if (order.memberId) {
        const userId = resolveSession(db, uni.getStorageSync('memberToken') || '');
        if (!userId || userId !== order.memberId) return fail('无权申请该订单售后');
      } else if (!order.ownerKey || session.getOwnerKey(order._id) !== order.ownerKey) {
        return fail('无权申请该订单售后');
      }
      if (db.refundRequests.some(r => r.orderId === order._id)) return fail('该订单已有售后申请');
      const reason = String(e.reason || '').trim();
      if (!reason) return fail('请填写退款原因');
      const request = {
        _id: 'rr' + (db.seq++), requestId: '', shopId: order.shopId,
        orderId: order._id, reason, status: 'pending', refundMode: 'manual',
        decisionNote: '', createTime: Date.now(), decisionTime: 0
      };
      request.requestId = request._id;
      db.refundRequests.push(request);
      save(db);
      return ok({ data: request });
    }
    if (e.action === 'get') {
      const order = db.orders.find(o => o._id === e.orderId);
      if (!order) return fail('订单不存在');
      if (order.memberId) {
        const userId = resolveSession(db, uni.getStorageSync('memberToken') || '');
        if (!userId || userId !== order.memberId) return fail('无权查看该订单售后');
      } else if (!order.ownerKey || session.getOwnerKey(order._id) !== order.ownerKey) {
        return fail('无权查看该订单售后');
      }
      const request = db.refundRequests.find(r => r.orderId === order._id) || null;
      if (!request) return ok({ data: null });
      return ok({ data: {
        _id: request._id,
        status: request.status,
        refundMode: request.refundMode || 'manual',
        reason: request.reason,
        decisionNote: request.decisionNote || '',
        createTime: request.createTime,
        decisionTime: request.decisionTime || 0
      } });
    }
    if (e.action === 'list') {
      const rows = db.refundRequests
        .filter(r => r.shopId === (e.shopId || SHOP_ID) && (!e.status || r.status === e.status))
        .slice()
        .sort((a, b) => b.createTime - a.createTime);
      return ok({ data: rows });
    }
    if (e.action === 'decision') {
      const request = db.refundRequests.find(r => r._id === e.requestId || r.requestId === e.requestId);
      if (!request) return fail('售后申请不存在');
      if (request.status !== 'pending') return fail('该申请已处理');
      if (e.decision !== 'approve' && e.decision !== 'reject') return fail('处理决定无效');
      request.status = e.decision === 'approve' ? 'approved_pending_manual_refund' : 'rejected';
      request.decisionNote = String(e.note || '').trim();
      request.decisionTime = Date.now();
      save(db);
      return ok({ data: request });
    }
    return fail('unknown action');
  },

  // ===============================================================
  // 会员：储值余额 + 积分。与后端 CouponService.register/recharge/accumulate 一致
  // ===============================================================
  cloudMember(e) {
    const db = load();

    // 会员档案视图。等级不再只是展示标签：levelRate 就是计价时真正套用的折扣率，
    // 两处共用模块级的 levelOf / levelRate，避免「显示银卡、算账按普通」。
    const view = (m) => {
      const lv = levelOf(m);
      return {
        _id: m._id, phone: m.phone, nickname: m.nickname,
        balance: money(m.balance), points: m.points || 0,
        totalSpend: money(m.totalSpend), orderCount: m.orderCount || 0,
        createTime: m.createTime,
        level: lv,
        levelRate: levelRate(lv),
        levelBenefit: levelBenefit(lv),
        // 积分可抵多少元：100 分 = 1 元、按整元
        pointsValue: Math.floor((m.points || 0) / POINTS_PER_YUAN)
      };
    };

    // ---------- 短信验证码（与后端 SmsCodeService 同规则）----------
    // 规则：6 位数字 / 5 分钟有效 / 60 秒重发间隔 / 每日 10 条 / 错 5 次作废。
    // 本地模拟层没有短信网关，直接把验证码放在 demoCode 里返回（后端演示模式同款），
    // 页面会自动填入，课堂上不必真去收短信。
    const SMS_TTL = 5 * 60 * 1000;
    const SMS_RESEND = 60 * 1000;
    const SMS_MAX_FAIL = 5;
    const SMS_DAILY_LIMIT = 10;

    if (e.action === 'sendCode') {
      const phone = (e.phone || '').trim();
      if (!phone) return fail('请填写手机号');
      if (!/^1\d{10}$/.test(phone)) return fail('手机号格式不对');
      const scene = e.scene || 'login';
      const now = Date.now();

      // 清掉一天前的旧记录（已无用于频控与统计，留着只会撑大本地库）
      db.smsCodes = (db.smsCodes || []).filter(x => x.expireAt > now - 86400000);

      // 频控 1：60 秒内不可重发。取该号该场景最新一条，与后端按 createTime 倒序取一致
      const sent = db.smsCodes
        .filter(x => x.phone === phone && x.scene === scene)
        .sort((a, b) => b.createTime - a.createTime)[0];
      if (sent && now - sent.createTime < SMS_RESEND) {
        const wait = Math.ceil((SMS_RESEND - (now - sent.createTime)) / 1000);
        return fail('发送过于频繁，请 ' + wait + ' 秒后重试');
      }

      // 频控 2：每日发送上限（按自然日 0 点起算，与后端 LocalDate.atStartOfDay 对齐）
      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);
      const todayCount = db.smsCodes.filter(
        x => x.phone === phone && x.createTime >= dayStart.getTime()
      ).length;
      if (todayCount >= SMS_DAILY_LIMIT) {
        return fail('今日验证码发送次数已达上限，请明天再试');
      }

      // 本地模拟用 Math.random 足够：这不是安全边界，而是演示数据
      const code = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
      db.smsCodes.push({
        phone, scene, code,
        createTime: now,
        expireAt: now + SMS_TTL,
        used: false,
        failCount: 0
      });
      save(db);
      return ok({
        data: {
          ttl: SMS_TTL / 1000,
          resendAfter: SMS_RESEND / 1000,
          demo: true,
          demoCode: code
        }
      });
    }

    // 校验验证码：通过返回空串，不通过返回错误文案（与后端抛 BizException 等价）
    const checkCode = (phone, code, scene) => {
      if (!/^\d{6}$/.test(String(code || '').trim())) return '请输入 6 位数字验证码';
      const rec = (db.smsCodes || [])
        .filter(x => x.phone === phone && x.scene === scene)
        .sort((a, b) => b.createTime - a.createTime)[0];
      if (!rec) return '请先获取验证码';
      if (rec.used) return '验证码已使用，请重新获取';
      if (rec.expireAt < Date.now()) return '验证码已过期，请重新获取';
      if (rec.failCount >= SMS_MAX_FAIL) return '验证码错误次数过多，请重新获取';
      if (rec.code !== String(code).trim()) {
        // 错误次数必须落库：否则每次请求都从 0 开始，6 位数字可被慢慢穷举
        rec.failCount++;
        save(db);
        const left = SMS_MAX_FAIL - rec.failCount;
        return left > 0
          ? '验证码不正确，还可尝试 ' + left + ' 次'
          : '验证码错误次数过多，请重新获取';
      }
      rec.used = true;   // 一次性使用：通过即作废，防重放
      save(db);
      return '';
    };

    // 手机号登录：必须先通过短信验证码，不存在就开户，存在直接返回
    if (e.action === 'login') {
      const phone = (e.phone || '').trim();
      if (!phone) return fail('请填写手机号');
      if (!/^1\d{10}$/.test(phone)) return fail('手机号格式不对');

      // 先校验验证码再开户：验证失败不应产生任何会员数据
      const codeErr = checkCode(phone, e.code, 'login');
      if (codeErr) return fail(codeErr);

      let m = db.members[phone];
      if (!m) {
        m = {
          _id: phone, phone,
          nickname: e.nickname || ('会员' + phone.slice(-4)),
          balance: 0, points: 0, totalSpend: 0, orderCount: 0,
          createTime: Date.now()
        };
        db.members[phone] = m;
        save(db);
      }
      // 登录即签发会话令牌：后续下单/领券/查券包都凭它认人
      const v = view(m);
      v.memberToken = issueSession(db, m._id);
      save(db);
      return ok({ data: v });
    }

    // 微信登录：与后端 /api/auth/wx-login 同约定。
    // mock 层没有真实微信接口，用固定演示 openid 模拟 code2session 的结果，
    // 保证重复登录命中的是同一会员（真实 openid 每个用户固定，效果一致）。
    if (e.action === 'wxLogin') {
      if (!e.code) return fail('缺少 code');
      const openid = 'wx_demo_user';
      let m = db.members[openid];
      if (!m) {
        m = {
          _id: openid, phone: '', openid,
          nickname: '微信会员' + openid.slice(-4),
          balance: 0, points: 0, totalSpend: 0, orderCount: 0,
          createTime: Date.now()
        };
        db.members[openid] = m;
        save(db);
      }
      // data 里带 demo:true，前端可提示「演示模式登录」
      const d = view(m);
      d.openid = openid;
      d.demo = true;
      d.memberToken = issueSession(db, m._id);
      save(db);
      return ok({ data: d });
    }

    if (e.action === 'info') {
      // 档案含余额、积分、累计消费，属隐私：必须持有该身份的会话
      const idErr = requireIdentity(db, e.userId);
      if (idErr) return fail(idErr);
      const m = db.members[e.userId];
      if (!m) return fail('会员不存在');
      return ok({ data: view(m) });
    }

    // 退出登录：吊销服务端会话（与后端 POST /api/member/logout 同语义）。
    // 此前 mock 也没有这一步 —— 「退出登录」只清本机 storage，
    // 令牌在 db.memberSessions 里继续有效，等于登了个假登录。
    if (e.action === 'logout') {
      const token = uni.getStorageSync('memberToken') || '';
      let revoked = false;
      if (token && db.memberSessions && db.memberSessions[token]) {
        delete db.memberSessions[token];
        save(db);
        revoked = true;
      }
      // 幂等：令牌缺失/已失效也返回成功，前端不必写「登出失败」分支
      return ok({ revoked });
    }

    // 充值。演示接口直接加余额，真实项目应走支付回调。
    // 操作主体是顾客自己，所以校验的是**会员会话**而非商户口令
    // （后端 MemberController.recharge 同款；此前 mock 漏了这个校验，
    //  导致「后端模式充值被拦、mock 模式正常」的两端不一致）
    if (e.action === 'recharge') {
      const idErr = requireIdentity(db, e.userId);
      if (idErr) return fail(idErr);
      const m = db.members[e.userId];
      if (!m) return fail('会员不存在');
      const amt = money(e.amount);
      if (amt <= 0) return fail('充值金额必须大于 0');
      m.balance = money(m.balance + amt);
      // 流水：充值是顾客主动行为，账上要能看到「钱从哪来」（与后端 recharge 同口径）
      recordTxn(db, e.userId, 'recharge', amt, 0, '');
      save(db);
      return ok({ data: view(m) });
    }
    // 资产流水：余额/积分的每一笔变动，按时间倒序。
    // 含快照与关联订单，属个人隐私，与 info/recharge 同样要认人
    if (e.action === 'transactions') {
      const idErr = requireIdentity(db, e.userId);
      if (idErr) return fail(idErr);
      const list = (db.memberTransactions || [])
        .filter(t => t.memberId === e.userId)
        .slice()
        .sort((a, b) => b.createTime - a.createTime);
      return ok({ data: list });
    }
    return fail('unknown action');
  },

  // ===============================================================
  // 菜品评价：与后端 ReviewController 一致
  // 注意与 cloudFeedback（投诉）是两件事：评价是打分，投诉是整改
  // ===============================================================
  cloudReview(e) {
    const db = load();
    const shopId = e.shopId || SHOP_ID;

    if (e.action === 'create') {
      if (!e.dishId) return fail('请选择要评价的菜品');
      const rating = parseInt(e.rating, 10);
      if (!rating || rating < 1 || rating > 5) return fail('评分必须是 1~5 星');

      // 必须买过才能评，否则随便编个 dishId 就能刷一星好评
      if (!e.orderId) return fail('请从已完成订单中选择菜品评价');
      const order = db.orders.find(x => x._id === e.orderId);
      if (!order) return fail('订单不存在');

      // 归属校验（2026-10-21 加）：只能评价自己的订单，防冒用他人订单刷评
      const currentUserId = resolveSession(db, uni.getStorageSync('memberToken') || '');
      if (!currentUserId) return fail('请先登录后再评价');
      if (currentUserId !== order.memberId) return fail('只能评价自己的订单');

      // 外卖单的终态是 delivered（配送完成）而不是 done（出餐），
      // 只认 done 会把已送达的外卖单挡在评价门外（前端按钮却显示可评价）
      if (order.status !== 'done' && order.status !== 'delivered') {
        return fail('订单完成后才能评价');
      }
      if (!order.items.some(it => it.dishId === e.dishId)) return fail('该订单中没有这道菜');
      // 同一订单同一道菜只能评一次
      if (db.reviews.some(r => r.orderId === e.orderId && r.dishId === e.dishId)) {
        return fail('这道菜已经评价过了');
      }

      // 菜名取库里的现值，不采信前端传的菜名
      const dish = db.dishes.find(x => x._id === e.dishId);
      const r = {
        _id: 'rv' + Date.now() + Math.floor(Math.random() * 900 + 100),
        shopId: order.shopId,
        orderId: e.orderId,
        dishId: e.dishId,
        dishName: dish ? dish.name : (e.dishName || ''),
        rating,
        content: e.content || '',
        images: e.images || '',
        userId: order.memberId || '',
        createTime: Date.now()
      };
      db.reviews.unshift(r); save(db);
      return ok({ _id: r._id });
    }

    if (e.action === 'list') {
      let list = db.reviews.filter(r => r.shopId === shopId);
      if (e.orderId) list = list.filter(r => r.orderId === e.orderId);
      return ok({ data: list.map(maskReviewUser) });
    }

    if (e.action === 'byDish') {
      const list = db.reviews.filter(r => r.dishId === e.dishId)
        .sort((a, b) => b.createTime - a.createTime);
      return ok({ data: list.map(maskReviewUser) });
    }

    // 评分汇总：菜品列表页显示「4.8 分 · 32 条」，一次拿全所有菜的聚合
    if (e.action === 'summary') {
      const all = db.reviews.filter(r => r.shopId === shopId);
      const grouped = {};
      all.forEach(r => {
        const key = r.dishId || '';
        const g = grouped[key] || (grouped[key] = { sum: 0, count: 0, latest: [] });
        g.sum += r.rating;
        g.count++;
        if (g.latest.length < 3) g.latest.push(maskReviewUser(r));
      });

      // 保留一位小数，避免出现 4.85000001 这种浮点尾巴
      const round1 = v => Math.round(v * 10) / 10;
      let totalScore = 0;
      const dishes = Object.keys(grouped).map(key => {
        const g = grouped[key];
        totalScore += g.sum;
        return { dishId: key, rating: round1(g.sum / g.count), count: g.count, latest: g.latest };
      });
      const count = all.length;
      return ok({
        data: { avgRating: count ? round1(totalScore / count) : 0, count, dishes }
      });
    }

    // 商家回复评价。与后端 ReviewController.reply 同规则：
    // 非空、最多 300 字、重复回复视为改口（覆盖并刷新时间）。
    // 真实的鉴权发生在后端 AuthInterceptor；mock 无鉴权层，仅保证行为一致。
    if (e.action === 'reply') {
      const r = db.reviews.find(x => x._id === e._id);
      if (!r) return fail('评价不存在');
      const text = String(e.reply == null ? '' : e.reply).trim();
      if (!text) return fail('回复内容不能为空');
      if (text.length > 300) return fail('回复最多 300 字');
      r.reply = text;
      r.replyTime = Date.now();
      save(db);
      return ok({ data: r });
    }

    if (e.action === 'deleteReply') {
      const r = db.reviews.find(x => x._id === e._id);
      if (!r) return fail('评价不存在');
      r.reply = '';
      r.replyTime = 0;
      save(db);
      return ok({ data: r });
    }
    return fail('unknown action');
  },

  // ===============================================================
  // 经营统计：与后端 AdminController.stats 逐字段同源
  // 页面：pages/merchant/stats/stats.vue
  //
  // 三条口径必须和后端一致，否则课堂切换数据源时两端数字对不上：
  //   ① 营业额只算 paid 及之后（含 delivering/delivered 物流态），
  //      unpaid 未付款与 canceled 已取消都不计收入
  //   ② pendingCount 是「当前待接单」，跨天累计，不是今日
  //   ③ daily 为近 7 日（含今天）按天汇总，日期串用设备本地时间拼，
  //      每天带 statusCount 供统计页点选日期看当天构成
  // ===============================================================
  cloudAdmin(e) {
    const db = load();
    const shopId = e.shopId || SHOP_ID;

    if (e.action === 'stats') {
      const all = db.orders.filter(o => o.shopId === shopId);
      const d0 = new Date();
      d0.setHours(0, 0, 0, 0);
      const todayStart = d0.getTime();
      // 营业额口径：paid 及之后都算收入（unpaid 未付款、canceled 已取消不计）。
      // delivering/delivered 是外卖单在 done 之后的物流态——钱在支付时就收了，
      // 漏掉它们会让「已配送/已送达」的外卖单从营业额里凭空消失。
      // 与后端 AdminController.stats 同一个 paidLike 判据（两端同步改）。
      const isPaid = s => s === 'paid' || s === 'preparing' || s === 'done'
        || s === 'delivering' || s === 'delivered';
      const pad = n => (n < 10 ? '0' : '') + n;

      // 营业额口径：总价 − 优惠券减免 − 等级折扣 − 积分抵现 + 配送费
      //（与后端 AdminController.revenueOf 同一条规则）。
      // 券/折扣/积分是让利不算收入；余额抵扣不扣减，因为充值时钱已经收过了；
      // 配送费是顾客额外付的真金白银，计入收入。
      const revenueOf = o => Math.max(0,
        (o.totalPrice || 0) - (o.discountAmount || 0) - (o.levelDiscount || 0)
        - (o.pointsPay || 0) + (o.deliveryFee || 0));

      let todayOrderCount = 0;
      let todayAmount = 0;
      all.forEach(o => {
        if (o.createTime >= todayStart) {
          todayOrderCount++;
          if (isPaid(o.status)) todayAmount += revenueOf(o);
        }
      });

      // 抢购单金额并入（与后端 AdminController.stats 同源，2026-11-11）。
      // flash_order 无 shop_id，全部归属 SHOP_ID：全局口径或本店口径才纳入。
      // 只并入「钱」，不动订单数/状态分布（flash 状态 pending/paid/canceled 与主订单七态不同源）。
      const flashIncluded = !e.shopId || e.shopId === SHOP_ID;
      const flashPaid = flashIncluded
        ? (db.flashOrders || []).filter(o => o.status === 'paid') : [];
      // 抢购净额 = payAmount（服务端已按 抢购价×件数 − 券 算好，mock 同规则）
      const flashRevenueOf = o => Math.max(0, Number(o.payAmount) || 0);
      let flashTodayAmount = 0;
      flashPaid.forEach(o => {
        if (o.createTime >= todayStart) flashTodayAmount += flashRevenueOf(o);
      });
      todayAmount += flashTodayAmount;

      // 近 7 日（含今天），与后端同一窗口：今天往前数 6 天。
      // 每天带 statusCount（当日订单状态分布），供统计页点选日期后
      // 展示「那天」的状态分布——只有汇总量的话点过去也看不到当天构成。
      // 键与后端 OrderService.allStatuses() 同序同全集（含配送中/已送达）。
      const STATUS_KEYS = ['unpaid', 'paid', 'preparing', 'done', 'delivering', 'delivered', 'canceled'];
      const daily = [];
      for (let i = 6; i >= 0; i--) {
        const day = new Date(todayStart - i * 86400000);
        const start = day.getTime();
        const end = start + 86400000;
        let orderCount = 0;
        let amount = 0;
        const dayStatus = {};
        STATUS_KEYS.forEach(s => { dayStatus[s] = 0; });
        all.forEach(o => {
          if (o.createTime >= start && o.createTime < end) {
            orderCount++;
            if (dayStatus[o.status] !== undefined) dayStatus[o.status]++;
            if (isPaid(o.status)) amount += revenueOf(o);
          }
        });
        // 抢购单只加金额，不加 orderCount/statusCount（与后端同源）
        flashPaid.forEach(o => {
          if (o.createTime >= start && o.createTime < end) amount += flashRevenueOf(o);
        });
        daily.push({
          date: pad(day.getMonth() + 1) + '-' + pad(day.getDate()),
          orderCount,
          amount: money(amount),
          statusCount: dayStatus
        });
      }

      // 状态分布：固定七键，顺序与后端 OrderService.allStatuses() 一致
      // （旧版只有五键，缺 delivering/delivered 会让外卖单在分布里凭空消失）
      const statusCount = {};
      STATUS_KEYS.forEach(s => {
        statusCount[s] = all.filter(o => o.status === s).length;
      });

      return ok({
        data: {
          orderTotal: all.length,
          todayOrderCount,
          todayAmount: money(todayAmount),
          pendingCount: all.filter(o => o.status === 'paid').length,
          // 拆解字段：今日营业额里来自抢购的部分（前端可选展示，与后端同名字段）
          flashTodayAmount: money(flashTodayAmount),
          flashTodayCount: flashPaid.filter(o => o.createTime >= todayStart).length,
          dishTotal: db.dishes.filter(x => x.shopId === shopId).length,
          categoryTotal: db.categories.filter(x => x.shopId === shopId).length,
          statusCount,
          daily
        }
      });
    }

    // 订单导出 CSV。与后端 AdminController.buildCsv 逐列同源：
    // 同表头、同顺序、同样转义规则、同样开头带 UTF-8 BOM（缺了 Excel 打开中文乱码）。
    // 小程序侧拿不到「另存为」，只能取文本自己落地，所以这里返回字符串而不是文件。
    if (e.action === 'exportOrders') {
      const scoped = !!e.shopId;
      const all = db.orders.filter(o => !scoped || o.shopId === shopId);
      const cell = s => String(s == null ? '' : s)
        .replace(/,/g, '、').replace(/\n|\r/g, ' ').replace(/"/g, "'");
      const num = v => (Number(v) || 0).toFixed(2);
      const pad2 = n => (n < 10 ? '0' : '') + n;
      const fmtTime = ts => {
        const d = new Date(ts || 0);
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' '
          + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
      };

      const lines = ['\uFEFF取餐号,订单号,桌号,状态,下单时间,菜品明细,原价,券减,会员折扣,余额抵扣,积分抵现,实付'];
      all.forEach(o => {
        const items = (o.items || []).map(i => i.name + 'x' + (i.qty || 1)).join('、');
        lines.push([
          cell(o.pickupNo), cell(o.orderNo), cell(o.tableNo), cell(STATUS_LABEL[o.status] || o.status),
          cell(fmtTime(o.createTime)), cell(items),
          num(o.totalPrice), num(o.discountAmount), num(o.levelDiscount),
          num(o.balancePay), num(o.pointsPay), num(o.payAmount)
        ].join(','));
      });

      // 抢购单并入导出（与后端 buildCsv 同源，2026-11-11）。
      // 全部状态导出，取餐号列写「抢购」以便对账区分；无等级/积分/余额/配送费概念，填 0。
      const flashAll = (!e.shopId || e.shopId === SHOP_ID) ? (db.flashOrders || []) : [];
      const flashLabel = s => '抢购·' + (s === 'paid' ? '已支付' : s === 'canceled' ? '已取消' : '待支付');
      flashAll.forEach(o => {
        if (e.from && (o.createTime == null || o.createTime < e.from)) return;
        if (e.to && (o.createTime == null || o.createTime > e.to)) return;
        lines.push([
          cell('抢购'), cell(o.orderNo), cell(''), cell(flashLabel(o.status)),
          cell(fmtTime(o.createTime)), cell(cell(o.itemName) + 'x' + (o.qty || 1)),
          num(o.subtotal), num(o.couponAmount), num(0),
          num(0), num(0), num(o.payAmount)
        ].join(','));
      });

      const rows = all.length + flashAll.filter(o =>
        (!e.from || (o.createTime != null && o.createTime >= e.from))
        && (!e.to || (o.createTime != null && o.createTime <= e.to))).length;
      return ok({
        data: {
          // 末尾补一个换行，与后端逐行 append('\n') 的输出逐字节一致。
          // 少了它，两端的 CSV 会差一个字节，而导出的表是要拿去对账的。
          csv: lines.join('\n') + '\n',
          rows,
          filename: 'orders-' + (scoped ? shopId : 'all') + '-' + rows + 'rows.csv'
        }
      });
    }
    return fail('unknown action');
  },

  // ---------------- 限时抢购 ----------------
  // 与后端 FlashSaleController 同一组 action、同一套返回结构与失败文案。
  // 页面只依赖 cloudFlash/*，切 useMock 时无需改一行页面代码。
  cloudFlash(e) {
    const db = load();
    const now = Date.now();
    const ident = flashIdentity(db, e.memberId || '');
    if (ident.err) return fail(ident.err);
    const memberId = ident.id;

    if (e.action === 'sessions') {
      return ok({ data: flashSessions(now) });
    }

    if (e.action === 'items') {
      const favs = flashFavIds(db, memberId);
      const list = db.flashItems
        .filter(f => f.status === 'on' && (!e.sessionId || flashInSession(f, e.sessionId)))
        .sort((a, b) => a.sortNo - b.sortNo)
        .map(f => flashItemView(db, f, memberId, favs));
      return ok({ data: list });
    }

    if (e.action === 'item') {
      const f = db.flashItems.find(x => x._id === e.id);
      if (!f) return fail('商品不存在或已下架');
      return ok({ data: flashItemView(db, f, memberId) });
    }

    if (e.action === 'favorites') {
      if (!memberId) return ok({ data: [] });
      const favs = flashFavIds(db, memberId);
      const list = db.favorites
        .filter(x => x.memberId === memberId)
        .sort((a, b) => b.createTime - a.createTime)
        .map(x => db.flashItems.find(f => f._id === x.itemId))
        .filter(Boolean)
        .map(f => flashItemView(db, f, memberId, favs));
      return ok({ data: list });
    }

    if (e.action === 'toggleFavorite') {
      if (!memberId) return fail('请先登录会员账号后再参与限时抢购');
      if (!db.flashItems.some(f => f._id === e.itemId)) return fail('商品不存在或已下架');
      const idx = db.favorites.findIndex(x => x.memberId === memberId && x.itemId === e.itemId);
      let favorited;
      if (idx >= 0) {
        db.favorites.splice(idx, 1);
        favorited = false;
      } else {
        db.favorites.push({
          _id: 'fav' + now + Math.floor(Math.random() * 1000),
          memberId: memberId,
          itemId: e.itemId,
          createTime: now
        });
        favorited = true;
      }
      save(db);
      return ok({ favorited: favorited });
    }

    if (e.action === 'coupons') {
      return ok({ data: flashCoupons(db, memberId, e.amount) });
    }

    if (e.action === 'orders') {
      if (!memberId) return ok({ data: [] });
      const list = db.flashOrders
        .filter(o => o.memberId === memberId)
        .sort((a, b) => b.createTime - a.createTime)
        .map(flashOrderView);
      return ok({ data: list });
    }

    if (e.action === 'createOrder') {
      if (!memberId) return fail('请先登录会员账号后再参与限时抢购');
      const info = flashSessions(now);
      const sid = e.sessionId || info.activeSessionId;
      const cur = info.sessions.find(s => s.id === sid);
      // 按真实时间窗判 active（与后端 FlashSaleService.isActive 同源，2026-11-11）：
      // 不用 cur.status（那是按列表位置推算的符号），用 now 是否落在 [startAt,endAt)。
      if (!cur || !(now >= cur.startAt && now < cur.endAt)) {
        return fail('本场抢购尚未开始或已结束');
      }

      const f = db.flashItems.find(x => x._id === e.itemId);
      if (!f || f.status !== 'on') return fail('商品不存在或已下架');
      if (!flashInSession(f, sid)) return fail('该商品不在本场活动中');

      const qty = Number(e.qty) || 1;
      if (qty < 1 || qty > 99) return fail('购买数量需在 1-99 之间');
      const bought = flashBought(db, memberId, f._id);
      if (f.limitPerUser > 0 && bought + qty > f.limitPerUser) {
        return fail('超出限购：每人限购 ' + f.limitPerUser + ' 件，你已购 ' + bought + ' 件');
      }

      const subtotal = money(f.flashPrice * qty);
      let discount = 0;
      let mc = null;
      if (e.couponId) {
        const q = quoteCoupon(db, e.couponId, memberId, subtotal, SHOP_ID);
        if (!q.usable) return fail(q.reason);
        discount = q.amount;
        mc = db.memberCoupons.find(x => x._id === e.couponId);
      }
      // 原子扣减：mock 单线程执行，等价于后端的条件 UPDATE
      if (f.stock < qty) return fail('来晚了，该商品已售罄或库存不足');
      f.stock -= qty;
      f.sold += qty;

      const orderId = 'fo' + now + Math.floor(Math.random() * 1000);
      const dd = new Date(now);
      const ymd = '' + dd.getFullYear() + pad2(dd.getMonth() + 1) + pad2(dd.getDate());
      const orderNo = 'FS' + ymd + (Math.floor(Math.random() * 900000) + 100000);
      const payAmount = money(subtotal - discount);
      db.flashOrders.push({
        _id: orderId,
        orderNo: orderNo,
        memberId: memberId,
        itemId: f._id,
        itemName: f.name,
        qty: qty,
        unitPrice: f.flashPrice,
        subtotal: subtotal,
        couponId: mc ? mc._id : '',
        couponAmount: discount,
        payAmount: payAmount,
        status: 'pending',
        sessionId: sid,
        createTime: now,
        payTime: 0,
        updateTime: now
      });
      if (mc) {
        mc.status = 'used';
        mc.useTime = now;
        mc.useOrderId = orderId;
      }
      save(db);
      return ok({
        orderId: orderId,
        orderNo: orderNo,
        payAmount: payAmount,
        message: '抢购成功，请在订单页完成支付'
      });
    }

    if (e.action === 'pay' || (e.action === 'status' && e.status === 'paid')) {
      if (!memberId) return fail('请先登录会员账号后再参与限时抢购');
      const o = db.flashOrders.find(x => x._id === e.orderId && x.memberId === memberId);
      if (!o) return fail('订单不存在');
      if (o.status !== 'pending') return fail('订单状态已变更，请刷新后重试');
      o.status = 'paid';
      o.payTime = now;
      o.updateTime = now;
      save(db);
      return ok({ data: flashOrderView(o) });
    }

    if (e.action === 'status' && e.status === 'canceled') {
      if (!memberId) return fail('请先登录会员账号后再参与限时抢购');
      const o = db.flashOrders.find(x => x._id === e.orderId && x.memberId === memberId);
      if (!o) return fail('订单不存在');
      if (o.status !== 'pending') return fail('只有待支付订单可以取消');
      o.status = 'canceled';
      o.updateTime = now;
      const f = db.flashItems.find(x => x._id === o.itemId);
      if (f) {
        f.stock += o.qty;
        f.sold = Math.max(0, f.sold - o.qty);
      }
      if (o.couponId) {
        const mc = db.memberCoupons.find(x => x._id === o.couponId);
        if (mc && mc.status === 'used' && mc.useOrderId === o._id) {
          mc.status = 'unused';
          mc.useTime = 0;
          mc.useOrderId = '';
        }
      }
      save(db);
      return ok({ data: flashOrderView(o) });
    }

    return fail('unknown action');
  }
};

// 对外暴露与 utils/cloud.js 相同的 call 接口
function call(name, action, data) {
  return new Promise((resolve, reject) => {
    const h = handlers[name];
    if (!h) { reject('无此模拟模块: ' + name); return; }
    // 模拟 120ms 网络延迟，贴近真实体验
    setTimeout(() => {
      try {
        const r = h(Object.assign({ action }, data || {}));
        if (r.success) resolve(r);
        else reject(r.msg || '请求失败');
      } catch (err) {
        reject(err && err.message ? err.message : String(err));
      }
    }, 120);
  });
}

module.exports = { call, SHOP_ID };

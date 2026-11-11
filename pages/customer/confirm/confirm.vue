<template>
<!-- pages/customer/confirm/confirm.vue —— 订单确认 + 优惠结算 + 提交支付
     金额拆四行展示（原价 / 券减 / 余额抵 / 实付），
     与后端 OrderService.quote 的返回字段一一对应 -->
<view class="container">
  <!-- ============ 订单明细 ============ -->
  <view class="card">
    <view class="block-title">订单明细</view>
    <view v-for="(item, index) in items" :key="item.dishId" class="row"
          :class="{ stale: staleFlags[index] }">
      <view class="row-name">
        {{item.name}}
        <text class="stale-tag" v-if="staleFlags[index]">已下架</text>
      </view>
      <view class="row-qty">x{{item.qty}}</view>
      <view class="row-price price">{{fmt(item.price * item.qty)}}</view>
      <text class="row-del" v-if="staleFlags[index]" @tap.stop="removeItem(index)">移除</text>
    </view>
    <view class="stale-bar" v-if="hasStale">
      有商品已下架，移除后才能提交。失效商品的金额已不计入合计。
    </view>
  </view>

  <!-- ============ 优惠结算 ============ -->
  <view class="card">
    <view class="block-title">优惠结算</view>

    <!-- 优惠券行 -->
    <view class="kv tap" @tap="openCouponSheet">
      <text>优惠券</text>
      <view class="kv-right">
        <text class="coupon-picked" :class="{none: !pickedCouponId}">{{couponLabel}}</text>
        <text class="kv-arrow">›</text>
      </view>
    </view>

    <!-- 余额抵扣开关：默认关闭，不能替顾客默认花掉他的钱 -->
    <view class="kv" v-if="balance > 0">
      <view class="kv-left">
        <text>储值余额抵扣</text>
        <text class="kv-sub">可用 ¥{{fmt(balance)}}</text>
      </view>
      <switch :checked="useBalance" color="#087c61"
              @change="onToggleBalance" />
    </view>
    <view class="kv" v-else>
      <view class="kv-left">
        <text>储值余额抵扣</text>
        <text class="kv-sub">登录会员后可使用</text>
      </view>
      <text class="kv-link" @tap="goLogin">去登录 ›</text>
    </view>

    <!-- 积分抵现开关：与余额同理，是资产就不能替顾客默认花掉 -->
    <view class="kv" v-if="points >= 100">
      <view class="kv-left">
        <text>积分抵现</text>
        <text class="kv-sub">{{points}} 分 ≈ ¥{{pointsValue}}（每 100 分抵 1 元）</text>
      </view>
      <switch :checked="usePoints" color="#087c61"
              @change="onTogglePoints" />
    </view>
    <view class="kv" v-else-if="userId">
      <view class="kv-left">
        <text>积分抵现</text>
        <text class="kv-sub">当前 {{points}} 分，满 100 分可用</text>
      </view>
      <text class="kv-sub">—</text>
    </view>
  </view>

  <!-- ============ 金额明细 ============ -->
  <view class="card">
    <view class="block-title">费用明细</view>
    <view class="amt-row">
      <text>商品原价</text>
      <text class="price">{{fmt(totalPrice)}}</text>
    </view>
    <view class="amt-row" v-if="discountAmount > 0">
      <text>优惠券减免</text>
      <text class="price minus">-{{fmt(discountAmount)}}</text>
    </view>
    <view class="amt-row" v-if="levelDiscount > 0">
      <text>会员折扣<text class="tag-lv">{{level}}</text></text>
      <text class="price minus">-{{fmt(levelDiscount)}}</text>
    </view>
    <view class="amt-row" v-if="balancePay > 0">
      <text>余额抵扣</text>
      <text class="price minus">-{{fmt(balancePay)}}</text>
    </view>
    <view class="amt-row" v-if="pointsPay > 0">
      <text>积分抵现<text class="tag-lv">{{pointsUsed}} 分</text></text>
      <text class="price minus">-{{fmt(pointsPay)}}</text>
    </view>
    <!-- 配送费：服务端算（满 39 免），不参与任何优惠，直接加在实付上 -->
    <view class="amt-row" v-if="mode === 'delivery'">
      <text>配送费<text class="tag-lv" v-if="deliveryFee <= 0">已免</text></text>
      <text class="price plus" v-if="deliveryFee > 0">+{{fmt(deliveryFee)}}</text>
      <text class="price minus" v-else>¥0.00</text>
    </view>
    <view class="total-card">
      <text>实付金额</text>
      <text class="price total-num">{{fmt(payAmount)}}</text>
    </view>
    <view class="saved-tip" v-if="savedAmount > 0">
      已为你节省 ¥{{fmt(savedAmount)}}
    </view>
    <!-- 预计等候：服务端按菜品件数算（quote 与 create 同一公式），
         提交前就让顾客知道大概等多久，而不是付完钱才被告知。
         外卖单服务端算的是「制作 + 配送」的送达预估，文案随之切换 -->
    <view class="wait-row" v-if="waitMinutes > 0">
      <text>{{mode === 'delivery' ? '预计送达' : '预计等候'}}</text>
      <text class="wait-num">约 {{waitMinutes}} 分钟</text>
    </view>
  </view>

  <!-- ============ 配送方式与备注 ============ -->
  <view class="card">
    <view class="block-title">配送方式</view>
    <!-- 双 tab：与首页入口一致；切换会改变配送费与等待文案，需重新试算 -->
    <view class="mode-tabs">
      <view class="mtab" :class="{on: mode === 'delivery'}" @tap="switchMode('delivery')">🛵 外卖配送</view>
      <view class="mtab" :class="{on: mode === 'pickup'}" @tap="switchMode('pickup')">🏪 到店自取</view>
    </view>
    <!-- 外卖：收货信息三件套。地址是骑手找到顾客的前提，
         服务端也会硬校验（绕过表单直接打接口下不了无地址单） -->
    <block v-if="mode === 'delivery'">
      <!-- 收货地址：优先从地址簿选择（带回填）；也保留手动填写兜底 -->
      <view class="addr-pick" @tap="goAddress">
        <view v-if="address" class="addr-picked">
          <view class="ap-top"><text class="ap-name">{{receiver}}</text><text class="ap-phone">{{phone}}</text></view>
          <view class="ap-detail">{{address}}</view>
        </view>
        <view v-else class="addr-empty">+ 选择收货地址</view>
        <text class="kv-arrow">›</text>
      </view>
      <view class="addr-quick" @tap="showManual = !showManual">
        {{showManual ? '收起手动填写' : '没有地址？手动填写'}}
      </view>
      <block v-if="showManual">
        <input class="addr-input" placeholder="收货人姓名" :value="receiver" @input="onField('receiver', $event)" />
        <input class="addr-input" placeholder="联系电话" type="number" :value="phone" @input="onField('phone', $event)" />
        <input class="addr-input" placeholder="收货地址（如：体育西路 101 号 2201 室）" :value="address" @input="onField('address', $event)" />
      </block>

      <!-- 配送时间：立即送 / 预约时段（外卖平台常见交互） -->
      <view class="block-sub">配送时间</view>
      <view class="mode-tabs sm">
        <view class="mtab" :class="{on: deliveryTimeMode === 'now'}" @tap="switchDTime('now')">立即送</view>
        <view class="mtab" :class="{on: deliveryTimeMode === 'book'}" @tap="switchDTime('book')">预约配送</view>
      </view>
      <view v-if="deliveryTimeMode === 'book'" class="slots">
        <view v-for="(s, i) in bookSlots" :key="i" class="slot"
              :class="{on: selectedSlot === s}" @tap="pickSlot(s)">{{s}}</view>
      </view>

      <view class="fee-tip">配送费 ¥5 · 商品满 ¥39 免配送费 · 金额以服务端计算为准</view>
    </block>
    <!-- 自取：桌号仅自取场景有意义（堂食遗存能力，与外卖共存） -->
    <view class="kv" v-else><text>桌号</text><text>{{tableNo || '未指定'}}</text></view>
    <view class="kv"><text>备注</text></view>
    <input class="note-input" placeholder="如：少辣、要香菜,多加葱（选填）" :value="note" @input="onNote" />
  </view>

  <button class="primary-btn" @tap="submit" :disabled="submitting || hasStale || !quoteOk || quoting">
    {{submitting ? '提交中...'
      : (items.length === 0 ? '购物车是空的'
      : (hasStale ? '请先移除下架商品'
      : (quoting ? '金额计算中...'
      : (!quoteOk ? '金额计算失败，请下拉重试'
      : (payAmount <= 0 ? '确认模拟支付 ¥0.00（全额抵扣）' : '提交订单并模拟支付 ' + fmt(payAmount))))))}}
  </button>
  <view class="tip">当前支付接口仅模拟订单支付，不会发起真实微信支付。接入限制见 README。</view>

  <!-- ============ 优惠券选择弹层 ============ -->
  <view class="mask" v-if="showCouponSheet" @tap="closeCouponSheet"></view>
  <view class="sheet" v-if="showCouponSheet">
    <view class="sheet-head">
      <text class="sheet-title">选择优惠券</text>
      <text class="sheet-close" @tap="closeCouponSheet">关闭</text>
    </view>
    <scroll-view scroll-y class="sheet-list">
      <!-- 不使用 -->
      <view class="cp-row" :class="{on: !pickedCouponId}" @tap="pickCoupon('')">
        <view class="cp-main">
          <view class="cp-name">不使用优惠券</view>
        </view>
        <text class="cp-tick" v-if="!pickedCouponId">✓</text>
      </view>

      <!-- 可用券 -->
      <view v-for="c in usableCoupons" :key="c._id" class="cp-row"
            :class="{on: pickedCouponId === c._id}" @tap="pickCoupon(c._id)">
        <view class="cp-left">
          <view class="cp-amount">
            <text class="cp-sign">¥</text>{{c.amount}}<text class="cp-unit">元</text>
          </view>
          <view class="cp-cond">{{c.threshold > 0 ? '满 ' + c.threshold + ' 可用' : '无门槛'}}</view>
        </view>
        <view class="cp-main">
          <view class="cp-name">{{c.couponName}}</view>
          <view class="cp-exp">有效期至 {{fmtDate(c.expireAt)}}</view>
        </view>
        <text class="cp-tick" v-if="pickedCouponId === c._id">✓</text>
      </view>
      <view class="empty" v-if="usableCoupons.length === 0 && loadingCoupons">
        加载中…
      </view>
      <view class="empty" v-if="usableCoupons.length === 0 && !loadingCoupons">
        暂无可用优惠券，去会员中心领一张
      </view>

      <!-- 不可用券也列出来并说明原因，让顾客知道为什么不能用 -->
      <view class="cp-sub" v-if="disabledCoupons.length > 0">不可用</view>
      <view v-for="c in disabledCoupons" :key="c._id" class="cp-row disabled">
        <view class="cp-left">
          <view class="cp-amount">
            <text class="cp-sign">¥</text>{{c.amount}}<text class="cp-unit">元</text>
          </view>
          <view class="cp-cond">{{c.threshold > 0 ? '满 ' + c.threshold + ' 可用' : '无门槛'}}</view>
        </view>
        <view class="cp-main">
          <view class="cp-name">{{c.couponName}}</view>
          <view class="cp-exp">{{c.reason}}</view>
        </view>
      </view>
    </scroll-view>
    <view class="sheet-foot">
      <view class="foot-link" @tap="goMember">领券中心</view>
      <button class="primary-btn sm" @tap="closeCouponSheet">确定</button>
    </view>
  </view>
</view>
</template>

<script>
// pages/customer/confirm/confirm.js —— 订单确认 + 优惠结算 + 提交支付
const { call } = require('@/common/cloud.js');
const { yuan } = require('@/common/format.js');
const session = require('@/common/session.js');
const app = getApp();

export default {

  data() {
    return {
    items: [],          // 订单项：{ dishId, name, price, qty }
    staleFlags: [],     // 与 items 一一对应：该项是否已下架/失效
    note: '',           // 备注（如忌口）
    tableNo: '',        // 桌号（仅到店自取）
    submitting: false,  // 防重复提交

    // ---------- 配送方式（外卖平台双模式） ----------
    mode: 'delivery',   // delivery=外卖配送 / pickup=到店自取（默认外卖）
    receiver: '',       // 收货人
    phone: '',          // 联系电话
    address: '',        // 收货地址
    deliveryFee: 0,     // 配送费（服务端算：满 39 免、否则 5 元）

    // ---------- 地址簿与配送时间（外卖增强体验） ----------
    showManual: false,  // 地址手动填写开关（默认走地址簿选择）
    deliveryTimeMode: 'now',  // now=立即送 / book=预约配送
    bookSlots: [        // 预约时段预设，选中的文案直接作为 deliveryTime 下发
      '尽快送达（30 分钟内）',
      '今天 18:00-19:00',
      '今天 19:00-20:00',
      '明天 11:00-12:00',
      '明天 12:00-13:00'
    ],
    selectedSlot: '',   // 已选预约时段文案

    // ---------- 优惠相关 ----------
    userId: '',            // 会员编号（手机号），未登录为空
    balance: 0,            // 会员储值余额
    useBalance: false,     // 是否用余额抵扣（默认否：不替顾客做花钱决定）
    points: 0,             // 会员积分余额
    usePoints: false,      // 是否用积分抵现（同样是开关，不默认替顾客花掉）
    level: '',             // 会员等级（仅展示，折扣由服务端算）
    pickedCouponId: '',    // 选中的持券记录 id
    coupons: [],           // 我的全部可用券
    couponReasons: {},     // {持券id: 不可用原因}
    loadingCoupons: false,

    // ---------- 金额（由服务端 quote 返回，不在前端自算） ----------
    totalPrice: 0,
    discountAmount: 0,
    levelDiscount: 0,      // 会员等级折扣减免（服务端算）
    balancePay: 0,
    pointsPay: 0,          // 积分抵现金额（服务端算）
    pointsUsed: 0,         // 本单消耗的积分数
    payAmount: 0,
    quoting: false,
    // 预计等候分钟（服务端算：基础 2 分钟 + 件数，封顶 30）
    waitMinutes: 0,
    // 试算是否成功。此前 quote 失败时金额停在 0 却仍可提交：
    // 顾客看到「确认支付 ¥0.00（全额抵扣）」，点下去却按原价创建订单。
    quoteOk: false,

    // 幂等键（2026-10-21 加）：同一笔下单请求的唯一标识，防止网络超时后重试导致重复下单
    clientRequestId: '',

    showCouponSheet: false
    };
  },

  computed: {
    // 购物车里有下架商品时不允许提交，避免顾客填完备注才失败
    hasStale() {
      return this.staleFlags.some(Boolean);
    },

    // 本单一共省了多少，用于「已为你节省」提示。
    // 节省只针对商品优惠：配送费是额外支出，要从实付里剔出去再比，
    // 否则「优惠 8 元 + 配送费 5 元」会显示成「只省 3 元」，甚至负数。
    savedAmount() {
      const goodsPay = this.payAmount - (this.mode === 'delivery' ? (this.deliveryFee || 0) : 0);
      return Math.round(((this.totalPrice - goodsPay) || 0) * 100) / 100;
    },

    // 积分可抵多少元：仅用于开关旁的一句提示，真正的抵现金额一律以服务端为准
    pointsValue() {
      return Math.floor((Number(this.points) || 0) / 100);
    },

    // 弹层里分两段：能用的排前面，不能用的沉底并标原因
    usableCoupons() {
      return this.coupons.filter(c => !this.couponReasons[c._id]);
    },
    disabledCoupons() {
      return this.coupons
        .filter(c => !!this.couponReasons[c._id])
        .map(c => Object.assign({}, c, { reason: this.couponReasons[c._id] }));
    },

    // 结算行上显示的券名
    couponLabel() {
      if (!this.pickedCouponId) return '不使用';
      const hit = this.coupons.find(c => c._id === this.pickedCouponId);
      return hit ? hit.couponName : '已选 1 张';
    },

    // 最终下发给后端的配送时间文案（默认「立即送」；预约则取所选时段）
    deliveryTimeText() {
      return this.deliveryTimeMode === 'book' && this.selectedSlot ? this.selectedSlot : '立即送';
    }
  },

  onLoad() {
    const shopId = this.shopId();
    // 幂等键：页面级生成一次，同一页面多次提交（网络超时后重试）都用同一个 key，
    // 服务端据此判重，不会生成重复订单（2026-10-21 加）
    this.clientRequestId = 'cr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const cart = uni.getStorageSync('cart_' + shopId) || {};
    const items = Object.values(cart).map(it => ({
      dishId: it.dish._id,
      name: it.dish.name,
      price: it.dish.price,
      qty: it.qty,
      spec: it.spec || ''  // 规格要求（去冰/微辣等）：从购物车带入订单（2026-10-21 修）
    }));
    this.items = items;
    this.staleFlags = items.map(() => false);
    this.tableNo = app.globalData.tableNo || uni.getStorageSync('tableNo');

    // 配送方式：优先首页入口带来的模式（globalData），回退缓存，默认外卖。
    // 收货信息从缓存回填（上次点过外卖就不用重填一遍）
    this.mode = app.globalData.orderMode || uni.getStorageSync('orderMode') || 'delivery';
    const last = uni.getStorageSync('lastDelivery') || {};
    this.receiver = last.receiver || '';
    this.phone = last.phone || '';
    this.address = last.address || '';

    // 会员身份与上次选的券：从本地缓存恢复，进页面就能看到
    this.syncMember();
    // 记下本次已同步的身份，供 onShow 比对「是不是换了人」
    this._shownUserId = this.userId;

    // 菜单是加购时拿的，期间可能被商家下架，进来先比对一次
    this.checkFresh(shopId);
    this.loadCoupons();
    this.quote();
  },

  /**
   * onShow —— 补上「从会员中心登录完返回」这一程。
   *
   * <p>本页点「去登录」是 navigateTo 进会员中心的，登录完 navigateBack 回来时
   * 本页还在页面栈里，**onLoad 不会重跑**。原先只在 onLoad 读一次登录态，
   * 结果就是：用户明明登录成功了，结算页依旧显示「未登录」、没有可用券、
   * 余额与积分都是 0，等于白登录一场（首页会员条也是同一类毛病）。
   *
   * <p>只在身份**真的变了**时才重算：否则每次 onShow（比如从券选择弹层、
   * 从菜品详情返回）都会把用户刚拨好的余额/积分开关重置掉。
   */
  onShow() {
    // 从地址簿返回：回填选中的地址（不论会员身份是否变化都要处理，故放最前）
    const sel = uni.getStorageSync('selectedAddress');
    if (sel) {
      this.receiver = sel.name;
      this.phone = sel.phone;
      this.address = sel.detail;
      uni.removeStorageSync('selectedAddress');
    }
    const now = session.getUserId();
    if (now === this._shownUserId) return;
    this._shownUserId = now;
    // 身份换了（刚登录/刚退出/换账号），上一位会员选的券一律作废：
    // 它要么不属于新账号，要么选的时候根本没登录资格。
    session.setPickedCoupon('');
    this.syncMember();
    this.loadCoupons();
    this.quote();
  },

  methods: {
    // 替代原生 wxs 的金额格式化（uni-app 不支持 <wxs> 标签）
    fmt(n) {
      n = Number(n) || 0;
      return '¥' + n.toFixed(2);
    },

    // 时间戳 → 2026-10-20
    fmtDate(ts) {
      if (!ts) return '';
      const d = new Date(Number(ts));
      const pad = n => (n < 10 ? '0' : '') + n;
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    },

    shopId() {
      return app.globalData.shopId || uni.getStorageSync('shopId') || 'demo-shop';
    },

    /**
     * 从本地会话恢复会员身份与资产（余额/积分/等级/上次选的券）。
     *
     * <p>抽成方法是因为 onLoad 与 onShow 都要用它 —— 登录页在页面栈上，
     * 登录完返回不会重跑 onLoad，只有 onShow 能兜住。
     */
    syncMember() {
      const prevUserId = this.userId;
      this.userId = session.getUserId();
      const profile = session.getProfile();
      this.balance = profile ? Number(profile.balance || 0) : 0;
      this.points = profile ? Number(profile.points || 0) : 0;
      this.level = profile ? (profile.level || '') : '';
      // 未登录时不要带上一位会员选的券：session.logout() 刻意不清 PICKED_COUPON
      // （券属于账号而非设备），若这里无条件恢复，未登录下单会把别人的券核销掉。
      this.pickedCouponId = this.userId ? session.getPickedCoupon() : '';
      // 身份变化（含换账号）时余额与积分开关一律归零（2026-10-21 修）：
      // 之前只在未登录时重置，换账号后 B 会继承 A 的开关意图，违背「默认不替顾客花钱」
      if (prevUserId !== this.userId) {
        this.useBalance = false;
        this.usePoints = false;
      }
    },

    /**
     * 比对购物车与当前在售商品。
     *
     * <p>购物车是加购时的快照，商家可能已经把某道菜下架了，直接提交会在
     * 后端被拒、且报错不够直白。这里进结算页就先标出来，让顾客自己决定移除。
     *
     * <p>套餐（dishId 以 combo@ 开头）要拆开看：组合里的两个单品都得还在售，
     * 任一被下架这个搭配就失效。注意套餐分区不在普通菜单里，所以单品在售情况
     * 要从套餐接口拿。
     *
     * <p>校验失败不阻塞结算（可能是网络问题），服务端下单时还有一道硬拦截。
     */
    async checkFresh(shopId) {
      try {
        const menuRes = await call('cloudMenu', 'getShopMenu', { shopId, role: 'customer' });
        const onSale = (menuRes.data && menuRes.data.dishes) || [];
        const onSaleIds = [];
        onSale.forEach(d => onSaleIds.push(d._id));

        // 套餐组件在售情况：从套餐接口取（红区/白区不在普通菜单里）
        const comboOnSaleIds = [];
        let comboLoaded = false;  // 套餐接口是否成功返回（2026-10-21 修：失败时不能误判全部下架）
        try {
          const comboRes = await call('cloudCombo', 'get', { shopId });
          const zones = (comboRes.data && comboRes.data.zones) || [];
          zones.forEach(z => (z.dishes || []).forEach(d => comboOnSaleIds.push(d._id)));
          comboLoaded = true;
        } catch (e) { /* 套餐拿不到不影响普通菜品校验 */ }

        const flags = this.items.map(it => {
          if (it.dishId.indexOf('combo@') === 0) {
            // 套餐接口失败时不做下架判断（否则所有 combo@ 都会被误标失效，阻塞结算）
            if (!comboLoaded) return false;
            const parts = it.dishId.split('@');
            return comboOnSaleIds.indexOf(parts[1]) < 0 || comboOnSaleIds.indexOf(parts[2]) < 0;
          }
          return onSaleIds.indexOf(it.dishId) < 0;
        });

        this.staleFlags = flags;
        if (flags.some(Boolean)) {
          uni.showToast({ title: '有商品已下架，请移除', icon: 'none' });
        }
      } catch (e) {
        console.warn('[confirm] 购物车新鲜度校验跳过：', e);
      }
    },

    /** 拉取我的可用券 */
    async loadCoupons() {
      if (!this.userId) {
        this.coupons = [];
        return;
      }
      this.loadingCoupons = true;
      try {
        const res = await call('cloudCoupon', 'my', { shopId: this.shopId(), userId: this.userId });
        const d = res.data || {};
        this.coupons = (d.usable || []).slice();
      } catch (e) {
        console.warn('[confirm] 优惠券加载失败', e);
        this.coupons = [];
      } finally {
        this.loadingCoupons = false;
      }
    },

    /**
     * 向服务端要一次真实金额。
     *
     * <p>刻意不在前端拿 price × qty 算优惠：券门槛、封顶、余额 80% 上限
     * 这些规则都在服务端算，前端自算只会出现「显示的」和「实收的」不一致。
     */
    async quote() {
      if (this.items.length === 0) return;
      this.quoting = true;
      this.quoteOk = false;  // 试算开始时立即失效，防止旧结果被提交（2026-10-21 修）
      const seq = (this._quoteSeq = (this._quoteSeq || 0) + 1);  // 请求序号，防旧响应覆盖新结果
      try {
        const res = await call('cloudOrder', 'quote', {
          shopId: this.shopId(),
          memberId: this.userId,
          memberCouponId: this.pickedCouponId,
          useBalance: this.useBalance,
          usePoints: this.usePoints,
          items: this.items,
          // 配送方式决定配送费与等待文案（金额服务端算，前端不传配送费字段）
          deliveryType: this.mode
        });
        // 旧请求的响应比新请求晚到 → 丢弃，防止覆盖新结果
        if (seq !== this._quoteSeq) return;
        const d = res.data || {};
        this.totalPrice = Number(d.totalPrice || 0);
        this.discountAmount = Number(d.discountAmount || 0);
        this.levelDiscount = Number(d.levelDiscount || 0);
        this.balancePay = Number(d.balancePay || 0);
        this.pointsPay = Number(d.pointsPay || 0);
        this.pointsUsed = Number(d.pointsUsed || 0);
        this.deliveryFee = Number(d.deliveryFee || 0);
        this.payAmount = Number(d.payAmount || 0);
        this.balance = Number(d.balance || 0);
        this.points = Number(d.points || 0);
        this.level = d.level || this.level;
        this.waitMinutes = Number(d.waitMinutes || 0);
        // 只有服务端真的把金额算回来，才允许提交
        this.quoteOk = true;

        // 服务端判定某张券不可用时，把原因带回来，弹层里置灰显示
        if (d.couponUsable === false) {
          this.$set(this.couponReasons, this.pickedCouponId, d.couponReason || '该券不可用');
          // 券已经废了（过期/被用），清掉选择并重算一次，避免一直带着废券提交
          if (this.pickedCouponId) {
            this.pickedCouponId = '';
            session.setPickedCoupon('');
            uni.showToast({ title: d.couponReason || '优惠券不可用', icon: 'none' });
            this.quoting = false;
            this.quote();
            return;
          }
        }
      } catch (e) {
        // 旧请求的失败不应影响新请求状态
        if (seq !== this._quoteSeq) return;
        // 不再「按无优惠展示」：那会让金额停在 ¥0.00 却仍可提交。
        // 置 quoteOk=false 由按钮拦住，用户看到的是「金额计算失败」而不是假的 0 元。
        this.quoteOk = false;
        console.warn('[confirm] 优惠试算失败：', e);
      } finally {
        if (seq === this._quoteSeq) this.quoting = false;
      }
    },

    /** 移除失效项，同步刷新合计与本地购物车 */
    removeItem(index) {
      const removed = this.items[index];
      const items = this.items.slice();
      const flags = this.staleFlags.slice();
      items.splice(index, 1);
      flags.splice(index, 1);
      this.items = items;
      this.staleFlags = flags;

      const cart = uni.getStorageSync('cart_' + this.shopId()) || {};
      delete cart[removed.dishId];
      uni.setStorageSync('cart_' + this.shopId(), cart);
      this.quote();

      if (items.length === 0) {
        uni.showToast({ title: '购物车已空', icon: 'none' });
        setTimeout(() => uni.navigateBack(), 600);
      }
    },

    onNote(e) { this.note = e.detail.value; },

    // 收货信息统一输入处理（receiver/phone/address 三个字段共用）
    onField(key, e) { this[key] = e.detail.value; },

    // 切换配送方式：配送费与等待时间随之变化，必须重新试算
    switchMode(m) {
      if (this.mode === m) return;
      this.mode = m;
      app.globalData.orderMode = m;
      uni.setStorageSync('orderMode', m);
      this.quote();
    },

    // ---------- 优惠券交互 ----------
    openCouponSheet() {
      if (!this.userId) {
        this.goLogin();
        return;
      }
      this.showCouponSheet = true;
      // 每张券能不能用取决于本单金额，打开时重新向服务端问一遍
      this.refreshCouponReasons();
    },
    closeCouponSheet() { this.showCouponSheet = false; },

    pickCoupon(id) {
      this.pickedCouponId = id;
      session.setPickedCoupon(id);
      this.quote();
    },

    /**
     * 逐张券问服务端「这一单能不能用」，把原因攒进 couponReasons。
     *
     * <p>为什么不在前端按 threshold 判断？因为真实规则还有封顶、
     * 归属校验、已使用判定等，前端只算门槛会给出错误承诺。
     */
    async refreshCouponReasons() {
      const reasons = {};
      const shopId = this.shopId();
      for (let i = 0; i < this.coupons.length; i++) {
        const c = this.coupons[i];
        try {
          const res = await call('cloudOrder', 'quote', {
            shopId,
            memberId: this.userId,
            memberCouponId: c._id,
            useBalance: false,
            items: this.items
          });
          const d = res.data || {};
          if (d.couponUsable === false) {
            reasons[c._id] = d.couponReason || '该券不可用';
          }
        } catch (e) {
          // 单张券试算失败不影响其它券，标成不可用即可
          reasons[c._id] = '试算失败';
        }
      }
      this.couponReasons = reasons;
    },

    onToggleBalance(e) {
      this.useBalance = e.detail.value;
      this.quote();
    },

    // 积分抵现开关：切换后必须重算——抵现金额受「应付金额的 20%」上限约束，
    // 前端自己算不出来，只有服务端知道这一刻能抵多少。
    onTogglePoints(e) {
      this.usePoints = e.detail.value;
      this.quote();
    },

    goLogin() {
      uni.showModal({
        title: '需要登录',
        content: '登录会员后才能使用优惠券与储值余额，是否前往登录？',
        success: r => {
          if (r.confirm) {
            // 注意：项目里没有 pages/customer/login 这个页面，登录 UI 就在会员中心
            uni.navigateTo({ url: '/pages/customer/member/member' });
          }
        }
      });
    },
    goMember() {
      this.showCouponSheet = false;
      uni.navigateTo({ url: '/pages/customer/member/member' });
    },

    // 跳地址簿选地址（from=confirm 让地址页点选后回填并返回）
    goAddress() {
      uni.navigateTo({ url: '/pages/customer/address/address?from=confirm' });
    },
    // 切换配送时间模式：切到预约时若未选时段，提交时再校验拦截
    switchDTime(m) {
      this.deliveryTimeMode = m;
    },
    pickSlot(s) {
      this.selectedSlot = s;
    },

    // ---------- 提交 ----------
    async submit() {
      if (this.submitting || this.hasStale) return;
      if (this.items.length === 0) {
        uni.showToast({ title: '购物车是空的', icon: 'none' });
        return;
      }
      // 金额没算出来就不许提交：宁可让用户重试，也不能让他看着 ¥0.00 被收全款
      if (!this.quoteOk) {
        uni.showToast({ title: '金额尚未算出，请稍候重试', icon: 'none' });
        this.quote();
        return;
      }
      // 外卖单本地预校验：服务端也会硬校验，这里提前拦是为了别让顾客
      // 填完备注点提交才被告知缺信息（体验差一截）
      if (this.mode === 'delivery') {
        if (!this.address.trim() || !this.phone.trim()) {
          uni.showToast({
            title: this.address ? '请填写联系电话' : '请选择或填写收货地址',
            icon: 'none'
          });
          return;
        }
        if (this.deliveryTimeMode === 'book' && !this.selectedSlot) {
          uni.showToast({ title: '请选择预约配送时间', icon: 'none' });
          return;
        }
      }
      this.submitting = true;

      const shopId = this.shopId();

      // ---- 第 1 步：创建订单 ----
      // 关键认知：create 成功的那一刻，券已经核销、余额已经扣了（服务端在 create 里做）。
      // 所以 create 与 pay 必须分开处理失败——pay 失败时订单已经存在，
      // 绝不能把用户留在结算页让他再点一次提交（那会建第二张单，券和余额被重复占用）。
      let created;
      try {
        // 优惠与配送费金额由服务端算，这里只传意图字段：用哪张券、要不要用
        // 余额/积分、配送方式与收货信息（外卖单）
        created = await call('cloudOrder', 'create', {
          shopId,
          tableNo: this.tableNo,
          items: this.items,
          note: this.note,
          memberId: this.userId,
          memberCouponId: this.pickedCouponId,
          useBalance: this.useBalance,
          usePoints: this.usePoints,
          deliveryType: this.mode,
          receiver: this.receiver,
          phone: this.phone,
          address: this.address,
          // 期望配送时间文案：立即送 / 预约时段（服务端只透传存储，不参与计费）
          deliveryTime: this.deliveryTimeText,
          // 幂等键：同一页面反复提交用同一个 key，服务端判重防重复下单
          clientRequestId: this.clientRequestId
        });
      } catch (e) {
        // create 失败 = 订单没建出来，券和余额都没动，留在页面重试是安全的
        this.submitting = false;
        uni.showToast({ title: this.friendlyError(e) || '下单失败，请重试', icon: 'none' });
        this.quote();   // 券可能刚被占用，金额刷新一次
        return;
      }

      // 下单成功：记住本次收货信息，下次点外卖免重填
      if (this.mode === 'delivery') {
        uni.setStorageSync('lastDelivery', {
          receiver: this.receiver,
          phone: this.phone,
          address: this.address
        });
      }

      // 订单访问凭证：服务端一次性下发，本机存着。
      // 游客没有会员身份，后续查单/取消/支付全靠它认「这是本机下的单」——
      // 不存的话游客订单就成了没人认得的单，地址打码、也取消不了。
      session.setOwnerKey(created.orderId, created.ownerKey);

      // 订单已存在：购物车立即清掉。
      // 不清的话用户返回菜单会看到原商品还在，再点一次就是重复下单同一批菜。
      uni.removeStorageSync('cart_' + shopId);
      session.setPickedCoupon('');
      // 余额变动过，本地缓存的会员档案已过期
      session.setProfile(null);

      // ---- 第 2 步：支付 ----
      try {
        await call('cloudOrder', 'pay', { orderId: created.orderId });
      } catch (e) {
        // 支付失败：订单停在 unpaid。跳到订单页，让顾客「继续支付」或「取消（退券退币）」，
        // 而不是回到结算页再建一单。
        this.submitting = false;
        uni.showToast({ title: '支付未完成，请在订单页继续', icon: 'none' });
        uni.redirectTo({
          url: '/pages/customer/order/order?orderId=' + created.orderId + '&unpaid=1'
        });
        return;
      }

      // ---- 第 3 步：跳转订单状态页 ----
      this.submitting = false;
      const saved = Math.round(((created.totalPrice || 0) - (created.payAmount || 0)) * 100) / 100;
      uni.redirectTo({
        url: '/pages/customer/order/order?orderId=' + created.orderId + '&saved=' + saved
      });
    },

    /**
     * 把异常转成能给用户看的文案。
     * 不直接弹原文：会露出 localhost:8080 这类内网地址，还容易被截成半句话。
     */
    friendlyError(e) {
      const raw = String(e || '');
      if (/无法连接后端|网络|timeout/i.test(raw)) return '网络异常，请稍后重试';
      return raw.slice(0, 20) || '';
    }
  },

  // 页面卸载时解除钩子，避免残留轮询（当前页无轮询，留作扩展位）
  onUnload() {}
}
</script>

<style scoped>
/* pages/customer/confirm/confirm.wxss */
.block-title { font-weight: 700; font-size: 30rpx; margin-bottom: 16rpx; }
.row { display: flex; align-items: center; padding: 16rpx 0; }
.row-name { flex: 1; font-size: 28rpx; }
.row-qty { color: var(--muted); margin: 0 24rpx; font-size: 26rpx; }
.row-price { font-size: 28rpx; width: 160rpx; text-align: right; }

/* 已下架项：红字 + 灰底 + 可移除 */
.row.stale { background: #fff5f5; border-radius: 8rpx; }
.row.stale .row-name,
.row.stale .row-price { color: #c0392b; }
.stale-tag {
  font-size: 20rpx;
  color: #fff;
  background: #c0392b;
  border-radius: 4rpx;
  padding: 2rpx 8rpx;
  margin-left: 10rpx;
}
.row-del {
  font-size: 24rpx;
  color: #c0392b;
  margin-left: 16rpx;
  text-decoration: underline;
}
.stale-bar {
  font-size: 24rpx;
  color: #c0392b;
  background: #fff5f5;
  border-radius: 8rpx;
  padding: 16rpx 20rpx;
  margin-top: 12rpx;
  line-height: 1.5;
}
.kv { display: flex; justify-content: space-between; align-items: center; font-size: 28rpx; padding: 12rpx 0; }
.kv-left { display: flex; align-items: baseline; }
.kv-sub { color: var(--muted); font-size: 22rpx; margin-left: 12rpx; }
.kv-right { display: flex; align-items: center; }
.kv-arrow { color: #dce9e4; margin-left: 10rpx; font-size: 30rpx; }
.kv-link { color: var(--primary); font-size: 26rpx; }
.kv.tap:active { background: #f2f8f6; }
.coupon-picked { color: var(--primary); font-size: 26rpx; }
.coupon-picked.none { color: var(--muted); }

/* 费用明细 */
.amt-row {
  display: flex;
  justify-content: space-between;
  font-size: 26rpx;
  color: #4d6f65;
  padding: 10rpx 0;
}
.amt-row .minus { color: #e74c3c; }
/* 配送费是额外支出，用橙色加号区别于红色减号（优惠），一眼分清方向 */
.amt-row .plus { color: #e67e22; }

/* 配送方式双 tab */
.mode-tabs {
  display: flex;
  background: #f2f8f6;
  border-radius: 12rpx;
  padding: 6rpx;
  margin-bottom: 16rpx;
}
.mtab {
  flex: 1;
  text-align: center;
  font-size: 26rpx;
  padding: 14rpx 0;
  border-radius: 10rpx;
  color: #4d6f65;
}
.mtab.on { background: #fff; color: #087c61; font-weight: 700; }

/* 配送时间双 tab：复用 mode-tabs，缩窄一点 */
.mode-tabs.sm { margin-top: 8rpx; margin-bottom: 12rpx; }
.mode-tabs.sm .mtab { padding: 10rpx 0; }

/* 地址选择入口行（点击跳地址簿） */
.addr-pick {
  display: flex; align-items: center;
  background: #f2f8f6; border-radius: 12rpx;
  padding: 20rpx; margin-top: 12rpx;
}
.addr-picked { flex: 1; }
.ap-top { display: flex; align-items: baseline; }
.ap-name { font-size: 28rpx; font-weight: 600; }
.ap-phone { font-size: 26rpx; color: #3e5e55; margin-left: 16rpx; }
.ap-detail { font-size: 26rpx; color: #4d6f65; margin-top: 6rpx; line-height: 1.5; }
.addr-empty { flex: 1; font-size: 28rpx; color: var(--primary); }
.addr-quick { font-size: 24rpx; color: var(--muted); margin-top: 12rpx; }

/* 预约时段按钮组 */
.block-sub { font-size: 26rpx; color: #3e5e55; margin-top: 16rpx; }
.slots { display: flex; flex-wrap: wrap; gap: 16rpx; margin-top: 12rpx; }
.slot {
  font-size: 24rpx; color: #3e5e55;
  background: #f2f8f6; border-radius: 8rpx;
  padding: 12rpx 20rpx;
}
.slot.on { background: #eaf4fb; color: #087c61; border: 2rpx solid #087c61; font-weight: 600; }

/* 收货信息输入 */
.addr-input {
  background: #f2f8f6;
  border-radius: 12rpx;
  padding: 20rpx;
  margin-top: 12rpx;
  font-size: 28rpx;
}
.fee-tip {
  font-size: 22rpx;
  color: var(--muted);
  margin-top: 12rpx;
  line-height: 1.5;
}

/* 会员等级 / 积分消耗的小标签：跟在费用行标题后面，不抢数字的视线 */
.tag-lv {
  margin-left: 10rpx;
  padding: 2rpx 10rpx;
  font-size: 20rpx;
  color: #b8860b;
  background: #fdf5e0;
  border-radius: 6rpx;
}
.total-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1rpx solid #f2f8f6;
  margin-top: 12rpx;
  padding-top: 20rpx;
  font-size: 28rpx;
}
.total-num { font-size: 38rpx; font-weight: 700; }
.saved-tip {
  text-align: right;
  color: #e74c3c;
  font-size: 24rpx;
  margin-top: 10rpx;
}
/* 预计等候：跟随费用明细的小字行，数字用主题色突出 */
.wait-row {
  display: flex;
  justify-content: space-between;
  font-size: 26rpx;
  color: #4d6f65;
  padding: 10rpx 0 0;
}
.wait-num { color: var(--primary); font-weight: 600; }

.note-input {
  background: #f2f8f6;
  border-radius: 12rpx;
  padding: 20rpx;
  margin-top: 12rpx;
  font-size: 28rpx;
}
.tip { color: var(--muted); font-size: 24rpx; text-align: center; margin-top: 16rpx; }

/* ================= 优惠券弹层 ================= */
.mask {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,.5);
  z-index: 20;
}
.sheet {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  background: #fff;
  border-radius: 24rpx 24rpx 0 0;
  padding: 32rpx;
  z-index: 21;
  height: 72vh;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}
.sheet-head { display: flex; justify-content: space-between; align-items: center; }
.sheet-title { font-size: 32rpx; font-weight: 700; }
.sheet-close { color: var(--muted); font-size: 26rpx; }
.sheet-list { flex: 1; margin-top: 16rpx; }
.sheet-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 20rpx;
  border-top: 1rpx solid #f2f8f6;
}
.foot-link { color: var(--primary); font-size: 26rpx; }
.primary-btn.sm { width: 220rpx; margin: 0; }

/* 券行 */
.cp-row {
  display: flex;
  align-items: center;
  padding: 22rpx 0;
  border-bottom: 1rpx solid #f2f8f6;
}
.cp-row.on { background: #eaf4fb; margin: 0 -16rpx; padding-left: 16rpx; padding-right: 16rpx; }
.cp-row.disabled { opacity: .5; }
.cp-left {
  width: 160rpx;
  flex-shrink: 0;
  border-right: 1rpx dashed #dce9e4;
  text-align: center;
}
.cp-amount { color: var(--primary); font-weight: 700; font-size: 38rpx; line-height: 1.1; }
.cp-sign { font-size: 20rpx; }
.cp-unit { font-size: 22rpx; font-weight: 400; }
.cp-cond { font-size: 20rpx; color: var(--muted); margin-top: 4rpx; }
.cp-main { flex: 1; padding-left: 20rpx; overflow: hidden; }
.cp-name { font-size: 28rpx; color: #183c34; }
.cp-exp { font-size: 22rpx; color: var(--muted); margin-top: 6rpx; }
.cp-tick { color: var(--primary); font-size: 32rpx; font-weight: 700; padding-right: 16rpx; }
.cp-sub {
  font-size: 24rpx;
  color: var(--muted);
  padding: 20rpx 0 8rpx;
}
.empty { text-align: center; color: var(--muted); padding: 60rpx 0; font-size: 26rpx; }
</style>
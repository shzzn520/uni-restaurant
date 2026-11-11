<template>
<!--
THESIS: Delivery progress follows the store-updated order stages, not a decorative map or invented courier dot.
OWN-WORLD: A dispatch manifest in deep service green, cobalt route marks, white paper, and clear station rules.
STORY: Diners see the current order stage, delivery address, and estimate, then know what happens next.
FIRST VIEWPORT: Order state and estimate lead; a vertical delivery ticket follows immediately, with address and cost beneath.
FORM: Customer order detail, candidate 3 from the grounded delivery systems; staging is a numbered vertical handoff stack (seed 5fdce4f5).
-->
<!-- pages/customer/order/order.wxml -->
<view class="container" v-if="order">
  <!-- 当前状态 -->
  <view class="status-card" :class="order.status === 'canceled' ? 'cancel' : ''">
    <!-- 取餐号：自取单凭它到柜台领餐；外卖单号供门店核对配送订单 -->
    <view class="pickup" v-if="order.pickupNo && order.status !== 'canceled'">
      <view class="pickup-label">{{isDelivery ? '配送单号' : '取餐号'}}</view>
      <view class="pickup-no">{{order.pickupNo}}</view>
      <view class="pickup-hint">{{isDelivery ? '门店按此号核对配送订单' : '请凭此号到柜台取餐'}}</view>
    </view>
    <!-- 外卖单收货信息：骑手联系与送达依据，跟取餐号同级展示 -->
    <view class="addr-block" v-if="isDelivery && order.address">
      <view class="addr-line">🛵 {{order.receiver}} {{order.phone}}</view>
      <view class="addr-line sub">{{order.address}}</view>
      <view class="addr-line sub" v-if="order.deliveryTime">🕐 期望送达：{{order.deliveryTime}}</view>
    </view>
    <view class="status-text">{{statusText}}</view>
    <view class="order-no">订单号：{{order.orderNo}}</view>
    <view class="order-table" v-if="!isDelivery && tableNo">桌号：{{tableNo}}</view>
    <!-- 等候时间是下单时算定的预估；自取在出餐后隐藏，外卖在配送完成前保留送达预估。 -->
    <view class="wait-tip" v-if="showWait">
      {{isDelivery ? '预计约 ' + waitMinutes + ' 分钟送达 · 约 ' + readyTimeText + ' 前送达'
                   : '预计等候约 ' + waitMinutes + ' 分钟 · 约 ' + readyTimeText + ' 可取'}}
    </view>
  </view>

  <!-- 外卖按真实订单状态呈现交接节点；不展示未接入的骑手身份或 GPS 位置 -->
  <view class="delivery-track" v-if="isDelivery">
    <view class="track-head">
      <view class="track-title">配送进度</view>
      <view class="track-state" :class="'state-' + order.status">{{deliveryStateLabel}}</view>
    </view>
    <view class="track-cancelled" v-if="order.status === 'canceled'">
      本单已取消，配送流程已结束。
    </view>
    <view class="route-list" v-else>
      <view v-for="node in deliveryNodes" :key="node.key"
            class="route-node" :class="{done: node.done, current: node.current}">
        <view class="route-marker">{{node.done ? '✓' : node.index}}</view>
        <view class="route-copy">
          <view class="route-title">{{node.title}}</view>
          <view class="route-detail" v-if="node.current">{{node.detail}}</view>
        </view>
      </view>
    </view>
    <view class="track-disclaimer">配送状态由门店更新；当前演示版不含骑手实时定位。</view>
  </view>

  <!-- 自取单继续使用紧凑进度条 -->
  <view class="steps" v-else>
    <view v-for="(item, index) in steps" :key="item.key" class="step" :class="item.done ? 'done' : ''">
      <view class="dot"></view>
      <view class="step-text">{{item.text}}</view>
    </view>
  </view>

  <!-- 商品明细 -->
  <view class="card">
    <view class="block-title">点餐明细</view>
    <view v-for="(item, index) in order.items" :key="item.dishId" class="row">
      <view class="row-name">{{item.name}}</view>
      <view class="row-qty">x{{item.qty}}</view>

      <!-- 评价入口：仅「已完成」订单可见。已评价显示星级摘要，未评价给按钮。
           外层只判断「能不能评价」，内层再分「评过/没评过」，
           避免同一元素上写两个 v-if（后者会覆盖前者，条件永远以最后一个为准） -->
      <view v-if="canReview(item)" class="fb-btn" @tap.stop="goReview(item)">
        {{ rvOf(item.dishId) ? starsText(rvOf(item.dishId)) : '评价' }}
      </view>

      <!-- 投诉反馈：菜品有问题才点，与上面的「评价」是两件事 -->
      <view
        v-if="fbOf(item.dishId)"
        class="fb-state"
        :class="fbOf(item.dishId) === 'handled' ? 'done' : 'wait'"
      >{{ fbOf(item.dishId) === 'handled' ? '已处理' : '待处理' }}</view>
      <view
        v-else-if="order && (order.status === 'paid' || (order.status === 'done' && !isDelivery))"
        class="fb-btn"
        @tap.stop="feedback(item)"
      >反馈</view>

      <view class="row-price price">{{fmt(item.price * item.qty)}}</view>
    </view>

    <!-- 优惠明细：只有真发生了优惠才展开，避免每单都多三行「¥0.00」 -->
    <view class="amt-row" v-if="discountAmount > 0">
      <text>商品原价</text>
      <text class="price">{{fmt(order.totalPrice)}}</text>
    </view>
    <view class="amt-row" v-if="discountAmount > 0">
      <text>优惠券减免</text>
      <text class="price minus">-{{fmt(discountAmount)}}</text>
    </view>
    <view class="amt-row" v-if="balancePay > 0">
      <text>储值余额抵扣</text>
      <text class="price minus">-{{fmt(balancePay)}}</text>
    </view>
    <!-- 配送费：外卖单才显示（金额服务端算定随单落库，不参与优惠） -->
    <view class="amt-row" v-if="isDelivery && deliveryFee > 0">
      <text>配送费</text>
      <text class="price plus">+{{fmt(deliveryFee)}}</text>
    </view>

    <view class="row total-row">
      <view class="row-name">{{saving > 0 ? '实付金额' : '合计'}}</view>
      <view class="price total-num">{{totalText}}</view>
    </view>
    <view class="saved-line" v-if="saving > 0">本单共省 ¥{{fmt(saving)}}</view>
    <view class="note-line" v-if="order.note">备注：{{order.note}}</view>
  </view>

  <view class="tip" v-if="isDelivery">配送状态由门店更新；订单状态会自动刷新，送达后停止刷新。</view>
  <view class="tip" v-else>状态自动刷新，备餐完成后会更新为「已完成」。</view>

  <!-- 继续支付：下单成功但支付请求失败时，订单停在 unpaid。
       券在下单一刻就已核销、余额已扣，所以必须给顾客两条明确的出路：
       继续支付，或取消（取消会退券退余额）。否则顾客只能反复回结算页重下单，
       那才是真的资损——券被烧、余额被扣，还多出一张废单。 -->
  <view class="pay-wrap" v-if="canPay">
    <button class="pay-btn" @tap="onPay" :disabled="paying">{{paying ? '处理中...' : '继续模拟支付'}}</button>
    <view class="pay-hint">当前接口仅模拟订单支付，不会发起真实微信支付。本单优惠券与储值余额已被占用，完成模拟支付或取消订单后才会释放。</view>
  </view>

  <!-- 顾客自主取消：状态机允许 unpaid/paid → canceled。
       只给这两个状态显示——备餐中厨师已动工、已完成已出餐，都不该让顾客反悔。
       取消会把该单用掉的券和余额退回来（数据层 refund），这点要在文案里说清，
       否则顾客不敢点，演示时也不敢点。 -->
  <view class="cancel-wrap" v-if="canCancel">
    <button class="cancel-btn" @tap="onCancel">取消订单</button>
    <view class="cancel-hint">取消后本单使用的优惠券与储值余额会退回到账户</view>
  </view>
  <view class="refund-wrap" v-if="canRequestRefund">
    <button class="refund-btn" @tap="requestRefund">申请售后退款</button>
    <view class="refund-hint">申请提交后由商家审核；批准仅代表审核通过，退款需商家人工处理，不会自动发起微信退款。</view>
  </view>
  <view class="refund-state" v-else-if="refundStatusLoading">
    正在查询售后申请…
  </view>
  <view class="refund-state" v-else-if="refundStatusError">
    {{refundStatusError}}
    <text class="refund-retry" @tap="loadRefundRequest">重新查询</text>
  </view>
  <view class="refund-state" v-else-if="refundRequestStatus">
    售后申请：{{refundStatusText(refundRequestStatus)}}
    <view class="refund-hint" v-if="refundRequestStatus === 'approved_pending_manual_refund' || refundRequestStatus === 'approved'">
      商家已批准申请；退款仍待人工处理，当前不代表款项已退回。
    </view>
    <view class="refund-hint" v-if="refundRequestNote">{{refundRequestNote}}</view>
  </view>
</view>

<view class="container" v-else >
  <view class="loading">加载中...</view>
</view>
</template>

<script>
// pages/customer/order/order.js —— 实时查看订单状态
const { call } = require('@/common/cloud.js');
const { yuan, STATUS_TEXT, STATUS_ORDER, FEEDBACK_REASONS } = require('@/common/format.js');
const app = getApp();
export default {

  data() {
    return {
    order: null,
    statusText: '',
    steps: [],       // 进度条节点
    totalText: '',
    tableNo: '',
    discountAmount: 0, // 优惠券减免
    balancePay: 0,     // 余额抵扣
    deliveryFee: 0,    // 配送费（外卖单有值，服务端算定落库）
    waitMinutes: 0,    // 预计等候分钟（下单时服务端算定落库；老订单为 0，不展示）
    fbMap: {},         // dishId -> 该菜最新反馈的状态（'new'/'handled'），顾客看商家是否已处理
    rvMap: {},         // dishId -> 该菜在本单已提交的评价（评分），已评价的不再给按钮
    paying: false,     // 继续支付中：防重复点击，重复 pay 会重复累计积分
    refundRequestStatus: '',
    refundRequestNote: '',
    refundStatusLoading: false,
    refundStatusLoaded: false,
    refundStatusError: ''
    };
  },

  computed: {
    // 是否外卖单：deliveryType 兜底 pickup（老订单没有该字段也不误判）
    isDelivery() {
      return !!this.order && this.order.deliveryType === 'delivery';
    },
    // 本单共省了多少 = 原价 - 实付。
    // 外卖单要从实付里剔掉配送费：配送费是额外支出不是优惠抵掉的，
    // 否则「优惠 8 元 + 配送费 5 元」会被算成「只省 3 元」甚至负数
    saving() {
      const goodsPay = this.payAmount - (this.isDelivery ? this.deliveryFee : 0);
      return Math.round((((this.order ? this.order.totalPrice : 0) - goodsPay) || 0) * 100) / 100;
    },
    // 实付金额。旧订单没有 payAmount 字段（历史数据），退化为原价。
    // 注意 payAmount=0 也是合法值（全额抵扣），不能用 v>0 判断（2026-10-21 修）
    payAmount() {
      if (!this.order) return 0;
      const v = Number(this.order.payAmount);
      return this.order.payAmount != null && Number.isFinite(v) ? v : Number(this.order.totalPrice || 0);
    },
    // 能否取消：仅待支付 / 已支付·待接单。备餐中与已完成都是商家的沉没成本，
    // 放给顾客取消会被滥用；已取消与已完成本身也不再显示
    canCancel() {
      if (!this.order) return false;
      return this.order.status === 'unpaid' || this.order.status === 'paid';
    },
    // 能否继续支付：只有 unpaid 才需要。
    // 下单(create)时券已核销、余额已扣，若支付请求失败（网络抖动/后端超时），
    // 单子会停在 unpaid —— 没有这个入口，顾客只能干等，券就白烧了。
    canPay() {
      return !!this.order && this.order.status === 'unpaid';
    },
    canRequestRefund() {
      if (!this.order || !this.refundStatusLoaded || this.refundStatusError || this.refundRequestStatus) return false;
      return ['paid', 'preparing', 'done', 'delivering', 'delivered'].indexOf(this.order.status) >= 0;
    },

    // 自取出餐后不再展示等候时间；外卖继续展示预计送达时间直到送达或取消。
    showWait() {
      if (!this.order || this.waitMinutes <= 0) return false;
      if (this.isDelivery) {
        return ['unpaid', 'paid', 'preparing', 'done', 'delivering'].indexOf(this.order.status) >= 0;
      }
      return this.order.status === 'unpaid'
        || this.order.status === 'paid'
        || this.order.status === 'preparing';
    },

    // 预计完成时刻：下单时间 + 服务端计算的等候分钟，格式 HH:mm
    readyTimeText() {
      if (!this.order || this.waitMinutes <= 0) return '';
      const d = new Date(Number(this.order.createTime || 0) + this.waitMinutes * 60000);
      const pad = n => (n < 10 ? '0' : '') + n;
      return pad(d.getHours()) + ':' + pad(d.getMinutes());
    },

    deliveryNodes() {
      if (!this.order) return [];
      const flow = [
        ['unpaid', '订单已提交', '完成支付后，门店将开始处理订单。'],
        ['paid', '等待门店接单', '支付已完成，请稍候门店确认。'],
        ['preparing', '门店备餐中', '门店正在准备餐品。'],
        ['done', '餐品已出餐', '餐品已出餐，等待配送交接。'],
        ['delivering', '配送途中', '订单正在配送途中。'],
        ['delivered', '已送达', '订单已送达，请查收。']
      ];
      const currentIndex = flow.findIndex(item => item[0] === this.order.status);
      return flow.map((item, index) => ({
        key: item[0],
        index: index + 1,
        title: item[1],
        detail: item[2],
        done: currentIndex >= index,
        current: currentIndex === index
      }));
    },

    deliveryStateLabel() {
      if (!this.order) return '';
      return {
        unpaid: '待支付',
        paid: '待门店接单',
        preparing: '备餐中',
        done: '等待配送',
        delivering: '配送中',
        delivered: '已送达',
        canceled: '已取消'
      }[this.order.status] || '状态待确认';
    }
  },

  onLoad(options) {
    this.orderId = options.orderId;
    this.load();
    this.loadRefundRequest();
    // 反馈与评价状态不随订单轮询刷新：商家处理反馈以小时计，
    // 单独在进入页面/提交后拉一次即可，跟 3 秒轮询绑在一起只会白白翻倍请求量
    this.loadFeedback();
    this.loadReviews();
    // 轮询实现「实时」：每 3 秒刷新一次订单状态。
    // 到终态后由 load() 内部停掉（见 stopPolling），不会一直请求下去。
    this.timer = setInterval(() => this.load(), 3000);
  },

  onUnload() {
    this.stopPolling();
  },

  /**
   * onShow —— 从评价页返回时刷新「已评价」状态。
   *
   * <p>首次 onShow 紧跟在 onLoad 之后，而 onLoad 已经拉过一遍，这里跳过避免重复请求。
   * 补它的原因：在评价页提交成功后 navigateBack 回来，rvMap 还是进入前的旧值，
   * 菜品行会继续显示「评价」按钮 —— 用户以为没提交成功，再点一次又被后端以
   * 「同一道菜不能重复评价」挡回来，白白困惑一轮。
   */
  onShow() {
    if (!this._shownOnce) {
      this._shownOnce = true;
      return;
    }
    this.loadFeedback();
    this.loadReviews();
  },

  methods: {
    // 停掉轮询。订单到 done / canceled 后状态不会再变，继续轮询纯属浪费流量与电量
    stopPolling() {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    },

    // 替代原生 wxs 的金额格式化（uni-app 不支持 <wxs> 标签）
    fmt(n) {
      n = Number(n) || 0;
      return '¥' + n.toFixed(2);
    },

    // 评分 → ★★★☆☆ 文本
    starsText(n) {
      const filled = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
      return '★★★★★'.slice(0, filled) + '☆☆☆☆☆'.slice(0, 5 - filled);
    },

    // 当前门店（评价页需要）
    shopId() {
      return app.globalData.shopId || uni.getStorageSync('shopId') || 'demo-shop';
    },

    async load() {
    try {
      const res = await call('cloudOrder', 'get', { orderId: this.orderId });
      const o = res.data;
      if (!o) return;
      const curIdx = STATUS_ORDER.indexOf(o.status);
      // 进度节点：外卖单在 done 之后追加「配送中 / 已送达」两个物流环节；自取单到 done 即终态。
      // 用 o.deliveryType 局部判断（此时 this.order 尚未赋值，computed isDelivery 还取旧值）
      const isDel = o.deliveryType === 'delivery';
      const flow = isDel
        ? ['unpaid', 'paid', 'preparing', 'done', 'delivering', 'delivered']
        : ['unpaid', 'paid', 'preparing', 'done'];
      const steps = flow.map(s => ({
        key: s,
        text: s === 'paid' ? '模拟支付完成' : STATUS_TEXT[s],
        done: curIdx >= STATUS_ORDER.indexOf(s) && o.status !== 'canceled'
      }));
      this.order = o;
      this.steps = steps;
      this.statusText = o.status === 'paid' ? '模拟支付完成·待接单' : STATUS_TEXT[o.status];
      // 实付优先；无优惠的订单实付 == 原价
      this.totalText = yuan(this.payAmount);
      this.discountAmount = Number(o.discountAmount || 0);
      this.balancePay = Number(o.balancePay || 0);
      this.deliveryFee = Number(o.deliveryFee || 0);
      this.waitMinutes = Number(o.waitMinutes || 0);
      this.tableNo = o.tableNo || '';
      this._fail = 0;
      // 终态：自取已完成 / 外卖已送达 / 已取消。状态不会再变了，停掉轮询省流量。
      // 注意外卖单的 done（已出餐）不是终态，后面还有 delivering → delivered，
      // 不能在 done 就停轮询，否则用户看不到配送状态更新（2026-10-21 修）
      // isDel 已在上面声明（line ~262），此处复用
      const isTerminal = o.status === 'canceled'
        || o.status === 'delivered'
        || (o.status === 'done' && !isDel);
      if (isTerminal) {
        this.stopPolling();
        // 刚变成完成时拉一次评价状态，让「评价」按钮立刻出现
        if (o.status === 'done' && !this._rvLoaded) this.loadReviews();
      }
    } catch (e) {
      // 轮询失败：连续几次后轻提示一次，避免静默无感知
      this._fail = (this._fail || 0) + 1;
      if (this._fail === 3) {
        uni.showToast({ title: '连接后端失败，请检查服务', icon: 'none' });
      }
    }
    },

    async loadRefundRequest() {
      if (this.refundStatusLoading) return;
      this.refundStatusLoading = true;
      this.refundStatusError = '';
      try {
        const response = await call('cloudRefund', 'get', { orderId: this.orderId });
        const request = response && response.data;
        this.refundRequestStatus = request ? (request.status || '') : '';
        this.refundRequestNote = request ? (request.decisionNote || '') : '';
        this.refundStatusLoaded = true;
      } catch (e) {
        this.refundRequestStatus = '';
        this.refundRequestNote = '';
        this.refundStatusLoaded = false;
        this.refundStatusError = '暂时无法查询售后状态，请重试。';
      } finally {
        this.refundStatusLoading = false;
      }
    },

    // 是否可评价：自取单「已完成」、外卖单「已送达」才开放；外卖单 done 只是「已出餐」，货没到不该评价。
    // 套餐类不给评价入口（combo@ 虚拟组合在 dish 表无记录，评价必失败）
    canReview(item) {
      if (!this.order) return false;
      const reviewable = (this.order.status === 'done' && !this.isDelivery)
        || this.order.status === 'delivered';
      if (!reviewable) return false;
      return !!item && item.dishId.indexOf('combo@') !== 0;
    },

    // 进入评价页；已评价的也允许进去改成新评价（后端会拦重复提交）
    goReview(item) {
      uni.navigateTo({
        url: '/pages/customer/review/review?orderId=' + this.orderId
          + '&dishId=' + item.dishId
          + '&dishName=' + encodeURIComponent(item.name)
      });
    },

    // 某道菜在本单已提交的评价评分；未评价返回 0
    rvOf(dishId) {
      return this.rvMap[dishId] || 0;
    },

    // 拉取本单已提交的评价，按 dishId 记录评分，避免同一道菜反复弹评价表单
    async loadReviews() {
      this._rvLoaded = true;
      try {
        const res = await call('cloudReview', 'list', { shopId: this.shopId(), orderId: this.orderId });
        const map = {};
        (res.data || []).forEach(r => {
          if (r.dishId && !map[r.dishId]) map[r.dishId] = r.rating;
        });
        this.rvMap = map;
      } catch (e) {
        // 评价状态拉不到不影响主流程，静默即可
      }
    },

    // 对某道菜提交投诉/反馈（选原因即提交，商家端按菜品聚合查看）
    async feedback(item) {
      const reasons = FEEDBACK_REASONS;
      uni.showActionSheet({
        itemList: reasons,
        success: async (r) => {
          const reason = reasons[r.tapIndex];
          try {
            await call('cloudFeedback', 'create', {
              orderId: this.orderId,
              dishId: item.dishId,
              dishName: item.name,
              reason: reason
            });
            uni.showToast({ title: '感谢反馈，我们会改进', icon: 'success' });
            // 提交后立刻刷新状态徽标，让「已反馈」当场可见
            this.loadFeedback();
          } catch (err) {
            uni.showToast({ title: '提交失败，请重试', icon: 'none' });
          }
        }
      });
    },

    // 拉取本单全部反馈，按 dishId 记录最新一条的状态，供菜品行展示处理进度
    async loadFeedback() {
      try {
        const res = await call('cloudFeedback', 'list', { orderId: this.orderId });
        const list = (res.data || []).slice().sort((a, b) => (b.createTime || 0) - (a.createTime || 0));
        const map = {};
        list.forEach(c => {
          // 同菜多次反馈只保留最新一条的状态
          if (c.dishId && !map[c.dishId]) map[c.dishId] = c.status || 'new';
        });
        this.fbMap = map;
      } catch (e) {
        // 反馈状态加载失败不打扰主流程，静默即可（菜品行的「反馈」按钮仍可用）
      }
    },

    // 某道菜最新反馈的状态；无反馈返回空串（模板据此切换「反馈」按钮与状态徽标）
    fbOf(dishId) {
      return this.fbMap[dishId] || '';
    },

    // 继续支付（unpaid → paid）。
    // 状态机本身只允许 unpaid → paid，重复调用会被后端/mock 挡住，
    // 这里再加一层 paying 标志是为了防止连点造成的并发重复请求。
    async onPay() {
      if (this.paying) return;
      this.paying = true;
      try {
        await call('cloudOrder', 'pay', { orderId: this.orderId });
        uni.showToast({ title: '模拟支付完成', icon: 'success' });
        this.load();   // 状态变为 paid，进度条与「继续支付」按钮随之收敛
      } catch (e) {
        // 不把内部错误原文弹给用户（会露出 localhost 之类内网地址）
        uni.showToast({ title: '支付失败，请重试', icon: 'none' });
      } finally {
        this.paying = false;
      }
    },

    refundStatusText(status) {
      return ({
        pending: '待商家审核',
        approved_pending_manual_refund: '已批准，待人工退款',
        approved: '已批准，待人工退款',
        rejected: '商家已拒绝',
        closed_by_cancellation: '订单已取消，售后申请已关闭'
      })[status] || '状态待确认';
    },

    requestRefund() {
      const reasons = ['商品质量问题', '商品与描述不符', '配送问题', '重复下单', '其他原因'];
      uni.showActionSheet({
        itemList: reasons,
        success: async result => {
          const reason = reasons[result.tapIndex];
          try {
            const response = await call('cloudRefund', 'create', { orderId: this.orderId, reason });
            const payload = (response && response.data) || {};
            this.refundRequestStatus = payload.status || 'pending';
            this.refundRequestNote = payload.decisionNote || '';
            this.refundStatusLoaded = true;
            uni.showModal({
              title: '售后申请已提交（演示订单）',
              content: '本单支付为模拟流程，未发生真实扣款。申请将等待商家审核；即使批准，也需商家人工处理，不会自动退款到账。',
              showCancel: false
            });
          } catch (e) {
            uni.showToast({ title: '申请失败：' + String(e).slice(0, 20), icon: 'none' });
          }
        }
      });
    },

    // 顾客取消订单。二次确认是必须的——取消不可恢复，误点代价大。
    // 成功后重新 load()：进度条、取餐号、「取消订单」按钮都会随状态一起收敛，
    // 其中取餐号在 canceled 时按设计隐藏（号已经作废，展示会误导顾客去柜台白等）
    onCancel() {
      uni.showModal({
        title: '取消订单',
        content: '取消后不可恢复。本单使用的优惠券与储值余额会退回到账户，确认取消？',
        confirmText: '取消订单',
        confirmColor: '#e6432d',
        success: async (r) => {
          if (!r.confirm) return;
          try {
            await call('cloudOrder', 'updateStatus', {
              orderId: this.orderId,
              status: 'canceled'
            });
            uni.showToast({ title: '订单已取消', icon: 'success' });
            this.load();
          } catch (e) {
            // 失败原因直接透出（如「订单状态不能从 preparing 变更为 canceled」），
            // 比统一「操作失败」更容易定位
            uni.showToast({ title: String(e).slice(0, 20) || '取消失败', icon: 'none' });
          }
        }
      });
    }
  }
}
</script>

<style scoped>
/* pages/customer/order/order.wxss */
.status-card {
  background: var(--primary);
  color: #fff;
  border-radius: 20rpx;
  padding: 40rpx 32rpx;
  text-align: center;
}
.status-card.cancel { background: #5c786f; }
.status-text { font-size: 40rpx; font-weight: 700; }

/* 取餐号：白底卡片里的大号数字，店员喊号、顾客记号的都是它 */
.pickup {
  background: rgba(255, 255, 255, .16);
  border-radius: 16rpx;
  padding: 20rpx 24rpx 24rpx;
  margin-bottom: 24rpx;
}
.pickup-label { font-size: 24rpx; opacity: .85; }
.pickup-no {
  font-size: 84rpx;
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: 4rpx;
  color: #FFC72C;
}
.pickup-hint { font-size: 22rpx; opacity: .8; margin-top: 4rpx; }
.order-no, .order-table { font-size: 26rpx; opacity: 0.9; margin-top: 8rpx; }
/* 外卖收货信息：跟在配送单号下方，白字与状态卡同色系 */
.addr-block { margin-top: 14rpx; text-align: center; }
.addr-line { color: #fff; font-size: 28rpx; font-weight: 600; }
.addr-line.sub { font-size: 24rpx; font-weight: 400; opacity: .85; margin-top: 6rpx; }
/* 配送费是额外支出，用暖色区别于优惠金额 */
.amt-row .plus { color: #e67e22; }
/* 预计等候：状态卡里的一行小字，紧跟桌号，不抢取餐号的视觉权重 */
.wait-tip { font-size: 24rpx; opacity: 0.92; margin-top: 10rpx; }

.steps {
  display: flex;
  justify-content: space-between;
  background: #fff;
  border-radius: 20rpx;
  padding: 32rpx 24rpx;
  margin: 24rpx 0;
}
.delivery-track {
  background: #fff;
  border: 1rpx solid var(--border);
  border-radius: 20rpx;
  padding: 28rpx 30rpx 24rpx;
  margin: 24rpx 0;
}
.track-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 20rpx;
  border-bottom: 1rpx solid var(--border);
}
.track-title { font-size: 30rpx; font-weight: 700; color: var(--text); }
.track-state {
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 24rpx;
  padding: 7rpx 16rpx;
  font-size: 23rpx;
  font-weight: 600;
}
.track-state.state-delivered { color: var(--primary); background: #e9f7ef; }
.track-state.state-canceled { color: #64736e; background: #eef2f0; }
.route-list { padding-top: 20rpx; }
.route-node {
  position: relative;
  display: flex;
  align-items: flex-start;
  min-height: 82rpx;
}
.route-node:not(:last-child)::after {
  content: '';
  position: absolute;
  left: 16rpx;
  top: 34rpx;
  bottom: -2rpx;
  width: 2rpx;
  background: #dce9e4;
}
.route-marker {
  position: relative;
  z-index: 1;
  flex: 0 0 34rpx;
  width: 34rpx;
  height: 34rpx;
  box-sizing: border-box;
  border: 2rpx solid #b9d1c9;
  border-radius: 50%;
  background: #fff;
  color: #6b837b;
  text-align: center;
  line-height: 30rpx;
  font-size: 20rpx;
  font-weight: 700;
}
.route-node.done .route-marker { border-color: var(--primary); background: var(--primary); color: #fff; }
.route-node.current .route-marker { border-color: var(--accent); background: var(--accent); color: #fff; }
.route-copy { padding: 1rpx 0 18rpx 18rpx; }
.route-title { color: #71847e; font-size: 26rpx; line-height: 1.4; }
.route-node.done .route-title { color: var(--text); }
.route-node.current .route-title { color: var(--accent); font-weight: 700; }
.route-detail { margin-top: 6rpx; color: var(--muted); font-size: 22rpx; line-height: 1.5; }
.track-cancelled { padding: 24rpx 0; color: var(--muted); font-size: 25rpx; }
.track-disclaimer {
  border-top: 1rpx solid var(--border);
  padding-top: 16rpx;
  color: var(--muted);
  font-size: 21rpx;
  line-height: 1.5;
}
.step { flex: 1; text-align: center; position: relative; }
.dot {
  width: 28rpx; height: 28rpx; border-radius: 50%;
  background: #dce9e4; margin: 0 auto 12rpx;
}
.step.done .dot { background: var(--primary); }
.step-text { font-size: 24rpx; color: var(--muted); }
.step.done .step-text { color: var(--primary); font-weight: 600; }

.block-title { font-weight: 700; font-size: 30rpx; margin-bottom: 16rpx; }
.row { display: flex; align-items: center; padding: 16rpx 0; }
.row-name { flex: 1; font-size: 28rpx; }
.row-qty { color: var(--muted); margin: 0 24rpx; font-size: 26rpx; }
.fb-btn {
  flex-shrink: 0;
  font-size: 22rpx;
  color: var(--primary);
  border: 2rpx solid var(--primary);
  border-radius: 16rpx;
  padding: 4rpx 16rpx;
  margin-right: 16rpx;
}
/* 反馈状态徽标：待处理=暖色，已处理=绿。 */
.fb-state {
  flex-shrink: 0;
  font-size: 22rpx;
  border-radius: 16rpx;
  padding: 4rpx 16rpx;
  margin-right: 16rpx;
}
.fb-state.wait { color: #e67e22; background: #fdf2e3; }
.fb-state.done { color: #087c61; background: #e9f7ef; }
.row-price { font-size: 28rpx; width: 160rpx; text-align: right; }
/* 优惠拆行：小字灰色，别跟实付金额抢注意力 */
.amt-row {
  display: flex;
  justify-content: space-between;
  font-size: 25rpx;
  color: var(--muted);
  padding: 6rpx 0;
}
.amt-row .minus { color: #e74c3c; }
.saved-line {
  text-align: right;
  font-size: 24rpx;
  color: #e74c3c;
  margin-top: 6rpx;
}
.total-row { border-top: 1rpx solid #f2f8f6; margin-top: 8rpx; padding-top: 24rpx; }
.total-num { font-size: 34rpx; font-weight: 700; }
.note-line { color: var(--muted); font-size: 26rpx; margin-top: 12rpx; }
.tip { color: var(--muted); font-size: 24rpx; text-align: center; margin-top: 16rpx; }

/* 取消订单：描边按钮而非实心，避免和主操作（去结算/支付）抢视觉。
   放在页面最底部，与「取消」这个低频且破坏性的动作相匹配 */
/* 继续支付：与「取消订单」并列，但视觉上是主操作 */
.pay-wrap { margin-top: 28rpx; }
.pay-btn {
  background: var(--primary);
  color: #fff;
  border-radius: 48rpx;
  font-size: 30rpx;
}
.pay-hint {
  font-size: 22rpx;
  color: var(--muted);
  text-align: center;
  margin-top: 12rpx;
  line-height: 1.5;
}
.cancel-wrap { margin-top: 40rpx; }
.cancel-btn {
  background: #fff;
  color: #e6432d;
  border: 1rpx solid #f3b5ac;
  border-radius: 48rpx;
  font-size: 30rpx;
  height: 84rpx;
  line-height: 84rpx;
}
.cancel-hint {
  text-align: center;
  color: var(--muted);
  font-size: 22rpx;
  margin-top: 14rpx;
}
.refund-wrap, .refund-state { margin-top: 20rpx; background: #fff; border-radius: 16rpx; padding: 22rpx; }
.refund-btn { background: #fff; color: var(--primary); border: 2rpx solid var(--primary); border-radius: 48rpx; font-size: 28rpx; }
.refund-hint { color: var(--muted); font-size: 22rpx; line-height: 1.5; margin-top: 12rpx; }
.refund-state { color: #8a5a00; font-size: 27rpx; }
.refund-retry { display: block; color: var(--primary); margin-top: 12rpx; }
.loading { text-align: center; color: var(--muted); padding: 80rpx 0; }
</style>

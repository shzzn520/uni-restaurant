// ===============================================================
// mixins/order-detail.js —— 订单详情行为（状态轮询 / 评价 / 售后）
// ===============================================================
// 从 order.vue 抽出：页面只保留模板与样式，状态机与轮询逻辑集中在这里。
const { call } = require('@/common/cloud.js');
const { yuan, STATUS_TEXT, STATUS_ORDER, FEEDBACK_REASONS } = require('@/common/format.js');
const app = getApp();
module.exports = {

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
    // 费用明细行：与确认页共用 amount-summary，展示规则集中在这里
    amountRows() {
      const rows = [];
      if (this.discountAmount > 0) {
        rows.push({ label: '商品原价', amount: this.order.totalPrice, kind: 'normal' });
        rows.push({ label: '优惠券减免', amount: this.discountAmount, kind: 'minus' });
      }
      if (this.balancePay > 0) {
        rows.push({ label: '储值余额抵扣', amount: this.balancePay, kind: 'minus' });
      }
      if (this.isDelivery && this.deliveryFee > 0) {
        rows.push({ label: '配送费', amount: this.deliveryFee, kind: 'plus' });
      }
      if (rows.length === 0) {
        rows.push({ label: '商品合计', amount: this.order.totalPrice, kind: 'normal' });
      }
      return rows;
    },

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

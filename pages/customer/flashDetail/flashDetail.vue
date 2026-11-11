<template>
  <view class="detail-page">
    <!-- ============ 加载 / 错误 / 空态 ============ -->
    <view v-if="loading" class="state-box">
      <view class="state-icon">⏳</view>
      <view class="state-text">正在加载商品…</view>
    </view>
    <view v-else-if="error" class="state-box">
      <view class="state-icon">⚠</view>
      <view class="state-text">{{error}}</view>
      <button class="retry-btn" @tap="load">重新加载</button>
    </view>
    <view v-else-if="!item" class="state-box">
      <view class="state-icon">🛍</view>
      <view class="state-text">商品不存在或已下架</view>
      <button class="retry-btn" @tap="goBack">返回会场</button>
    </view>

    <view v-else>
      <image class="cover" :src="item.image" mode="aspectFill" />

      <!-- ============ 价格与倒计时 ============ -->
      <view class="price-panel">
        <view class="pp-left">
          <view class="pp-price"><text class="sign">¥</text>{{item.flashPrice}}</view>
          <text class="pp-origin">¥{{item.originalPrice}}</text>
          <text class="pp-tag">{{item.discount}} 折</text>
        </view>
        <view class="pp-right">
          <view class="pp-timer-label">{{timerLabel}}</view>
          <view class="pp-timer">{{countdownText}}</view>
        </view>
      </view>

      <!-- ============ 商品信息 ============ -->
      <view class="card">
        <view class="title">{{item.name}}</view>
        <view class="desc">{{item.description || '限时特惠，售完即止'}}</view>
        <view class="meta-row">
          <text class="meta">剩余 {{item.remain}} 件</text>
          <text class="meta">已抢 {{item.soldPercent}}%</text>
          <text class="meta" v-if="item.limitPerUser > 0">每人限购 {{item.limitPerUser}} 件</text>
          <text class="meta" v-if="item.bought > 0">你已购 {{item.bought}} 件</text>
        </view>
        <view class="progress"><view class="bar" :style="{width: item.soldPercent + '%'}" /></view>
      </view>

      <!-- ============ 数量 ============ -->
      <view class="card row-card">
        <view class="row-label">购买数量</view>
        <view class="stepper">
          <view class="step-btn" :class="{off: qty <= 1}" @tap="changeQty(-1)">−</view>
          <view class="step-num">{{qty}}</view>
          <view class="step-btn" :class="{off: qty >= maxQty}" @tap="changeQty(1)">＋</view>
        </view>
        <view class="row-tip">最多可购 {{maxQty}} 件</view>
      </view>

      <!-- ============ 优惠券 ============ -->
      <view class="card">
        <view class="block-title">优惠券</view>
        <view v-if="!logged" class="hint">登录后可选择优惠券</view>
        <view v-else-if="coupons.length === 0" class="hint">暂无优惠券，可到会员中心领券</view>
        <view v-else>
          <view v-for="c in coupons" :key="c._id"
                class="cp-item" :class="{off: !c.usable, on: pickedCouponId === c._id}"
                @tap="pickCoupon(c)">
            <view class="cp-amount"><text class="cp-sign">¥</text>{{c.amount}}</view>
            <view class="cp-main">
              <view class="cp-name">{{c.couponName}}</view>
              <view class="cp-cond">{{c.threshold > 0 ? '满 ' + c.threshold + ' 可用' : '无门槛'}}</view>
              <view class="cp-reason" v-if="!c.usable">{{c.reason}}</view>
            </view>
            <view class="cp-check">{{pickedCouponId === c._id ? '✓' : ''}}</view>
          </view>
          <view class="cp-clear" @tap="pickCoupon(null)">不使用优惠券</view>
        </view>
      </view>

      <!-- ============ 金额预估 ============ -->
      <view class="card">
        <view class="amount-row"><text>商品小计</text><text>¥{{subtotalText}}</text></view>
        <view class="amount-row"><text>优惠券减免</text><text class="minus">-¥{{discountText}}</text></view>
        <view class="amount-row total"><text>预估应付</text><text>¥{{previewText}}</text></view>
        <view class="hint">实际应付金额以下单结果为准（由服务端计算）</view>
      </view>

      <view v-if="feedback.text" class="feedback" :class="feedback.type">{{feedback.text}}</view>
      <view class="bottom-space" />
    </view>

    <!-- ============ 底部操作栏 ============ -->
    <view v-if="item && !loading && !error" class="bottom-bar">
      <view class="fav-btn" :class="{on: item.favorited}" @tap="toggleFav">
        <view class="fav-icon">{{item.favorited ? '♥' : '♡'}}</view>
        <view class="fav-text">收藏</view>
      </view>
      <button class="buy-btn" :class="btnClass" :disabled="btnDisabled || submitting" @tap="buy">
        {{btnText}}
      </button>
    </view>
  </view>
</template>

<script>
// pages/customer/flashDetail/flashDetail.vue —— 抢购商品详情 / 下单入口
// 金额口径：抢购价、券减免均由数据层（后端或 mock）下发；页面只做展示与预估，
// 真正应付金额以 cloudFlash/createOrder 的返回值为准。
const { call } = require('@/common/cloud.js');
const session = require('@/common/session.js');

export default {
  data() {
    return {
      loading: false,
      error: '',
      itemId: '',
      sessionId: '',
      item: null,
      qty: 1,
      coupons: [],
      pickedCouponId: '',
      logged: false,
      userId: '',
      sessionStatus: '',
      startAt: 0,
      endAt: 0,
      timerLabel: '距结束',
      countdownText: '00:00:00',
      serverOffset: 0,
      btnText: '立即抢购',
      btnDisabled: false,
      btnClass: 'primary',
      submitting: false,
      feedback: { type: '', text: '' },
      timer: null,
      feedbackTimer: null
    };
  },

  computed: {
    /** 可购上限：库存、限购剩余量两者取小；未登录时按限购量算，登录后由服务端最终校验 */
    maxQty() {
      if (!this.item) return 1;
      const stock = Math.max(0, this.item.remain || 0);
      const limitLeft = this.item.limitPerUser > 0
        ? Math.max(0, this.item.limitPerUser - (this.item.bought || 0))
        : 99;
      return Math.max(1, Math.min(stock, limitLeft, 99));
    },
    subtotalText() {
      if (!this.item) return '0.00';
      return (Number(this.item.flashPrice) * this.qty).toFixed(2);
    },
    discountText() {
      const c = this.coupons.find(x => x._id === this.pickedCouponId && x.usable);
      return c ? Number(c.discount || 0).toFixed(2) : '0.00';
    },
    previewText() {
      return (Number(this.subtotalText) - Number(this.discountText)).toFixed(2);
    }
  },

  onLoad(options) {
    this.itemId = (options && options.id) || '';
    this.sessionId = (options && options.sessionId) || '';
    this.load();
  },

  onShow() {
    // 从登录页 / 订单页 / 会场返回时，登录态、库存与限购都可能已变化，一律重拉。
    // 首次 onShow 紧跟 onLoad，此时 item 尚未返回（null），自然跳过，不会重复请求。
    if (this.itemId && !this.loading && this.item) {
      this.load();
    }
  },

  onPullDownRefresh() {
    this.load(() => uni.stopPullDownRefresh());
  },

  onUnload() { this.clearTimers(); },
  onHide() { this.clearTimers(); },

  methods: {
    load(done) {
      if (this.loading) { if (done) done(); return; }
      this.loading = true;
      this.error = '';
      this.logged = session.isLogin();
      this.userId = this.logged ? session.getUserId() : '';

      call('cloudFlash', 'sessions', {})
        .then(res => {
          const d = res.data || {};
          this.serverOffset = (d.serverTime || Date.now()) - Date.now();
          const all = d.sessions || [];
          if (!this.sessionId) this.sessionId = d.activeSessionId || '';
          const cur = all.find(s => s.id === this.sessionId) || all[1] || null;
          if (cur) {
            this.startAt = cur.startAt;
            this.endAt = cur.endAt;
            this.sessionStatus = cur.status;
          }
          return call('cloudFlash', 'item', { id: this.itemId, memberId: this.userId });
        })
        .then(res => {
          this.item = res.data || null;
          this.loading = false;
          this.refreshSessionState();
          this.refreshButton();
          this.startTimer();
          this.loadCoupons();
          if (done) done();
        })
        .catch(err => {
          this.loading = false;
          this.error = err && err.msg ? err.msg : String(err || '加载失败');
          if (done) done();
        });
    },

    loadCoupons() {
      this.coupons = [];
      this.pickedCouponId = '';
      if (!this.logged || !this.item) return;
      call('cloudFlash', 'coupons', {
        memberId: this.userId,
        amount: this.subtotalText
      }).then(res => {
        this.coupons = res.data || [];
      }).catch(() => { this.coupons = []; });
    },

    /** 用服务端时间校准后的当前时间推算场次状态，倒计时归零即锁定按钮 */
    refreshSessionState() {
      const now = Date.now() + this.serverOffset;
      if (now < this.startAt) {
        this.sessionStatus = 'upcoming';
        this.timerLabel = '距开抢';
      } else if (now < this.endAt) {
        this.sessionStatus = 'active';
        this.timerLabel = '距结束';
      } else {
        this.sessionStatus = 'ended';
        this.timerLabel = '本场已结束';
      }
      this.updateCountdown();
      this.refreshButton();
    },

    updateCountdown() {
      const now = Date.now() + this.serverOffset;
      let target = this.sessionStatus === 'upcoming' ? this.startAt : this.endAt;
      const sec = this.sessionStatus === 'ended'
        ? 0 : Math.max(0, Math.floor((target - now) / 1000));
      this.countdownText = this.fmtCountdown(sec);
      if (sec === 0 && this.sessionStatus === 'active') {
        this.sessionStatus = 'ended';
        this.timerLabel = '本场已结束';
        this.refreshButton();
        this.showFeedback('warn', '本场抢购已结束');
      }
    },

    fmtCountdown(sec) {
      const two = n => (n < 10 ? '0' + n : '' + n);
      return two(Math.floor(sec / 3600)) + ':' + two(Math.floor((sec % 3600) / 60)) + ':' + two(sec % 60);
    },

    startTimer() {
      this.clearTimers();
      this.timer = setInterval(() => {
        this.refreshSessionState();
      }, 1000);
    },

    clearTimers() {
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      if (this.feedbackTimer) { clearTimeout(this.feedbackTimer); this.feedbackTimer = null; }
    },

    /** 按钮状态机：与 flash.vue 完全同一套判定顺序 */
    refreshButton() {
      let text = '立即抢购', disabled = false, cls = 'primary';
      if (this.sessionStatus === 'ended') {
        text = '本场已结束'; disabled = true; cls = 'off';
      } else if (this.sessionStatus === 'upcoming') {
        text = '即将开抢'; disabled = true; cls = 'off';
      } else if (!this.item || this.item.status === 'soldout' || this.item.remain <= 0) {
        text = '已售罄'; disabled = true; cls = 'off';
      } else if (!this.logged) {
        text = '登录后抢购'; cls = 'need-login';
      } else if (!this.item.canBuy) {
        text = '已达限购'; disabled = true; cls = 'off';
      }
      this.btnText = text;
      this.btnDisabled = disabled;
      this.btnClass = cls;
    },

    changeQty(delta) {
      const next = this.qty + delta;
      if (next < 1 || next > this.maxQty) return;
      this.qty = next;
      // 金额变了，券的门槛可用性也会变，需要重新试算
      this.loadCoupons();
    },

    pickCoupon(c) {
      if (!c) { this.pickedCouponId = ''; return; }
      if (!c.usable) {
        this.showFeedback('warn', c.reason || '该券当前不可用');
        return;
      }
      this.pickedCouponId = this.pickedCouponId === c._id ? '' : c._id;
    },

    toggleFav() {
      if (!this.logged) {
        this.askLogin('收藏需使用会员账号，是否前往登录？');
        return;
      }
      call('cloudFlash', 'toggleFavorite', { itemId: this.itemId, memberId: this.userId })
        .then(res => {
          this.item = Object.assign({}, this.item, { favorited: !!res.favorited });
          this.showFeedback('ok', res.favorited ? '已加入收藏' : '已取消收藏');
        })
        .catch(err => {
          this.showFeedback('err', err && err.msg ? err.msg : String(err || '操作失败'));
        });
    },

    buy() {
      if (!this.logged) {
        this.askLogin('抢购需使用会员账号，是否前往登录？');
        return;
      }
      if (this.sessionStatus !== 'active') {
        this.showFeedback('warn', '本场尚未开始或已结束');
        return;
      }
      if (!this.item || this.item.status === 'soldout' || this.item.remain <= 0) {
        this.showFeedback('warn', '来晚了，该商品已售罄');
        return;
      }
      if (!this.item.canBuy) {
        this.showFeedback('warn', '已达每人限购数量');
        return;
      }
      this.submitOrder();
    },

    submitOrder() {
      if (this.submitting) return;
      this.submitting = true;
      uni.showLoading({ title: '正在抢购' });
      call('cloudFlash', 'createOrder', {
        itemId: this.itemId,
        qty: this.qty,
        couponId: this.pickedCouponId,
        sessionId: this.sessionId,
        memberId: this.userId
      }).then(res => {
        uni.hideLoading();
        this.submitting = false;
        this.showFeedback('ok', '抢购成功！单号 ' + (res.orderNo || res.orderId || ''));
        uni.showModal({
          title: '抢购成功',
          content: '应付 ¥' + (res.payAmount || 0) + '，是否前往订单页完成支付？',
          confirmText: '去订单页',
          success: r => {
            if (r.confirm) this.goOrders();
            else this.load();
          }
        });
      }).catch(err => {
        uni.hideLoading();
        this.submitting = false;
        const msg = err && err.msg ? err.msg : String(err || '抢购失败');
        this.showFeedback('err', '抢购失败：' + msg);
        this.load();
      });
    },

    askLogin(content) {
      uni.showModal({
        title: '需要登录',
        content: content,
        success: r => {
          if (r.confirm) uni.navigateTo({ url: '/pages/customer/member/member' });
        }
      });
    },

    goOrders() {
      uni.navigateTo({ url: '/pages/customer/flashOrders/flashOrders' });
    },

    goBack() {
      uni.navigateBack({
        fail: () => uni.redirectTo({ url: '/pages/customer/flash/flash' })
      });
    },

    showFeedback(type, text) {
      this.feedback = { type: type, text: text };
      if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
      this.feedbackTimer = setTimeout(() => {
        this.feedback = { type: '', text: '' };
      }, 4000);
    }
  }
};
</script>

<style>
.detail-page { min-height: 100vh; background: #f2f8f6; }
.cover { width: 100%; height: 460rpx; background: #dce9e4; }

.price-panel {
  display: flex; justify-content: space-between; align-items: center;
  padding: 24rpx 28rpx; background: linear-gradient(90deg, #176db3, #087c61); color: #fff;
}
.pp-left { display: flex; align-items: baseline; }
.pp-price { font-size: 58rpx; font-weight: 700; }
.sign { font-size: 28rpx; }
.pp-origin { font-size: 24rpx; text-decoration: line-through; opacity: .8; margin-left: 14rpx; }
.pp-tag {
  font-size: 22rpx; background: rgba(255,255,255,.25);
  padding: 4rpx 12rpx; border-radius: 20rpx; margin-left: 14rpx;
}
.pp-right { text-align: right; }
.pp-timer-label { font-size: 22rpx; opacity: .9; }
.pp-timer { font-size: 34rpx; font-weight: 700; font-variant-numeric: tabular-nums; }

.card { background: #fff; margin: 18rpx 24rpx; padding: 24rpx; border-radius: 16rpx; }
.title { font-size: 34rpx; font-weight: 700; color: #183c34; }
.desc { font-size: 24rpx; color: #5c786f; margin-top: 10rpx; line-height: 1.5; }
.meta-row { display: flex; flex-wrap: wrap; margin-top: 16rpx; }
.meta { font-size: 22rpx; color: #087c61; background: #eaf4fb; padding: 6rpx 12rpx; border-radius: 6rpx; margin: 0 10rpx 8rpx 0; }
.progress { height: 10rpx; background: #f2f8f6; border-radius: 10rpx; overflow: hidden; margin-top: 12rpx; }
.bar { height: 100%; background: linear-gradient(90deg, #5da8d3, #087c61); border-radius: 10rpx; }

.row-card { display: flex; align-items: center; flex-wrap: wrap; }
.row-label { font-size: 28rpx; font-weight: 600; flex: 1; }
.stepper { display: flex; align-items: center; }
.step-btn {
  width: 56rpx; height: 56rpx; line-height: 52rpx; text-align: center;
  border: 1rpx solid #dce9e4; border-radius: 10rpx; font-size: 32rpx; color: #183c34;
}
.step-btn.off { color: #dce9e4; border-color: #dce9e4; }
.step-num { width: 80rpx; text-align: center; font-size: 28rpx; }
.row-tip { width: 100%; font-size: 22rpx; color: #9bb2aa; margin-top: 12rpx; }

.block-title { font-size: 28rpx; font-weight: 700; margin-bottom: 16rpx; }
.hint { font-size: 24rpx; color: #5c786f; margin-top: 12rpx; }
.cp-item {
  display: flex; align-items: center; padding: 18rpx; margin-bottom: 14rpx;
  border: 1rpx solid #dce9e4; border-radius: 12rpx;
}
.cp-item.on { border-color: #087c61; background: #eaf4fb; }
.cp-item.off { opacity: .55; }
.cp-amount { font-size: 38rpx; font-weight: 700; color: #087c61; width: 130rpx; }
.cp-sign { font-size: 24rpx; }
.cp-main { flex: 1; min-width: 0; }
.cp-name { font-size: 26rpx; color: #183c34; }
.cp-cond { font-size: 22rpx; color: #5c786f; margin-top: 4rpx; }
.cp-reason { font-size: 22rpx; color: #c0392b; margin-top: 4rpx; }
.cp-check { width: 44rpx; text-align: center; color: #087c61; font-size: 30rpx; }
.cp-clear { text-align: center; font-size: 24rpx; color: #5c786f; padding: 12rpx; }

.amount-row { display: flex; justify-content: space-between; font-size: 26rpx; color: #3e5e55; padding: 8rpx 0; }
.amount-row .minus { color: #087c61; }
.amount-row.total { font-size: 30rpx; font-weight: 700; color: #183c34; border-top: 1rpx solid #dce9e4; margin-top: 10rpx; padding-top: 18rpx; }
.amount-row.total text:last-child { color: #087c61; }

.feedback { margin: 18rpx 24rpx; padding: 18rpx 22rpx; border-radius: 12rpx; font-size: 26rpx; }
.feedback.ok { background: #e9f7ef; color: #087c61; }
.feedback.err { background: #fdecec; color: #c0392b; }
.feedback.warn { background: #fff5e3; color: #a56a00; }

.state-box { padding: 140rpx 30rpx; text-align: center; color: #5c786f; }
.state-icon { font-size: 64rpx; margin-bottom: 18rpx; }
.state-text { font-size: 28rpx; }
.retry-btn {
  margin: 30rpx auto 0; width: 240rpx; height: 68rpx; line-height: 68rpx;
  font-size: 26rpx; color: #fff; background: #087c61; border-radius: 34rpx;
}
.bottom-space { height: 160rpx; }

.bottom-bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 10;
  display: flex; align-items: center; padding: 14rpx 24rpx;
  background: #fff; box-shadow: 0 -4rpx 20rpx rgba(0,0,0,.06);
}
.fav-btn { width: 110rpx; text-align: center; color: #5c786f; }
.fav-btn.on { color: #087c61; }
.fav-icon { font-size: 38rpx; line-height: 1; }
.fav-text { font-size: 20rpx; margin-top: 4rpx; }
.buy-btn {
  flex: 1; margin: 0 0 0 16rpx; height: 84rpx; line-height: 84rpx;
  font-size: 30rpx; color: #fff; background: #087c61; border-radius: 42rpx;
}
.buy-btn.need-login { background: #5da8d3; }
.buy-btn.off { background: #dce9e4; color: #5c786f; }
</style>

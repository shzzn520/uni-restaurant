<template>
  <view class="flash-page">
    <!-- ============ 活动头：标题 + 服务端校准后的倒计时 ============ -->
    <view class="hero">
      <view class="hero-row">
        <view>
          <view class="hero-title">限时抢购</view>
          <view class="hero-sub">每日 4 场 · 整点开抢 · 售完即止</view>
        </view>
        <view class="hero-badge">FLASH SALE</view>
      </view>
      <view class="hero-timer">
        <text class="ht-label">{{timerLabel}}</text>
        <text class="ht-num">{{countdownText}}</text>
      </view>
    </view>

    <!-- ============ 场次切换 ============ -->
    <scroll-view scroll-x class="session-bar" show-scrollbar="false">
      <view v-for="s in sessions" :key="s.id"
            class="session-item"
            :class="{on: currentId === s.id, ended: s.status === 'ended'}"
            @tap="switchSession(s)">
        <view class="s-time">{{s.title}}</view>
        <view class="s-label">{{s.label}}</view>
      </view>
    </scroll-view>

    <!-- ============ 优惠券入口 ============ -->
    <view class="coupon-bar" @tap="goMember">
      <text class="cb-icon">券</text>
      <text class="cb-text">{{couponText}}</text>
      <text class="cb-arrow">›</text>
    </view>

    <!-- ============ 最近一次操作反馈 ============ -->
    <view v-if="feedback.text" class="feedback" :class="feedback.type">
      {{feedback.text}}
    </view>

    <!-- ============ 加载 / 错误 / 空态 ============ -->
    <view v-if="loading" class="state-box">
      <view class="state-icon">⏳</view>
      <view class="state-text">正在加载本场商品…</view>
    </view>
    <view v-else-if="error" class="state-box">
      <view class="state-icon">⚠</view>
      <view class="state-text">{{error}}</view>
      <button class="retry-btn" @tap="load">重新加载</button>
    </view>
    <view v-else-if="items.length === 0" class="state-box">
      <view class="state-icon">🛍</view>
      <view class="state-text">本场暂无抢购商品</view>
      <view class="state-tip">换个场次看看，或稍后再来</view>
    </view>

    <!-- ============ 商品列表 ============ -->
    <view v-else class="list">
      <view v-for="it in items" :key="it._id" class="card">
        <!-- 点击主区域进详情；收藏与按钮放在同级，避免事件冒泡互相干扰 -->
        <view class="main" @tap="goDetail(it)">
          <image class="thumb" :src="it.image" mode="aspectFill" />
          <view class="info">
            <view class="name">{{it.name}}</view>
            <view class="desc">{{it.description || '限时特惠，售完即止'}}</view>
            <view class="tags">
              <text class="tag">{{it.discount}} 折</text>
              <text v-if="it.limitPerUser > 0" class="tag ghost">限购 {{it.limitPerUser}} 件</text>
              <text v-if="it.bought > 0" class="tag ghost">已购 {{it.bought}}</text>
            </view>
            <view class="progress"><view class="bar" :style="{width: it.soldPercent + '%'}" /></view>
            <view class="stock">已抢 {{it.soldPercent}}% · 仅剩 {{it.remain}} 件</view>
            <view class="price-row">
              <view class="price"><text class="sign">¥</text>{{it.flashPrice}}</view>
              <text class="origin">¥{{it.originalPrice}}</text>
            </view>
          </view>
        </view>
        <view class="actions">
          <view class="fav" :class="{on: it.favorited}" @tap="toggleFav(it)">
            {{it.favorited ? '♥' : '♡'}}
          </view>
          <button class="buy" :class="it._btnClass" :disabled="it._btnDisabled" @tap="quickBuy(it)">
            {{it._btnText}}
          </button>
        </view>
      </view>
    </view>

    <view class="foot-tip">抢购商品为活动一口价，优惠券可在详情页选择</view>
  </view>
</template>

<script>
// pages/customer/flash/flash.vue —— 限时抢购主会场
// 数据全部经 common/cloud.js 分发：本机 localhost 走 Spring Boot，线上 H5 走 mock，
// 两条链路返回结构逐字段一致，页面不感知数据源。
const { call } = require('@/common/cloud.js');
const session = require('@/common/session.js');

export default {
  data() {
    return {
      loading: false,          // 防重入标志，初值必须 false（否则 onLoad 那次 load 会被自己挡掉）
      loadedOnce: false,       // 跳过紧跟 onLoad 的首次 onShow
      error: '',
      sessions: [],
      currentId: '',
      sessionStatus: '',
      currentEndAt: 0,
      currentStartAt: 0,
      countdownText: '00:00:00',
      timerLabel: '本场剩余',
      items: [],
      logged: false,
      userId: '',
      couponText: '登录后查看可用优惠券',
      feedback: { type: '', text: '' },
      serverOffset: 0,         // serverTime - 本机 Date.now()，用于校准倒计时
      timer: null,
      feedbackTimer: null
    };
  },

  onLoad() {
    this.load();
  },

  onShow() {
    // navigateTo 去登录/详情再回来时，登录态与库存都可能变了，必须重拉。
    // 首次 onShow 紧跟 onLoad，那次交给 onLoad 的 load()，避免重复请求。
    if (!this.loadedOnce) {
      this.loadedOnce = true;
      return;
    }
    const nowLogged = session.isLogin();
    const nowUser = session.getUserId();
    this.logged = nowLogged;
    this.userId = nowLogged ? nowUser : '';
    this.load();
  },

  onPullDownRefresh() {
    this.load(() => uni.stopPullDownRefresh());
  },

  onUnload() {
    this.clearTimers();
  },

  onHide() {
    this.clearTimers();
  },

  methods: {
    /** 统一入口：拉场次 + 商品 + 券包，失败只显示错误态不留半屏数据 */
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
          this.sessions = this.decorateSessions(d.sessions || []);
          if (!this.currentId) {
            this.currentId = d.activeSessionId || (this.sessions[1] && this.sessions[1].id) || '';
          }
          this.syncCurrentSession();
          return call('cloudFlash', 'items', {
            sessionId: this.currentId,
            memberId: this.userId
          });
        })
        .then(res => {
          this.items = (res.data || []).map(it => this.decorateItem(it));
          this.loading = false;
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

    /** 券包数量：复用既有优惠券体系，未登录时给明确引导 */
    loadCoupons() {
      if (!this.logged) {
        this.couponText = '登录后查看可用优惠券';
        return;
      }
      call('cloudCoupon', 'my', { shopId: 'demo-shop', userId: this.userId })
        .then(res => {
          const d = res.data || {};
          const n = (d.usable || []).length;
          this.couponText = n > 0 ? ('你有 ' + n + ' 张可用优惠券，去会员中心查看') : '暂无可用优惠券，去领券中心看看';
        })
        .catch(() => { this.couponText = '优惠券加载失败，点此重试'; });
    },

    /**
     * 场次状态由「服务端时间 + 本机流逝时间」推算，不每次都请求接口。
     * 倒计时归零时把 active 场次改成 ended，按钮随之变成「本场已结束」。
     */
    decorateSessions(list) {
      const now = Date.now() + this.serverOffset;
      return list.map(s => {
        const copy = Object.assign({}, s);
        if (now < copy.startAt) {
          copy.status = 'upcoming';
          copy.secondsLeft = Math.max(0, Math.floor((copy.startAt - now) / 1000));
        } else if (now < copy.endAt) {
          copy.status = 'active';
          copy.secondsLeft = Math.max(0, Math.floor((copy.endAt - now) / 1000));
        } else {
          copy.status = 'ended';
          copy.secondsLeft = 0;
        }
        copy.label = copy.status === 'active' ? '抢购中'
          : (copy.status === 'ended' ? '已结束' : '即将开抢');
        return copy;
      });
    },

    syncCurrentSession() {
      const cur = this.sessions.find(s => s.id === this.currentId) || this.sessions[0];
      if (!cur) return;
      this.sessionStatus = cur.status;
      this.currentEndAt = cur.endAt;
      this.currentStartAt = cur.startAt;
      this.timerLabel = cur.status === 'upcoming' ? '距开抢'
        : (cur.status === 'ended' ? '本场已结束' : '本场剩余');
      this.updateCountdown();
    },

    updateCountdown() {
      const now = Date.now() + this.serverOffset;
      let target = this.currentEndAt;
      if (this.sessionStatus === 'upcoming') target = this.currentStartAt;
      let sec = 0;
      if (this.sessionStatus !== 'ended') {
        sec = Math.max(0, Math.floor((target - now) / 1000));
      }
      this.countdownText = this.fmtCountdown(sec);
      // 倒计时结束：立即把按钮状态切到「本场已结束」，不给用户点了才报错
      if (sec === 0 && this.sessionStatus === 'active') {
        this.sessions = this.decorateSessions(this.sessions);
        this.syncCurrentSession();
        this.items = this.items.map(it => this.decorateItem(it));
        this.showFeedback('warn', '本场抢购已结束，请切换场次');
      }
    },

    fmtCountdown(sec) {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      const two = n => (n < 10 ? '0' + n : '' + n);
      return two(h) + ':' + two(m) + ':' + two(s);
    },

    startTimer() {
      this.clearTimers();
      this.timer = setInterval(() => {
        this.sessions = this.decorateSessions(this.sessions);
        this.syncCurrentSession();
      }, 1000);
    },

    clearTimers() {
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      if (this.feedbackTimer) { clearTimeout(this.feedbackTimer); this.feedbackTimer = null; }
    },

    /**
     * 按钮状态机：在数据入口归一化出 _btnText/_btnDisabled/_btnClass，
     * 模板只绑单一字段，避免小程序端表达式与复杂判断造成渲染异常。
     */
    decorateItem(it) {
      const o = Object.assign({}, it);
      let text = '马上抢', disabled = false, cls = 'primary';
      if (this.sessionStatus === 'ended') {
        text = '本场已结束'; disabled = true; cls = 'off';
      } else if (this.sessionStatus === 'upcoming') {
        text = '即将开抢'; disabled = true; cls = 'off';
      } else if (o.status === 'soldout' || o.remain <= 0) {
        text = '已售罄'; disabled = true; cls = 'off';
      } else if (!this.logged) {
        text = '登录后抢购'; cls = 'need-login';
      } else if (!o.canBuy) {
        text = '已达限购'; disabled = true; cls = 'off';
      }
      o._btnText = text;
      o._btnDisabled = disabled;
      o._btnClass = cls;
      return o;
    },

    switchSession(s) {
      if (this.currentId === s.id) return;
      this.currentId = s.id;
      this.syncCurrentSession();
      this.load();
    },

    goDetail(it) {
      uni.navigateTo({
        url: '/pages/customer/flashDetail/flashDetail?id=' + it._id + '&sessionId=' + this.currentId
      });
    },

    goMember() {
      uni.navigateTo({ url: '/pages/customer/member/member' });
    },

    /** 抢购按钮：未登录先引导登录，其余状态由按钮禁用态挡住，这里再做一次防御 */
    quickBuy(it) {
      if (!this.logged) {
        uni.showModal({
          title: '需要登录',
          content: '抢购需使用会员账号，是否前往登录？',
          success: r => { if (r.confirm) this.goMember(); }
        });
        return;
      }
      if (this.sessionStatus !== 'active') {
        this.showFeedback('warn', '本场尚未开始或已结束');
        return;
      }
      if (it.status === 'soldout' || it.remain <= 0) {
        this.showFeedback('warn', '来晚了，该商品已售罄');
        return;
      }
      if (!it.canBuy) {
        this.showFeedback('warn', '已达每人限购数量');
        return;
      }
      uni.showModal({
        title: '确认抢购',
        content: it.name + ' × 1，抢购价 ¥' + it.flashPrice + '，是否下单？',
        success: r => { if (r.confirm) this.submitOrder(it, 1, ''); }
      });
    },

    submitOrder(it, qty, couponId) {
      uni.showLoading({ title: '正在抢购' });
      call('cloudFlash', 'createOrder', {
        itemId: it._id,
        qty: qty,
        couponId: couponId,
        sessionId: this.currentId,
        memberId: this.userId
      }).then(res => {
        uni.hideLoading();
        this.showFeedback('ok', '抢购成功！单号 ' + (res.orderNo || res.orderId || ''));
        this.load();
        uni.showModal({
          title: '抢购成功',
          content: '应付 ¥' + (res.payAmount || 0) + '，是否前往订单页完成支付？',
          confirmText: '去订单页',
          success: r => {
            if (r.confirm) {
              uni.navigateTo({ url: '/pages/customer/flashOrders/flashOrders' });
            }
          }
        });
      }).catch(err => {
        uni.hideLoading();
        const msg = err && err.msg ? err.msg : String(err || '抢购失败');
        this.showFeedback('err', '抢购失败：' + msg);
        // 库存/限购可能被别的请求改过，失败后重拉一次，避免界面停在旧状态
        this.load();
      });
    },

    toggleFav(it) {
      if (!this.logged) {
        uni.showModal({
          title: '需要登录',
          content: '收藏需使用会员账号，是否前往登录？',
          success: r => { if (r.confirm) this.goMember(); }
        });
        return;
      }
      call('cloudFlash', 'toggleFavorite', { itemId: it._id, memberId: this.userId })
        .then(res => {
          this.items = this.items.map(x =>
            x._id === it._id ? Object.assign({}, x, { favorited: !!res.favorited }) : x);
          this.showFeedback('ok', res.favorited ? '已加入收藏' : '已取消收藏');
        })
        .catch(err => {
          this.showFeedback('err', (err && err.msg ? err.msg : String(err || '操作失败')));
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
.flash-page { min-height: 100vh; background: #f2f8f6; padding-bottom: 30rpx; }

.hero {
  padding: 30rpx 28rpx 26rpx;
  background: linear-gradient(135deg, #176db3 0%, #087c61 100%);
  color: #fff;
}
.hero-row { display: flex; justify-content: space-between; align-items: flex-start; }
.hero-title { font-size: 42rpx; font-weight: 700; letter-spacing: 2rpx; }
.hero-sub { font-size: 24rpx; opacity: .9; margin-top: 8rpx; }
.hero-badge {
  font-size: 20rpx; letter-spacing: 2rpx; padding: 6rpx 14rpx;
  border: 1rpx solid rgba(255,255,255,.7); border-radius: 30rpx; opacity: .9;
}
.hero-timer { margin-top: 26rpx; display: flex; align-items: baseline; }
.ht-label { font-size: 26rpx; opacity: .95; margin-right: 16rpx; }
.ht-num { font-size: 48rpx; font-weight: 700; font-variant-numeric: tabular-nums; }

.session-bar { white-space: nowrap; background: #fff; padding: 16rpx 10rpx; }
.session-item {
  display: inline-block; width: 180rpx; padding: 14rpx 0; margin: 0 8rpx;
  text-align: center; border-radius: 14rpx; background: #f2f8f6; color: #4d6f65;
}
.session-item.on { background: #eaf4fb; color: #087c61; border: 1rpx solid #ffb99e; }
.session-item.ended { opacity: .55; }
.s-time { font-size: 28rpx; font-weight: 700; }
.s-label { font-size: 22rpx; margin-top: 4rpx; }

.coupon-bar {
  display: flex; align-items: center; margin: 18rpx 24rpx; padding: 20rpx 22rpx;
  background: #fff; border-radius: 16rpx;
}
.cb-icon {
  width: 40rpx; height: 40rpx; line-height: 40rpx; text-align: center;
  background: #eaf4fb; color: #087c61; border-radius: 8rpx; font-size: 24rpx; margin-right: 16rpx;
}
.cb-text { flex: 1; font-size: 26rpx; color: #444; }
.cb-arrow { font-size: 36rpx; color: #9bb2aa; }

.feedback { margin: 0 24rpx 16rpx; padding: 18rpx 22rpx; border-radius: 12rpx; font-size: 26rpx; }
.feedback.ok { background: #e9f7ef; color: #087c61; }
.feedback.err { background: #fdecec; color: #c0392b; }
.feedback.warn { background: #fff5e3; color: #a56a00; }

.state-box { padding: 100rpx 30rpx; text-align: center; color: #5c786f; }
.state-icon { font-size: 64rpx; margin-bottom: 18rpx; }
.state-text { font-size: 28rpx; }
.state-tip { font-size: 24rpx; margin-top: 10rpx; color: #9bb2aa; }
.retry-btn {
  margin: 30rpx auto 0; width: 240rpx; height: 68rpx; line-height: 68rpx;
  font-size: 26rpx; color: #fff; background: #087c61; border-radius: 34rpx;
}

.list { padding: 0 24rpx; }
.card {
  background: #fff; border-radius: 18rpx; margin-bottom: 20rpx;
  padding: 20rpx; overflow: hidden;
}
.main { display: flex; }
.thumb { width: 190rpx; height: 190rpx; border-radius: 12rpx; background: #f2f8f6; flex-shrink: 0; }
.info { flex: 1; margin-left: 20rpx; min-width: 0; }
.name { font-size: 30rpx; font-weight: 700; color: #183c34; }
.desc {
  font-size: 22rpx; color: #5c786f; margin-top: 6rpx;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tags { margin-top: 10rpx; }
.tag {
  display: inline-block; font-size: 20rpx; color: #087c61; background: #eaf4fb;
  padding: 4rpx 10rpx; border-radius: 6rpx; margin-right: 8rpx;
}
.tag.ghost { color: #5c786f; background: #f2f8f6; }
.progress { height: 10rpx; background: #f2f8f6; border-radius: 10rpx; margin-top: 14rpx; overflow: hidden; }
.bar { height: 100%; background: linear-gradient(90deg, #5da8d3, #087c61); border-radius: 10rpx; }
.stock { font-size: 20rpx; color: #5c786f; margin-top: 6rpx; }
.price-row { display: flex; align-items: baseline; margin-top: 10rpx; }
.price { font-size: 38rpx; font-weight: 700; color: #087c61; }
.sign { font-size: 24rpx; }
.origin { font-size: 22rpx; color: #9bb2aa; text-decoration: line-through; margin-left: 12rpx; }

.actions { display: flex; align-items: center; justify-content: flex-end; margin-top: 16rpx; }
.fav { font-size: 40rpx; color: #dce9e4; padding: 0 22rpx; }
.fav.on { color: #087c61; }
.buy {
  margin: 0; min-width: 200rpx; height: 66rpx; line-height: 66rpx;
  font-size: 26rpx; color: #fff; background: #087c61; border-radius: 33rpx;
}
.buy.need-login { background: #5da8d3; }
.buy.off { background: #dce9e4; color: #5c786f; }
.foot-tip { text-align: center; font-size: 22rpx; color: #9bb2aa; padding: 20rpx 0 40rpx; }
</style>

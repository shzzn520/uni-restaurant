<template>
  <view class="orders-page">
    <view v-if="!logged" class="state-box">
      <view class="state-icon">🔒</view>
      <view class="state-text">登录后查看我的抢购订单</view>
      <view class="state-tip">订单与会员账号绑定，支付状态会实时同步</view>
      <button class="primary-btn" @tap="goLogin">去登录</button>
    </view>

    <view v-else-if="loading" class="state-box">
      <view class="state-icon">⏳</view>
      <view class="state-text">正在同步订单状态…</view>
    </view>

    <view v-else-if="error" class="state-box">
      <view class="state-icon">⚠</view>
      <view class="state-text">{{error}}</view>
      <button class="primary-btn" @tap="load">重新加载</button>
    </view>

    <view v-else>
      <!-- 状态筛选 -->
      <view class="tab-bar">
        <view v-for="t in tabs" :key="t.id" class="tab" :class="{on: tab === t.id}" @tap="switchTab(t.id)">
          {{t.name}} ({{countOf(t.id)}})
        </view>
      </view>

      <view v-if="filtered.length === 0" class="state-box small">
        <view class="state-icon">📋</view>
        <view class="state-text">{{tab === 'all' ? '还没有抢购订单' : '该状态下暂无订单'}}</view>
        <button class="primary-btn" @tap="goFlash">去抢购会场</button>
      </view>

      <view v-else class="list">
        <view v-for="o in filtered" :key="o._id" class="card">
          <view class="card-top">
            <view class="order-no">{{o.orderNo}}</view>
            <view class="status" :class="o._statusClass">{{o.statusText}}</view>
          </view>
          <view class="goods">
            <view class="goods-name">{{o.itemName}}</view>
            <view class="goods-meta">¥{{o.unitPrice}} × {{o.qty}}</view>
          </view>
          <view class="amount-row"><text>商品小计</text><text>¥{{o.subtotal}}</text></view>
          <view class="amount-row" v-if="o.couponAmount > 0"><text>优惠券减免</text><text class="minus">-¥{{o.couponAmount}}</text></view>
          <view class="amount-row total"><text>应付金额</text><text>¥{{o.payAmount}}</text></view>
          <view class="time">{{o._timeText}}</view>

          <view class="actions" v-if="o.status === 'pending'">
            <view class="btn ghost" @tap="cancel(o)">取消订单</view>
            <view class="btn primary" @tap="pay(o)">立即支付</view>
          </view>
          <view class="actions" v-else>
            <view class="btn ghost" @tap="goFlash">再逛会场</view>
          </view>
        </view>
      </view>

      <view v-if="filtered.length > 0" class="foot-tip">下拉可刷新订单状态</view>
    </view>
  </view>
</template>

<script>
// pages/customer/flashOrders/flashOrders.vue —— 我的抢购订单（状态同步）
// 演示环境支付为「直接置为已支付」，与项目里充值接口的演示定位一致；
// 真实项目应接支付回调后再改状态。
const { call } = require('@/common/cloud.js');
const session = require('@/common/session.js');

export default {
  data() {
    return {
      loading: false,
      loadedOnce: false,
      logged: false,
      userId: '',
      error: '',
      orders: [],
      tab: 'all',
      tabs: [
        { id: 'all', name: '全部' },
        { id: 'pending', name: '待支付' },
        { id: 'paid', name: '已支付' },
        { id: 'canceled', name: '已取消' }
      ],
      busyId: '',
      feedbackTimer: null
    };
  },

  computed: {
    filtered() {
      if (this.tab === 'all') return this.orders;
      return this.orders.filter(o => o.status === this.tab);
    }
  },

  onLoad() { this.load(); },

  onShow() {
    // 从会场/详情下单后返回，必须重拉才能看到新订单与最新状态
    if (this.loadedOnce) this.load();
    this.loadedOnce = true;
  },

  onPullDownRefresh() {
    this.load(() => uni.stopPullDownRefresh());
  },

  onUnload() {
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
  },

  methods: {
    load(done) {
      if (this.loading) { if (done) done(); return; }
      this.logged = session.isLogin();
      this.userId = this.logged ? session.getUserId() : '';
      if (!this.logged) {
        this.orders = [];
        this.error = '';
        if (done) done();
        return;
      }
      this.loading = true;
      this.error = '';
      call('cloudFlash', 'orders', { memberId: this.userId })
        .then(res => {
          this.orders = (res.data || []).map(o => this.decorate(o));
          this.loading = false;
          if (done) done();
        })
        .catch(err => {
          this.loading = false;
          this.error = err && err.msg ? err.msg : String(err || '加载失败');
          if (done) done();
        });
    },

    /** 时间文案与状态样式在数据入口算好，模板只绑单一字段 */
    decorate(o) {
      const cls = o.status === 'paid' ? 'paid'
        : (o.status === 'canceled' ? 'canceled' : 'pending');
      return Object.assign({}, o, {
        _timeText: this.fmtTime(o.createTime),
        _statusClass: cls
      });
    },

    fmtTime(ts) {
      if (!ts) return '';
      const d = new Date(Number(ts));
      const two = n => (n < 10 ? '0' + n : '' + n);
      return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate())
        + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
    },

    countOf(id) {
      if (id === 'all') return this.orders.length;
      return this.orders.filter(o => o.status === id).length;
    },

    switchTab(id) { this.tab = id; },

    pay(o) {
      if (this.busyId) return;
      uni.showModal({
        title: '确认支付',
        content: '应付 ¥' + o.payAmount + '，演示环境将直接标记为已支付',
        success: r => {
          if (!r.confirm) return;
          this.busyId = o._id;
          uni.showLoading({ title: '处理中' });
          call('cloudFlash', 'pay', { orderId: o._id, memberId: this.userId })
            .then(() => {
              uni.hideLoading();
              this.busyId = '';
              uni.showToast({ title: '支付成功', icon: 'success' });
              this.load();
            })
            .catch(err => {
              uni.hideLoading();
              this.busyId = '';
              uni.showToast({ title: err && err.msg ? err.msg : String(err || '支付失败'), icon: 'none' });
              // 状态可能已被别处改动，失败也重拉一次保持同步
              this.load();
            });
        }
      });
    },

    cancel(o) {
      if (this.busyId) return;
      uni.showModal({
        title: '取消订单',
        content: '取消后库存会归还，确定取消这笔抢购订单？',
        success: r => {
          if (!r.confirm) return;
          this.busyId = o._id;
          uni.showLoading({ title: '处理中' });
          call('cloudFlash', 'status', { orderId: o._id, status: 'canceled', memberId: this.userId })
            .then(() => {
              uni.hideLoading();
              this.busyId = '';
              uni.showToast({ title: '订单已取消', icon: 'none' });
              this.load();
            })
            .catch(err => {
              uni.hideLoading();
              this.busyId = '';
              uni.showToast({ title: err && err.msg ? err.msg : String(err || '取消失败'), icon: 'none' });
              this.load();
            });
        }
      });
    },

    goFlash() {
      uni.navigateTo({ url: '/pages/customer/flash/flash' });
    },

    goLogin() {
      uni.navigateTo({ url: '/pages/customer/member/member' });
    }
  }
};
</script>

<style>
.orders-page { min-height: 100vh; background: #f2f8f6; padding: 0 24rpx 40rpx; }
.state-box { padding: 150rpx 30rpx; text-align: center; color: #5c786f; }
.state-box.small { padding: 90rpx 30rpx; }
.state-icon { font-size: 68rpx; margin-bottom: 18rpx; }
.state-text { font-size: 30rpx; color: #3e5e55; }
.state-tip { font-size: 24rpx; color: #9bb2aa; margin-top: 12rpx; }
.primary-btn {
  margin: 36rpx auto 0; width: 300rpx; height: 72rpx; line-height: 72rpx;
  font-size: 27rpx; color: #fff; background: #087c61; border-radius: 36rpx;
}

.tab-bar { display: flex; background: #fff; border-radius: 14rpx; margin: 20rpx 0; padding: 8rpx; }
.tab { flex: 1; text-align: center; font-size: 24rpx; color: #5c786f; padding: 16rpx 0; border-radius: 10rpx; }
.tab.on { background: #eaf4fb; color: #087c61; font-weight: 700; }

.list { padding-bottom: 20rpx; }
.card { background: #fff; border-radius: 16rpx; padding: 24rpx; margin-bottom: 18rpx; }
.card-top { display: flex; justify-content: space-between; align-items: center; }
.order-no { font-size: 24rpx; color: #5c786f; }
.status { font-size: 24rpx; font-weight: 600; }
.status.pending { color: #087c61; }
.status.paid { color: #087c61; }
.status.canceled { color: #9bb2aa; }

.goods { display: flex; justify-content: space-between; align-items: baseline; padding: 20rpx 0 16rpx; border-bottom: 1rpx solid #f2f8f6; }
.goods-name { font-size: 30rpx; font-weight: 700; color: #183c34; }
.goods-meta { font-size: 24rpx; color: #5c786f; }
.amount-row { display: flex; justify-content: space-between; font-size: 24rpx; color: #5c786f; padding: 8rpx 0; }
.amount-row .minus { color: #087c61; }
.amount-row.total { font-size: 28rpx; font-weight: 700; color: #183c34; padding-top: 14rpx; }
.amount-row.total text:last-child { color: #087c61; }
.time { font-size: 22rpx; color: #9bb2aa; margin-top: 12rpx; }

.actions { display: flex; justify-content: flex-end; margin-top: 18rpx; padding-top: 18rpx; border-top: 1rpx solid #f2f8f6; }
.btn { font-size: 24rpx; padding: 12rpx 28rpx; border-radius: 30rpx; margin-left: 16rpx; }
.btn.ghost { color: #5c786f; border: 1rpx solid #dce9e4; }
.btn.primary { color: #fff; background: #087c61; }
.foot-tip { text-align: center; font-size: 22rpx; color: #9bb2aa; padding: 20rpx 0; }
</style>

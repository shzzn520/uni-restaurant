<template>
<!-- pages/merchant/orderDetail/orderDetail.wxml -->
<view class="container" v-if="order">
  <view class="status-card">
    <view class="pickup" v-if="order.pickupNo && order.status !== 'canceled'">
      <view class="pickup-label">{{order.deliveryType === 'delivery' ? '配送单号' : '取餐号'}}</view>
      <view class="pickup-no">{{order.pickupNo}}</view>
    </view>
    <view class="status-text">{{statusText}}</view>
    <view class="order-no">订单号：{{order.orderNo}}</view>
    <view class="order-time">下单时间：{{timeText}}</view>
    <!-- 外卖单：配送方式标签 + 收货信息（骑手/打包都需要），桌号仅自取单有意义 -->
    <view class="delivery-tag" v-if="order.deliveryType === 'delivery'">🛵 外卖配送</view>
    <view class="order-addr" v-if="order.deliveryType === 'delivery' && order.address">
      {{order.receiver}} {{order.phone}} · {{order.address}}
      <view class="delivery-time" v-if="order.deliveryTime">🕐 期望送达：{{order.deliveryTime}}</view>
    </view>
    <view class="order-table" v-if="order.deliveryType !== 'delivery' && order.tableNo">桌号：{{order.tableNo}}</view>
  </view>

  <view class="card">
    <view class="block-title">点餐明细</view>
    <view v-for="(item, index) in order.items" :key="item.dishId" class="row">
      <view class="row-name">{{item.name}}</view>
      <view class="row-qty">x{{item.qty}}</view>
      <view class="row-price price">{{fmt(item.price * item.qty)}}</view>
    </view>
    <view class="row total-row">
      <view class="row-name">合计</view>
      <view class="price total-num">{{totalText}}</view>
    </view>
    <view class="note-line" v-if="order.note">备注：{{order.note}}</view>
  </view>

  <!-- 状态操作 -->
  <view class="actions">
    <button v-if="canPreparing" class="act-btn primary" @tap="onPreparing">开始备餐</button>
    <button v-if="canDone" class="act-btn primary" @tap="onDone">完成出餐</button>
    <!-- 外卖单出餐后：进入配送环节（自取单无此两步） -->
    <button v-if="canDelivering" class="act-btn primary" @tap="onDelivering">标记配送中</button>
    <button v-if="canDelivered" class="act-btn primary" @tap="onDelivered">标记已送达</button>
    <button v-if="canCancel" class="act-btn danger" @tap="onCancel">取消订单</button>
    <view v-if="!canPreparing && !canDone && !canCancel && !canDelivering && !canDelivered" class="done-tip">该订单已为终态</view>
  </view>
</view>
</template>

<script>
// pages/merchant/orderDetail/orderDetail.js —— 订单详情与状态流转
const { call } = require('@/common/cloud.js');
const { yuan, STATUS_TEXT, shortTime } = require('@/common/format.js');
const { requireLogin } = require('@/common/merchant.js');
export default {

  data() {
    return {
    order: null,
    statusText: '',
    totalText: '',
    timeText: '',
    // 状态流转按钮：根据当前状态显示可操作项
    canPreparing: false,
    canDone: false,
    canCancel: false,
    // 外卖单专属：出餐后进入「配送中 / 已送达」物流环节
    canDelivering: false,
    canDelivered: false
    };
  },

  onLoad(options) {
    this.orderId = options.orderId;
    // 商家端守卫：没有商户口令就回登录页（2026-10-21 加）
    if (!requireLogin(this)) return;
    this.load();
  },

  methods: {
    // 替代原生 wxs 的金额格式化（uni-app 不支持 <wxs> 标签）
    fmt(n) {
      n = Number(n) || 0;
      return '¥' + n.toFixed(2);
    },

    async load() {
    try {
      const res = await call('cloudOrder', 'get', { orderId: this.orderId });
      const o = res.data;
      if (!o) return;
          this.order = o;
    this.statusText = STATUS_TEXT[o.status];
    this.totalText = yuan(o.totalPrice);
    this.timeText = shortTime(o.createTime);
    this.canPreparing = o.status === 'paid';
    // 已支付 -> 开始备餐
    this.canDone = o.status === 'preparing';
    // 备餐中 -> 完成；可取消的条件
    this.canCancel = o.status === 'paid' || o.status === 'preparing';
    // 外卖单在出餐后进入「配送中 / 已送达」两个物流环节；自取单 done 即终态（后端状态机同此规则）
    this.canDelivering = o.deliveryType === 'delivery' && o.status === 'done';
    this.canDelivered = o.deliveryType === 'delivery' && o.status === 'delivering';
    } catch (e) {
      uni.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // 更新订单状态
  async update(status) {
    try {
      await call('cloudOrder', 'updateStatus', { orderId: this.orderId, status });
      uni.showToast({ title: '已更新', icon: 'success' });
      this.load();
    } catch (e) {
      uni.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  onPreparing() { this.update('preparing'); },
  onDone() { this.update('done'); },
  // 外卖单：出餐后交给骑手，进入配送中
  onDelivering() { this.update('delivering'); },
  // 外卖单：送达顾客，需二次确认（终态操作，误点无法回退）
  onDelivered() {
    uni.showModal({
      title: '标记已送达',
      content: '确认订单已送达顾客？',
      success: (r) => { if (r.confirm) this.update('delivered'); }
    });
  },
  onCancel() {
    uni.showModal({
      title: '取消订单',
      content: '确认取消该订单？',
      success: (r) => { if (r.confirm) this.update('canceled'); }
    });
  }
  }
}
</script>

<style scoped>
/* pages/merchant/orderDetail/orderDetail.wxss */
.status-card {
  background: var(--primary);
  color: #fff;
  border-radius: 20rpx;
  padding: 36rpx 32rpx;
}
.status-text { font-size: 40rpx; font-weight: 700; }
.order-no, .order-time, .order-table { font-size: 26rpx; opacity: 0.92; margin-top: 8rpx; }

/* 外卖标签：红底白字，与订单列表页同一套视觉 */
.delivery-tag {
  display: inline-block;
  font-size: 24rpx;
  color: #fff;
  background: #087c61;
  border-radius: 6rpx;
  padding: 4rpx 14rpx;
  margin-top: 12rpx;
}
/* 收货信息：外卖单才有，换行展示避免撑破状态卡 */
.order-addr {
  font-size: 26rpx;
  opacity: 0.92;
  margin-top: 8rpx;
  line-height: 1.5;
}
/* 期望送达时间：换行展示，避免撑破状态卡 */
.delivery-time {
  font-size: 24rpx;
  opacity: 0.9;
  margin-top: 6rpx;
}

/* 取餐号 */
.pickup {
  background: rgba(255, 255, 255, .16);
  border-radius: 14rpx;
  padding: 16rpx 24rpx 20rpx;
  margin-bottom: 20rpx;
}
.pickup-label { font-size: 24rpx; opacity: .85; }
.pickup-no { font-size: 64rpx; font-weight: 800; line-height: 1.1; color: #FFC72C; }

.block-title { font-weight: 700; font-size: 30rpx; margin-bottom: 16rpx; }
.row { display: flex; align-items: center; padding: 16rpx 0; }
.row-name { flex: 1; font-size: 28rpx; }
.row-qty { color: var(--muted); margin: 0 24rpx; font-size: 26rpx; }
.row-price { font-size: 28rpx; width: 160rpx; text-align: right; }
.total-row { border-top: 1rpx solid #f2f8f6; margin-top: 8rpx; padding-top: 24rpx; }
.total-num { font-size: 34rpx; font-weight: 700; }
.note-line { color: var(--muted); font-size: 26rpx; margin-top: 12rpx; }

.actions { margin-top: 24rpx; }
.act-btn { border-radius: 48rpx; margin-bottom: 20rpx; color: #fff; }
.act-btn.primary { background: var(--primary); }
.act-btn.danger { background: #e74c3c; }
.done-tip { text-align: center; color: var(--muted); padding: 20rpx; }
</style>

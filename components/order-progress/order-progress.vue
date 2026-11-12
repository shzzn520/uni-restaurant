<template>
  <!-- 订单进度：外卖走交接节点，自取走紧凑进度条 -->
  <view>
    <view class="delivery-track" v-if="isDelivery">
      <view class="track-head">
        <view class="track-title">配送进度</view>
        <view class="track-state" :class="'state-' + order.status">{{ stateLabel }}</view>
      </view>

      <view class="track-cancelled" v-if="order.status === 'canceled'">
        本单已取消，配送流程已结束。
      </view>
      <view class="route-list" v-else>
        <view
          v-for="node in nodes"
          :key="node.key"
          class="route-node"
          :class="{ done: node.done, current: node.current }"
        >
          <view class="route-marker">{{ node.done ? '✓' : node.index }}</view>
          <view class="route-copy">
            <view class="route-title">{{ node.title }}</view>
            <view class="route-detail" v-if="node.current">{{ node.detail }}</view>
          </view>
        </view>
      </view>

      <view class="track-disclaimer">配送状态由门店更新；当前演示版不含骑手实时定位。</view>
    </view>

    <view class="steps" v-else>
      <view v-for="item in steps" :key="item.key" class="step" :class="item.done ? 'done' : ''">
        <view class="dot"></view>
        <view class="step-text">{{ item.text }}</view>
      </view>
    </view>
  </view>
</template>

<script>
// components/order-progress/order-progress.vue —— 订单进度展示
// 节点数据由页面计算（状态机在页面/服务端），组件只负责渲染，
// 避免「页面算一套、组件又猜一套」。
export default {
  name: 'OrderProgress',
  props: {
    isDelivery: { type: Boolean, default: false },
    order: { type: Object, required: true },
    nodes: { type: Array, default: () => [] },
    steps: { type: Array, default: () => [] },
    stateLabel: { type: String, default: '' }
  }
};
</script>

<style scoped>
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
</style>
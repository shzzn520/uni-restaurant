<template>
  <!-- 通用状态块：登录态 / 加载中 / 出错 / 空列表 共用 -->
  <view class="empty-state" :class="{ compact: compact }">
    <view class="es-icon" v-if="icon">{{ icon }}</view>
    <view class="es-title">{{ title }}</view>
    <view class="es-sub" v-if="sub">{{ sub }}</view>
    <view class="es-tip" v-if="tip">{{ tip }}</view>
    <view class="es-actions">
      <slot></slot>
    </view>
  </view>
</template>

<script>
// components/empty-state/empty-state.vue —— 空态 / 错误态 / 未登录态统一组件
// 设计要点：
//   - 只负责「展示」，按钮等操作通过默认插槽交给页面，避免把业务跳转塞进组件；
//   - compact 用于卡片内部的小空态，普通态用于整页空态。
export default {
  name: 'EmptyState',
  props: {
    icon: { type: String, default: '' },     // emoji 或符号
    title: { type: String, default: '' },    // 主文案
    sub: { type: String, default: '' },      // 主文案下的补充说明
    tip: { type: String, default: '' },      // 更弱的提示（灰色小字）
    compact: { type: Boolean, default: false } // 小尺寸（卡片内）
  }
};
</script>

<style scoped>
.empty-state {
  padding: 150rpx 30rpx;
  text-align: center;
}
.empty-state.compact {
  padding: 60rpx 20rpx;
}
.es-icon {
  font-size: 68rpx;
  margin-bottom: 18rpx;
  line-height: 1.2;
}
.compact .es-icon {
  font-size: 48rpx;
  margin-bottom: 12rpx;
}
.es-title {
  font-size: 30rpx;
  color: #3e5e55;
  line-height: 1.5;
}
.es-sub {
  font-size: 24rpx;
  color: #5c786f;
  margin-top: 12rpx;
  line-height: 1.6;
}
.es-tip {
  font-size: 22rpx;
  color: #9bb2aa;
  margin-top: 10rpx;
}
.es-actions:empty {
  display: none;
}
</style>
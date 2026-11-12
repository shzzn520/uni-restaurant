<template>
  <!-- 数量步进器：只发事件，不直接改值，数量边界由页面业务决定 -->
  <view class="stepper">
    <text class="step-btn" :class="{ off: value <= min }" @tap="$emit('dec')">{{ minus }}</text>
    <text class="step-num">{{ value }}</text>
    <text class="step-btn" :class="{ off: value >= max }" @tap="$emit('inc')">{{ plus }}</text>
  </view>
</template>

<script>
// components/stepper/stepper.vue —— 数量加减控件
export default {
  name: 'Stepper',
  props: {
    value: { type: Number, default: 1 },
    min: { type: Number, default: 1 },
    max: { type: Number, default: 99 },
    minus: { type: String, default: '-' },
    plus: { type: String, default: '+' }
  }
};
</script>

<style scoped>
.stepper {
  display: flex;
  align-items: center;
}
.step-btn {
  width: 52rpx;
  height: 52rpx;
  line-height: 48rpx;
  text-align: center;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  font-size: 36rpx;
}
.step-btn.off { background: #dce9e4; }
.step-num { width: 64rpx; text-align: center; font-size: 30rpx; }
</style>
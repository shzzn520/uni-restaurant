<template>
  <!-- 金额明细：结算页与订单详情共用，行内容由页面按需传入 -->
  <view class="amount-summary">
    <view class="amt-row" v-for="(r, i) in rows" :key="i">
      <text>
        {{ r.label }}
        <text class="tag-lv" v-if="r.tag">{{ r.tag }}</text>
      </text>
      <text class="price" :class="r.kind">{{ signOf(r) }}{{ fmt(r.amount) }}</text>
    </view>

    <view class="total-card">
      <text>{{ totalLabel }}</text>
      <text class="price total-num">{{ fmt(totalAmount) }}</text>
    </view>

    <view class="saved-tip" v-if="Number(saved) > 0">
      {{ savedPrefix }} {{ fmt(saved) }}
    </view>

    <!-- 预计等候 / 送达：只有结算页需要，订单页不传即隐藏 -->
    <view class="wait-row" v-if="waitValue">
      <text>{{ waitLabel }}</text>
      <text class="wait-num">{{ waitValue }}</text>
    </view>
  </view>
</template>

<script>
// components/amount-summary/amount-summary.vue —— 费用明细
// rows 结构：{ label, amount, kind: 'minus' | 'plus' | 'free', tag }
// 金额只做展示，真正的优惠计算仍在服务端（规则见 common/rules.js）。
export default {
  name: 'AmountSummary',
  props: {
    rows: { type: Array, default: () => [] },
    totalLabel: { type: String, default: '实付金额' },
    totalAmount: { type: [Number, String], default: 0 },
    saved: { type: [Number, String], default: 0 },
    savedPrefix: { type: String, default: '已为你节省' },
    waitLabel: { type: String, default: '' },
    waitValue: { type: String, default: '' }
  },
  methods: {
    // 分 -> 元，统一两位小数
    fmt(n) {
      return '¥' + (Number(n) || 0).toFixed(2);
    },
    signOf(row) {
      if (row.kind === 'plus') return '+';
      if (row.kind === 'minus') return '-';
      return '';
    }
  }
};
</script>

<style scoped>
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
.wait-row {
  display: flex;
  justify-content: space-between;
  font-size: 26rpx;
  color: #4d6f65;
  padding: 10rpx 0 0;
}
.wait-num { color: var(--primary); font-weight: 600; }
</style>
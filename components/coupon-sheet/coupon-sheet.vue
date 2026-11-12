<template>
  <!-- 优惠券选择弹层：可用券置顶、不可用券沉底并说明原因 -->
  <view>
    <view class="mask" v-if="visible" @tap="$emit('close')"></view>
    <view class="sheet" v-if="visible">
      <view class="sheet-head">
        <text class="sheet-title">选择优惠券</text>
        <text class="sheet-close" @tap="$emit('close')">关闭</text>
      </view>

      <scroll-view scroll-y class="sheet-list">
        <!-- 不使用 -->
        <view class="cp-row" :class="{ on: !pickedId }" @tap="$emit('pick', '')">
          <view class="cp-main">
            <view class="cp-name">不使用优惠券</view>
          </view>
          <text class="cp-tick" v-if="!pickedId">✓</text>
        </view>

        <!-- 可用券 -->
        <view
          v-for="c in coupons"
          :key="c._id"
          class="cp-row"
          :class="{ on: pickedId === c._id }"
          @tap="$emit('pick', c._id)"
        >
          <view class="cp-left">
            <view class="cp-amount">
              <text class="cp-sign">¥</text>{{ c.amount }}<text class="cp-unit">元</text>
            </view>
            <view class="cp-cond">{{ c.threshold > 0 ? '满 ' + c.threshold + ' 可用' : '无门槛' }}</view>
          </view>
          <view class="cp-main">
            <view class="cp-name">{{ c.couponName }}</view>
            <view class="cp-exp">有效期至 {{ formatter ? formatter(c.expireAt) : '' }}</view>
          </view>
          <text class="cp-tick" v-if="pickedId === c._id">✓</text>
        </view>

        <empty-state v-if="coupons.length === 0 && loading" compact title="加载中…" />
        <empty-state v-if="coupons.length === 0 && !loading" compact title="暂无可用优惠券，去会员中心领一张" />

        <!-- 不可用券也列出来并说明原因，让顾客知道为什么不能用 -->
        <view class="cp-sub" v-if="disabledCoupons.length > 0">不可用</view>
        <view v-for="c in disabledCoupons" :key="c._id" class="cp-row disabled">
          <view class="cp-left">
            <view class="cp-amount">
              <text class="cp-sign">¥</text>{{ c.amount }}<text class="cp-unit">元</text>
            </view>
            <view class="cp-cond">{{ c.threshold > 0 ? '满 ' + c.threshold + ' 可用' : '无门槛' }}</view>
          </view>
          <view class="cp-main">
            <view class="cp-name">{{ c.couponName }}</view>
            <view class="cp-exp">{{ c.reason }}</view>
          </view>
        </view>
      </scroll-view>

      <view class="sheet-foot">
        <view class="foot-link" @tap="$emit('member')">领券中心</view>
        <button class="primary-btn sm" @tap="$emit('close')">确定</button>
      </view>
    </view>
  </view>
</template>

<script>
// components/coupon-sheet/coupon-sheet.vue —— 优惠券选择弹层
// 只负责展示和选择，不参与价格试算：选中后由页面重新向服务端 quote。
export default {
  name: 'CouponSheet',
  props: {
    visible: { type: Boolean, default: false },
    coupons: { type: Array, default: () => [] },          // 可用券
    disabledCoupons: { type: Array, default: () => [] },  // { ...coupon, reason }
    pickedId: { type: String, default: '' },
    loading: { type: Boolean, default: false },
    formatter: { type: Function, default: null }          // 日期格式化函数，由页面注入
  }
};
</script>

<style scoped>
.mask {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,.5);
  z-index: 20;
}
.sheet {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  background: #fff;
  border-radius: 24rpx 24rpx 0 0;
  padding: 32rpx;
  z-index: 21;
  height: 72vh;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}
.sheet-head { display: flex; justify-content: space-between; align-items: center; }
.sheet-title { font-size: 32rpx; font-weight: 700; }
.sheet-close { color: var(--muted); font-size: 26rpx; }
.sheet-list { flex: 1; margin-top: 16rpx; }
.sheet-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 20rpx;
  border-top: 1rpx solid #f2f8f6;
}
.foot-link { color: var(--primary); font-size: 26rpx; }
.primary-btn.sm { width: 220rpx; margin: 0; }

/* 券行 */
.cp-row {
  display: flex;
  align-items: center;
  padding: 22rpx 0;
  border-bottom: 1rpx solid #f2f8f6;
}
.cp-row.on { background: #eaf4fb; margin: 0 -16rpx; padding-left: 16rpx; padding-right: 16rpx; }
.cp-row.disabled { opacity: .5; }
.cp-left {
  width: 160rpx;
  flex-shrink: 0;
  border-right: 1rpx dashed #dce9e4;
  text-align: center;
}
.cp-amount { color: var(--primary); font-weight: 700; font-size: 38rpx; line-height: 1.1; }
.cp-sign { font-size: 20rpx; }
.cp-unit { font-size: 22rpx; font-weight: 400; }
.cp-cond { font-size: 20rpx; color: var(--muted); margin-top: 4rpx; }
.cp-main { flex: 1; padding-left: 20rpx; overflow: hidden; }
.cp-name { font-size: 28rpx; color: #183c34; }
.cp-exp { font-size: 22rpx; color: var(--muted); margin-top: 6rpx; }
.cp-tick { color: var(--primary); font-size: 32rpx; font-weight: 700; padding-right: 16rpx; }
.cp-sub {
  font-size: 24rpx;
  color: var(--muted);
  padding: 20rpx 0 8rpx;
}
</style>
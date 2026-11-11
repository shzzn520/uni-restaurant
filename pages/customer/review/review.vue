<template>
<!-- pages/customer/review/review.vue —— 菜品评价页
     星星评分 + 文字 + 快速短语标签；带 orderId/dishId 进入，只能评本单买过的菜 -->
<view class="container">
  <view class="card">
    <view class="rv-dish">
      <view class="rv-name">{{dishName}}</view>
      <view class="rv-sub">订单 {{orderId}}</view>
    </view>

    <!-- 评分 -->
    <view class="rate-block">
      <view class="block-title">综合评分</view>
      <view class="stars">
        <text v-for="n in 5" :key="n" class="star"
              :class="{on: n <= rating}" @tap="rating = n">★</text>
      </view>
      <view class="rate-text">{{rateText}}</view>
    </view>

    <!-- 快速短语：点一下填进输入框，减少打字成本 -->
    <view class="card inner">
      <view class="block-title">说点什么（选填）</view>
      <view class="quick-tags">
        <text v-for="t in QUICK_TAGS" :key="t" class="qtag"
              :class="{on: content === t}" @tap="pickQuick(t)">{{t}}</text>
      </view>
      <textarea class="rv-textarea" placeholder="口味、分量、包装……写得越具体越有参考价值"
                :value="content" :maxlength="200" @input="onContent" />
      <view class="counter">{{content.length}} / 200</view>
    </view>

    <button class="primary-btn" @tap="submit" :disabled="submitting">
      {{submitting ? '提交中...' : '发表评价'}}
    </button>
    <view class="tip">评价发布后不可修改，可在菜品详情页看到</view>
  </view>
</view>
</template>

<script>
// pages/customer/review/review.js —— 发表一条菜品评价
const { call } = require('@/common/cloud.js');
const app = getApp();

// 快速短语标签：覆盖最常见的几种评价，避免用户面对空输入框直接放弃
const QUICK_TAGS = [
  '味道很棒', '分量足', '包装完好', '送餐很快',
  '有点咸', '不够热', '分量偏少', '包装撒了'
];

// 评分 → 文案。1 星和 5 星的说法差异最大，中间档用中性描述
const RATE_TEXT = {
  1: '很不满意，商家会认真看看问题出在哪',
  2: '不太满意，还有改进空间',
  3: '一般般，勉强可以',
  4: '还不错，比较满意',
  5: '非常满意，下次还点'
};

export default {

  data() {
    return {
    orderId: '',
    dishId: '',
    dishName: '',
    rating: 5,     // 默认 5 星：多数用户是满意才来评价的，少点一次反而更麻烦
    content: '',
    submitting: false
    };
  },

  computed: {
    rateText() {
      return RATE_TEXT[this.rating] || '请选择评分';
    }
  },

  onLoad(options) {
    this.orderId = options.orderId || '';
    this.dishId = options.dishId || '';
    // dishName 经 encodeURIComponent 传参，解回来要 decodeURIComponent
    this.dishName = options.dishName ? decodeURIComponent(options.dishName) : '这道菜';
  },

  methods: {
    shopId() {
      return app.globalData.shopId || uni.getStorageSync('shopId') || 'demo-shop';
    },

    onContent(e) { this.content = e.detail.value; },

    // 快速短语：再点一次取消，避免手滑改了主意却改不掉
    pickQuick(t) {
      this.content = this.content === t ? '' : t;
    },

    async submit() {
      if (this.submitting) return;
      if (!this.rating || this.rating < 1) {
        uni.showToast({ title: '请先选择评分', icon: 'none' });
        return;
      }
      this.submitting = true;
      try {
        await call('cloudReview', 'create', {
          shopId: this.shopId(),
          orderId: this.orderId,
          dishId: this.dishId,
          dishName: this.dishName,
          rating: this.rating,
          content: this.content
        });
        uni.showToast({ title: '评价成功，感谢反馈', icon: 'success' });
        setTimeout(() => uni.navigateBack(), 900);
      } catch (e) {
        // 服务端的报错是有信息量的（没买过 / 已评价 / 订单未完成），原样带给用户
        uni.showToast({ title: String(e).slice(0, 20) || '提交失败', icon: 'none' });
        this.submitting = false;
      }
    }
  }
}
</script>

<style scoped>
/* pages/customer/review/review.wxss */
.card {
  background: #fff;
  border-radius: 20rpx;
  margin: 24rpx;
  padding: 32rpx;
}
.card.inner { padding: 24rpx 0; border-top: 1rpx solid #f2f8f6; margin: 20rpx 0; }
.block-title { font-weight: 700; font-size: 28rpx; margin-bottom: 20rpx; }
.rv-dish { margin-bottom: 10rpx; }
.rv-name { font-size: 36rpx; font-weight: 700; }
.rv-sub { color: var(--muted); font-size: 24rpx; margin-top: 8rpx; }

.stars { display: flex; }
.star {
  font-size: 60rpx;
  color: #dce9e4;
  margin-right: 20rpx;
}
.star.on { color: #f5a623; }
.rate-text { color: var(--muted); font-size: 25rpx; margin-top: 16rpx; }

.quick-tags { display: flex; flex-wrap: wrap; margin-bottom: 20rpx; }
.qtag {
  font-size: 24rpx;
  padding: 10rpx 24rpx;
  border-radius: 26rpx;
  background: #f2f8f6;
  color: #4d6f65;
  margin: 0 14rpx 14rpx 0;
}
.qtag.on { background: var(--primary); color: #fff; }

.rv-textarea {
  width: 100%;
  height: 180rpx;
  background: #f2f8f6;
  border-radius: 12rpx;
  padding: 20rpx;
  font-size: 28rpx;
  box-sizing: border-box;
}
.counter {
  text-align: right;
  color: #9bb2aa;
  font-size: 22rpx;
  margin-top: 10rpx;
}
.tip { color: var(--muted); font-size: 24rpx; text-align: center; margin-top: 20rpx; }
</style>
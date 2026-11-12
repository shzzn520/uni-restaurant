<template>
<!-- pages/customer/menu/menu.wxml -->
<view class="menu-page">
  <!-- 顶部店铺名 -->
  <view class="header">{{shopName}}</view>

  <!-- 搜索栏：输入关键词即切换为全菜单平面搜索（跨分类），清空回到分类视图 -->
  <view class="search-bar">
    <view class="search-box">
      <text class="search-icon">🔍</text>
      <input class="search-input" placeholder="搜索菜品，如「牛肉面」"
             :value="keyword" confirm-type="search" @input="onSearchInput" />
      <text v-if="keyword" class="search-clear" @tap="clearSearch">×</text>
    </view>
  </view>

  <!-- 空数据兜底：提示而非自动重置（避免误清空商家数据）。搜索态不走这里 -->
  <view v-if="menuList.length === 0 && !searching" class="empty-wrap">
    <view class="empty-tip">该店铺暂无上架菜品</view>
    <view class="empty-sub">可稍后重试，或联系商家在管理后台上架菜品</view>
  </view>

  <!-- 搜索结果：平面列表，命中关键字高亮（菜名/描述均参与匹配） -->
  <scroll-view v-if="searching" class="dish-list search-list" scroll-y>
    <view class="search-count" v-if="searchResults.length > 0">
      共 {{searchResults.length}} 个相关菜品
    </view>
    <dish-card
      v-for="item in searchResults"
      :key="item._id"
      :item="item"
      :sold="isSoldOut(item)"
      :at-limit="atLimit(item._id)"
      :rating="ratingOf(item._id)"
      :review-count="reviewCountOf(item._id)"
      :name-segs="highlightSegs(item.name)"
      :desc-segs="highlightSegs(item.desc)"
      @tap="openDetail"
      @add="quickAdd"
    />
    <view v-if="searchResults.length === 0" class="empty">没有找到「{{keyword}}」相关菜品</view>
  </scroll-view>

  <!-- 主体：左侧分类 + 右侧菜品 -->
  <view class="body" v-if="menuList.length > 0 && !searching">
    <scroll-view class="cat-list" scroll-y>
      <view
        v-for="(item, index) in categories"
        :key="item._id"
        class="cat-item"
        :class="{ active: activeCat === index }"
        @tap="switchCat(index)"
      >{{item.name}}</view>
    </scroll-view>

    <scroll-view class="dish-list" scroll-y>
      <dish-card
        v-for="item in menuList[activeCat].dishes"
        :key="item._id"
        :item="item"
        :sold="isSoldOut(item)"
        :at-limit="atLimit(item._id)"
        :rating="ratingOf(item._id)"
        :review-count="reviewCountOf(item._id)"
        @tap="openDetail"
        @add="quickAdd"
      />
      <view v-if="menuList[activeCat].dishes.length === 0" class="empty">该分类暂无可售商品</view>
    </scroll-view>
  </view>

  <!-- 底部购物车栏 -->
  <view class="cart-bar" :class="{ bump: bump }">
    <view class="cart-icon" @tap="toggleCart">
      <text>购物车</text>
      <text class="badge" v-if="cartCount">{{cartCount}}</text>
    </view>
    <view class="cart-total price">{{fmt(cartTotal)}}</view>
    <view class="checkout-btn" @tap="goConfirm">去结算</view>
  </view>

  <!-- 购物车弹层 -->
  <view class="mask" v-if="showCart" @tap="toggleCart"></view>
  <view class="sheet" v-if="showCart">
    <view class="sheet-head">
      <view class="sheet-title">已选商品（{{cartCount}} 件）</view>
      <text class="sheet-clear" v-if="cartItems.length > 0" @tap="clearCart">清空</text>
    </view>
    <scroll-view scroll-y class="sheet-list">
      <view v-for="(item, index) in cartItems" :key="item.id" class="sheet-row">
        <image v-if="item.dish.image" class="sheet-thumb" :src="item.dish.image" mode="aspectFill"></image>
        <view v-else class="sheet-thumb">{{item.dish.name[0]}}</view>
        <view class="sheet-name">{{item.dish.name}}</view>
        <view class="sheet-price price">{{fmt(item.dish.price)}}</view>
        <stepper :value="item.qty" :max="MAX_QTY" @dec="cartDec(item.id)" @inc="cartInc(item.id)" />
      </view>
      <view v-if="cartItems.length === 0" class="empty">购物车是空的</view>
    </scroll-view>
  </view>

  <!-- 商品详情弹层 -->
  <view class="mask" v-if="showDetail" @tap="closeDetail"></view>
  <view class="sheet" v-if="showDetail">
    <image v-if="current.image" class="detail-thumb" :src="current.image" mode="aspectFill"></image>
    <view v-else class="detail-thumb">{{current.name[0]}}</view>
    <view class="detail-name">{{current.name}}</view>
    <view class="detail-rate" v-if="ratingOf(current._id)">
      <text class="dr-star">★ {{ratingOf(current._id)}}</text>
      <text class="dr-count">{{reviewCountOf(current._id)}} 条评价</text>
    </view>
    <view class="detail-desc">{{current.desc || '暂无描述'}}</view>

    <!-- 规格备注：进单条备注，商家端能看到（冷饮去冰之类） -->
    <view class="spec-wrap" v-if="!isSoldOut(current)">
      <view class="spec-title">规格要求（选填）</view>
      <view class="spec-tags">
        <text v-for="t in SPEC_TAGS" :key="t" class="spec-tag"
              :class="{on: spec === t}" @tap="toggleSpec(t)">{{t}}</text>
      </view>
    </view>

    <view class="detail-price price">{{fmt(current.price)}}</view>
    <stepper class="detail-stepper" :value="qty" :max="MAX_QTY" @dec="dec" @inc="inc" />
    <button class="primary-btn" @tap="addToCart" :disabled="atLimit(current._id)">
      {{atLimit(current._id) ? '已达单菜上限（' + MAX_QTY + ' 份）' : '加入购物车'}}
    </button>

    <!-- 该菜品的真实评价 -->
    <view class="review-block" v-if="reviews.length > 0">
      <view class="rv-title">顾客评价（{{reviews.length}}）</view>
      <view class="rv-item" v-for="r in reviews" :key="r._id">
        <view class="rv-stars">{{starsText(r.rating)}}</view>
        <view class="rv-content" v-if="r.content">{{r.content}}</view>
        <image v-for="(img, i) in splitImages(r.images)" :key="i" class="rv-img" :src="img" mode="aspectFill"></image>
        <!-- 商家回复：跟在评价下面，让后来的人看到「这家店会回应」，比只堆好评更有说服力 -->
        <view class="rv-reply" v-if="r.reply">
          <text class="rv-reply-tag">商家回复</text>
          <text class="rv-reply-text">{{r.reply}}</text>
        </view>
        <view class="rv-time">{{fmtDate(r.createTime)}}</view>
      </view>
    </view>
    <view class="review-empty" v-else>还没有人评价过这道菜</view>
  </view>
</view>
</template>

<script>
// 菜单页行为见 mixins/menu-cart.js
const menuCart = require('@/mixins/menu-cart.js');
export default { mixins: [menuCart] };
</script>
<style scoped>
/* pages/customer/menu/menu.wxss */
.menu-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #fff;
}
.header {
  height: 88rpx;
  line-height: 88rpx;
  text-align: center;
  font-weight: 700;
  font-size: 32rpx;
  background: var(--primary);
  color: #fff;
}
/* 搜索栏：贴店铺名下方，胶囊输入框（仿外卖 App 惯例） */
.search-bar {
  padding: 16rpx 24rpx;
  background: #fff;
  border-bottom: 1rpx solid #f2f8f6;
}
.search-box {
  display: flex;
  align-items: center;
  background: #f2f8f6;
  border-radius: 32rpx;
  padding: 12rpx 24rpx;
}
.search-icon { font-size: 26rpx; margin-right: 12rpx; }
.search-input { flex: 1; font-size: 26rpx; height: 44rpx; line-height: 44rpx; }
.search-clear {
  width: 36rpx; height: 36rpx; line-height: 32rpx; text-align: center;
  border-radius: 50%; background: #dce9e4; color: #fff; font-size: 26rpx;
}
.search-count {
  font-size: 24rpx; color: var(--muted);
  padding: 20rpx 0 8rpx;
}
/* 命中关键字：主题色加粗，一眼看到「为什么搜出这条」 */
.body {
  flex: 1;
  display: flex;
  overflow: hidden;
}
/* 左侧分类 */
.cat-list {
  width: 180rpx;
  background: #f2f8f6;
  height: 100%;
}
.cat-item {
  padding: 36rpx 12rpx;
  text-align: center;
  font-size: 28rpx;
  color: #3e5e55;
}
.cat-item.active {
  background: #fff;
  color: var(--primary);
  font-weight: 700;
  border-left: 6rpx solid var(--primary);
}
/* 右侧菜品 */
.dish-list {
  flex: 1;
  height: 100%;
  padding: 0 24rpx;
}
.empty { text-align: center; color: var(--muted); padding: 60rpx 0; }

/* 空数据兜底 */
.empty-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80rpx 40rpx;
}
.empty-tip { color: var(--muted); font-size: 28rpx; margin-bottom: 24rpx; }
.load-btn { width: 400rpx; }

/* 底部购物车栏 */
.cart-bar {
  height: 100rpx;
  display: flex;
  align-items: center;
  background: #14526c;
  color: #fff;
  padding: 0 24rpx;
}
/* 加购反馈：整条栏轻微放大一下，320ms 后由 JS 摘掉 bump 类 */
.cart-bar.bump { animation: barBump .32s ease; }
@keyframes barBump {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.035); }
  100% { transform: scale(1); }
}
.cart-icon {
  position: relative;
  font-size: 28rpx;
  padding-right: 16rpx;
}
.badge {
  position: absolute;
  top: -10rpx;
  right: -6rpx;
  background: var(--primary);
  color: #fff;
  font-size: 20rpx;
  min-width: 32rpx;
  height: 32rpx;
  line-height: 32rpx;
  text-align: center;
  border-radius: 16rpx;
}
.cart-total { flex: 1; font-weight: 700; }
.checkout-btn {
  background: var(--primary);
  color: #fff;
  padding: 0 40rpx;
  height: 100rpx;
  line-height: 100rpx;
  font-size: 30rpx;
}

/* 弹层通用 */
.mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.5);
  z-index: 10;
}
.sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  background: #fff;
  border-radius: 24rpx 24rpx 0 0;
  z-index: 11;
  padding: 32rpx;
  max-height: 70vh;
  box-sizing: border-box;
}
.sheet-title { font-weight: 700; font-size: 32rpx; margin-bottom: 16rpx; }
.sheet-head { display: flex; justify-content: space-between; align-items: center; }
.sheet-clear { color: #5c786f; font-size: 26rpx; padding-left: 20rpx; }
.sheet-list { max-height: 50vh; }
.sheet-row {
  display: flex;
  align-items: center;
  padding: 20rpx 0;
  border-bottom: 1rpx solid #f2f8f6;
}
.sheet-thumb {
  width: 68rpx;
  height: 68rpx;
  line-height: 68rpx;
  text-align: center;
  border-radius: 10rpx;
  background: #eaf4fb;
  color: var(--primary);
  font-size: 30rpx;
  font-weight: 700;
  margin-right: 16rpx;
  flex-shrink: 0;
}
.sheet-name { flex: 1; font-size: 28rpx; }
.sheet-price { width: 140rpx; font-size: 28rpx; }

/* 详情弹层内元素 */
.detail-thumb {
  width: 120rpx; height: 120rpx; line-height: 120rpx; text-align: center;
  border-radius: 16rpx; background: #eaf4fb; color: var(--primary);
  font-size: 52rpx; font-weight: 700; margin: 0 auto 16rpx;
}
.detail-name { text-align: center; font-size: 34rpx; font-weight: 700; }
.detail-rate { text-align: center; margin-top: 8rpx; }
.dr-star { color: #f5a623; font-size: 26rpx; }
.dr-count { color: var(--muted); font-size: 22rpx; margin-left: 10rpx; }
.detail-desc { text-align: center; color: var(--muted); font-size: 26rpx; margin: 8rpx 0; }
.detail-price { text-align: center; font-size: 36rpx; margin: 8rpx 0 16rpx; }
.detail-stepper { justify-content: center; margin-bottom: 24rpx; }

/* 规格要求：横向可换行的小标签，单选 */
.spec-wrap { margin: 20rpx 0; }
.spec-title { font-size: 26rpx; color: var(--muted); margin-bottom: 14rpx; }
.spec-tags { display: flex; flex-wrap: wrap; }
.spec-tag {
  font-size: 24rpx;
  color: #4d6f65;
  background: #f2f8f6;
  border: 1rpx solid #e8e8e8;
  border-radius: 26rpx;
  padding: 8rpx 22rpx;
  margin: 0 12rpx 12rpx 0;
}
.spec-tag.on {
  color: #fff;
  background: var(--primary);
  border-color: var(--primary);
}

/* 评价列表 */
.review-block {
  margin-top: 24rpx;
  padding-top: 20rpx;
  border-top: 1rpx solid #f2f8f6;
}
.rv-title { font-size: 28rpx; font-weight: 700; margin-bottom: 12rpx; }
.rv-item {
  padding: 14rpx 0;
  border-bottom: 1rpx solid #f2f8f6;
}
.rv-stars { color: #f5a623; font-size: 24rpx; letter-spacing: 2rpx; }
.rv-content { font-size: 26rpx; color: #183c34; margin-top: 8rpx; line-height: 1.5; }
.rv-img {
  width: 140rpx;
  height: 140rpx;
  border-radius: 10rpx;
  margin: 12rpx 12rpx 0 0;
}
.rv-time { font-size: 22rpx; color: #9bb2aa; margin-top: 8rpx; }
/* 商家回复：浅绿底，与顾客评价正文区分开，一眼能看出是谁说的 */
.rv-reply {
  margin-top: 10rpx;
  padding: 10rpx 14rpx;
  background: #e9f7ef;
  border-left: 6rpx solid #087c61;
  border-radius: 8rpx;
}
.rv-reply-tag {
  font-size: 20rpx;
  color: #087c61;
  font-weight: 600;
  margin-right: 10rpx;
}
.rv-reply-text { font-size: 24rpx; color: #224d61; line-height: 1.5; }
.review-empty {
  text-align: center;
  color: var(--muted);
  font-size: 24rpx;
  padding: 30rpx 0 10rpx;
}
</style>

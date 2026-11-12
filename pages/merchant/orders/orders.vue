<template>
<!-- pages/merchant/orders/orders.wxml -->
<view class="orders-page">
  <!-- 顶部分栏 -->
  <view class="tabs">
    <view
      v-for="(item, index) in tabs"
      :key="item.key"
      class="tab"
      :class="{ active: active === index }"
      @tap="switchTab(index)"
    >{{item.label}}</view>
  </view>

  <!-- 订单列表 -->
  <!-- 列表在固定高度的 scroll-view 里，所以触底要用 @scrolltolower，
       页面级的 onReachBottom 在这里永远不会触发（页面本身不滚动） -->
  <scroll-view scroll-y class="list" @scrolltolower="loadMore" :lower-threshold="80">
    <view
      v-for="(item, index) in list"
      :key="item._id"
      class="order-card"
      @tap="goDetail(item._id)"
    >
      <view class="order-head">
        <text class="pickup-no" v-if="item.pickupNo">{{item.pickupNo}}</text>
        <text class="order-no">{{item.orderNo}}</text>
        <text class="order-time">{{item.timeText}}</text>
      </view>
      <view class="order-items">
        <text v-for="(it, index) in item.items" :key="it.dishId" class="item-tag">{{it.name}}x{{it.qty}}</text>
      </view>
      <view class="order-foot">
        <!-- 配送方式标签：外卖单用红色 🛵 标出（店员要安排打包交接骑手），自取单保持桌号 -->
        <text class="delivery-tag" v-if="item.deliveryType === 'delivery'">🛵 外卖</text>
        <text class="order-table" v-else-if="item.tableNo">桌号 {{item.tableNo}}</text>
        <text class="order-total price">{{item.totalText}}</text>
      </view>
    </view>

    <view v-if="list.length === 0" class="empty">暂无{{tabs[active].label}}</view>

    <!-- 分页尾 -->
    <view v-if="list.length" class="page-foot">
      <text v-if="loadingMore" class="pf-end">加载中…</text>
      <text v-else-if="hasMore" class="pf-more" @tap="loadMore">上拉加载更多</text>
      <text v-else class="pf-end">— 已显示全部 {{list.length}} / {{total}} 单 —</text>
    </view>
  </scroll-view>

  <!-- 底部入口 -->
  <view class="footer">
    <button class="menu-btn ghost" @tap="goFeedback">顾客反馈</button>
    <button class="menu-btn ghost" @tap="goStats">经营统计</button>
    <button class="menu-btn" @tap="goMenu">菜品管理</button>
    <button class="menu-btn ghost" @tap="goCoupons">优惠券管理</button>
    <button class="menu-btn ghost" @tap="goRefunds">售后申请</button>
    <button class="menu-btn ghost" @tap="goShops">门店管理</button>
  </view>
</view>
</template>

<script>
// pages/merchant/orders/orders.js —— 商家订单看板（按状态分栏）
const { call } = require('@/common/cloud.js');
const { yuan, shortTime } = require('@/common/format.js');
const { requireLogin } = require('@/common/merchant.js');
const app = getApp();

// 看板分栏：新订单 / 备餐中 / 已出餐 / 配送中 / 已送达 / 已取消
// 外卖单 done（已出餐）后还有 delivering/delivered，缺了它们外卖单会从看板消失
const TABS = [
  { key: 'paid', label: '新订单' },
  { key: 'preparing', label: '备餐中' },
  { key: 'done', label: '已出餐' },
  { key: 'delivering', label: '配送中' },
  { key: 'delivered', label: '已送达' },
  { key: 'canceled', label: '已取消' }
];
export default {
  data() {
    return {
    tabs: TABS,
    active: 0,
    list: [],
    // 分页状态
    page: 1,
    total: 0,
    hasMore: false,
    loading: false,
    loadingMore: false
    };
  },

  onLoad() {
    // 商家端守卫：没有商户口令就不发请求，直接回登录页（2026-10-21 加）
    if (!requireLogin(this)) return;
    this.load();
    // 轮询刷新，保证实时接收新订单。
    // 只在「停在第 1 页」时才刷：否则商家翻到第 2 页查旧单，每 5 秒被拽回顶部。
    // 新订单必然出现在第 1 页，跳过几轮不影响实时性。
    this.timer = setInterval(() => {
      if (this.page > 1 || this.loadingMore) return;
      this.load();
    }, 5000);
  },

  onUnload() { clearInterval(this.timer); },
  onShow() {
    // 登录后从登录页跳回来时，onLoad 不重跑，这里要重新判断并补一次拉取
    if (!requireLogin(this)) return;
    this.load();
  },

  // 触底加载下一页（页面生命周期，必须在顶层）
  onReachBottom() {
    this.load(true);
  },

  // ⚠️ 事件处理函数必须写在 methods 内（2026-10-16 修）。
  // 原先本页**完全没有 methods 块**，switchTab / load / loadMore / goDetail /
  // goMenu / goFeedback / goStats 全挂在 export default 顶层。
  // uni-app(Vue2) 的页面选项会走 Vue.extend()，只有 options.methods 里的函数
  // 才会挂到 vm 实例上，顶层普通函数被静默丢弃。
  // 后果：onLoad 里第一句 this.load() 就抛错 → 整个看板永远「暂无新订单」；
  // 分栏切不动、点订单进不去详情、底部三个入口全部点不动。
  // 而编译期零提示 —— 自动化脚本走 HTTP 直连，也照不出这一类 bug。
  methods: {
    switchTab(index) {
      this.active = index;
      // 切栏回到第 1 页：不同状态各自从头翻
      this.page = 1;
      this.hasMore = false;
      this.load();
    },

    // scroll-view 触底回调
    loadMore() {
      this.load(true);
    },

    async load(more) {
      if (more && (!this.hasMore || this.loadingMore)) return;
      if (!more && this.loading) return;
      const shopId = uni.getStorageSync('m_shopId') || app.globalData.shopId || 'demo-shop';
      const status = TABS[this.active].key;
      const nextPage = more ? this.page + 1 : 1;
      if (more) this.loadingMore = true; else this.loading = true;

      try {
        // 分页返回 {list,total,page,size,hasMore}。
        // 原先整表返回，单量一多就每次轮询都把全部订单连同明细推一遍。
        const res = await call('cloudOrder', 'list', {
          shopId, status, page: nextPage, size: 20
        });
        const d = (res && res.data) || {};
        const rows = (d.list || []).map(o => ({
          ...o,
          totalText: yuan(o.totalPrice),
          timeText: shortTime(o.createTime)
        }));
        this.list = more ? this.list.concat(rows) : rows;
        this.page = d.page || nextPage;
        this.total = Number(d.total || rows.length);
        this.hasMore = !!d.hasMore;
        this._fail = 0;   // 恢复成功计数
      } catch (e) {
        // 连续失败几次后轻提示一次，避免静默无感知
        this._fail = (this._fail || 0) + 1;
        if (this._fail === 3) {
          uni.showToast({ title: '连接后端失败，请检查服务', icon: 'none' });
        }
      } finally {
        this.loading = false;
        this.loadingMore = false;
      }
    },

    goDetail(orderId) {
      uni.navigateTo({ url: '/pages/merchant/orderDetail/orderDetail?orderId=' + orderId });
    },

    goMenu() {
      uni.navigateTo({ url: '/pages/merchant/menu/menu' });
    },

    // 查看顾客反馈（按菜品聚合，找出需要改进的菜）
    goFeedback() {
      uni.navigateTo({ url: '/pages/merchant/feedback/feedback' });
    },

    // 经营统计：营业额 / 待接单 / 近 7 日趋势 / 状态分布
    goStats() {
      uni.navigateTo({ url: '/pages/merchant/stats/stats' });
    },

    goCoupons() {
      uni.navigateTo({ url: '/pages/merchant/coupons/coupons' });
    },

    goRefunds() {
      uni.navigateTo({ url: '/pages/merchant/refundRequests/refundRequests' });
    },

    goShops() {
      uni.navigateTo({ url: '/pages/merchant/shops/shops' });
    }
  }
}
</script>

<style scoped>
/* pages/merchant/orders/orders.wxss */
.orders-page { display: flex; flex-direction: column; height: 100vh; background: #f2f8f6; }
.tabs {
  display: flex;
  background: #fff;
  border-bottom: 1rpx solid #dce9e4;
}
.tab {
  flex: 1;
  text-align: center;
  padding: 28rpx 0;
  font-size: 28rpx;
  color: #3e5e55;
  border-bottom: 4rpx solid transparent;
}
.tab.active {
  color: var(--primary);
  font-weight: 700;
  border-bottom-color: var(--primary);
}
.list { flex: 1; padding: 24rpx; }
.order-card {
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx;
  margin-bottom: 20rpx;
}
.order-head { display: flex; align-items: center; font-size: 26rpx; color: var(--muted); }
.order-no { font-weight: 600; color: #183c34; flex: 1; }
/* 取餐号在商家端同样要显眼：店员照着它喊号 */
.pickup-no {
  font-size: 32rpx;
  font-weight: 800;
  color: #fff;
  background: var(--primary);
  border-radius: 8rpx;
  padding: 2rpx 14rpx;
  margin-right: 16rpx;
}
.order-items { margin: 16rpx 0; }
.item-tag {
  display: inline-block;
  background: #f2f8f6;
  border-radius: 8rpx;
  padding: 6rpx 14rpx;
  font-size: 24rpx;
  margin: 0 12rpx 12rpx 0;
}
.order-foot { display: flex; justify-content: space-between; align-items: center; }
.order-table { font-size: 26rpx; color: #3e5e55; }
/* 外卖标签：红底白字，店员扫一眼就知道这单要打包交骑手 */
.delivery-tag {
  font-size: 22rpx;
  color: #fff;
  background: #087c61;
  border-radius: 6rpx;
  padding: 4rpx 12rpx;
}
.order-total { font-size: 32rpx; font-weight: 700; }
.empty { text-align: center; color: var(--muted); padding: 80rpx 0; }
/* 分页尾 */
.page-foot { text-align: center; padding: 20rpx 0 40rpx; }
.pf-more { font-size: 24rpx; color: var(--primary); }
.pf-end { font-size: 22rpx; color: #9bb2aa; }
.footer { padding: 16rpx 24rpx; background: #fff; display: flex; flex-wrap: wrap; gap: 12rpx; }
.menu-btn {
  background: var(--primary);
  color: #fff;
  border-radius: 48rpx;
  flex: 0 0 calc(50% - 6rpx);
  box-sizing: border-box;
  font-size: 25rpx;
  margin: 0;
}
.menu-btn.ghost {
  background: #fff;
  color: var(--primary);
  border: 2rpx solid var(--primary);
}
</style>

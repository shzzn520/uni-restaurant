<template>
<!-- pages/customer/stores/stores.vue —— 门店选择页（仿麦当劳外卖「门店选择」） -->
<!-- 真实 i麦当劳 的交互：进入即请求定位 → 门店按「距你由近到远」排序 →
     每家门店卡片展示 距离/地址/取餐方式 → 点卡片切换门店返回 -->
<view class="container">
  <!-- 定位状态条：让用户知道列表为什么是这个顺序 -->
  <view class="loc-bar">
    <text class="loc-icon">📍</text>
    <view class="loc-main">
      <view class="loc-title">{{ located ? '已获取当前位置' : (locating ? '正在定位…' : '未获取定位')}}</view>
      <view class="loc-sub">{{ located ? '门店按「距你由近到远」排序，最近的可外卖/自取' : '允许定位后可按距离推荐最近门店' }}</view>
    </view>
    <text class="loc-again" v-if="!locating" @tap="onRelocate">{{ located ? '重新定位' : '去定位' }}</text>
  </view>

  <!-- 门店卡片列表：按距离升序（无定位时按默认顺序） -->
  <view
    class="store-card"
    :class="{ current: item._id === currentShopId }"
    v-for="item in list"
    :key="item._id"
    @tap="onPick(item)"
  >
    <view class="sc-top">
      <view class="sc-name">{{item.name}}</view>
      <view class="sc-dist" v-if="item.distanceText">距您 {{item.distanceText}}</view>
      <view class="sc-dist static" v-else-if="item.distance">{{item.distance}}</view>
    </view>
    <view class="sc-tags">
      <text class="sc-tag red">到店取餐</text>
      <text class="sc-tag line">外卖</text>
      <text class="sc-tag cur" v-if="item._id === currentShopId">当前门店</text>
    </view>
    <view class="sc-addr">🏠 {{item.address}}</view>
    <view class="sc-time">🕐 营业时间 07:00-22:00</view>
  </view>

  <view class="foot-tip" v-if="list.length">选好后返回首页即可在所选门店下单（演示环境菜单全店通用）</view>
</view>
</template>

<script>
// pages/customer/stores/stores.vue —— 门店选择（定位推荐）
// 数据入口与其他页面一致：统一走 common/cloud.js，页面不感知 mock/后端差异
const { call } = require('@/common/cloud.js');
const app = getApp();

export default {
  data() {
    return {
      list: [],          // 门店列表（已按距离排序）
      located: false,    // 是否成功拿到定位
      locating: false,   // 定位进行中
      currentShopId: ''  // 当前选中门店（高亮 + 「当前门店」标）
    };
  },

  onLoad() {
    this.currentShopId = app.globalData.shopId || uni.getStorageSync('shopId') || 'demo-shop';
    this.onRelocate();
  },

  methods: {
    /** 定位 → 拉门店列表（带坐标，服务端就近排序）→ 刷新列表 */
    async onRelocate() {
      this.locating = true;
      let lat, lng;
      try {
        const pos = await new Promise((resolve, reject) => {
          uni.getLocation({
            type: 'gcj02', // 国测局坐标，与门店坐标同系，距离才准
            success: resolve,
            fail: reject
          });
        });
        lat = pos.latitude;
        lng = pos.longitude;
        this.located = true;
      } catch (e) {
        // 拒绝授权 / H5 环境拿不到定位：不阻塞，按默认顺序展示
        this.located = false;
      }
      this.locating = false;
      await this.loadStores(lat, lng);
    },

    /** 拉门店列表；lat/lng 有值时服务端会算距并按最近排序 */
    async loadStores(lat, lng) {
      try {
        const res = await call('cloudShop', 'list', { lat, lng });
        this.list = (res.data && res.data.shops) || [];
      } catch (e) {
        uni.showToast({ title: '门店加载失败', icon: 'none' });
      }
    },

    /** 选中门店：写回全局与缓存，返回首页（首页 onShow 会检测变化并刷新） */
    onPick(item) {
      if (item._id === this.currentShopId) {
        uni.navigateBack();
        return;
      }
      app.globalData.shopId = item._id;
      uni.setStorageSync('shopId', item._id);
      uni.setStorageSync('shopName', item.name);
      uni.showToast({ title: '已切换到 ' + item.name, icon: 'none' });
      // 稍作停留让提示可读，再返回首页
      setTimeout(() => uni.navigateBack(), 600);
    }
  }
};
</script>

<style scoped>
.container { padding: 24rpx; }

/* 定位状态条 */
.loc-bar {
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx 28rpx;
  display: flex;
  align-items: center;
}
.loc-icon { font-size: 36rpx; margin-right: 16rpx; }
.loc-main { flex: 1; }
.loc-title { font-size: 28rpx; font-weight: 700; color: #183c34; }
.loc-sub { font-size: 22rpx; color: var(--muted); margin-top: 6rpx; }
.loc-again { font-size: 24rpx; color: var(--primary); }

/* 门店卡片：仿 i麦当劳 —— 名字 + 距离一行，标签行，地址/营业时间小字 */
.store-card {
  background: #fff;
  border-radius: 16rpx;
  padding: 26rpx 28rpx;
  margin-top: 24rpx;
  border: 2rpx solid transparent;
}
/* 当前门店：红描边提示，无需再点 */
.store-card.current { border-color: #087c61; }
.sc-top { display: flex; align-items: baseline; justify-content: space-between; }
.sc-name { font-size: 30rpx; font-weight: 700; color: #183c34; }
/* 距离用绿色数字强调 —— 与真实麦当劳外卖一致 */
.sc-dist { font-size: 26rpx; color: #087c61; font-weight: 700; }
.sc-dist.static { color: var(--muted); font-weight: 400; }
.sc-tags { margin-top: 14rpx; display: flex; }
.sc-tag {
  font-size: 20rpx;
  padding: 4rpx 12rpx;
  border-radius: 6rpx;
  margin-right: 12rpx;
}
.sc-tag.red { background: #fdeceb; color: #087c61; }
.sc-tag.line { background: #f2f8f6; color: #4d6f65; }
.sc-tag.cur { background: #087c61; color: #fff; }
.sc-addr { font-size: 24rpx; color: #4d6f65; margin-top: 14rpx; }
.sc-time { font-size: 22rpx; color: var(--muted); margin-top: 8rpx; }

.foot-tip {
  text-align: center;
  font-size: 22rpx;
  color: var(--muted);
  margin-top: 32rpx;
  line-height: 1.6;
}
</style>

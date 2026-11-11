<template>
<!-- pages/merchant/login/login.wxml -->
<view class="container">
  <view class="title">商家管理后台</view>
  <view class="card">
    <view class="label">店铺 ID</view>
    <input class="input" placeholder="输入店铺ID" :value="shopId" @input="onInput" />
    <view class="label">操作口令</view>
    <input class="input" placeholder="商户操作口令" password :value="key" @input="onKey" />
    <button class="primary-btn" @tap="enter">进入订单看板</button>
  </view>

  <view class="divider">或</view>

  <button class="ghost-btn" @tap="initDemo">一键初始化演示数据</button>
  <view class="hint">首次使用请先初始化演示数据，将自动创建「demo-shop」店铺、分类与示例菜品。默认口令 demo1234（可在后端 application.yml 的 restaurant.admin-key 修改）。</view>
</view>
</template>

<script>
// pages/merchant/login/login.js —— 商家登录 / 初始化演示数据
const { call } = require('@/common/cloud.js');
const app = getApp();
export default {
  data() {
    return {
      shopId: 'demo-shop',  // 默认演示店铺
      key: 'demo1234'       // 默认操作口令（演示用，生产请修改）
    };
  },

  // ⚠️ 事件处理函数必须写在 methods 内（2026-10-16 修）。
  // 原先 onInput / onKey / enter / initDemo 四个函数直接挂在 export default 顶层，
  // 而 uni-app(Vue2) 的页面选项会走 Vue.extend()，只有 options.methods 里的函数
  // 才会挂到 vm 实例上；顶层普通函数会被静默丢弃。
  // 后果：本页所有按钮点了完全没反应（控制台报 does not have a method "enter"），
  // 商家根本进不去后台，而编译期没有任何提示。
  // 注意生命周期钩子（onLoad/onShow）例外 —— 运行时 initHooks 会单独收走，留在顶层即可。
  methods: {
    onInput(e) { this.shopId = e.detail.value; },
    onKey(e) { this.key = e.detail.value; },

    // 登录并进入管理后台
    async enter() {
      const shopId = this.shopId.trim() || 'demo-shop';
      const key = this.key.trim() || 'demo1234';
      uni.showLoading({ title: '登录中' });
      try {
        const res = await call('cloudShop', 'login', { shopId, key });
        const token = (res.data && res.data.token) || res.token;
        if (!token) throw new Error('no token');
        // 保存口令令牌，后续商户写接口会自动携带
        uni.setStorageSync('shopToken', token);
        uni.setStorageSync('m_shopId', shopId);
        app.globalData.shopId = shopId;
        uni.hideLoading();
        uni.navigateTo({ url: '/pages/merchant/orders/orders' });
      } catch (e) {
        uni.hideLoading();
        uni.showToast({ title: '口令错误或未连接后端', icon: 'none' });
      }
    },

    // 一键初始化演示数据（首次使用：创建店铺 + 分类 + 菜品）
    async initDemo() {
      const shopId = this.shopId.trim() || 'demo-shop';
      const key = this.key.trim() || 'demo1234';
      uni.showLoading({ title: '初始化中' });
      try {
        const res = await call('cloudShop', 'login', { shopId, key });
        const token = (res.data && res.data.token) || res.token;
        if (!token) throw new Error('no token');
        uni.setStorageSync('shopToken', token);
        const init = await call('cloudShop', 'initDemo', { shopId });
        uni.setStorageSync('m_shopId', init.shopId || shopId);
        app.globalData.shopId = init.shopId || shopId;
        uni.hideLoading();
        uni.showToast({ title: '演示数据已就绪', icon: 'success' });
        setTimeout(() => {
          uni.navigateTo({ url: '/pages/merchant/orders/orders' });
        }, 800);
      } catch (e) {
        uni.hideLoading();
        uni.showToast({ title: '初始化失败（口令或后端）', icon: 'none' });
      }
    }
  }
}
</script>

<style scoped>
/* pages/merchant/login/login.wxss */
.title { font-size: 40rpx; font-weight: 700; margin: 40rpx 0 24rpx; }
.label { font-size: 28rpx; color: var(--muted); margin-bottom: 12rpx; margin-top: 12rpx; }
.divider { text-align: center; color: var(--muted); margin: 32rpx 0; }
.ghost-btn {
  background: #fff;
  color: var(--primary);
  border: 2rpx solid var(--primary);
  border-radius: 48rpx;
}
.hint { color: var(--muted); font-size: 24rpx; margin-top: 24rpx; line-height: 1.6; }
</style>

<template>
<!-- pages/customer/index/index.wxml -->
<view class="container">
  <!-- 已加载到店铺信息 -->
  <template v-if="shop">
    <!-- 顶部会员条：未登录显示「登录享优惠」，已登录显示余额与积分 -->
    <view class="member-bar" @tap="goMember">
      <view class="mb-left">
        <text class="mb-icon">👤</text>
        <text class="mb-name">{{memberText}}</text>
      </view>
      <view class="mb-right" v-if="logged">
        <text class="mb-balance">¥{{balanceText}}</text>
        <text class="mb-points">{{profile.points || 0}} 积分 ›</text>
      </view>
      <text class="mb-arrow" v-else>去登录 ›</text>
    </view>

    <!-- 门店定位栏：仿麦当劳外卖首页顶栏 —— 当前门店 + 实时距离，点击进门店选择 -->
    <view class="loc-bar" @tap="goStores">
      <text class="lb-icon">📍</text>
      <view class="lb-main">
        <view class="lb-shop">{{shop.name}}</view>
        <view class="lb-sub">{{locText || shop.address || '点击选择附近门店'}}</view>
      </view>
      <text class="lb-switch">切换门店 ›</text>
    </view>

    <view class="shop-card">
      <view class="shop-logo">{{shop.name[0]}}</view>
      <view class="shop-name">{{shop.name}}</view>
      <view class="shop-desc">{{shop.desc || '欢迎光临，请扫码点单'}}</view>
    </view>
    <!-- 外卖平台双入口：仿麦当劳外卖首页「外卖到家 / 到店自取」两大服务。
         模式存 globalData，结算页按它展示地址栏或桌号栏 -->
    <view class="mode-row">
      <view class="mode-btn delivery" @tap="onEnter('delivery')">
        <text class="mode-icon">🛵</text>
        <view class="mode-main">
          <view class="mode-title">外卖到家</view>
          <view class="mode-desc">约 30 分钟送达 · 满 39 免配送费</view>
        </view>
      </view>
      <view class="mode-btn pickup" @tap="onEnter('pickup')">
        <text class="mode-icon">🏪</text>
        <view class="mode-main">
          <view class="mode-title">到店自取</view>
          <view class="mode-desc">免配送费 · 取餐号叫号</view>
        </view>
      </view>
    </view>
    <view class="table-tip" v-if="tableNo">当前桌号：{{tableNo}}</view>

    <!-- 优惠券入口：显示可用券数量，没券时引导去领 -->
    <view class="coupon-entry" @tap="goMember">
      <view class="cp-left">
        <view class="cp-title">优惠券</view>
        <view class="cp-desc">{{couponText}}</view>
      </view>
      <text class="cp-go">去领券 ›</text>
    </view>

    <!-- 限时抢购入口：场次信息由服务端下发，未登录也可浏览；倒计时在会场页内展示 -->
    <view class="flash-entry" @tap="goFlash">
      <view class="fe-left">
        <text class="fe-badge">限时</text>
        <view>
          <view class="fe-title">限时抢购</view>
          <view class="fe-desc">{{flashText}}</view>
        </view>
      </view>
      <text class="fe-go">去抢购 ›</text>
    </view>

    <!-- 麦当劳「1+1 随心配」入口：红白两区各选一件，一口价 ¥12 -->
    <view class="combo-entry" @tap="goCombo">
      <view class="ce-left">
        <text class="ce-badge">超值</text>
        <view>
          <view class="ce-title">1+1 随心配</view>
          <view class="ce-desc">红区白区各选 1 件 · 一口价</view>
        </view>
      </view>
      <view class="ce-right">
        <text class="ce-price"><text class="ce-sign">¥</text>12</text>
        <text class="ce-go">去搭配 ›</text>
      </view>
    </view>

    <!-- 本桌订单：顾客下单后只能进单条状态页，这里补一个回溯入口 -->
    <view class="orders-entry" @tap="goOrders">
      <view class="oe-left">
        <text class="oe-icon">🧾</text>
        <view>
          <view class="oe-title">本桌订单</view>
          <view class="oe-desc">查看这桌点过什么、做到哪一步</view>
        </view>
      </view>
      <text class="oe-go">›</text>
    </view>

    <!-- 口碑入口：全店评分与评价条数 -->
    <view class="review-entry" v-if="avgRating > 0">
      <view class="re-head">
        <text class="re-score">★ {{avgRating}}</text>
        <text class="re-count">{{reviewCount}} 条评价</text>
      </view>
      <view class="re-tip">顾客真实口碑，评分来自已完成订单</view>
    </view>

    <!-- 商家入口：页尾安静但不难找——答辩时要让老师几秒内点到商家端，
         原先灰底 #5c786f 小字在实际真机上几乎看不见，改为白底描边 + #4d6f65 -->
    <view class="merchant-entry" @tap="goMerchant">
      <text class="me-icon">🏪</text>
      <text class="me-text">商家管理入口</text>
      <text class="me-arrow">›</text>
    </view>
  </template>

  <!-- 未带参进入：手动输入 -->
  <template v-else >
    <view class="title">进入店铺</view>
    <view class="form">
      <input class="input" placeholder="输入店铺ID" :value="shopId" @input="onInputShop" />
      <input class="input" placeholder="桌号（可选）" :value="tableNo" @input="onInputTable" />
      <button class="primary-btn" @tap="onEnter">进入店铺</button>
    </view>
    <view class="hint">提示：用微信「扫一扫」扫描餐桌二维码可自动识别店铺与桌号。</view>

    <!-- 商家入口：这个分支（未带参/加载失败时）原先没有，
         导致后台数据源连不上时商家端彻底进不去 -->
    <view class="merchant-entry" @tap="goMerchant">
      <text class="me-icon">🏪</text>
      <text class="me-text">商家管理入口</text>
      <text class="me-arrow">›</text>
    </view>
  </template>
</view>
</template>

<script>
// pages/customer/index/index.js —— 顾客扫码进入店铺首页
const { call } = require('@/common/cloud.js');
const session = require('@/common/session.js');
const app = getApp();
export default {
  data() {
    return {
    shop: null,     // 店铺信息
    shopId: '',     // 当前店铺 ID
    tableNo: '',     // 桌号
    entryShopId: '', // 扫码/带参进入时指定的门店（有值则不做「就近推荐」替换）
    locText: '',     // 定位栏文案：距您 xxx · 地址
    logged: false,  // 是否已登录
    profile: {},    // 会员档案（余额/积分）
    usableCount: 0, // 可用券数量
    avgRating: 0,   // 全店均分
    reviewCount: 0,  // 评价总条数
    flashText: '每日 4 场 · 整点开抢'  // 抢购入口副标题，由场次接口刷新
    };
  },

  computed: {
    memberText() {
      if (!this.logged) return '登录享优惠';
      return this.profile.nickname || '会员';
    },
    balanceText() {
      return Number(this.profile.balance || 0).toFixed(2);
    },
    // 有券直说「N 张可用」，没券说去领 —— 后者在营销上是更有效的引导
    couponText() {
      if (!this.logged) return '登录领券，下单更优惠';
      return this.usableCount > 0 ? (this.usableCount + ' 张优惠券可用') : '暂无优惠券，去领一张';
    }
  },

  onLoad(options) {
    // 真实场景中，餐桌二维码内容应为：
    // pages/customer/index/index?shopId=xxx&tableNo=xx
    // 未带参数时（如开发者工具直接编译本页），默认进入演示店铺，便于直接预览。
    const storedShopId = uni.getStorageSync('shopId') || '';
    const explicitShopId = options.shopId || '';
    const storedTableNo = uni.getStorageSync('tableNo') || '';
    const shopId = explicitShopId || storedShopId || 'demo-shop';
    const tableNo = options.tableNo || (explicitShopId ? '' : storedTableNo || '1');
    // 扫码指定或之前手动选过的门店都优先于定位推荐，避免冷启动时悄悄切店。
    this.entryShopId = explicitShopId || storedShopId;

    // 写入全局与本地缓存
    app.globalData.shopId = shopId;
    app.globalData.tableNo = tableNo;
    uni.setStorageSync('shopId', shopId);
    uni.setStorageSync('tableNo', tableNo);

    // 回填到页面数据：① 手动输入框有默认值 ② 「开始点单」不再误判为未输入
    this.shopId = shopId;
    this.tableNo = tableNo;

    this.fetchShop(shopId);
    this.fetchReviewSummary(shopId);
    this.locateRecommend();
    // 会员信息刻意不在这里拉：onShow 必然晚于 onLoad，
    // 放到 onShow 里既能覆盖首屏，也能覆盖「去会员中心登录后返回」。
    // 原先只在 onLoad 拉一次，登录完退回首页，会员条还写着「登录享优惠 / 去登录」，
    // 用户会以为登录没生效 —— 这是最容易被当成「登录了却说没登录」的一处。
  },

  /**
   * onShow —— 每次页面显示都重新对齐会员状态。
   *
   * <p>首页是 navigateTo 会员中心的出发地，登录/充值/领券都发生在那之后，
   * 返回时首页不会重跑 onLoad，只有 onShow 能兜住。
   */
  onShow() {
    // 门店选择页切换后返回：storage 里的 shopId 已变，但本页 data 还是旧值。
    // 按铁律「onShow 重算先比对是否真的变了」，没变就不重复拉接口。
    const stored = uni.getStorageSync('shopId') || 'demo-shop';
    if (stored !== this.shopId) {
      this.shopId = stored;
      app.globalData.shopId = stored;
      this.fetchShop(stored);
      this.fetchReviewSummary(stored);
      this.locText = ''; // 旧门店的距离文案已失效，等定位推荐重算
    }
    this.fetchMemberInfo();
    this.fetchFlashEntry();
  },

  methods: {
    /**
     * 定位推荐（仿麦当劳外卖）：拿用户位置 → 服务端按距离排门店 →
     * ① 顶栏显示「距您最近门店的距离」；② 非扫码进入时自动切到最近门店。
     * 定位失败（拒绝授权/H5 拿不到）静默降级为「点击选择门店」，不阻塞点单。
     */
    async locateRecommend() {
      let lat, lng;
      try {
        const pos = await new Promise((resolve, reject) => {
          uni.getLocation({ type: 'gcj02', success: resolve, fail: reject });
        });
        lat = pos.latitude;
        lng = pos.longitude;
      } catch (e) {
        this.locText = '未获取定位 · 点击选择门店';
        return;
      }
      try {
        const res = await call('cloudShop', 'list', { lat, lng });
        const shops = (res.data && res.data.shops) || [];
        const nearest = shops[0];
        if (!nearest || nearest.distanceKm === undefined) {
          this.locText = '点击选择门店';
          return;
        }
        this.locText = '距您 ' + nearest.distanceText + ' · ' + (nearest.address || '');
        // 扫码进店的顾客已在目标门店，不要把门店悄悄换掉
        if (!this.entryShopId && nearest._id !== this.shopId) {
          this.shopId = nearest._id;
          app.globalData.shopId = nearest._id;
          uni.setStorageSync('shopId', nearest._id);
          uni.setStorageSync('shopName', nearest.name);
          this.fetchShop(nearest._id);
          this.fetchReviewSummary(nearest._id);
        }
      } catch (e) {
        this.locText = '点击选择门店';
      }
    },

    // 进入门店选择页（按距离排序，点选后返回本页 onShow 自动刷新）
    goStores() {
      uni.navigateTo({ url: '/pages/customer/stores/stores' });
    },

    // 拉取店铺信息
    async fetchShop(shopId) {
      try {
        const res = await call('cloudShop', 'get', { shopId });
            this.shop = res.data;
        if (res.data) {
          uni.setNavigationBarTitle({ title: res.data.name });
          uni.setStorageSync('shopName', res.data.name);
        }
      } catch (e) {
        uni.showToast({ title: '店铺加载失败', icon: 'none' });
      }
    },

    /**
     * 会员状态与可用券数。
     *
     * <p>先用本地缓存把界面填上再请求服务端：首页首屏不该为一个余额干等网络。
     */
    async fetchMemberInfo() {
      const userId = session.getUserId();
      const cached = session.getProfile();
      // 退出登录后返回首页：必须把已登录的痕迹清干净。
      // 原先这里直接 return，logged 与 profile 还停在登录态，
      // 会员条会继续显示上一位会员的余额，看着像「退了个假登录」。
      if (!userId) {
        this.logged = false;
        this.profile = {};
        this.usableCount = 0;
        return;
      }
      if (cached) {
        this.logged = true;
        this.profile = cached;
      }

      try {
        const res = await call('cloudMember', 'info', { userId });
        this.profile = res.data || {};
        this.logged = true;
        session.setProfile(this.profile);
      } catch (e) {
        // 会话令牌失效（如升级前已登录、本地没有 token）：直接清掉登录态，
        // 否则会停在「已登录但余额永远是缓存值」的假状态里
        if (String(e).indexOf('请先登录') >= 0) {
          session.logout();
          this.logged = false;
          this.profile = {};
          return;
        }
        // 网络失败时保留缓存展示，不把用户踢回未登录态
        console.warn('[index] 会员信息刷新失败', e);
      }

      try {
        const res = await call('cloudCoupon', 'my', {
          shopId: app.globalData.shopId || 'demo-shop',
          userId
        });
        this.usableCount = ((res.data && res.data.usable) || []).length;
      } catch (e) {
        this.usableCount = 0;
      }
    },

    // 全店评分与评价数
    async fetchReviewSummary(shopId) {
      try {
        const res = await call('cloudReview', 'summary', { shopId });
        const d = res.data || {};
        this.avgRating = Number(d.avgRating || 0);
        this.reviewCount = Number(d.count || 0);
      } catch (e) {
        // 没有评价数据就不显示这块，不打扰用户
      }
    },

    // 抢购入口只取一次场次信息做引导文案；首页不起每秒定时器，倒计时放在会场页
    async fetchFlashEntry() {
      try {
        const res = await call('cloudFlash', 'sessions', {});
        const d = res.data || {};
        const active = (d.sessions || []).find(s => s.status === 'active');
        this.flashText = active
          ? ('本场 ' + active.range + ' 抢购中 · 低至 5 折')
          : '每日 4 场 · 整点开抢';
      } catch (e) {
        // 后端/mock 不可用时保留静态引导文案，不让首页多一个错误态
        this.flashText = '每日 4 场 · 整点开抢';
      }
    },

    // 进入限时抢购会场
    goFlash() {
      uni.navigateTo({ url: '/pages/customer/flash/flash' });
    },

    goMember() {
      uni.navigateTo({ url: '/pages/customer/member/member' });
    },

    goOrders() {
      uni.navigateTo({ url: '/pages/customer/orders/orders' });
    },

    onInputShop(e) {     this.shopId = e.detail.value; },
    onInputTable(e) {     this.tableNo = e.detail.value; },

  // 无扫码参数时，手动进入店铺（自动加载路径也走这里）。
  // mode：delivery=外卖到家 / pickup=到店自取 —— 存全局供结算页读取，
  // 决定它展示收货地址栏还是桌号栏（金额与配送费由服务端算）
  async onEnter(mode) {
    // 手动输入优先；为空时回退到全局 / 缓存 / 演示店铺，避免误弹「请输入店铺ID」
    const shopId = (this.shopId || '').trim()
      || app.globalData.shopId
      || uni.getStorageSync('shopId')
      || 'demo-shop';
    this.shopId = shopId; // 回显
    const tableNo = (this.tableNo || '').trim() || uni.getStorageSync('tableNo') || '1';
    app.globalData.shopId = shopId;
    app.globalData.tableNo = tableNo;
    // 记住服务模式：外卖单结算页不问桌号、要收货地址
    app.globalData.orderMode = mode || 'delivery';
    uni.setStorageSync('orderMode', app.globalData.orderMode);
    uni.setStorageSync('shopId', shopId);
    uni.setStorageSync('tableNo', tableNo);
    uni.navigateTo({ url: '/pages/customer/menu/menu' });
  },

  // 进入「1+1 随心配」套餐选配页
  goCombo() {
    const shopId = (this.shopId || '').trim()
      || app.globalData.shopId
      || uni.getStorageSync('shopId')
      || 'demo-shop';
    const tableNo = (this.tableNo || '').trim() || uni.getStorageSync('tableNo') || '1';
    app.globalData.shopId = shopId;
    app.globalData.tableNo = tableNo;
    uni.setStorageSync('shopId', shopId);
    uni.setStorageSync('tableNo', tableNo);
    uni.navigateTo({ url: '/pages/customer/combo/combo?shopId=' + shopId });
  },

  // 进入商家管理后台（登录页，需店铺 ID + 操作口令）
  goMerchant() {
    uni.navigateTo({ url: '/pages/merchant/login/login' });
  }
  }
}
</script>

<style scoped>
/* pages/customer/index/index.wxss */
/* 会员条：深色底，压在店铺卡片上方形成层次 */
.member-bar {
  margin-top: 24rpx;
  background: #14526c;
  border-radius: 16rpx;
  padding: 22rpx 28rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.mb-left { display: flex; align-items: center; }
.mb-icon { font-size: 32rpx; margin-right: 12rpx; }
.mb-name { color: #fff; font-size: 28rpx; font-weight: 600; }
.mb-right { display: flex; align-items: center; }
.mb-balance { color: #FFC72C; font-size: 30rpx; font-weight: 700; margin-right: 20rpx; }
.mb-points { color: #fff; font-size: 24rpx; opacity: .85; }
.mb-arrow { color: #FFC72C; font-size: 26rpx; }

/* 门店定位栏：仿麦当劳外卖顶栏，白卡 + 定位图标 + 绿色距离 */
.loc-bar {
  margin-top: 24rpx;
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx 28rpx;
  display: flex;
  align-items: center;
}
.lb-icon { font-size: 34rpx; margin-right: 14rpx; }
.lb-main { flex: 1; min-width: 0; }
.lb-shop { font-size: 30rpx; font-weight: 700; color: #183c34; }
.lb-sub {
  font-size: 22rpx;
  color: #087c61;
  margin-top: 6rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lb-switch { font-size: 24rpx; color: var(--primary); flex-shrink: 0; }

/* 优惠券入口 */
.coupon-entry {
  margin-top: 24rpx;
  background: #fff;
  border-radius: 16rpx;
  padding: 26rpx 28rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cp-title { font-size: 30rpx; font-weight: 700; color: #183c34; }
.cp-desc { font-size: 24rpx; color: var(--muted); margin-top: 8rpx; }
.cp-go { font-size: 26rpx; color: var(--primary); }

/* 口碑卡片 */
.review-entry {
  margin-top: 24rpx;
  background: #fff;
  border-radius: 16rpx;
  padding: 26rpx 28rpx;
}
.re-head { display: flex; align-items: baseline; }
.re-score { color: #f5a623; font-size: 36rpx; font-weight: 800; }
.re-count { color: var(--muted); font-size: 24rpx; margin-left: 14rpx; }
.re-tip { color: var(--muted); font-size: 22rpx; margin-top: 10rpx; }

.shop-card {
  background: #fff;
  border-radius: 20rpx;
  padding: 48rpx 32rpx;
  text-align: center;
  margin-top: 40rpx;
}
.shop-logo {
  width: 140rpx;
  height: 140rpx;
  line-height: 140rpx;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  font-size: 64rpx;
  font-weight: 700;
  margin: 0 auto 24rpx;
}
.shop-name {
  font-size: 40rpx;
  font-weight: 700;
}
.shop-desc {
  color: var(--muted);
  margin-top: 12rpx;
  font-size: 26rpx;
}
.table-tip {
  text-align: center;
  color: var(--primary);
  margin: 24rpx 0;
  font-size: 28rpx;
}

/* 外卖/自取双入口：绿色外送、蓝色自取，入口状态一眼可辨 */
.mode-row { display: flex; margin-top: 28rpx; }
.mode-btn {
  flex: 1;
  border-radius: 16rpx;
  padding: 26rpx 24rpx;
  display: flex;
  align-items: center;
}
.mode-btn.delivery {
  background: #087c61;
  color: #fff;
  margin-right: 16rpx;
  box-shadow: 0 8rpx 24rpx rgba(8, 124, 97, .18);
}
.mode-btn.pickup {
  background: #fff;
  border: 2rpx solid #176DB3;
  color: #183c34;
}
.mode-icon { font-size: 44rpx; margin-right: 14rpx; }
.mode-title { font-size: 30rpx; font-weight: 700; }
.mode-btn.pickup .mode-title { color: #176DB3; }
.mode-desc { font-size: 20rpx; margin-top: 6rpx; opacity: .85; }
.mode-btn.pickup .mode-desc { color: var(--muted); opacity: 1; }
.title {
  font-size: 36rpx;
  font-weight: 700;
  margin: 40rpx 0 24rpx;
}
.hint {
  color: var(--muted);
  font-size: 24rpx;
  margin-top: 32rpx;
  line-height: 1.6;
}

/* 套餐入口卡片 */
/* 限时抢购入口：蓝色活动区，与点餐主入口保持层级 */
.flash-entry {
  margin-top: 24rpx;
  background: #176db3;
  border-radius: 18rpx;
  padding: 24rpx 28rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #fff;
  box-shadow: 0 6rpx 20rpx rgba(23, 109, 179, .18);
}
.fe-left { display: flex; align-items: center; }
.fe-badge {
  background: #FFE08A; color: #8A3300; font-size: 20rpx; font-weight: 700;
  padding: 4rpx 12rpx; border-radius: 6rpx; margin-right: 16rpx;
}
.fe-title { font-size: 32rpx; font-weight: 800; }
.fe-desc { font-size: 22rpx; opacity: .9; margin-top: 4rpx; }
.fe-go { font-size: 24rpx; font-weight: 600; }

.combo-entry {
  margin-top: 32rpx;
  background: #087c61;
  border-radius: 20rpx;
  padding: 28rpx 32rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #fff;
  box-shadow: 0 8rpx 24rpx rgba(8, 124, 97, .18);
}
.ce-left { display: flex; align-items: center; }
.ce-badge {
  background: #FFC72C;
  color: #7A2E00;
  font-size: 20rpx;
  font-weight: 700;
  padding: 4rpx 12rpx;
  border-radius: 6rpx;
  margin-right: 16rpx;
}
.ce-title { font-size: 34rpx; font-weight: 800; }
.ce-desc { font-size: 22rpx; opacity: .85; margin-top: 4rpx; }
.ce-right { text-align: right; }
.ce-price { font-size: 46rpx; font-weight: 800; color: #FFC72C; line-height: 1.1; }
.ce-sign { font-size: 24rpx; margin-right: 2rpx; }
.ce-go { display: block; font-size: 22rpx; opacity: .9; margin-top: 6rpx; }

/* 本桌订单入口：白底卡片，与优惠券入口同语言，不跟绿色套餐入口抢注意力 */
.orders-entry {
  margin-top: 24rpx;
  background: #fff;
  border-radius: 16rpx;
  padding: 26rpx 28rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.oe-left { display: flex; align-items: center; }
.oe-icon { font-size: 40rpx; margin-right: 16rpx; }
.oe-title { font-size: 30rpx; font-weight: 700; color: #183c34; }
.oe-desc { font-size: 24rpx; color: var(--muted); margin-top: 8rpx; }
.oe-go { font-size: 32rpx; color: #dce9e4; }

/* 商家入口：页尾安静但不难找。白底描边 + #4d6f65 正文色，
   既不与「开始点单」抢视觉，也能让商家/老师在真机上一眼看到 */
.merchant-entry {
  margin-top: 48rpx;
  padding: 22rpx 28rpx;
  border-radius: 12rpx;
  background: #fff;
  border: 1rpx solid #e6e6e6;
  display: flex;
  align-items: center;
  justify-content: center;
}
.me-icon { font-size: 28rpx; margin-right: 12rpx; }
.me-text { font-size: 26rpx; color: #4d6f65; }
.me-arrow { font-size: 28rpx; color: #5c786f; margin-left: 8rpx; }
</style>

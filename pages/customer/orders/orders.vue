<template>
<!-- pages/customer/orders/orders.wxml -->
<view class="container">
  <!-- 顶部说明：本页按桌号聚合，顾客没有登录体系，桌号就是身份维度 -->
  <view class="head" v-if="list.length">
    <text class="head-title">本桌订单</text>
    <text class="head-sub">桌号 {{tableNo}} · 共 {{total || list.length}} 单</text>
  </view>

  <!-- 订单卡片列表 -->
  <view v-if="list.length">
    <view v-for="o in list" :key="o._id" class="card order-card" @tap="goDetail(o)">
      <view class="card-top">
        <!-- 取餐号是这屏最该被一眼看到的信息，和订单状态页保持同一视觉权重 -->
        <view class="pickup">
          <text class="pickup-label">取餐号</text>
          <text class="pickup-no">{{o.pickupNo || '--'}}</text>
        </view>
        <view class="badge" :class="o.status">{{statusText[o.status]}}</view>
      </view>

      <view class="items">{{itemsText(o)}}</view>

      <view class="card-bottom">
        <text class="time">{{shortTime(o.createTime)}}</text>
        <view class="amt">
          <text class="amt-label">实付</text>
          <text class="amt-num">{{payText(o)}}</text>
        </view>
      </view>

      <view class="saved" v-if="savingOf(o) > 0">本单已省 {{yuan(savingOf(o))}}</view>
    </view>

    <!-- 分页尾：明确区分「还有更多」和「到底了」，不给不确定感 -->
    <view class="page-foot">
      <text v-if="hasMore" class="pf-more" @tap="load(true)">上拉加载更多</text>
      <text v-else class="pf-end">— 已显示全部 {{list.length}} 单 —</text>
    </view>
  </view>

  <!-- 空状态：给出明确去向，别让用户停在白屏 -->
  <view class="empty" v-else-if="!loading">
    <view class="empty-icon">🧾</view>
    <view class="empty-title">本桌还没有订单</view>
    <view class="empty-sub">回到首页「开始点单」，第一笔订单会出现在这里</view>
    <button class="empty-btn" @tap="goMenu">去点单</button>
  </view>

  <view class="loading" v-else>加载中...</view>
</view>
</template>

<script>
// pages/customer/orders/orders.js —— 顾客端历史订单列表
//
// 为什么需要这一页：原来顾客下单后只能进单条订单状态页，想看「这桌点过什么」
// 没有入口，演示时也无法回溯。订单列表接口（cloudOrder/list）前后端本就存在，
// 这里只是补上顾客侧的展示层。
//
// 身份维度：顾客端没有真实登录体系，用「桌号」聚合。这也是扫码点单的真实语义——
// 同桌的人共用一桌订单。
const { call } = require('@/common/cloud.js');
const { STATUS_TEXT, yuan, shortTime } = require('@/common/format.js');
const app = getApp();

export default {
  data() {
    return {
      list: [],
      // 初始必须为 false：load() 有防重入守卫 if (this.loading) return，
      // 初值设 true 会让 onLoad/onShow 的首次调用被自己挡掉，请求永远不发，
      // 页面死锁在「加载中」（真实事故：本桌订单点进去一直转圈）。
      // onLoad 在首帧渲染前同步跑完到第一个 await，不会闪空状态。
      loading: false,
      shopId: '',
      tableNo: '',
      // 分页状态：桌号维度由服务端筛，这里只管翻页
      page: 1,
      total: 0,
      hasMore: false,
      // 模板里不能直接读模块级常量/函数，必须挂到 data 上。
      // 漏挂的后果是渲染时抛 "n.shortTime is not a function"——
      // Vue 捕获渲染异常后保留旧 DOM，页面死锁在「加载中」，
      // 且控制台不一定看得到（2026-10-18 真实事故，三个都要挂）。
      statusText: STATUS_TEXT,
      yuan,
      shortTime
    };
  },

  // 下拉刷新：顾客可能刚从别处下过单，回到本页要能看到
  onPullDownRefresh() {
    this.load();
  },

  // 触底加载下一页。必须是页面生命周期（顶层），写进 methods 不会注册，
  // 表现是「上拉毫无反应」——本项目在别的页面踩过这个坑。
  onReachBottom() {
    this.load(true);
  },

  onLoad(options) {
    this.shopId = options.shopId
      || app.globalData.shopId
      || uni.getStorageSync('shopId')
      || 'demo-shop';
    this.tableNo = options.tableNo
      || app.globalData.tableNo
      || uni.getStorageSync('tableNo')
      || '1';
    // H5 下 onShow 不一定在首次进入时触发，必须在 onLoad 同步拉取，
    // 否则页面会永远停在「加载中」。小程序/App 下 onShow 仍会补一次，
    // load() 内部有 this.loading 防重入，不会重复请求。
    if (this.shopId) this.load();
  },

  // 统一在 onShow 拉取：覆盖「首次进入」与「从订单详情页返回」两种情况。
  onShow() {
    if (!this.shopId) return;
    this.load();
  },

  methods: {
    async load(more) {
      if (more && !this.hasMore) return;
      if (this.loading) return;
      this.loading = true;
      const nextPage = more ? this.page + 1 : 1;
      try {
        // 桌号交给服务端筛：先前是拉全店订单再前端过滤，分页后第 2 页里的本桌订单
        // 会永远看不到（这也是把 tableNo 下推到接口的原因）。
        const res = await call('cloudOrder', 'list', {
          shopId: this.shopId, tableNo: this.tableNo, page: nextPage, size: 20
        });
        const d = (res && res.data) || {};
        const rows = d.list || [];
        this.list = more ? this.list.concat(rows) : rows;
        this.page = d.page || nextPage;
        this.total = Number(d.total || rows.length);
        this.hasMore = !!d.hasMore;
        this._fail = 0;
      } catch (e) {
        // 只提示一次，避免下拉反复失败时 toast 刷屏
        this._fail = (this._fail || 0) + 1;
        if (this._fail === 1) {
          uni.showToast({ title: '订单加载失败', icon: 'none' });
        }
      } finally {
        this.loading = false;
        uni.stopPullDownRefresh();
      }
    },

    // 菜品摘要：最多列 2 个菜名，其余折叠成「等 N 份」，避免长订单把卡片撑爆。
    // 必须带份数——只列菜名会丢数量，「牛肉面、黄焖鸡」看着像 2 件，
    // 实际可能是 2+1=3 份，摘要得能反映真实份量。
    // 折叠时统计的是「剩余行」的总份数，不是行数：行数小份数大，
    // 写「等 1 件」会让顾客以为只多了一份。
    itemsText(o) {
      const its = o.items || [];
      if (!its.length) return '（无明细）';
      const qty = i => (Number(i.qty) || 0) > 0 ? Number(i.qty) : 1;
      let s = its.slice(0, 2)
        .map(i => i.name + (qty(i) > 1 ? ' x' + qty(i) : ''))
        .join('、');
      const rest = its.slice(2);
      if (rest.length) {
        s += ' 等 ' + rest.reduce((n, i) => n + qty(i), 0) + ' 份';
      }
      return s;
    },

    // 实付金额。历史订单没有 payAmount 字段（早于优惠体系），退化为原价，
    // 与订单状态页 payAmount 计算属性保持同一套兜底逻辑。
    // payAmount=0 也是合法值（全额抵扣），不能用 v>0 判断（2026-10-21 修）
    payText(o) {
      const v = Number(o.payAmount);
      const pay = o.payAmount != null && Number.isFinite(v) ? v : Number(o.totalPrice || 0);
      return yuan(pay);
    },

    // 本单优惠 = 原价 - 实付
    savingOf(o) {
      const total = Number(o.totalPrice || 0);
      const v = Number(o.payAmount);
      const pay = o.payAmount != null && Number.isFinite(v) ? v : total;
      return Math.round((total - pay) * 100) / 100;
    },

    goDetail(o) {
      uni.navigateTo({ url: '/pages/customer/order/order?orderId=' + o._id });
    },

    goMenu() {
      uni.navigateTo({ url: '/pages/customer/menu/menu' });
    }
  }
};
</script>

<style scoped>
/* pages/customer/orders/orders.wxss */

.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 4rpx 8rpx 20rpx;
}
.head-title { font-size: 32rpx; font-weight: 700; color: var(--text); }
.head-sub { font-size: 24rpx; color: var(--muted); }

.order-card { padding: 26rpx 28rpx; }

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* 取餐号：深色小块，与订单状态页同一语言 */
.pickup {
  display: flex;
  align-items: baseline;
  background: #14526c;
  border-radius: 10rpx;
  padding: 8rpx 16rpx;
}
.pickup-label { color: #FFC72C; font-size: 20rpx; margin-right: 10rpx; }
.pickup-no { color: #fff; font-size: 34rpx; font-weight: 800; }

/* 状态徽标：配色与订单状态页的进度条语义一致 */
.badge {
  font-size: 22rpx;
  padding: 6rpx 16rpx;
  border-radius: 999rpx;
  font-weight: 600;
}
.badge.unpaid     { background: #fff4e5; color: #e8830c; }
.badge.paid       { background: #eaf4fb; color: #176db3; }
.badge.preparing  { background: #eaf4fb; color: #176db3; }
.badge.done       { background: #e9f7ef; color: #087c61; }
.badge.canceled   { background: #f2f8f6; color: #5c786f; }

.items {
  font-size: 28rpx;
  color: var(--text);
  margin-top: 18rpx;
  line-height: 1.5;
}

.card-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 16rpx;
}
.time { font-size: 22rpx; color: var(--muted); }
.amt { display: flex; align-items: baseline; }
.amt-label { font-size: 22rpx; color: var(--muted); margin-right: 8rpx; }
.amt-num { font-size: 32rpx; font-weight: 700; color: var(--primary); }

.saved {
  margin-top: 12rpx;
  font-size: 22rpx;
  color: #087c61;
}

/* 空状态 */
.empty {
  text-align: center;
  padding: 140rpx 60rpx;
}
.empty-icon { font-size: 96rpx; }
.empty-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--text);
  margin-top: 24rpx;
}
.empty-sub {
  font-size: 24rpx;
  color: var(--muted);
  margin-top: 12rpx;
  line-height: 1.6;
}
.empty-btn {
  margin-top: 40rpx;
  background: var(--primary);
  color: #fff;
  border-radius: 999rpx;
  font-size: 30rpx;
  padding: 0 60rpx;
  height: 80rpx;
  line-height: 80rpx;
}

.loading {
  text-align: center;
  color: var(--muted);
  font-size: 26rpx;
  padding: 120rpx 0;
}

/* 分页尾 */
.page-foot { text-align: center; padding: 20rpx 0 40rpx; }
.pf-more { font-size: 24rpx; color: var(--primary); }
.pf-end { font-size: 22rpx; color: #9bb2aa; }
</style>

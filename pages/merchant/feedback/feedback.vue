<template>
<!-- pages/merchant/feedback/feedback.vue —— 商家端顾客反馈看板 -->
<view class="container">
  <view class="page-title">顾客反馈</view>
  <view class="page-sub">按菜品聚合 · 被反馈最多的排最前，优先改进</view>

  <!-- 空状态 -->
  <view v-if="list.length === 0" class="empty">暂无顾客反馈，顾客在订单页点「反馈」后这里会出现统计</view>

  <!-- 按菜品聚合的反馈卡片：点卡片展开该菜的全部单条反馈，可逐条标记已处理 -->
  <view v-for="(item, index) in list" :key="item._key" class="card fb-card">
    <view class="fb-head" @tap="toggle(item)">
      <view class="fb-name">{{item.dishName || '未知菜品'}}</view>
      <view class="fb-count" :class="{ hot: item.count >= 3 }">{{item.count}} 次</view>
    </view>
    <view class="fb-reasons">
      <text v-for="(r, i) in item.reasons" :key="i" class="reason-tag">{{r}}</text>
    </view>
    <view class="fb-time">最近反馈：{{shortTime(item.lastTime)}}</view>
    <view class="fb-foot">
      <text v-if="item.pending > 0" class="pending-tag">{{item.pending}} 条待处理</text>
      <text v-else class="done-tag">已全部处理</text>
      <text class="fb-toggle">{{ openKey === item._key ? '收起 ▲' : '展开明细 ▼' }}</text>
    </view>

    <!-- 该菜品的单条反馈列表 -->
    <view v-if="openKey === item._key" class="fb-detail">
      <view v-for="c in itemsOf(item)" :key="c._id" class="fb-row" :class="{ handled: c.status === 'handled' }">
        <view class="fb-row-main">
          <text class="fb-row-reason">{{c.reason}}</text>
          <text class="fb-row-time">{{shortTime(c.createTime)}}</text>
        </view>
        <view class="fb-row-side">
          <text v-if="c.status === 'handled'" class="row-state done">已处理</text>
          <text v-else class="row-state wait">待处理</text>
          <view v-if="c.status !== 'handled'" class="row-btn" @tap.stop="markHandled(c)">标记已处理</view>
        </view>
      </view>
    </view>
  </view>

  <!-- ============ 顾客评价（可回复） ============ -->
  <!-- 评价与投诉是并列的两件事：投诉是「出问题了要走整改」，评价是「打分沉淀口碑」。
       放在同一页是因为它们都是商家该听的顾客声音，但处理方式完全不同 —— 投诉要销号，
       评价要回应。差评未回复的排在最前面。 -->
  <view class="page-title sec-title">顾客评价</view>
  <view class="page-sub">
    共 {{reviews.length}} 条<text v-if="unrepliedCount > 0"> · <text class="warn">{{unrepliedCount}} 条待回复</text></text>
  </view>

  <view v-if="reviews.length === 0" class="empty">暂无评价，顾客在订单页评价后这里会出现</view>

  <view v-for="rv in reviews" :key="rv._id" class="card rv-card" :class="{ bad: rv.rating <= 2 }">
    <view class="rv-head">
      <text class="rv-stars">{{stars(rv.rating)}}</text>
      <text class="rv-dish">{{rv.dishName || '菜品'}}</text>
      <text class="rv-time">{{shortTime(rv.createTime)}}</text>
    </view>
    <view class="rv-content">{{rv.content || '（未填写评价内容）'}}</view>

    <!-- 已回复：绿框展示；未回复：给输入入口 -->
    <view v-if="rv.reply" class="rv-reply">
      <text class="rv-reply-label">商家回复</text>
      <text class="rv-reply-text">{{rv.reply}}</text>
      <text class="rv-reply-time">{{shortTime(rv.replyTime)}}</text>
    </view>

    <view v-if="replyingId === rv._id" class="rv-editor">
      <textarea class="rv-input" :value="replyText" maxlength="300"
                placeholder="回应顾客（最多 300 字）" @input="onReplyInput" />
      <view class="rv-actions">
        <text class="rv-btn ghost" @tap="cancelReply">取消</text>
        <text class="rv-btn" :class="{ disabled: replying }" @tap="submitReply(rv)">{{replying ? '提交中…' : '提交回复'}}</text>
      </view>
    </view>
    <view v-else class="rv-actions">
      <text class="rv-btn ghost" @tap="startReply(rv)">{{rv.reply ? '修改回复' : '回复'}}</text>
      <text v-if="rv.reply" class="rv-btn ghost danger" @tap="removeReply(rv)">撤回</text>
    </view>
  </view>
</view>
</template>

<script>
// 商家端顾客反馈：拉取按菜品聚合的投诉统计，帮助发现口碑差的菜品
const { call } = require('@/common/cloud.js');
const { shortTime } = require('@/common/format.js');
const { requireLogin } = require('@/common/merchant.js');
const app = getApp();

export default {
  data() {
    return {
      // 模板里不能直接读模块级函数（uni-app Vue2 页面选项只把 data/methods
      // 挂到实例上），必须像 statusText 一样挂进来。
      // 漏挂的后果与本店顾客 orders 页同款：渲染抛
      // "n.shortTime is not a function"，Vue 保留旧 DOM，页面看着像卡住。
      shortTime,
      list: [],      // [{ dishId, dishName, count, pending, reasons[], lastTime }] 按次数降序
      raw: [],       // 单条反馈全量（按门店），展开明细时按 dishId 过滤，避免每菜一个请求
      openKey: '',   // 当前展开卡片的 key（取列表项的 _key：dishId，缺省 name:xxx）

      // ---- 顾客评价 ----
      reviews: [],       // 按「差评优先、新的在前」排序
      replyingId: '',    // 正在编辑回复的评价 id
      replyText: '',     // 回复草稿
      replying: false    // 提交中，防重复点击
    };
  },

  computed: {
    // 待回复数量：只是给商家一个「还有几条没搭话」的提示
    unrepliedCount() {
      return this.reviews.filter(r => !r.reply).length;
    }
  },

  onLoad() {
    // 商家端守卫（2026-10-21 加）
    if (!requireLogin(this)) return;
    this.load();
  },

  onShow() {
    // 从别处返回时刷新，保证看到最新反馈
    if (!requireLogin(this)) return;
    this.load();
  },

  methods: {
    async load() {
      const shopId = uni.getStorageSync('m_shopId') || app.globalData.shopId || 'demo-shop';
      try {
        // 聚合统计 + 单条全量 + 评价，三路并行，互不阻塞
        const [stats, all, reviews] = await Promise.all([
          call('cloudFeedback', 'stats', { shopId }),
          call('cloudFeedback', 'list', { shopId }),
          call('cloudReview', 'list', { shopId })
        ]);
        this.list = (stats.data || []).map(it => Object.assign({}, it, {
          // 预计算唯一 key：mp 平台的 :key 不支持「item.dishId || item.dishName」
          // 这类表达式，编译期告警且列表 diff 可能失效，故在数据侧算好。
          // 套餐类虚拟商品没有 dishId，用 name: 前缀兜底保证不与真实菜品 id 撞车
          _key: it.dishId || ('name:' + it.dishName)
        }));
        this.raw = all.data || [];
        // 评价排序：待回复优先（商家最容易漏掉），其次星级低的优先，
        // 最后按时间新的在前。让商家打开页面第一眼看到的就是最该处理的。
        const list = (reviews.data || []).slice();
        list.sort((a, b) => {
          const ra = a.reply ? 1 : 0, rb = b.reply ? 1 : 0;
          if (ra !== rb) return ra - rb;
          if ((a.rating || 0) !== (b.rating || 0)) return (a.rating || 0) - (b.rating || 0);
          return (b.createTime || 0) - (a.createTime || 0);
        });
        this.reviews = list;
      } catch (e) {
        uni.showToast({ title: '反馈加载失败', icon: 'none' });
      }
    },

    // 星级显示：实心与空心，比数字更直观
    stars(n) {
      const k = Math.max(0, Math.min(5, Number(n) || 0));
      return '★'.repeat(k) + '☆'.repeat(5 - k);
    },

    startReply(rv) {
      this.replyingId = rv._id;
      this.replyText = rv.reply || '';
    },

    cancelReply() {
      this.replyingId = '';
      this.replyText = '';
    },

    onReplyInput(e) {
      this.replyText = e.detail.value;
    },

    // 提交回复：真正的校验在服务端（非空 / 300 字上限），前端只做防连点
    async submitReply(rv) {
      if (this.replying) return;
      const text = (this.replyText || '').trim();
      if (!text) {
        uni.showToast({ title: '请填写回复内容', icon: 'none' });
        return;
      }
      this.replying = true;
      try {
        await call('cloudReview', 'reply', { _id: rv._id, reply: text });
        uni.showToast({ title: '已回复', icon: 'success' });
        this.cancelReply();
        this.load();
      } catch (err) {
        const raw = String(err || '');
        uni.showToast({ title: raw.slice(0, 20) || '回复失败', icon: 'none' });
      } finally {
        this.replying = false;
      }
    },

    async removeReply(rv) {
      const r = await new Promise(resolve => uni.showModal({
        title: '撤回回复',
        content: '撤回后这条评价会回到「待回复」，顾客将看不到你的回复。',
        success: x => resolve(x.confirm)
      }));
      if (!r) return;
      try {
        await call('cloudReview', 'deleteReply', { _id: rv._id });
        this.load();
      } catch (err) {
        uni.showToast({ title: '撤回失败，请重试', icon: 'none' });
      }
    },

    // 展开/收起某道菜的明细
    toggle(item) {
      const key = item._key;
      this.openKey = (this.openKey === key) ? '' : key;
    },

    // 某道菜名下的全部单条反馈（新的在前，后端已排序）
    itemsOf(item) {
      const key = item.dishId || ('name:' + (item.dishName || ''));
      return this.raw.filter(c => (c.dishId || ('name:' + (c.dishName || ''))) === key);
    },

    // 商家标记一条反馈已处理：处理后刷新，顾客订单页随即能看到状态
    async markHandled(c) {
      try {
        await call('cloudFeedback', 'handled', { id: c._id });
        uni.showToast({ title: '已标记为处理', icon: 'success' });
        this.load();
      } catch (err) {
        uni.showToast({ title: '操作失败，请重试', icon: 'none' });
      }
    }
  }
}
</script>

<style scoped>
/* pages/merchant/feedback/feedback.wxss */
.page-title { font-size: 40rpx; font-weight: 700; margin: 24rpx 0 8rpx; }
.page-sub { color: var(--muted); font-size: 24rpx; margin-bottom: 24rpx; }
.empty { text-align: center; color: var(--muted); padding: 120rpx 40rpx; font-size: 26rpx; }

.fb-card { border-left: 8rpx solid var(--primary); }
.fb-head { display: flex; justify-content: space-between; align-items: center; }
.fb-name { font-size: 32rpx; font-weight: 700; }
.fb-count {
  font-size: 26rpx; color: #fff; background: var(--primary);
  border-radius: 24rpx; padding: 4rpx 20rpx;
}
.fb-count.hot { background: #e74c3c; }  /* 被反馈 >=3 次，标红提示优先处理 */
.fb-reasons { margin-top: 16rpx; display: flex; flex-wrap: wrap; }
.reason-tag {
  display: inline-block; background: #f2f8f6; color: #4d6f65;
  border-radius: 8rpx; padding: 6rpx 18rpx; font-size: 24rpx; margin: 0 12rpx 12rpx 0;
}
.fb-time { color: var(--muted); font-size: 22rpx; margin-top: 8rpx; }

/* 卡片底栏：待处理计数 + 展开提示 */
.fb-foot {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 12rpx; padding-top: 16rpx; border-top: 1rpx solid #f2f8f6;
}
.pending-tag { font-size: 24rpx; color: #e67e22; font-weight: 600; }
.done-tag { font-size: 24rpx; color: #087c61; }
.fb-toggle { font-size: 22rpx; color: var(--muted); }

/* 单条反馈明细 */
.fb-detail { margin-top: 16rpx; background: #f2f8f6; border-radius: 12rpx; padding: 8rpx 20rpx; }
.fb-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16rpx 0; border-bottom: 1rpx solid #f2f8f6;
}
.fb-row:last-child { border-bottom: none; }
.fb-row.handled { opacity: .6; }
.fb-row-main { flex: 1; }
.fb-row-reason { font-size: 26rpx; color: #183c34; display: block; }
.fb-row-time { font-size: 20rpx; color: var(--muted); }
.fb-row-side { display: flex; align-items: center; margin-left: 16rpx; }
.row-state { font-size: 22rpx; margin-right: 12rpx; }
.row-state.done { color: #087c61; }
.row-state.wait { color: #e67e22; }
.row-btn {
  font-size: 22rpx; color: #fff; background: var(--primary);
  border-radius: 20rpx; padding: 8rpx 20rpx;
}

/* ============ 顾客评价 ============ */
.sec-title { margin-top: 48rpx; }
.warn { color: #e74c3c; font-weight: 600; }

.rv-card { border-left: 8rpx solid #087c61; }
/* 1~2 星标红：低分评价最该被商家看到，颜色是最快的检索方式 */
.rv-card.bad { border-left-color: #e74c3c; }
.rv-head { display: flex; align-items: center; }
.rv-stars { color: #FFC72C; font-size: 26rpx; letter-spacing: 2rpx; }
.rv-card.bad .rv-stars { color: #e74c3c; }
.rv-dish { font-size: 26rpx; font-weight: 600; margin-left: 16rpx; flex: 1; }
.rv-time { font-size: 20rpx; color: var(--muted); }
.rv-content { font-size: 26rpx; color: #183c34; margin-top: 12rpx; line-height: 1.5; }

.rv-reply {
  margin-top: 16rpx; padding: 14rpx 18rpx;
  background: #e9f7ef; border-radius: 10rpx;
  border-left: 6rpx solid #087c61;
}
.rv-reply-label { font-size: 20rpx; color: #087c61; font-weight: 600; display: block; margin-bottom: 6rpx; }
.rv-reply-text { font-size: 24rpx; color: #224d61; line-height: 1.5; display: block; }
.rv-reply-time { font-size: 20rpx; color: var(--muted); }

.rv-editor { margin-top: 16rpx; }
.rv-input {
  width: 100%; box-sizing: border-box;
  min-height: 120rpx; padding: 16rpx;
  background: #f2f8f6; border-radius: 10rpx; font-size: 26rpx;
}
.rv-actions { display: flex; justify-content: flex-end; margin-top: 12rpx; }
.rv-btn {
  font-size: 24rpx; color: #fff; background: var(--primary);
  border-radius: 24rpx; padding: 10rpx 28rpx; margin-left: 16rpx;
}
.rv-btn.ghost { color: #4d6f65; background: #f2f8f6; }
.rv-btn.danger { color: #e74c3c; }
.rv-btn.disabled { opacity: .6; }
</style>

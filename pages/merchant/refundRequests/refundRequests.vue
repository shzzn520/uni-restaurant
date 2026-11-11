<template>
<view class="page">
  <view class="notice">退款申请由商家审核。批准仅记录审核结果，需另行人工处理；此页面不会发起真实微信退款。</view>
  <view class="tabs">
    <view v-for="tab in tabs" :key="tab.key" class="tab" :class="{active: status === tab.key}" @tap="switchStatus(tab.key)">{{tab.label}}</view>
  </view>
  <view v-if="loading && !list.length" class="empty">申请加载中…</view>
  <view v-else-if="error" class="error">{{error}}</view>
  <view v-else-if="!list.length" class="empty">暂无{{activeLabel}}申请</view>

  <view v-for="item in list" :key="item._key" class="request-card">
    <view class="top">
      <text class="order-id">订单 {{item.orderId}}</text>
      <text class="status" :class="item.status">{{statusLabel(item.status)}}</text>
    </view>
    <view class="reason">{{item.reason}}</view>
    <view class="meta">申请时间：{{timeText(item.createTime)}}</view>
    <view v-if="item.decisionNote || item.note" class="note">处理说明：{{item.decisionNote || item.note}}</view>
    <view v-if="item.status === 'pending'" class="actions">
      <button class="reject" :disabled="busyId === item._key" @tap="decide(item, 'reject')">拒绝</button>
      <button class="approve" :disabled="busyId === item._key" @tap="decide(item, 'approve')">批准（待人工退款）</button>
    </view>
    <view v-else-if="item.status === 'approved_pending_manual_refund' || item.status === 'approved'" class="manual">已批准；请按商家流程人工处理退款。</view>
    <view v-else-if="item.status === 'closed_by_cancellation'" class="manual">订单已取消，售后申请已关闭。</view>
  </view>
</view>
</template>

<script>
const { call } = require('@/common/cloud.js');
const { requireLogin } = require('@/common/merchant.js');
const app = getApp();
const TABS = [
  { key: 'pending', label: '待审核' },
  { key: 'approved_pending_manual_refund', label: '已批准' },
  { key: 'rejected', label: '已拒绝' },
  { key: 'closed_by_cancellation', label: '已关闭' }
];

function currentShopId() {
  return uni.getStorageSync('m_shopId') || app.globalData.shopId || 'demo-shop';
}

export default {
  data() {
    return { tabs: TABS, status: 'pending', list: [], loading: false, error: '', busyId: '' };
  },
  computed: {
    activeLabel() {
      const hit = TABS.find(t => t.key === this.status);
      return hit ? hit.label : '售后';
    }
  },
  onLoad() {
    if (!requireLogin(this)) return;
    this.load();
  },
  onShow() {
    if (requireLogin(this)) this.load();
  },
  methods: {
    async load() {
      this.loading = true;
      this.error = '';
      try {
        const res = await call('cloudRefund', 'list', { shopId: currentShopId(), status: this.status });
        const data = res.data;
        const rows = Array.isArray(data) ? data : ((data && data.list) || []);
        // 小程序端的 :key 只接受单一字段路径，写 `item._id || item.requestId` 这类表达式
        // 会在编译期告警且 key 实际失效 —— 列表项退化成按索引复用，切换分栏时卡片内容会串位。
        // 在数据入口把主键归一化成固定字段 _key，模板只绑它。
        // 口径与 decide() 里的 requestId 保持一致（后端 decision 接口认 requestId）。
        rows.forEach(r => { r._key = r.requestId || r._id || r.orderId; });
        this.list = rows;
      } catch (e) {
        this.error = '售后申请加载失败：' + String(e);
      } finally {
        this.loading = false;
      }
    },
    switchStatus(status) {
      if (this.status === status) return;
      this.status = status;
      this.load();
    },
    statusLabel(status) {
      return ({
        pending: '待审核',
        approved_pending_manual_refund: '已批准·待人工退款',
        approved: '已批准·待人工退款',
        rejected: '已拒绝',
        closed_by_cancellation: '已关闭'
      })[status] || '状态待确认';
    },
    timeText(value) {
      if (!value) return '—';
      const date = new Date(Number(value));
      const pad = n => (n < 10 ? '0' : '') + n;
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
        + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
    },
    decide(item, decision) {
      const requestId = item.requestId || item._id;
      const approve = decision === 'approve';
      uni.showModal({
        title: approve ? '批准售后申请' : '拒绝售后申请',
        content: approve
          ? '本项目支付为演示流程，订单未发生真实扣款。批准只记录审核结果，不会自动退款到账。是否继续？'
          : '确认拒绝该售后申请？',
        editable: true,
        placeholderText: approve ? '选填：人工退款处理说明' : '选填：拒绝原因',
        confirmText: approve ? '批准' : '拒绝',
        success: async result => {
          if (!result.confirm) return;
          this.busyId = requestId;
          try {
            await call('cloudRefund', 'decision', {
              requestId, decision, note: String(result.content || '').trim()
            });
            uni.showToast({
              title: approve ? '已批准，待人工退款' : '已拒绝申请',
              icon: 'none'
            });
            await this.load();
          } catch (e) {
            uni.showToast({ title: '处理失败：' + String(e).slice(0, 18), icon: 'none' });
          } finally {
            this.busyId = '';
          }
        }
      });
    }
  }
};
</script>

<style scoped>
.page { padding: 22rpx; }
.notice { background: #fff7e6; color: #8a5a00; padding: 20rpx; border-radius: 12rpx; line-height: 1.5; font-size: 24rpx; }
.tabs { display: flex; background: #fff; margin: 20rpx 0; border-radius: 12rpx; }
.tab { flex: 1; text-align: center; padding: 22rpx 0; font-size: 26rpx; color: #3e5e55; border-bottom: 4rpx solid transparent; }
.tab.active { color: var(--primary); font-weight: 700; border-bottom-color: var(--primary); }
.request-card { background: #fff; border-radius: 16rpx; padding: 24rpx; margin-bottom: 18rpx; }
.top { display: flex; justify-content: space-between; align-items: center; }
.order-id { font-weight: 700; font-size: 27rpx; }
.status { border-radius: 20rpx; padding: 6rpx 12rpx; font-size: 21rpx; background: #fff4e5; color: #b36b00; }
.status.approved { background: #e9f7ef; color: #087c61; }
.status.rejected { background: #f2f8f6; color: #5c786f; }
.reason { font-size: 29rpx; margin: 20rpx 0 12rpx; }
.meta, .note, .manual { font-size: 23rpx; color: var(--muted); line-height: 1.5; }
.note { margin-top: 10rpx; }
.manual { color: #8a5a00; margin-top: 14rpx; }
.actions { display: flex; margin-top: 20rpx; }
.actions button { flex: 1; border-radius: 40rpx; font-size: 24rpx; }
.reject { color: #c0392b; background: #fff; border: 1rpx solid #e6b7b2; margin-right: 14rpx; }
.approve { color: #fff; background: var(--primary); }
.empty { text-align: center; color: var(--muted); padding: 100rpx 0; }
.error { background: #fff; color: #c0392b; border-radius: 12rpx; padding: 20rpx; }
</style>

<template>
<!-- pages/customer/bill/bill.vue —— 会员资产流水
     余额与积分的每一笔变动：充值、消费、赠分、退款逐笔可查，带变动后快照 -->
<view class="container">

  <!-- 顶部汇总：当前余额与积分（档案拉失败也不挡列表，快照列本身就能对账） -->
  <view class="summary" v-if="Object.keys(profile).length > 0">
    <view class="sum-item">
      <view class="sum-num"><text class="sum-sign">¥</text>{{balanceText}}</view>
      <view class="sum-label">当前余额</view>
    </view>
    <view class="sum-divider"></view>
    <view class="sum-item">
      <view class="sum-num">{{profile.points || 0}}</view>
      <view class="sum-label">当前积分</view>
    </view>
  </view>

  <!-- 筛选：全部 / 收入 / 支出（红入绿出，与国内记账习惯一致） -->
  <view class="tab-row">
    <text class="tab" :class="{on: tab === 'all'}" @tap="switchTab('all')">全部</text>
    <text class="tab" :class="{on: tab === 'in'}" @tap="switchTab('in')">收入</text>
    <text class="tab" :class="{on: tab === 'out'}" @tap="switchTab('out')">支出</text>
  </view>

  <!-- 流水列表 -->
  <view class="list">
    <view class="txn" v-for="t in filtered" :key="t._id">
      <view class="txn-icon" :class="txnCls(t)">{{txnIcon(t)}}</view>
      <view class="txn-main">
        <view class="txn-name">{{t.remark || t.type}}</view>
        <view class="txn-meta">
          {{fmtTime(t.createTime)}}<text v-if="t.orderId"> · 订单 {{t.orderId}}</text>
        </view>
      </view>
      <view class="txn-right">
        <view class="txn-amount" :class="isIn(t) ? 'in' : 'out'">
          {{isIn(t) ? '+' : '−'}}{{amountText(t)}}
        </view>
        <!-- 变动后快照：对账就看这一行，「这笔之后余额/积分是多少」 -->
        <view class="txn-after">余额 ¥{{money(t.balanceAfter)}} · 积分 {{t.pointsAfter || 0}}</view>
      </view>
    </view>

    <view class="empty" v-if="filtered.length === 0">
      {{loading ? '加载中...' : '暂无流水记录'}}
    </view>
  </view>

  <view class="tip">流水由服务端在每次余额/积分变动时自动记录，取消订单的退还款项也会逐笔体现</view>
</view>
</template>

<script>
// pages/customer/bill/bill.js —— 会员资产流水页
const { call } = require('@/common/cloud.js');
const session = require('@/common/session.js');

// 流水类型 → 图标。颜色不在这里定：入账/出账由变动方向决定（红入绿出），
// 同一种类型不可能既有入账又有出账，避免「图标和颜色打架」。
const TXN_ICON = {
  recharge: '💰',
  consume: '🍔',
  points_pay: '🎫',
  earn: '⭐',
  refund: '↩️',
  refund_points: '↩️',
  reclaim_points: '↩️'
};

export default {

  data() {
    return {
      userId: '',    // 会员编号（登录态）
      profile: {},   // 会员档案（汇总卡用）
      list: [],      // 全部流水（服务端已按时间倒序）
      tab: 'all',    // 全部 / 收入 / 支出
      loading: false
    };
  },

  computed: {
    balanceText() {
      return Number(this.profile.balance || 0).toFixed(2);
    },
    // 收入=变动为正（入账），支出=变动为负。一条流水只会动余额或动积分其中之一，
    // 所以任选一个非零的就能判方向。
    filtered() {
      if (this.tab === 'all') return this.list;
      return this.list.filter(t => this.isIn(t) === (this.tab === 'in'));
    }
  },

  onLoad() {
    this.userId = session.getUserId();
  },

  onShow() {
    // 从别页返回（如下完一单）流水会变：按项目铁律在 onShow 重拉，
    // 不能只依赖 onLoad——navigateTo 出去再回来 onLoad 不重跑。
    if (this.userId) this.load();
  },

  onPullDownRefresh() {
    this.load(() => uni.stopPullDownRefresh());
  },

  methods: {
    switchTab(t) {
      this.tab = t;
    },

    isIn(t) {
      const amount = Number(t.amount || 0);
      const points = Number(t.points || 0);
      return amount > 0 || (amount === 0 && points > 0);
    },

    txnIcon(t) {
      return TXN_ICON[t.type] || '📋';
    },

    // 积分流用的底色与余额流区分开，视觉上能看出「动的哪本账」
    txnCls(t) {
      return Number(t.points || 0) !== 0 ? 'points' : 'amount';
    },

    // 金额文案：动余额显示钱，动积分显示分
    amountText(t) {
      const amount = Number(t.amount || 0);
      if (amount !== 0) return '¥' + Math.abs(amount).toFixed(2);
      return Math.abs(Number(t.points || 0)) + ' 分';
    },

    money(n) {
      return (Number(n) || 0).toFixed(2);
    },

    fmtTime(ts) {
      if (!ts) return '';
      const d = new Date(Number(ts));
      const pad = n => (n < 10 ? '0' : '') + n;
      return pad(d.getMonth() + 1) + '-' + pad(d.getDate())
        + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    },

    async load(done) {
      this.loading = true;
      try {
        // 档案与流水并行拉：汇总卡失败不该让列表也空着
        const [info, txn] = await Promise.all([
          call('cloudMember', 'info', { userId: this.userId }).catch(() => null),
          call('cloudMember', 'transactions', { userId: this.userId })
        ]);
        if (info && info.data) this.profile = info.data;
        this.list = (txn && txn.data) || [];
      } catch (e) {
        console.warn('[bill] 流水加载失败', e);
        uni.showToast({ title: '流水加载失败', icon: 'none' });
      } finally {
        this.loading = false;
        if (done) done();
      }
    }
  }
};
</script>

<style scoped>
/* pages/customer/bill/bill.wxss */
.container { padding-bottom: 60rpx; }

/* ---------- 汇总卡 ---------- */
.summary {
  background: linear-gradient(135deg, #14526c, #3e5e55);
  color: #fff;
  border-radius: 20rpx;
  margin: 24rpx;
  padding: 32rpx;
  display: flex;
  align-items: center;
}
.sum-item { flex: 1; text-align: center; }
.sum-sign { font-size: 30rpx; margin-right: 4rpx; }
.sum-num { font-size: 48rpx; font-weight: 800; line-height: 1.2; }
.sum-label { font-size: 22rpx; opacity: .75; margin-top: 6rpx; }
.sum-divider { width: 1rpx; height: 60rpx; background: rgba(255,255,255,.2); }

/* ---------- 筛选 tab ---------- */
.tab-row {
  display: flex;
  background: #fff;
  border-radius: 16rpx;
  margin: 0 24rpx 20rpx;
  border-bottom: 1rpx solid #f2f8f6;
}
.tab {
  flex: 1;
  text-align: center;
  font-size: 26rpx;
  color: var(--muted);
  padding: 18rpx 0;
}
.tab.on { color: var(--primary); font-weight: 700; }

/* ---------- 流水行 ---------- */
.list {
  background: #fff;
  border-radius: 20rpx;
  margin: 0 24rpx;
  padding: 8rpx 24rpx;
}
.txn {
  display: flex;
  align-items: center;
  padding: 26rpx 0;
  border-bottom: 1rpx solid #f2f8f6;
}
.txn:last-child { border-bottom: none; }
.txn-icon {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32rpx;
  flex-shrink: 0;
  margin-right: 20rpx;
}
/* 动余额的：橙色底；动积分的：紫色底 —— 一眼看出动的哪本账 */
.txn-icon.amount { background: #FFF1E8; }
.txn-icon.points { background: #F3EEFF; }
.txn-main { flex: 1; overflow: hidden; }
.txn-name { font-size: 28rpx; }
.txn-meta { font-size: 22rpx; color: var(--muted); margin-top: 6rpx; }
.txn-right { text-align: right; flex-shrink: 0; margin-left: 16rpx; }
/* 红入绿出：与国内记账/行情习惯一致 */
.txn-amount { font-size: 30rpx; font-weight: 700; }
.txn-amount.in { color: #e74c3c; }
.txn-amount.out { color: #07a35a; }
.txn-after { font-size: 20rpx; color: var(--muted); margin-top: 6rpx; }

.empty { text-align: center; color: var(--muted); font-size: 26rpx; padding: 60rpx 0; }

.tip {
  color: #9bb2aa;
  font-size: 22rpx;
  text-align: center;
  margin-top: 24rpx;
  padding: 0 48rpx;
  line-height: 1.6;
}
</style>

<template>
<!-- pages/merchant/stats/stats.vue -->
<view class="stats-page">
  <!-- 今日概览：营业额是老板第一眼要看的数字，所以给最大的版面。
       点选趋势图里某一天后，这里切换成「那天」的口径（见 pickDay） -->
  <view class="hero">
    <view class="hero-top">
      <text class="hero-label">{{ heroLabel }}</text>
      <text class="hero-refresh" @tap="load">刷新</text>
    </view>
    <view class="hero-amount">{{ yuan(heroAmount) }}</view>
    <view class="hero-sub">{{ heroSub }}</view>
    <view class="hero-note">仅统计已支付及之后的订单，未支付不计入，且已扣除优惠券减免</view>
  </view>

  <!-- 四宫格指标 -->
  <view class="grid">
    <view class="cell">
      <view class="cell-num">{{ s.orderTotal }}</view>
      <view class="cell-label">累计订单</view>
    </view>
    <view class="cell">
      <view class="cell-num hot">{{ s.pendingCount }}</view>
      <view class="cell-label">待接单</view>
    </view>
    <view class="cell">
      <view class="cell-num">{{ s.dishTotal }}</view>
      <view class="cell-label">在售菜品</view>
    </view>
    <view class="cell">
      <view class="cell-num">{{ s.categoryTotal }}</view>
      <view class="cell-label">菜品分类</view>
    </view>
  </view>

  <!-- 近 7 日营业额：纯 CSS 柱状图，不引第三方图表库（小程序包体积是硬约束）。
       柱子可点：选中某一天后，顶部大数字与下方状态分布都切成那天口径 -->
  <view class="card">
    <view class="card-title">
      <text>近 7 日营业额</text>
      <text class="chart-hint" v-if="!isTodaySelected">点柱子看当天 · <text class="back-today" @tap="backToday">回今天</text></text>
    </view>
    <view class="chart">
      <view v-for="(d, i) in s.daily" :key="d.date" class="bar-col" :class="{ selected: i === selected }" @tap="pickDay(i)">
        <text class="bar-val" v-if="d.amount > 0">{{ d.amount }}</text>
        <view class="bar-track">
          <view class="bar" :class="{ today: d.today, selected: i === selected }" :style="{ height: d.h + 'rpx' }"></view>
        </view>
        <text class="bar-date" :class="{ today: d.today, selected: i === selected }">{{ d.today ? '今天' : d.date }}</text>
      </view>
    </view>
  </view>

  <!-- 订单状态分布：跟随选中的日期切换（默认今天） -->
  <view class="card">
    <view class="card-title">{{ distTitle }}</view>
    <view v-for="row in dayRows" :key="row.key" class="srow">
      <text class="srow-label">{{ row.label }}</text>
      <view class="srow-track">
        <view class="srow-fill" :style="{ width: row.pct + '%', background: row.color }"></view>
      </view>
      <text class="srow-num">{{ row.count }}</text>
    </view>
  </view>

  <!-- 数据导出：把订单明细导成 CSV，给对账/做表用 -->
  <view class="card">
    <view class="card-title">订单数据导出</view>
    <view class="exp-tip">
      导出本店全部订单的明细与优惠构成（取餐号、状态、菜品、券减、会员折扣、余额、积分、实付）。
      小程序不支持「另存为」，导出内容会写入剪贴板，粘贴到 Excel / WPS 即成表格；
      想直接下载文件可在电脑浏览器打开 <text class="exp-url">/api/admin/orders/export</text>。
    </view>
    <view class="exp-btn" :class="{ disabled: exporting }" @tap="exportCsv">
      {{ exporting ? '导出中…' : '导出订单 CSV' }}
    </view>
    <view v-if="exportResult" class="exp-result">{{ exportResult }}</view>
  </view>

  <view class="foot-note">数据口径与后端 /api/admin/stats 一致，切换数据源时两端数字相同</view>
</view>
</template>

<script>
// pages/merchant/stats/stats.js —— 商家经营统计页
// 数据来自 cloudAdmin/stats（mock 与 Spring Boot 后端同字段同口径）
const { call } = require('@/common/cloud.js');
const { STATUS_TEXT, yuan } = require('@/common/format.js');
const { requireLogin } = require('@/common/merchant.js');
const app = getApp();

// 状态分布行：颜色与顾客订单页的状态徽标保持同一套语义
// 红=待接单（要动手处理）、黄=备餐中、绿=已完成、蓝=配送中、深绿=已送达、灰=待支付/已取消
// 七行与后端 OrderService.allStatuses() 同全集——外卖单若缺 delivering/delivered
// 两行，配送中的订单在分布里会凭空消失，老板会以为单子丢了
const STATUS_ROWS = [
  { key: 'unpaid', label: STATUS_TEXT.unpaid, color: '#b6b6b6' },
  { key: 'paid', label: '待接单', color: '#e6432d' },
  { key: 'preparing', label: STATUS_TEXT.preparing, color: '#f5a623' },
  { key: 'done', label: STATUS_TEXT.done, color: '#087c61' },
  { key: 'delivering', label: STATUS_TEXT.delivering, color: '#176db3' },
  { key: 'delivered', label: STATUS_TEXT.delivered, color: '#087c61' },
  { key: 'canceled', label: STATUS_TEXT.canceled, color: '#d8d8d8' }
];

const BAR_MAX_H = 220; // 柱状图最高高度（rpx）

export default {
  data() {
    return {
      yuan,
      s: {
        todayAmount: 0,
        todayOrderCount: 0,
        pendingCount: 0,
        orderTotal: 0,
        dishTotal: 0,
        categoryTotal: 0,
        daily: []
      },
      // 趋势图选中的日子（daily 下标）。默认最后一天=今天，
      // 刷新时按 date 串尽量保留用户选择（见 load）
      selected: 0,
      exporting: false,    // 防连点：导出要跑一次完整查询，重复点会白跑
      exportResult: ''     // 最近一次导出的结果提示（条数 + 是否已入剪贴板）
    };
  },

  // 每次进入都重拉：从订单页处理完订单返回时，这里的待接单数要跟着变
  // 商家端守卫：/api/admin/stats 现在要商户口令（经营数据不能匿名读，2026-10-21 加）
  onShow() {
    if (!requireLogin(this)) return;
    this.load();
  },

  computed: {
    // 选中的那天（daily 为空时返回 null，各派生值走兜底）
    heroDay() {
      const d = this.s.daily && this.s.daily[this.selected];
      return d || null;
    },

    isTodaySelected() {
      const d = this.heroDay;
      return !d || !!d.today;
    },

    heroLabel() {
      const d = this.heroDay;
      if (!d || d.today) return '今日营业额';
      return d.date + ' 营业额';
    },

    heroAmount() {
      const d = this.heroDay;
      return d ? d.amount : this.s.todayAmount;
    },

    heroSub() {
      const d = this.heroDay;
      if (!d) return '今日 0 单 · 待接单 0 单';
      // 待接单是「当前」运营口径、跨天累计，只有选中今天才并排展示；
      // 历史日期并排一个实时数会误导（那天的待接单早就处理完了）
      if (d.today) {
        return '今日 ' + this.s.todayOrderCount + ' 单 · 待接单 ' + this.s.pendingCount + ' 单';
      }
      return d.date + ' ' + d.orderCount + ' 单';
    },

    distTitle() {
      const d = this.heroDay;
      if (!d || d.today) return '订单状态分布';
      return d.date + ' 订单状态分布';
    },

    // 状态分布跟随选中日期：优先取当天的 statusCount（daily 里带），
    // 老后端没有该字段时退化为全店汇总，不能白屏
    dayRows() {
      const d = this.heroDay;
      const sc = (d && d.statusCount) || this.s.statusCount || {};
      const cnt = k => Number(sc[k]) || 0;
      // 分布条长度按「最大状态数」缩放，不用总数：5 单里 4 单完成时条要接近满栏
      const maxCnt = STATUS_ROWS.reduce((m, r) => Math.max(m, cnt(r.key)), 0);
      return STATUS_ROWS.map(r => ({
        key: r.key,
        label: r.label,
        color: r.color,
        count: cnt(r.key),
        pct: maxCnt > 0 ? Math.round((cnt(r.key) / maxCnt) * 100) : 0
      }));
    }
  },

  methods: {
    /**
     * 导出订单 CSV。
     *
     * <p>小程序没有「另存为」能力，所以这里走剪贴板：拿到 CSV 文本整段写进去，
     * 用户粘到 Excel / WPS 就是一张表。比写文件更可靠——写文件再用 openDocument
     * 打开在官方文档里并不支持 csv 类型，真机上会直接失败。
     */
    async exportCsv() {
      if (this.exporting) return;
      this.exporting = true;
      this.exportResult = '';
      const shopId = uni.getStorageSync('m_shopId') || app.globalData.shopId || 'demo-shop';
      try {
        const res = await call('cloudAdmin', 'exportOrders', { shopId });
        const d = (res && res.data) || {};
        const csv = d.csv || '';
        const rows = Number(d.rows || 0);
        if (!rows) {
          this.exportResult = '本店还没有订单，没有可导出的数据';
          return;
        }
        uni.setClipboardData({
          data: csv,
          success: () => {
            this.exportResult = '已复制 ' + rows + ' 条订单（' + csv.length + ' 字符），'
              + '直接粘贴到 Excel 即可';
          },
          fail: () => {
            // 复制失败不吞掉：明确告诉用户失败了，而不是假装成功
            this.exportResult = '剪贴板写入失败，请重试或改用电脑浏览器下载';
          }
        });
      } catch (e) {
        console.error('[stats] 导出失败：', e);
        this.exportResult = '导出失败：' + String(e).slice(0, 30);
      } finally {
        this.exporting = false;
      }
    },

    async load() {
      const shopId = uni.getStorageSync('m_shopId') || app.globalData.shopId || 'demo-shop';
      try {
        const res = await call('cloudAdmin', 'stats', { shopId });
        const s = res.data;
        // daily 兜底：老版本后端没有这个字段时也不能让页面白屏
        s.daily = s.daily || [];

        // 柱高按「最大值等比缩放」，最少留 4rpx 让 0 营业额的日子也有个柱墩
        const maxAmt = s.daily.reduce((m, d) => Math.max(m, Number(d.amount) || 0), 0);
        s.daily = s.daily.map((d, i) => ({
          date: d.date,
          amount: Number(d.amount) || 0,
          orderCount: Number(d.orderCount) || 0,
          // 保留后端返回的当日状态分布（2026-10-21 修：之前 map 丢掉了这个字段，
          // 导致点历史日期后状态分布回退成全店汇总）
          statusCount: d.statusCount || null,
          today: i === s.daily.length - 1,
          h: maxAmt > 0 ? Math.max(4, Math.round((Number(d.amount) / maxAmt) * BAR_MAX_H)) : 4
        }));

        // 刷新时保留用户已选日期：按 date 串回填下标；
        // 找不到（所选日期滑出 7 日窗口）就回今天，避免 selected 越界
        const prevDate = this.s.daily[this.selected] && this.s.daily[this.selected].date;
        const keepIdx = prevDate ? s.daily.findIndex(d => d.date === prevDate) : -1;
        this.selected = keepIdx >= 0 ? keepIdx : Math.max(0, s.daily.length - 1);

        this.s = s;
        this._fail = 0;
      } catch (e) {
        this._fail = (this._fail || 0) + 1;
        if (this._fail === 1) {
          uni.showToast({ title: '统计数据加载失败', icon: 'none' });
        }
      }
    },

    // 点趋势图柱子看那天：顶部大数字与状态分布都切到选中日期
    pickDay(i) {
      this.selected = i;
    },

    // 回到今天（选中历史日期后才显示这个入口）
    backToday() {
      this.selected = Math.max(0, this.s.daily.length - 1);
    }
  }
};
</script>

<style scoped>
/* pages/merchant/stats/stats.wxss */
.stats-page { padding: 24rpx; background: #f2f8f6; min-height: 100vh; }

/* 今日概览大卡 */
.hero {
  background: linear-gradient(135deg, #176db3, #087c61);
  border-radius: 20rpx;
  padding: 32rpx;
  color: #fff;
}
.hero-top { display: flex; justify-content: space-between; align-items: center; }
.hero-label { font-size: 26rpx; opacity: 0.9; }
.hero-refresh {
  font-size: 24rpx;
  background: rgba(255, 255, 255, 0.22);
  border-radius: 28rpx;
  padding: 6rpx 20rpx;
}
.hero-amount { font-size: 72rpx; font-weight: 800; margin: 12rpx 0 8rpx; }
.hero-sub { font-size: 28rpx; opacity: 0.95; }
.hero-note { font-size: 22rpx; opacity: 0.75; margin-top: 12rpx; }

/* 四宫格 */
.grid {
  display: flex;
  background: #fff;
  border-radius: 16rpx;
  margin-top: 24rpx;
  padding: 28rpx 0;
}
.cell { flex: 1; text-align: center; }
.cell-num { font-size: 44rpx; font-weight: 700; color: #183c34; }
.cell-num.hot { color: #e6432d; }
.cell-label { font-size: 24rpx; color: var(--muted); margin-top: 6rpx; }

/* 卡片通用 */
.card { background: #fff; border-radius: 16rpx; margin-top: 24rpx; padding: 28rpx 24rpx; }
.card-title { font-size: 30rpx; font-weight: 700; color: #183c34; margin-bottom: 28rpx; display: flex; align-items: baseline; }
/* 图表提示与「回今天」：默认隐藏，选中历史日期才出现 */
.chart-hint { font-size: 20rpx; font-weight: 400; color: #5c786f; margin-left: 16rpx; }
.back-today { color: #087c61; }

/* 近 7 日柱状图 */
.chart { display: flex; align-items: flex-end; height: 300rpx; }
.bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; cursor: pointer; }
.bar-val { font-size: 20rpx; color: #5c786f; margin-bottom: 6rpx; }
.bar-track { flex: 1; width: 100%; display: flex; align-items: flex-end; justify-content: center; }
.bar {
  width: 36rpx;
  background: #ffd9a8;
  border-radius: 8rpx 8rpx 0 0;
}
/* 今天用主题橙，和前几天区分开 */
.bar.today { background: #087c61; }
/* 选中态：深一档的橙 + 轨道淡底，让「当前看的是哪天」一眼可辨 */
.bar.selected { background: #176db3; }
.bar-col.selected .bar-track { background: #fff3e8; border-radius: 8rpx 8rpx 0 0; }
.bar-date { font-size: 20rpx; color: #5c786f; margin-top: 10rpx; }
.bar-date.today { color: #087c61; font-weight: 700; }
.bar-date.selected { color: #176db3; font-weight: 700; }

/* 状态分布 */
.srow { display: flex; align-items: center; margin-bottom: 20rpx; }
.srow:last-child { margin-bottom: 0; }
.srow-label { width: 120rpx; font-size: 26rpx; color: #3e5e55; }
.srow-track { flex: 1; height: 20rpx; background: #f2f8f6; border-radius: 10rpx; overflow: hidden; }
.srow-fill { height: 100%; border-radius: 10rpx; }
.srow-num { width: 60rpx; text-align: right; font-size: 28rpx; font-weight: 700; color: #183c34; }

.foot-note {
  text-align: center;
  font-size: 22rpx;
  color: #9bb2aa;
  margin: 28rpx 0 40rpx;
}

/* ============ 订单导出 ============ */
.exp-tip { font-size: 22rpx; color: #5c786f; line-height: 1.6; }
.exp-url { color: #087c61; }
.exp-btn {
  margin-top: 24rpx;
  height: 80rpx;
  line-height: 80rpx;
  text-align: center;
  border-radius: 40rpx;
  background: #087c61;
  color: #fff;
  font-size: 28rpx;
}
.exp-btn.disabled { opacity: .6; }
.exp-result {
  margin-top: 18rpx;
  font-size: 22rpx;
  color: #087c61;
  background: #e9f7ef;
  border-radius: 10rpx;
  padding: 14rpx 18rpx;
  line-height: 1.5;
}
</style>

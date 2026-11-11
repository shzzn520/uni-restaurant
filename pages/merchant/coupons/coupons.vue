<template>
<view class="page">
  <view class="intro">管理本店领券中心展示的优惠券模板。</view>
  <view v-if="loading && !list.length" class="empty">优惠券加载中…</view>
  <view v-else-if="error" class="error">{{error}}</view>
  <view v-else-if="!list.length" class="empty">暂无优惠券模板</view>

  <view v-for="item in list" :key="item._id" class="coupon-card">
    <view class="card-head">
      <view class="coupon-name">{{item.name || item.couponName}}</view>
      <text class="status" :class="item.status">{{item.status === 'on' ? '发放中' : '已停用'}}</text>
    </view>
    <view class="amount">满 {{Number(item.threshold) || 0}} 减 ¥{{item.amount}}</view>
    <view class="meta">有效 {{item.validDays}} 天 · 限领 {{item.perUserLimit}} 张 · 总量 {{item.totalQty > 0 ? item.totalQty : '不限'}}（已领 {{item.claimedQty || 0}}）</view>
    <view class="ops">
      <text class="link" @tap="edit(item)">编辑</text>
      <text class="link" @tap="toggle(item)">{{item.status === 'on' ? '停用' : '启用'}}</text>
    </view>
  </view>
  <button class="primary-btn" @tap="openCreate">+ 新增优惠券</button>

  <view class="mask" v-if="showForm" @tap="closeForm"></view>
  <view class="sheet" v-if="showForm">
    <view class="sheet-title">{{editing ? '编辑优惠券' : '新增优惠券'}}</view>
    <input class="field" placeholder="优惠券名称" :value="form.name" @input="onField('name', $event)" />
    <view class="row">
      <input class="field half" type="digit" placeholder="使用门槛（元）" :value="form.threshold" @input="onField('threshold', $event)" />
      <input class="field half" type="digit" placeholder="减免金额（元）" :value="form.amount" @input="onField('amount', $event)" />
    </view>
    <view class="row">
      <input class="field half" type="number" placeholder="有效天数" :value="form.validDays" @input="onField('validDays', $event)" />
      <input class="field half" type="number" placeholder="总发行量（0不限）" :value="form.totalQty" @input="onField('totalQty', $event)" />
    </view>
    <input class="field" type="number" placeholder="每人限领张数" :value="form.perUserLimit" @input="onField('perUserLimit', $event)" />
    <view class="hint">总发行量填 0 表示不限；已领取数量不会因编辑而重置。</view>
    <button class="primary-btn" :disabled="saving" @tap="save">{{saving ? '保存中…' : '保存'}}</button>
    <button class="cancel-btn" @tap="closeForm">取消</button>
  </view>
</view>
</template>

<script>
const { call } = require('@/common/cloud.js');
const { requireLogin } = require('@/common/merchant.js');
const app = getApp();

function currentShopId() {
  return uni.getStorageSync('m_shopId') || app.globalData.shopId || 'demo-shop';
}

export default {
  data() {
    return {
      list: [],
      loading: false,
      saving: false,
      error: '',
      showForm: false,
      editing: null,
      form: { name: '', threshold: '0', amount: '', validDays: '7', totalQty: '0', perUserLimit: '1' }
    };
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
        const res = await call('cloudCoupon', 'adminList', { shopId: currentShopId() });
        const data = res.data;
        this.list = Array.isArray(data) ? data : ((data && data.list) || []);
      } catch (e) {
        this.error = '优惠券加载失败：' + String(e);
      } finally {
        this.loading = false;
      }
    },
    openCreate() {
      this.editing = null;
      this.form = { name: '', threshold: '0', amount: '', validDays: '7', totalQty: '0', perUserLimit: '1' };
      this.showForm = true;
    },
    edit(item) {
      this.editing = item;
      this.form = {
        name: item.name || item.couponName || '',
        threshold: String(item.threshold == null ? 0 : item.threshold),
        amount: String(item.amount == null ? '' : item.amount),
        validDays: String(item.validDays || 7),
        totalQty: String(item.totalQty || 0),
        perUserLimit: String(item.perUserLimit || 1)
      };
      this.showForm = true;
    },
    onField(key, e) { this.form[key] = e.detail.value; },
    closeForm() { this.showForm = false; },
    async save() {
      if (this.saving) return;
      const body = {
        shopId: currentShopId(),
        name: String(this.form.name || '').trim(),
        threshold: Number(this.form.threshold),
        amount: Number(this.form.amount),
        validDays: Number(this.form.validDays),
        totalQty: Number(this.form.totalQty),
        perUserLimit: Number(this.form.perUserLimit)
      };
      if (!body.name || !Number.isFinite(body.threshold) || body.threshold < 0
        || !(body.amount > 0) || !(body.validDays > 0) || body.totalQty < 0
        || !Number.isFinite(body.totalQty)
        || !(body.perUserLimit > 0)) {
        uni.showToast({ title: '请填写有效的优惠券信息', icon: 'none' });
        return;
      }
      this.saving = true;
      try {
        if (this.editing) {
          await call('cloudCoupon', 'adminUpdate', { id: this.editing._id, data: body });
        } else {
          await call('cloudCoupon', 'adminCreate', { data: body });
        }
        this.showForm = false;
        await this.load();
      } catch (e) {
        uni.showToast({ title: '优惠券保存失败：' + String(e).slice(0, 18), icon: 'none' });
      } finally {
        this.saving = false;
      }
    },
    async toggle(item) {
      const status = item.status === 'on' ? 'off' : 'on';
      try {
        await call('cloudCoupon', 'adminToggle', { id: item._id, status });
        await this.load();
      } catch (e) {
        uni.showToast({ title: '状态更新失败：' + String(e).slice(0, 18), icon: 'none' });
      }
    }
  }
};
</script>

<style scoped>
.page { padding: 24rpx; }
.intro, .meta, .hint { color: var(--muted); font-size: 24rpx; line-height: 1.5; }
.intro { padding: 4rpx 4rpx 18rpx; }
.coupon-card { background: #fff; border-radius: 16rpx; padding: 24rpx; margin-bottom: 18rpx; }
.card-head, .ops, .row { display: flex; align-items: center; justify-content: space-between; }
.coupon-name { font-size: 30rpx; font-weight: 700; }
.status { font-size: 22rpx; border-radius: 20rpx; padding: 6rpx 14rpx; }
.status.on { background: #e9f7ef; color: #087c61; }
.status.off { background: #f2f8f6; color: #5c786f; }
.amount { color: var(--primary); font-size: 32rpx; font-weight: 700; margin: 14rpx 0 8rpx; }
.ops { justify-content: flex-end; margin-top: 16rpx; }
.link { color: var(--primary); font-size: 26rpx; margin-left: 32rpx; }
.empty { text-align: center; color: var(--muted); padding: 100rpx 0; }
.error { color: #c0392b; background: #fff; border-radius: 16rpx; padding: 22rpx; margin-bottom: 20rpx; }
.primary-btn { background: var(--primary); color: #fff; border-radius: 48rpx; margin: 20rpx 0; }
.mask { position: fixed; top: 0; right: 0; bottom: 0; left: 0; background: rgba(0,0,0,.5); z-index: 10; }
.sheet { position: fixed; left: 0; right: 0; bottom: 0; padding: 32rpx; background: #fff; border-radius: 24rpx 24rpx 0 0; z-index: 11; box-sizing: border-box; }
.sheet-title { font-size: 32rpx; font-weight: 700; margin-bottom: 22rpx; }
.field { width: 100%; box-sizing: border-box; background: #f2f8f6; border-radius: 12rpx; padding: 18rpx 20rpx; margin-bottom: 16rpx; font-size: 27rpx; }
.row .half { width: 48%; }
.hint { margin: 0 0 12rpx; }
.cancel-btn { background: #f2f8f6; color: #3e5e55; border-radius: 48rpx; margin-bottom: 12rpx; }
</style>

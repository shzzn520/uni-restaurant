<template>
<view class="page">
  <view class="intro">管理顾客端可选门店。已有订单的门店不能删除，以保留历史订单数据。</view>

  <view v-if="loading && !list.length" class="empty">门店加载中…</view>
  <view v-else-if="error" class="error">{{error}}</view>
  <view v-else-if="!list.length" class="empty">暂无门店</view>

  <view v-for="item in list" :key="item._id" class="shop-card">
    <view class="shop-head">
      <view class="shop-name">{{item.name}}</view>
      <text v-if="item._id === currentShopId" class="current">当前登录门店</text>
    </view>
    <view class="detail">门店 ID：{{item._id}}</view>
    <view class="detail">地址：{{item.address}}</view>
    <view v-if="item.desc" class="detail">简介：{{item.desc}}</view>
    <view class="detail">坐标：{{item.latitude}}, {{item.longitude}}</view>
    <view class="ops">
      <text class="link" @tap="edit(item)">编辑</text>
      <text class="link danger" @tap="remove(item)">删除</text>
    </view>
  </view>

  <button class="primary-btn" @tap="openCreate">+ 新增门店</button>

  <view class="mask" v-if="showForm" @tap="closeForm"></view>
  <view class="sheet" v-if="showForm">
    <view class="sheet-title">{{editing ? '编辑门店' : '新增门店'}}</view>
    <input class="field" placeholder="门店名称" :value="form.name" @input="onField('name', $event)" />
    <input class="field" placeholder="详细地址" :value="form.address" @input="onField('address', $event)" />
    <input class="field" placeholder="门店简介（选填）" :value="form.desc" @input="onField('desc', $event)" />
    <view class="row">
      <input class="field half" type="digit" placeholder="纬度" :value="form.latitude" @input="onField('latitude', $event)" />
      <input class="field half" type="digit" placeholder="经度" :value="form.longitude" @input="onField('longitude', $event)" />
    </view>
    <view class="hint">请填写门店真实坐标，顾客可按距离查找门店。</view>
    <button class="primary-btn" :disabled="saving" @tap="save">{{saving ? '保存中…' : '保存'}}</button>
    <button class="cancel-btn" @tap="closeForm">取消</button>
  </view>
</view>
</template>

<script>
const { call } = require('@/common/cloud.js');
const { requireLogin } = require('@/common/merchant.js');
const app = getApp();

export default {
  data() {
    return {
      list: [],
      loading: false,
      saving: false,
      error: '',
      showForm: false,
      editing: null,
      currentShopId: '',
      form: { name: '', address: '', desc: '', latitude: '', longitude: '' }
    };
  },
  onLoad() {
    if (!requireLogin(this)) return;
    this.currentShopId = uni.getStorageSync('m_shopId') || app.globalData.shopId || 'demo-shop';
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
        const res = await call('cloudShop', 'list', {});
        this.list = (res.data && res.data.shops) || [];
      } catch (e) {
        this.error = '门店加载失败：' + String(e);
      } finally {
        this.loading = false;
      }
    },
    openCreate() {
      this.editing = null;
      this.form = { name: '', address: '', desc: '', latitude: '', longitude: '' };
      this.showForm = true;
    },
    edit(item) {
      this.editing = item;
      this.form = {
        name: item.name || '',
        address: item.address || '',
        desc: item.desc || '',
        latitude: String(item.latitude == null ? '' : item.latitude),
        longitude: String(item.longitude == null ? '' : item.longitude)
      };
      this.showForm = true;
    },
    onField(key, e) { this.form[key] = e.detail.value; },
    closeForm() { this.showForm = false; },
    async save() {
      if (this.saving) return;
      const data = {
        name: String(this.form.name || '').trim(),
        address: String(this.form.address || '').trim(),
        desc: String(this.form.desc || '').trim(),
        latitude: Number(this.form.latitude),
        longitude: Number(this.form.longitude)
      };
      if (!data.name || !data.address || !this.form.latitude || !this.form.longitude
        || !Number.isFinite(data.latitude) || data.latitude < -90 || data.latitude > 90
        || !Number.isFinite(data.longitude) || data.longitude < -180 || data.longitude > 180) {
        uni.showToast({ title: '请填写有效的门店信息和经纬度', icon: 'none' });
        return;
      }
      this.saving = true;
      try {
        if (this.editing) {
          await call('cloudShop', 'update', { id: this.editing._id, data });
        } else {
          await call('cloudShop', 'create', { data });
        }
        this.showForm = false;
        await this.load();
      } catch (e) {
        uni.showToast({ title: '门店保存失败：' + String(e).slice(0, 20), icon: 'none' });
      } finally {
        this.saving = false;
      }
    },
    remove(item) {
      if (item._id === this.currentShopId) {
        uni.showToast({ title: '不能删除当前登录门店', icon: 'none' });
        return;
      }
      uni.showModal({
        title: '删除门店',
        content: '确认删除“' + item.name + '”？该门店已有订单时无法删除。',
        success: async result => {
          if (!result.confirm) return;
          try {
            await call('cloudShop', 'delete', { id: item._id });
            await this.load();
          } catch (e) {
            uni.showToast({ title: '门店删除失败：' + String(e).slice(0, 20), icon: 'none' });
          }
        }
      });
    }
  }
};
</script>

<style scoped>
.page { padding: 24rpx; }
.intro, .detail, .hint { color: var(--muted); font-size: 24rpx; line-height: 1.5; }
.intro { padding: 4rpx 4rpx 18rpx; }
.shop-card { background: #fff; border-radius: 16rpx; padding: 24rpx; margin-bottom: 18rpx; }
.shop-head, .ops, .row { display: flex; align-items: center; justify-content: space-between; }
.shop-name { font-size: 30rpx; font-weight: 700; }
.current { color: #087c61; font-size: 22rpx; }
.detail { margin-top: 10rpx; }
.ops { justify-content: flex-end; margin-top: 16rpx; }
.link { color: var(--primary); font-size: 26rpx; margin-left: 32rpx; }
.link.danger { color: #c0392b; }
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

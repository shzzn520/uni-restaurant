<template>
<!-- pages/merchant/menu/menu.wxml -->
<view class="menu-manage">
  <!-- 分类区 -->
  <view class="cat-bar">
    <scroll-view scroll-x class="cat-scroll">
      <view v-for="(item, index) in categories" :key="item._id" class="cat-chip">
        <text>{{item.name}}</text>
        <text class="cat-del" @tap.stop="removeCategory(item._id)">×</text>
      </view>
    </scroll-view>
    <view class="cat-add" @tap="addCategory">+ 分类</view>
  </view>

  <!-- 菜品列表（按分类归组） -->
  <scroll-view scroll-y class="dish-area">
    <view v-for="(item, index) in grouped" :key="item._id" class="cat-block">
      <view class="cat-title">{{item.name}}（{{item.list.length}}）</view>
      <!-- 内层循环变量改名 d，避免与外层 item 冲突 -->
      <view v-for="(d, index) in item.list" :key="d._id" class="dish-row">
        <image v-if="d.image" class="dish-thumb" :src="d.image" mode="aspectFill"></image>
        <view v-else class="dish-thumb">{{d.name[0]}}</view>
        <view class="dish-main">
          <view class="dish-name">{{d.name}}</view>
          <view class="dish-price price">{{d.priceText}}</view>
        </view>
        <view class="dish-ops">
          <view class="op-tag" :class="{ on: d.on, off: !d.on }" @tap="toggle(d)">{{d.on ? '在售' : '下架'}}</view>
          <view class="op-btn" @tap="openEdit(d)">编辑</view>
          <view class="op-btn del" @tap="remove(d._id)">删除</view>
        </view>
      </view>
      <view v-if="item.list.length === 0" class="empty">该分类暂无菜品</view>
    </view>
  </scroll-view>

  <!-- 新增菜品按钮 -->
  <view class="footer">
    <button class="add-btn" @tap="openAdd">+ 新增菜品</button>
    <button class="coupon-btn" @tap="goCoupons">优惠券管理</button>
  </view>

  <!-- 菜品编辑弹层 -->
  <view class="mask" v-if="showForm" @tap="closeForm"></view>
  <view class="sheet" v-if="showForm">
    <view class="sheet-title">{{editing ? '编辑菜品' : '新增菜品'}}</view>

    <view class="form-row">
      <text class="form-label">名称</text>
      <input class="form-input" placeholder="菜品名称" :value="form.name" @input="onField('name', $event)" />
    </view>
    <view class="form-row">
      <text class="form-label">价格</text>
      <input class="form-input" type="digit" placeholder="0.00" :value="form.price" @input="onField('price', $event)" />
    </view>
    <view class="form-row">
      <text class="form-label">分类</text>
      <picker mode="selector" :range="categories" range-key="name" :value="catIndex"
              @change="onCategoryPick">
        <view class="form-input picker">
          {{ (categories[catIndex] && categories[catIndex].name) || '请选择' }}
        </view>
      </picker>
    </view>
    <view class="form-row">
      <text class="form-label">描述</text>
      <input class="form-input" placeholder="选填" :value="form.desc" @input="onField('desc', $event)" />
    </view>
    <view class="form-row">
      <text class="form-label">图片</text>
      <view class="img-box" @tap="chooseImage">
        <image v-if="form.image" :src="form.image" mode="aspectFill" class="img-prev" />
        <text v-else  class="img-add">+ 上传</text>
      </view>
    </view>

    <button class="primary-btn" @tap="save" :disabled="saving">{{saving ? '保存中...' : '保存'}}</button>
    <button class="cancel-btn" @tap="closeForm">取消</button>
  </view>
</view>
</template>

<script>
// pages/merchant/menu/menu.js —— 商家菜品与分类管理
const { call } = require('@/common/cloud.js');
const { yuan } = require('@/common/format.js');
const config = require('@/common/config.js');
const { requireLogin } = require('@/common/merchant.js');
// config 已不再需要：uni-app 版去掉了云存储分支
const app = getApp();

// 取当前商家店铺 ID（兼容模拟模式）
function currentShopId() {
  return uni.getStorageSync('m_shopId') || app.globalData.shopId || 'demo-shop';
}
export default {
  data() {
    return {
    categories: [],   // 分类列表
    grouped: [],      // 按分类归组：[{ _id, name, list: [dish] }]
    showForm: false,  // 菜品编辑弹层
    editing: false,   // 是否编辑已有菜品
    catIndex: 0,      // 当前选中分类在 picker 中的下标
    saving: false,    // 保存中：后端 addDish 无幂等键，连点两次会真的建出两道同名菜
    form: { name: '', price: '', categoryId: '', desc: '', image: '', _id: '' }
    };
  },

  onLoad() {
    // 商家端守卫（2026-10-21 加）
    if (!requireLogin(this)) return;
    this.load();
  },

  // ⚠️ 事件处理函数必须写在 methods 内（2026-10-16 修）。
  // 原先这些函数直接挂在 export default 顶层。uni-app(Vue2) 的页面选项会走
  // Vue.extend()，只有 options.methods 里的函数才会挂到 vm 实例上，顶层普通函数
  // 会被静默丢弃 —— 点击时抛 does not have a method "xxx"，表现就是按钮完全没反应，
  // 且编译期零提示（自动化脚本走 HTTP 直连，也照不出这一类 bug）。
  // 生命周期钩子（onLoad/onShow/onUnload/onReachBottom）例外，留在顶层即可。
  methods: {
    // 拉取全部菜品（含下架）
    async load() {
      const shopId = currentShopId();
      try {
        const res = await call('cloudMenu', 'getShopMenu', { shopId, role: 'merchant' });
        const categories = (res.data && res.data.categories) || [];
        const dishes = (res.data && res.data.dishes) || [];
        const grouped = categories.map(cat => ({
          _id: cat._id,
          name: cat.name,
          list: dishes
            .filter(d => d.categoryId === cat._id)
            .map(d => ({ ...d, priceText: yuan(d.price), on: d.status === 'on' }))
        }));
      // 若表单无分类，默认选中第一个
      this.categories = categories;
      this.grouped = grouped;
      this.form.categoryId =
        (this.form && this.form.categoryId) ||
        (res.data.categories[0] && res.data.categories[0]._id) ||
        '';
      } catch (e) {
        uni.showToast({ title: '加载失败', icon: 'none' });
      }
    },

    // 打开新增菜品
    openAdd() {
      const first = this.categories[0];
          this.showForm = true;
      this.editing = false;
      this.catIndex = 0;
      this.form = { name: '', price: '', categoryId: first ? first._id : '', desc: '', image: '', _id: '' };
    },

    // 打开编辑菜品
    openEdit(d) {
      // 定位该菜品分类在分类列表中的下标
      const idx = this.categories.findIndex(c => c._id === d.categoryId);
          this.showForm = true;
      this.editing = true;
      this.catIndex = idx >= 0 ? idx : 0;
      this.form = {
          name: d.name, price: String(d.price), categoryId: d.categoryId,
          desc: d.desc || '', image: d.image || '', _id: d._id
        };
    },
    closeForm() {     this.showForm = false; },

    // 分类选择器
    onCategoryPick(e) {
      const idx = Number(e.detail.value);
          this.catIndex = idx;
      this.form.categoryId = this.categories[idx]._id;
    },

    // 表单字段输入
    // 表单字段输入：k 为字段名，e 为输入事件（$event）
    onField(k, e) {
      this.$set(this.form, k, e.detail.value);
    },

    // 选择图片并上传到后端（HTTP 模式下图片存到后端，返回可访问 URL；本地模拟模式直接用临时路径）
    async chooseImage() {
      const r = await uni.chooseMedia({ count: 1, mediaType: ['image'] });
      const filePath = r.tempFiles[0].tempFilePath;
      const header = {};
      const token = uni.getStorageSync('shopToken');
      if (token) header['X-Shop-Token'] = token;
      uni.showLoading({ title: '上传中' });
      try {
        if (config.useMock) {
          // 本地模拟：无上传接口，暂用临时路径（重启后失效，仅演示用）
          uni.hideLoading();
          this.form.image = filePath;
          uni.showToast({ title: '已选择', icon: 'success' });
          return;
        }
        const up = await uni.uploadFile({
          url: config.apiBase + '/upload',
          filePath,
          name: 'file',
          header
        });
        const data = JSON.parse(up.data);
        if (data.success && data.data && data.data.url) {
          this.form.image = data.data.url;
          uni.hideLoading();
          uni.showToast({ title: '已上传', icon: 'success' });
        } else {
          uni.hideLoading();
          uni.showToast({ title: data.msg || '上传失败', icon: 'none' });
        }
      } catch (e) {
        uni.hideLoading();
        uni.showToast({ title: '上传失败', icon: 'none' });
      }
    },

    // 保存菜品（新增 / 更新）
    async save() {
      // 防重复点击：后端 addDish 没有幂等键，连点两次会创建两道同名同价的菜
      if (this.saving) return;
      const f = this.form;
      if (!f.name || !f.price) {
        uni.showToast({ title: '请填写名称和价格', icon: 'none' });
        return;
      }
      // 价格必须是正数：后端 DishDto 有 @DecimalMin，这里提前拦一道给出可读提示
      if (!(Number(f.price) > 0)) {
        uni.showToast({ title: '价格必须大于 0', icon: 'none' });
        return;
      }
      const data = {
        name: f.name,
        price: Number(f.price),
        categoryId: f.categoryId,
        desc: f.desc,
        image: f.image
      };
      this.saving = true;
      try {
        if (this.editing) {
          data._id = f._id;
          await call('cloudMenu', 'updateDish', { data });
        } else {
          // 新增必须带上 shopId，否则云端会写到空店铺导致不显示
          await call('cloudMenu', 'addDish', { data, shopId: currentShopId() });
        }
            this.showForm = false;
        this.load();
      } catch (e) {
        uni.showToast({ title: '保存失败', icon: 'none' });
      } finally {
        this.saving = false;
      }
    },

    // 上/下架切换
    async toggle(d) {
      const status = d.status === 'on' ? 'off' : 'on';
      try {
        await call('cloudMenu', 'toggleDish', { _id: d._id, status });
        this.load();
      } catch (e) {
        uni.showToast({ title: '操作失败', icon: 'none' });
      }
    },

    // 删除菜品
    remove(id) {
      uni.showModal({
        title: '删除菜品',
        content: '确认删除该菜品？',
        success: async (r) => {
          if (r.confirm) {
            try {
              await call('cloudMenu', 'deleteDish', { _id: id });
              this.load();
            } catch (e) {
              uni.showToast({ title: '删除失败', icon: 'none' });
            }
          }
        }
      });
    },

    // 新增分类（弹窗输入）
    async addCategory() {
      const r = await uni.showModal({ title: '新增分类', editable: true, placeholderText: '分类名称' });
      if (r.confirm && r.content) {
        try {
          await call('cloudMenu', 'addCategory', {
            name: r.content,
            sort: this.categories.length,
            shopId: currentShopId()
          });
          this.load();
        } catch (e) {
          uni.showToast({ title: '添加失败', icon: 'none' });
        }
      }
    },

    // 删除分类（同时删除其下菜品）
    removeCategory(id) {
      uni.showModal({
        title: '删除分类',
        content: '将同时删除该分类下所有菜品，确认？',
        success: async (r) => {
          if (r.confirm) {
            try {
              await call('cloudMenu', 'deleteCategory', { _id: id });
              this.load();
            } catch (e) {
              uni.showToast({ title: '删除失败', icon: 'none' });
            }
          }
        }
      });
    },

    goCoupons() {
      uni.navigateTo({ url: '/pages/merchant/coupons/coupons' });
    }
  }
}
</script>

<style scoped>
/* pages/merchant/menu/menu.wxss */
.menu-manage { display: flex; flex-direction: column; height: 100vh; background: #f2f8f6; }

/* 分类条 */
.cat-bar { display: flex; align-items: center; background: #fff; padding: 16rpx; }
.cat-scroll { flex: 1; white-space: nowrap; }
.cat-chip {
  display: inline-flex; align-items: center;
  background: #f2f8f6; border-radius: 32rpx;
  padding: 12rpx 24rpx; margin-right: 16rpx; font-size: 26rpx;
}
.cat-del { color: #e74c3c; margin-left: 12rpx; font-size: 30rpx; }
.cat-add { color: var(--primary); font-size: 28rpx; padding-left: 12rpx; flex-shrink: 0; }

/* 菜品区 */
.dish-area { flex: 1; padding: 24rpx; }
.cat-title { font-weight: 700; font-size: 28rpx; margin: 16rpx 0 12rpx; color: #3e5e55; }
.dish-row {
  display: flex; align-items: center;
  background: #fff; border-radius: 16rpx;
  padding: 20rpx; margin-bottom: 16rpx;
}
.dish-thumb {
  width: 80rpx; height: 80rpx; line-height: 80rpx; text-align: center;
  border-radius: 12rpx; background: #eaf4fb; color: var(--primary);
  font-size: 34rpx; font-weight: 700; margin-right: 20rpx; flex-shrink: 0;
}
.dish-main { flex: 1; }
.dish-name { font-size: 30rpx; font-weight: 600; }
.dish-price { font-size: 26rpx; margin-top: 6rpx; }
.dish-ops { display: flex; flex-direction: column; align-items: flex-end; }
.op-tag {
  font-size: 22rpx; padding: 4rpx 14rpx; border-radius: 20rpx; margin-bottom: 10rpx;
}
.op-tag.on { background: #e8f8ee; color: #2ecc71; }
.op-tag.off { background: #f2f8f6; color: #5c786f; }
.op-btn { font-size: 24rpx; color: var(--primary); margin-top: 6rpx; }
.op-btn.del { color: #e74c3c; }
.empty { text-align: center; color: var(--muted); padding: 30rpx 0; }

/* 底部 */
.footer { padding: 16rpx 24rpx; background: #fff; display: flex; }
.add-btn { background: var(--primary); color: #fff; border-radius: 48rpx; }
.coupon-btn { background: #fff; color: var(--primary); border: 2rpx solid var(--primary); border-radius: 48rpx; margin-left: 16rpx; }

/* 编辑弹层 */
.mask { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 10; }
.sheet {
  position: fixed; left: 0; right: 0; bottom: 0;
  background: #fff; border-radius: 24rpx 24rpx 0 0; z-index: 11;
  padding: 32rpx; box-sizing: border-box;
}
.sheet-title { font-weight: 700; font-size: 32rpx; margin-bottom: 24rpx; }
.form-row { display: flex; align-items: center; margin-bottom: 24rpx; }
.form-label { width: 100rpx; font-size: 28rpx; color: #3e5e55; }
.form-input {
  flex: 1; background: #f2f8f6; border-radius: 12rpx; padding: 20rpx; font-size: 28rpx;
}
.picker { color: #183c34; }
.img-box {
  flex: 1; height: 140rpx; background: #f2f8f6; border-radius: 12rpx;
  display: flex; align-items: center; justify-content: center;
}
.img-prev { width: 140rpx; height: 140rpx; border-radius: 12rpx; }
.img-add { color: var(--muted); font-size: 26rpx; }
.cancel-btn { background: #f2f8f6; color: #3e5e55; border-radius: 48rpx; margin-top: 16rpx; }
</style>

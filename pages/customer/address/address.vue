<template>
<!-- pages/customer/address/address.vue —— 收货地址簿（本地存储，纯前端）
     结算页外卖模式从这里选地址，选完回填；也可独立管理（新增/编辑/删除/默认） -->
<view class="container">
  <view class="mode-note">{{isMember ? '会员地址同步至账号' : '访客地址仅保存在本机'}}</view>
  <view v-if="loading" class="empty">地址加载中…</view>
  <view v-else-if="error" class="error">{{error}}</view>
  <view v-else-if="list.length === 0" class="empty">还没有保存的收货地址</view>

  <view
    v-for="a in list"
    :key="a.id"
    class="addr-card"
    @tap="onSelect(a)"
  >
    <view class="addr-top">
      <text class="addr-name">{{a.name}}</text>
      <text class="addr-phone">{{a.phone}}</text>
      <text class="default-tag" v-if="a.isDefault">默认</text>
    </view>
    <view class="addr-detail">{{a.detail}}</view>
    <!-- 操作区：@tap.stop 阻断冒泡，避免触发整卡「选地址回填」 -->
    <view class="addr-ops" @tap.stop>
      <text class="op" v-if="!a.isDefault" @tap="onSetDefault(a)">设为默认</text>
      <text class="op" @tap="onEdit(a)">编辑</text>
      <text class="op danger" @tap="onRemove(a)">删除</text>
    </view>
  </view>

  <button class="primary-btn" @tap="openEditor()">+ 新增收货地址</button>

  <!-- 编辑/新增弹层 -->
  <view class="mask" v-if="showEditor" @tap="closeEditor"></view>
  <view class="sheet" v-if="showEditor">
    <view class="sheet-title">{{editing ? '编辑地址' : '新增地址'}}</view>
    <input class="fld" placeholder="收货人姓名" :value="form.name" @input="onF('name', $event)" />
    <input class="fld" placeholder="联系电话" type="number" :value="form.phone" @input="onF('phone', $event)" />
    <input class="fld" placeholder="收货地址（如：体育西路 101 号 2201 室）" :value="form.detail" @input="onF('detail', $event)" />
    <view class="def-row">
      <text>设为默认地址</text>
      <switch :checked="form.isDefault" color="#087c61" @change="onDef" />
    </view>
    <view class="sheet-foot">
      <button class="ghost-btn" @tap="closeEditor">取消</button>
      <button class="primary-btn sm" @tap="save">保存</button>
    </view>
  </view>
</view>
</template>

<script>
// pages/customer/address/address.js —— 会员云地址簿 / 访客本地地址簿
const { call } = require('@/common/cloud.js');
const session = require('@/common/session.js');
export default {
  data() {
    return {
      list: [],
      isMember: false,
      loading: false,
      error: '',
      // 来源页：from=confirm 表示是从结算页进来的，点选要回填并返回
      from: '',
      showEditor: false,
      editing: null,                                  // 编辑中的地址对象；null 表示新增
      form: { name: '', phone: '', detail: '', isDefault: false }
    };
  },

  // 页面生命周期放顶层（onLoad/onShow 不是事件处理函数，可顶层）
  onLoad(options) {
    this.from = options.from || '';
  },

  onShow() {
    this.load();
  },

  methods: {
    async load() {
      this.isMember = !!session.getUserId();
      this.error = '';
      this.loading = true;
      try {
        if (this.isMember) {
          if (!session.getMemberToken()) throw new Error('会员登录状态无效，请重新登录后管理地址');
          const res = await call('cloudAddress', 'list');
          const rows = Array.isArray(res.data) ? res.data : ((res.data && res.data.list) || []);
          this.list = rows.map(a => Object.assign({}, a, { id: a._id || a.id }));
        } else {
          // 游客地址存在本机 storage，早期数据可能只有 _id：这里统一补出 id，
          // 供模板 :key 直接使用。小程序端的 :key 不接受 `a._id || a.id` 这类表达式，
          // 写了会在编译期告警且 key 失效，列表项退化成按索引复用。
          const rows = uni.getStorageSync('addressBook') || [];
          this.list = rows.map(a => Object.assign({}, a, { id: a._id || a.id }));
        }
      } catch (e) {
        // A member's failed cloud request must never reveal or overwrite a guest address book.
        this.list = [];
        this.error = '会员地址加载失败：' + (e && e.message ? e.message : String(e));
      } finally {
        this.loading = false;
      }
    },

    saveGuestBook(list) {
      // 统一在这里补 id，保证内存里的 list 每条都有主键（模板 :key 依赖它）
      const rows = list.map(a => Object.assign({}, a, { id: a.id || a._id }));
      uni.setStorageSync('addressBook', rows);
      this.list = rows;
    },

    formBody(isDefault) {
      return {
        name: (this.form.name || '').trim(),
        phone: (this.form.phone || '').trim(),
        detail: (this.form.detail || '').trim(),
        isDefault: !!isDefault
      };
    },

    openEditor() {
      this.editing = null;
      this.form = { name: '', phone: '', detail: '', isDefault: false };
      this.showEditor = true;
    },

    onEdit(a) {
      this.editing = a;
      // 复制一份，保存时再回写，避免编辑中取消也污染原对象
      this.form = { name: a.name, phone: a.phone, detail: a.detail, isDefault: !!a.isDefault };
      this.showEditor = true;
    },

    closeEditor() { this.showEditor = false; },

    // 表单字段统一输入处理（name/phone/detail 共用）
    onF(key, e) { this.form[key] = e.detail.value; },

    onDef(e) { this.form.isDefault = e.detail.value; },

    async save() {
      const { name, phone, detail } = this.formBody(this.form.isDefault);
      if (!name || !phone || !detail) {
        uni.showToast({ title: '请填写完整信息', icon: 'none' });
        return;
      }
      try {
        if (this.isMember) {
          const body = this.formBody(this.form.isDefault || (!this.editing && this.list.length === 0));
          if (this.editing) {
            await call('cloudAddress', 'update', { id: this.editing._id || this.editing.id, data: body });
          } else {
            await call('cloudAddress', 'create', { data: body });
          }
          await this.load();
        } else {
          const list = (uni.getStorageSync('addressBook') || []).slice();
          if (this.form.isDefault) list.forEach(x => { x.isDefault = false; });
          if (this.editing) {
            const id = this.editing.id || this.editing._id;
            const target = list.find(x => (x.id || x._id) === id);
            if (target) Object.assign(target, { name, phone, detail, isDefault: this.form.isDefault });
          } else {
            list.push({ id: 'addr' + Date.now(), name, phone, detail, isDefault: this.form.isDefault || list.length === 0 });
          }
          this.saveGuestBook(list);
        }
        this.showEditor = false;
      } catch (e) {
        uni.showToast({ title: '地址保存失败：' + String(e).slice(0, 20), icon: 'none' });
      }
    },

    async onSetDefault(a) {
      try {
        if (this.isMember) {
          await call('cloudAddress', 'update', {
            id: a._id || a.id,
            data: { name: a.name, phone: a.phone, detail: a.detail, isDefault: true }
          });
          await this.load();
        } else {
          const id = a.id || a._id;
          const list = (uni.getStorageSync('addressBook') || []).map(x =>
            Object.assign({}, x, { isDefault: (x.id || x._id) === id }));
          this.saveGuestBook(list);
        }
      } catch (e) {
        uni.showToast({ title: '设置默认地址失败：' + String(e).slice(0, 18), icon: 'none' });
      }
    },

    onRemove(a) {
      uni.showModal({
        title: '删除地址',
        content: '确认删除该收货地址？',
        success: async r => {
          if (r.confirm) {
            try {
              if (this.isMember) {
                await call('cloudAddress', 'delete', { id: a._id || a.id });
                await this.load();
              } else {
                const id = a.id || a._id;
                const list = (uni.getStorageSync('addressBook') || []).filter(x => (x.id || x._id) !== id);
                this.saveGuestBook(list);
              }
            } catch (e) {
              uni.showToast({ title: '删除地址失败：' + String(e).slice(0, 18), icon: 'none' });
            }
          }
        }
      });
    },

    // 仅从结算页进来时点选才回填（管理场景下整卡点击不应跳走）
    onSelect(a) {
      if (this.from !== 'confirm') return;
      uni.setStorageSync('selectedAddress', { name: a.name, phone: a.phone, detail: a.detail });
      uni.navigateBack();
    }
  }
};
</script>

<style scoped>
/* pages/customer/address/address.wxss */
.container { padding: 24rpx; }
.mode-note { color: var(--muted); font-size: 22rpx; padding: 8rpx 4rpx 18rpx; }
.empty { text-align: center; color: var(--muted); padding: 120rpx 0; font-size: 28rpx; }
.error { color: #c0392b; background: #fff; border-radius: 16rpx; padding: 24rpx; font-size: 26rpx; }

.addr-card {
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx;
  margin-bottom: 20rpx;
}
.addr-top { display: flex; align-items: center; }
.addr-name { font-size: 30rpx; font-weight: 700; }
.addr-phone { font-size: 26rpx; color: #3e5e55; margin-left: 20rpx; }
/* 默认标签：红底白字，与外卖标签同一套视觉 */
.default-tag {
  font-size: 20rpx;
  color: #fff;
  background: #087c61;
  border-radius: 6rpx;
  padding: 2rpx 12rpx;
  margin-left: 16rpx;
}
.addr-detail { font-size: 26rpx; color: #4d6f65; margin-top: 12rpx; line-height: 1.5; }
.addr-ops { display: flex; justify-content: flex-end; margin-top: 16rpx; }
.op { font-size: 24rpx; color: var(--primary); margin-left: 32rpx; }
.op.danger { color: #c0392b; }

/* 编辑弹层 */
.mask {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,.5); z-index: 20;
}
.sheet {
  position: fixed; left: 0; right: 0; bottom: 0;
  background: #fff; border-radius: 24rpx 24rpx 0 0;
  padding: 32rpx; z-index: 21;
  box-sizing: border-box;
}
.sheet-title { font-size: 32rpx; font-weight: 700; margin-bottom: 24rpx; }
.fld {
  background: #f2f8f6; border-radius: 12rpx;
  padding: 20rpx; margin-bottom: 16rpx; font-size: 28rpx;
}
.def-row {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 28rpx; padding: 12rpx 0 24rpx;
}
.sheet-foot { display: flex; align-items: center; }
.ghost-btn {
  flex: 1; background: #f2f8f6; color: #3e5e55;
  border-radius: 48rpx; margin-right: 20rpx; font-size: 28rpx;
}
.primary-btn.sm { width: 240rpx; margin: 0; }
</style>

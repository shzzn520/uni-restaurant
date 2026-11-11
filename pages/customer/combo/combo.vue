<template>
<!-- pages/customer/combo/combo.vue —— 「1+1 随心配」套餐选配页
     麦当劳风格：顶部门店定位栏 → 中间伪 3D 托盘（实时预览搭配）→ 红区/白区选一格 → 一口价入购物车 -->
<view class="page">

  <!-- ============ 门店定位栏 ============ -->
  <view class="locator">
    <view class="loc-left" @tap="openShopSheet">
      <text class="loc-pin">📍</text>
      <view class="loc-info">
        <view class="loc-name">{{currentShop.name || '正在定位…'}}</view>
        <view class="loc-meta">
          <text class="loc-dist" v-if="currentShop.distance">{{currentShop.distance}}</text>
          <text class="loc-addr" v-if="currentShop.address">{{currentShop.address}}</text>
        </view>
      </view>
      <text class="loc-switch">切换 ›</text>
    </view>
    <view class="loc-tabs">
      <text class="loc-tab active">到店取餐</text>
      <text class="loc-tab">外送</text>
    </view>
  </view>

  <!-- ============ 伪 3D 舞台 ============
       不用 transform-style: preserve-3d（微信真机 / Android X5 内核支持差，会被扁平化），
       改用纯 2D transform 叠加：托盘 scaleY 压扁出俯视透视感，
       物品靠 translateY 抬升 + drop-shadow 长度表达「高度」，效果等价但兼容性稳。 -->
  <view class="stage">
    <view class="stage-bg"></view>

    <!-- 托盘：压扁 + 底部径向阴影，营造「放在桌面上」 -->
    <view class="tray-shadow"></view>
    <image class="tray" src="/static/food/asset_tray.png" mode="aspectFit"></image>

    <!-- 红区选中物：主餐体量大，抬升较低，投影更实（离桌面近） -->
    <view class="ground ground-red" v-if="redPick"></view>
    <image class="figure fig-red" v-if="redPick"
           :src="redPick.image" mode="aspectFit"></image>

    <!-- 白区选中物：杯型瘦高，抬升更高，投影更虚更远（离桌面远） -->
    <view class="ground ground-white" v-if="whitePick"></view>
    <image class="figure fig-white" v-if="whitePick"
           :src="whitePick.image" mode="aspectFit"></image>

    <!-- 未选满时的占位提示 -->
    <view class="stage-tip" v-if="!ready">
      请选 {{!redPick ? '红区' : ''}}{{!redPick && !whitePick ? ' 和 ' : ''}}{{!whitePick ? '白区' : ''}}各 1 件
    </view>
  </view>

  <!-- ============ 套餐标题条 ============ -->
  <view class="combo-bar" v-if="combo.name">
    <view class="combo-title">
      <text class="combo-badge">超值</text>
      <text class="combo-name">{{combo.name}}</text>
    </view>
    <view class="combo-price"><text class="p-sign">¥</text>{{priceText}}</view>
  </view>

  <!-- ============ 选配区 ============ -->
  <view class="zones">
    <view class="zone" v-for="z in zones" :key="z.key">
      <view class="zone-head" :class="z.key">
        <text class="zone-name">{{z.name}}</text>
        <text class="zone-rule">任选 {{z.pick}} 件</text>
      </view>
      <view class="grid">
        <view class="cell" v-for="item in z.dishes" :key="item._id"
              :class="{on: isPicked(z.key, item._id)}" @tap="pick(z.key, item)">
          <view class="pic-wrap">
            <image class="pic" :src="item.image" mode="aspectFit"></image>
            <text class="tick" v-if="isPicked(z.key, item._id)">✓</text>
          </view>
          <view class="cname">{{item.name}}</view>
          <view class="cdesc">{{item.desc}}</view>
        </view>
      </view>
    </view>
  </view>

  <!-- ============ 底部结算条 ============ -->
  <view class="pay-bar">
    <view class="pay-info">
      <view class="pay-price">
        <text class="p-sign">¥</text>{{totalText}}
        <text class="pay-qty" v-if="qty > 1">（{{qty}} 份）</text>
      </view>
      <view class="pay-sel">{{selText}}</view>
    </view>
    <view class="pay-stepper">
      <text class="ps-btn" @tap="dec">-</text>
      <text class="ps-num">{{qty}}</text>
      <text class="ps-btn" @tap="inc">+</text>
    </view>
    <view class="pay-btn" :class="{disabled: !ready}" @tap="addCombo">加入购物车</view>
  </view>

  <!-- ============ 门店切换弹层 ============ -->
  <view class="mask" v-if="showShopSheet" @tap="closeShopSheet"></view>
  <view class="sheet" :class="{up: showShopSheet}">
    <view class="sheet-title">选择门店</view>
    <view class="sheet-list">
      <view class="sheet-row" v-for="s in shops" :key="s._id" @tap="chooseShop(s)">
        <view class="sr-main">
          <view class="sr-name">{{s.name}}</view>
          <view class="sr-addr" v-if="s.address">{{s.address}}</view>
        </view>
        <text class="sr-dist" v-if="s.distance">{{s.distance}}</text>
        <text class="sr-cur" v-if="s._id === shopId">当前</text>
      </view>
    </view>
  </view>

  <view class="safe-bottom"></view>
</view>
</template>

<script>
// pages/customer/combo/combo.js —— 套餐选配逻辑
const { call } = require('@/common/cloud.js');
const { yuan } = require('@/common/format.js');
const app = getApp();

// 单行套餐数量上限，与 menu.vue / 后端 OrderService 的 99 保持一致
const MAX_QTY = 99;

export default {
  data() {
    return {
      shopId: '',          // 当前门店
      shops: [],           // 门店列表
      showShopSheet: false,// 门店切换弹层
      currentShop: {},     // 当前门店展示信息

      combo: {},           // 套餐整体：{name, price, zones}
      zones: [],           // 分区：红区 / 白区
      picks: {},           // 选择结果：{ red: dishId, white: dishId }
      pickedMap: {},       // 分区 → 已选商品对象，供舞台上图
      qty: 1,              // 本次要加入的份数

      loading: false
    };
  },

  computed: {
    // 红区已选商品对象
    redPick() { return this.pickedMap.red || null; },
    // 白区已选商品对象
    whitePick() { return this.pickedMap.white || null; },
    // 两个区都选好才允许加购
    ready() { return !!(this.pickedMap.red && this.pickedMap.white); },
    priceText() { return Number(this.combo.price || 0).toFixed(2); },
    // 底部展示的是「单价 × 份数」
    totalText() {
      return (Number(this.combo.price || 0) * (this.qty || 1)).toFixed(2);
    },
    // 底部结算条上的已选摘要
    selText() {
      if (!this.redPick && !this.whitePick) return '红白两区各选 1 件，一口价';
      const parts = [];
      if (this.redPick) parts.push(this.redPick.name);
      if (this.whitePick) parts.push(this.whitePick.name);
      return parts.join(' + ');
    }
  },

  onLoad(options) {
    // 支持扫码带参进入：?shopId=xxx
    const shopId = (options && options.shopId)
      || app.globalData.shopId
      || uni.getStorageSync('shopId')
      || 'demo-shop';
    this.shopId = shopId;
    app.globalData.shopId = shopId;
    uni.setStorageSync('shopId', shopId);

    this.fetchShops();
    this.fetchCombo();
  },

  methods: {
    // ---------- 数据拉取 ----------
    async fetchShops() {
      try {
        const res = await call('cloudShop', 'list', {});
        const shops = (res.data && res.data.shops) || [];
        this.shops = shops;
        this.syncCurrentShop();
      } catch (e) {
        // 门店列表拿不到不影响选餐，用单店信息兜底
        console.warn('[combo] 门店列表加载失败', e);
      }
    },

    async fetchCombo() {
      if (this.loading) return;
      this.loading = true;
      uni.showLoading({ title: '加载中' });
      try {
        const res = await call('cloudCombo', 'get', { shopId: this.shopId });
        const d = res.data || {};
        this.combo = { name: d.name, price: d.price };
        this.zones = d.zones || [];
        this.resetPicks();
        if (d.name) uni.setNavigationBarTitle({ title: d.name });
      } catch (e) {
        uni.showToast({ title: '套餐加载失败', icon: 'none' });
      } finally {
        uni.hideLoading();
        this.loading = false;
      }
    },

    // 每个分区默认选中第一件，避免舞台空着
    resetPicks() {
      const picks = {};
      const map = {};
      this.zones.forEach(z => {
        if (z.dishes && z.dishes.length) {
          picks[z.key] = z.dishes[0]._id;
          map[z.key] = z.dishes[0];
        }
      });
      this.picks = picks;
      this.pickedMap = map;
    },

    // ---------- 选配 ----------
    // 单选：同区再点同一件不取消（套餐必须选满），点其它件则替换
    pick(zoneKey, item) {
      const picks = Object.assign({}, this.picks);
      const map = Object.assign({}, this.pickedMap);
      picks[zoneKey] = item._id;
      map[zoneKey] = item;
      this.picks = picks;
      this.pickedMap = map;
    },

    isPicked(zoneKey, id) {
      return this.picks[zoneKey] === id;
    },

    // ---------- 加入购物车 ----------
    // 与 menu.vue 共用 cart_<shopId> 结构：{ key: { dish:{_id,name,price,image}, qty } }
    // 同一组合会合并数量，换搭配则独立成行，confirm.vue 无需改动即可结算
    addCombo() {
      if (!this.ready) {
        const lack = [];
        if (!this.redPick) lack.push('红区');
        if (!this.whitePick) lack.push('白区');
        uni.showToast({ title: '请先选择' + lack.join('和'), icon: 'none' });
        return;
      }
      const shopId = this.shopId;
      const cart = uni.getStorageSync('cart_' + shopId) || {};
      // 虚拟商品 ID：combo@<红区菜品id>@<白区菜品id>
      // 分隔符用 @ 是因为菜品 ID 本身含连字符（如 demo-shop-d9），用 - 拼会切不开。
      // 服务端靠这个 ID 反查组合、重算名称与价格，前端传的 name/price 仅供参考展示。
      const key = 'combo@' + this.redPick._id + '@' + this.whitePick._id;
      const name = this.combo.name + '（' + this.redPick.name + ' + ' + this.whitePick.name + '）';
      const dish = {
        _id: key,
        name: name,
        price: Number(this.combo.price) || 0,
        image: this.redPick.image,
        desc: '红区：' + this.redPick.name + ' / 白区：' + this.whitePick.name,
        isCombo: true
      };
      const qty = this.qty || 1;
      // 合并后不能超过单行上限（与后端 OrderService 的 99 一致）：
      // 上一轮已加过同一个组合时，这一步会拦下超量的部分
      const already = cart[key] ? cart[key].qty : 0;
      if (already + qty > MAX_QTY) {
        uni.showToast({ title: '该套餐最多 ' + MAX_QTY + ' 份', icon: 'none' });
        // 把步进器下调到「还能加的数量」，用户不用自己心算
        this.qty = Math.max(1, MAX_QTY - already);
        return;
      }
      if (cart[key]) {
        cart[key].qty += qty;
      } else {
        cart[key] = { dish, qty };
      }
      uni.setStorageSync('cart_' + shopId, cart);

      // 加完留在本页：同行的人可能要再来一份不同搭配，强制跳走反而不方便。
      // 用 showModal 给一次「去结算」的机会，用户也可以关掉继续搭配。
      const addQty = qty;
      this.qty = 1;
      uni.showModal({
        title: '已加入购物车',
        content: addQty + ' 份「' + name + '」，合计 ¥' + (Number(this.combo.price) * addQty).toFixed(2)
          + '\n购物车现有 ' + this.countCart(cart) + ' 件',
        confirmText: '去结算',
        cancelText: '继续搭配',
        success(res) {
          if (res.confirm) {
            uni.navigateTo({ url: '/pages/customer/confirm/confirm' });
          }
        }
      });
    },

    // 统计购物车总件数，用于弹窗里告诉顾客「现在一共几件」
    countCart(cart) {
      let n = 0;
      Object.keys(cart).forEach(k => { n += cart[k].qty; });
      return n;
    },

    // 份数加减。到上限时给一次提示而不是静默不动，
    // 否则用户连点 + 看不到反应会以为界面卡死
    inc() {
      if (this.qty >= MAX_QTY) {
        uni.showToast({ title: '该套餐最多 ' + MAX_QTY + ' 份', icon: 'none' });
        return;
      }
      this.qty = this.qty + 1;
    },
    dec() { if (this.qty > 1) this.qty = this.qty - 1; },

    // ---------- 门店切换 ----------
    openShopSheet() { this.showShopSheet = true; },
    closeShopSheet() { this.showShopSheet = false; },

    chooseShop(s) {
      if (s._id === this.shopId) { this.showShopSheet = false; return; }
      this.shopId = s._id;
      app.globalData.shopId = s._id;
      uni.setStorageSync('shopId', s._id);
      this.showShopSheet = false;
      this.syncCurrentShop();
      // 换店后菜单可能不同，重新拉套餐并重置选择
      this.fetchCombo();
      uni.showToast({ title: '已切换到 ' + s.name, icon: 'none' });
    },

    // 同步顶部展示的门店信息（列表内有则从列表取，否则用单店接口回查）
    syncCurrentShop() {
      const hit = this.shops.find(s => s._id === this.shopId);
      if (hit) {
        this.currentShop = hit;
      } else {
        call('cloudShop', 'get', { shopId: this.shopId })
          .then(res => { this.currentShop = res.data || {}; })
          .catch(() => { this.currentShop = { name: '演示门店' }; });
      }
    },

    fmt(n) { return yuan(n); }
  }
}
</script>

<style scoped>
/* ================= 页面容器 ================= */
.page {
  min-height: 100vh;
  background: #f2f8f6;
  padding-bottom: 200rpx; /* 给底部结算条留位置 */
}

/* ================= 门店定位栏 ================= */
.locator {
  background: linear-gradient(180deg, #087c61 0%, #C41F14 100%);
  padding: 24rpx 28rpx 0;
  color: #fff;
}
.loc-left {
  display: flex;
  align-items: center;
}
.loc-pin { font-size: 34rpx; margin-right: 12rpx; }
.loc-info { flex: 1; overflow: hidden; }
.loc-name {
  font-size: 32rpx;
  font-weight: 700;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.loc-meta {
  margin-top: 6rpx;
  font-size: 22rpx;
  opacity: .85;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.loc-dist {
  background: rgba(255, 199, 44, .22);
  color: #FFC72C;
  padding: 2rpx 10rpx;
  border-radius: 6rpx;
  margin-right: 12rpx;
}
.loc-switch { font-size: 24rpx; opacity: .9; padding-left: 16rpx; }

.loc-tabs { display: flex; margin-top: 20rpx; }
.loc-tab {
  padding: 0 28rpx 18rpx;
  font-size: 26rpx;
  opacity: .65;
  position: relative;
}
.loc-tab.active { opacity: 1; font-weight: 700; }
.loc-tab.active::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 6rpx;
  width: 40rpx;
  height: 6rpx;
  margin-left: -20rpx;
  border-radius: 3rpx;
  background: #FFC72C;
}

/* ================= 伪 3D 舞台 ================= */
.stage {
  position: relative;
  height: 380rpx;
  overflow: hidden;
  background: linear-gradient(180deg, #C41F14 0%, #fff 62%, #fff 100%);
}
.stage-bg {
  position: absolute;
  left: 50%;
  top: 250rpx;
  width: 620rpx;
  height: 620rpx;
  margin-left: -310rpx;
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(0, 0, 0, .07), rgba(0, 0, 0, 0) 70%);
}

/* 托盘：scaleY 压扁产生俯视透视；再给一点 rotate 让构图不呆板 */
.tray-shadow {
  position: absolute;
  left: 50%;
  top: 268rpx;
  width: 460rpx;
  height: 90rpx;
  margin-left: -230rpx;
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(0, 0, 0, .30), rgba(0, 0, 0, 0) 72%);
}
.tray {
  position: absolute;
  left: 50%;
  top: 128rpx;
  width: 520rpx;
  height: 210rpx;
  margin-left: -260rpx;
  transform: scaleY(.62) rotate(-2deg);
  transform-origin: 50% 50%;
}

/* 接触阴影：与对应图层同 x 座标，贴着托盘面，让物品「站住」而不是「飘着」 */
.ground {
  position: absolute;
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(0, 0, 0, .34), rgba(0, 0, 0, 0) 70%);
}
.ground-red { left: 152rpx; top: 258rpx; width: 210rpx; height: 54rpx; }
.ground-white { left: 372rpx; top: 244rpx; width: 120rpx; height: 42rpx; }

/* 选中食物本体：translateY 抬升量 + 投影长度共同表达「离桌面高度」 */
.figure {
  position: absolute;
}
.fig-red {
  left: 92rpx;
  top: 150rpx;
  width: 230rpx;
  height: 170rpx;
  transform: translateY(-16px) rotate(-3deg);
}
.fig-white {
  left: 356rpx;
  top: 74rpx;
  width: 120rpx;
  height: 180rpx;
  transform: translateY(-10px) rotate(2deg);
}

.stage-tip {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 18rpx;
  text-align: center;
  font-size: 24rpx;
  color: #5c786f;
}

/* ================= 套餐标题条 ================= */
.combo-bar {
  margin: 20rpx 24rpx 0;
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx 28rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, .04);
}
.combo-title { display: flex; align-items: center; }
.combo-badge {
  background: #087c61;
  color: #fff;
  font-size: 20rpx;
  padding: 4rpx 10rpx;
  border-radius: 6rpx;
  margin-right: 14rpx;
}
.combo-name { font-size: 32rpx; font-weight: 700; color: #183c34; }
.combo-price { font-size: 46rpx; font-weight: 800; color: #087c61; }
.p-sign { font-size: 26rpx; margin-right: 2rpx; }

/* ================= 选配区 ================= */
.zones { padding: 20rpx 24rpx 0; }
.zone {
  background: #fff;
  border-radius: 16rpx;
  margin-bottom: 20rpx;
  overflow: hidden;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, .04);
}
.zone-head {
  padding: 20rpx 28rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #fff;
}
.zone-head.red { background: linear-gradient(90deg, #087c61, #0b9272); }
.zone-head.white { background: linear-gradient(90deg, #14526c, #3e5e55); }
.zone-name { font-size: 30rpx; font-weight: 700; }
.zone-rule { font-size: 22rpx; opacity: .85; }

.grid {
  display: flex;
  flex-wrap: wrap;
  padding: 12rpx 8rpx 20rpx;
}
.cell {
  width: 25%;
  padding: 16rpx 8rpx;
  box-sizing: border-box;
  text-align: center;
}
.pic-wrap {
  position: relative;
  width: 100%;
  height: 130rpx;
  border-radius: 12rpx;
  background: #f2f8f6;
  border: 2rpx solid transparent;
  overflow: hidden;
}
.cell.on .pic-wrap {
  border-color: #087c61;
  background: #FFF4F2;
}
.pic { width: 100%; height: 100%; }
.tick {
  position: absolute;
  right: 0;
  top: 0;
  width: 34rpx;
  height: 34rpx;
  line-height: 34rpx;
  text-align: center;
  background: #087c61;
  color: #fff;
  font-size: 22rpx;
  border-radius: 0 0 8rpx 0;
}
.cname {
  font-size: 24rpx;
  margin-top: 10rpx;
  color: #183c34;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.cell.on .cname { color: #087c61; font-weight: 600; }
.cdesc {
  font-size: 20rpx;
  color: #5c786f;
  margin-top: 4rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ================= 底部结算条 ================= */
.pay-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: 120rpx;
  background: #fff;
  box-shadow: 0 -4rpx 20rpx rgba(0, 0, 0, .08);
  display: flex;
  align-items: center;
  padding: 0 28rpx;
  z-index: 20;
}
.pay-info { flex: 1; overflow: hidden; }
.pay-price { font-size: 44rpx; font-weight: 800; color: #087c61; line-height: 1.1; }
.pay-sel {
  font-size: 22rpx;
  color: #5c786f;
  margin-top: 4rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pay-qty { font-size: 24rpx; font-weight: 400; margin-left: 8rpx; }

/* 份数步进器 */
.pay-stepper {
  display: flex;
  align-items: center;
  margin-right: 24rpx;
}
.ps-btn {
  width: 52rpx;
  height: 52rpx;
  line-height: 48rpx;
  text-align: center;
  border-radius: 50%;
  border: 2rpx solid #087c61;
  color: #087c61;
  font-size: 34rpx;
}
.ps-num { width: 56rpx; text-align: center; font-size: 30rpx; color: #183c34; }

.pay-btn {
  background: #FFC72C;
  color: #7A2E00;
  font-size: 30rpx;
  font-weight: 700;
  padding: 0 36rpx;
  height: 84rpx;
  line-height: 84rpx;
  border-radius: 42rpx;
}
.pay-btn.disabled { background: #dce9e4; color: #5c786f; }

/* ================= 门店弹层 ================= */
.mask {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, .5);
  z-index: 30;
}
.sheet {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  background: #fff;
  border-radius: 24rpx 24rpx 0 0;
  padding: 32rpx 28rpx 40rpx;
  z-index: 31;
  max-height: 70vh;
  box-sizing: border-box;
  transform: translateY(100%);
  transition: transform .25s ease;
}
.sheet.up { transform: translateY(0); }
.sheet-title { font-size: 32rpx; font-weight: 700; margin-bottom: 20rpx; }
.sheet-list { max-height: 52vh; }
.sheet-row {
  display: flex;
  align-items: center;
  padding: 24rpx 0;
  border-bottom: 1rpx solid #f2f8f6;
}
.sr-main { flex: 1; overflow: hidden; }
.sr-name { font-size: 28rpx; color: #183c34; }
.sr-addr { font-size: 22rpx; color: #5c786f; margin-top: 6rpx; }
.sr-dist { font-size: 24rpx; color: #087c61; margin-left: 16rpx; }
.sr-cur {
  font-size: 22rpx;
  color: #fff;
  background: #087c61;
  padding: 2rpx 12rpx;
  border-radius: 6rpx;
  margin-left: 16rpx;
}

.safe-bottom { height: 0; }
</style>

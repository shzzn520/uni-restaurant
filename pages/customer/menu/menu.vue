<template>
<!-- pages/customer/menu/menu.wxml -->
<view class="menu-page">
  <!-- 顶部店铺名 -->
  <view class="header">{{shopName}}</view>

  <!-- 搜索栏：输入关键词即切换为全菜单平面搜索（跨分类），清空回到分类视图 -->
  <view class="search-bar">
    <view class="search-box">
      <text class="search-icon">🔍</text>
      <input class="search-input" placeholder="搜索菜品，如「牛肉面」"
             :value="keyword" confirm-type="search" @input="onSearchInput" />
      <text v-if="keyword" class="search-clear" @tap="clearSearch">×</text>
    </view>
  </view>

  <!-- 空数据兜底：提示而非自动重置（避免误清空商家数据）。搜索态不走这里 -->
  <view v-if="menuList.length === 0 && !searching" class="empty-wrap">
    <view class="empty-tip">该店铺暂无上架菜品</view>
    <view class="empty-sub">可稍后重试，或联系商家在管理后台上架菜品</view>
  </view>

  <!-- 搜索结果：平面列表，命中关键字高亮（菜名/描述均参与匹配） -->
  <scroll-view v-if="searching" class="dish-list search-list" scroll-y>
    <view class="search-count" v-if="searchResults.length > 0">
      共 {{searchResults.length}} 个相关菜品
    </view>
    <view
      v-for="(item, index) in searchResults"
      :key="item._id"
      class="dish-item"
      :class="{ sold: isSoldOut(item) }"
      @tap="openDetail(item)"
    >
      <image v-if="item.image" class="dish-thumb" :src="item.image" mode="aspectFill"></image>
      <view v-else class="dish-thumb">{{item.name[0]}}</view>
      <view class="dish-info">
        <view class="dish-name">
          <text v-for="(s, si) in highlightSegs(item.name)" :key="si" :class="{ hit: s.hit }">{{s.t}}</text>
        </view>
        <view class="dish-desc ellipsis">
          <template v-if="item.desc">
            <text v-for="(s, si) in highlightSegs(item.desc)" :key="si" :class="{ hit: s.hit }">{{s.t}}</text>
          </template>
          <text v-else>暂无描述</text>
        </view>
        <view class="dish-meta">
          <text class="dish-price price">{{fmt(item.price)}}</text>
          <!-- 评分：来自评价汇总接口。没人评价过就不显示，避免出现「0.0 分」这种误导 -->
          <text class="dish-rate" v-if="ratingOf(item._id)">
            ★ {{ratingOf(item._id)}} · {{reviewCountOf(item._id)}} 条
          </text>
        </view>
      </view>
      <!-- 加购按钮：已售罄或已达单菜上限时置灰，避免点了才提示 -->
      <view class="dish-add" v-if="!isSoldOut(item)" :class="{off: atLimit(item._id)}" @tap.stop="quickAdd(item)">
        {{atLimit(item._id) ? '满' : '+'}}
      </view>
      <view class="sold-tag" v-else>已售罄</view>
    </view>
    <view v-if="searchResults.length === 0" class="empty">没有找到「{{keyword}}」相关菜品</view>
  </scroll-view>

  <!-- 主体：左侧分类 + 右侧菜品 -->
  <view class="body" v-if="menuList.length > 0 && !searching">
    <scroll-view class="cat-list" scroll-y>
      <view
        v-for="(item, index) in categories"
        :key="item._id"
        class="cat-item"
        :class="{ active: activeCat === index }"
        @tap="switchCat(index)"
      >{{item.name}}</view>
    </scroll-view>

    <scroll-view class="dish-list" scroll-y>
      <view
        v-for="(item, index) in menuList[activeCat].dishes"
        :key="item._id"
        class="dish-item"
        :class="{ sold: isSoldOut(item) }"
        @tap="openDetail(item)"
      >
        <image v-if="item.image" class="dish-thumb" :src="item.image" mode="aspectFill"></image>
        <view v-else class="dish-thumb">{{item.name[0]}}</view>
        <view class="dish-info">
          <view class="dish-name">{{item.name}}</view>
          <view class="dish-desc ellipsis">{{item.desc || '暂无描述'}}</view>
          <view class="dish-meta">
            <text class="dish-price price">{{fmt(item.price)}}</text>
            <!-- 评分：来自评价汇总接口。没人评价过就不显示，避免出现「0.0 分」这种误导 -->
            <text class="dish-rate" v-if="ratingOf(item._id)">
              ★ {{ratingOf(item._id)}} · {{reviewCountOf(item._id)}} 条
            </text>
          </view>
        </view>
        <!-- 加购按钮：已售罄或已达单菜上限时置灰，避免点了才提示 -->
        <view class="dish-add" v-if="!isSoldOut(item)" :class="{off: atLimit(item._id)}" @tap.stop="quickAdd(item)">
          {{atLimit(item._id) ? '满' : '+'}}
        </view>
        <view class="sold-tag" v-else>已售罄</view>
      </view>
      <view v-if="menuList[activeCat].dishes.length === 0" class="empty">该分类暂无可售商品</view>
    </scroll-view>
  </view>

  <!-- 底部购物车栏 -->
  <view class="cart-bar" :class="{ bump: bump }">
    <view class="cart-icon" @tap="toggleCart">
      <text>购物车</text>
      <text class="badge" v-if="cartCount">{{cartCount}}</text>
    </view>
    <view class="cart-total price">{{fmt(cartTotal)}}</view>
    <view class="checkout-btn" @tap="goConfirm">去结算</view>
  </view>

  <!-- 购物车弹层 -->
  <view class="mask" v-if="showCart" @tap="toggleCart"></view>
  <view class="sheet" v-if="showCart">
    <view class="sheet-head">
      <view class="sheet-title">已选商品（{{cartCount}} 件）</view>
      <text class="sheet-clear" v-if="cartItems.length > 0" @tap="clearCart">清空</text>
    </view>
    <scroll-view scroll-y class="sheet-list">
      <view v-for="(item, index) in cartItems" :key="item.id" class="sheet-row">
        <image v-if="item.dish.image" class="sheet-thumb" :src="item.dish.image" mode="aspectFill"></image>
        <view v-else class="sheet-thumb">{{item.dish.name[0]}}</view>
        <view class="sheet-name">{{item.dish.name}}</view>
        <view class="sheet-price price">{{fmt(item.dish.price)}}</view>
        <view class="stepper">
          <text class="step-btn" @tap="cartDec(item.id)">-</text>
          <text class="step-num">{{item.qty}}</text>
          <text class="step-btn" :class="{off: atLimit(item.id)}" @tap="cartInc(item.id)">+</text>
        </view>
      </view>
      <view v-if="cartItems.length === 0" class="empty">购物车是空的</view>
    </scroll-view>
  </view>

  <!-- 商品详情弹层 -->
  <view class="mask" v-if="showDetail" @tap="closeDetail"></view>
  <view class="sheet" v-if="showDetail">
    <image v-if="current.image" class="detail-thumb" :src="current.image" mode="aspectFill"></image>
    <view v-else class="detail-thumb">{{current.name[0]}}</view>
    <view class="detail-name">{{current.name}}</view>
    <view class="detail-rate" v-if="ratingOf(current._id)">
      <text class="dr-star">★ {{ratingOf(current._id)}}</text>
      <text class="dr-count">{{reviewCountOf(current._id)}} 条评价</text>
    </view>
    <view class="detail-desc">{{current.desc || '暂无描述'}}</view>

    <!-- 规格备注：进单条备注，商家端能看到（冷饮去冰之类） -->
    <view class="spec-wrap" v-if="!isSoldOut(current)">
      <view class="spec-title">规格要求（选填）</view>
      <view class="spec-tags">
        <text v-for="t in SPEC_TAGS" :key="t" class="spec-tag"
              :class="{on: spec === t}" @tap="toggleSpec(t)">{{t}}</text>
      </view>
    </view>

    <view class="detail-price price">{{fmt(current.price)}}</view>
    <view class="stepper detail-stepper">
      <text class="step-btn" @tap="dec">-</text>
      <text class="step-num">{{qty}}</text>
      <text class="step-btn" :class="{off: qty >= MAX_QTY}" @tap="inc">+</text>
    </view>
    <button class="primary-btn" @tap="addToCart" :disabled="atLimit(current._id)">
      {{atLimit(current._id) ? '已达单菜上限（' + MAX_QTY + ' 份）' : '加入购物车'}}
    </button>

    <!-- 该菜品的真实评价 -->
    <view class="review-block" v-if="reviews.length > 0">
      <view class="rv-title">顾客评价（{{reviews.length}}）</view>
      <view class="rv-item" v-for="r in reviews" :key="r._id">
        <view class="rv-stars">{{starsText(r.rating)}}</view>
        <view class="rv-content" v-if="r.content">{{r.content}}</view>
        <image v-for="(img, i) in splitImages(r.images)" :key="i" class="rv-img" :src="img" mode="aspectFill"></image>
        <!-- 商家回复：跟在评价下面，让后来的人看到「这家店会回应」，比只堆好评更有说服力 -->
        <view class="rv-reply" v-if="r.reply">
          <text class="rv-reply-tag">商家回复</text>
          <text class="rv-reply-text">{{r.reply}}</text>
        </view>
        <view class="rv-time">{{fmtDate(r.createTime)}}</view>
      </view>
    </view>
    <view class="review-empty" v-else>还没有人评价过这道菜</view>
  </view>
</view>
</template>



<script>
// pages/customer/menu/menu.js —— 分类菜单 + 商品详情 + 购物车
const { call } = require('@/common/cloud.js');
const app = getApp();

export default {

  data() {
    return {
    categories: [],     // 分类列表
    menuList: [],       // 按分类归组的 [{category, dishes}]
    activeCat: 0,       // 当前选中分类下标
    cart: {},           // 购物车：{ dishId: { dish, qty, spec } }
    cartCount: 0,       // 购物车商品总数
    cartTotal: 0,       // 购物车合计金额
    cartItems: [],      // 购物车扁平数组（供弹层渲染）
    showCart: false,    // 购物车弹层
    showDetail: false,  // 商品详情弹层
    current: null,      // 当前查看的商品
    qty: 1,             // 详情弹层内数量
    shopName: '',

    // ---------- 本轮新增：菜品搜索 ----------
    keyword: '',        // 搜索关键字；非空即切换到平面搜索结果

    // ---------- 本轮新增 ----------
    spec: '',             // 规格备注（去冰 / 微辣…）
    bump: false,          // 购物车角标抖动
    lastAddAt: 0,         // 上次快速加购的时间戳，用于连点防抖
    reviews: [],          // 当前商品的评价列表
    reviewStats: {},      // { dishId: {rating, count} }，列表页展示评分用
    // 单道菜数量上限。与后端 OrderService.priceItems 的 99 保持一致：
    // 前端拦一道是为了体验，后端那道才是硬约束
    MAX_QTY: 99,
    SPEC_TAGS: ['去冰', '少冰', '常温', '微辣', '不辣', '不要香菜', '多加葱']
    };
  },

  computed: {
    // 是否处于搜索态：关键字去空白后非空。
    // 计算属性而非 data 标志位——单一数据源，不会出现「keyword 非空但标志位没跟上」
    searching() {
      return (this.keyword || '').trim().length > 0;
    },

    /**
     * 搜索结果：把各分类的菜品拉平后按「菜名 / 描述」模糊匹配。
     *
     * 为什么在前端过滤而不另开接口：菜单是一次性全量拉下来的（演示规模
     * 十几到几十个菜），本地过滤零延迟、断网也能搜；真要按门店海量 SKU
     * 再改服务端搜索也不迟，页面这边只依赖 menuList 的结构不变。
     *
     * 售罄菜品同样参与结果并置灰显示，与分类视图的「不过滤、只置灰」保持一致。
     */
    searchResults() {
      const kw = (this.keyword || '').trim().toLowerCase();
      if (!kw) return [];
      const all = [];
      this.menuList.forEach(g => g.dishes.forEach(d => all.push(d)));
      return all.filter(d =>
        (d.name || '').toLowerCase().indexOf(kw) >= 0
        || (d.desc || '').toLowerCase().indexOf(kw) >= 0
      );
    }
  },

  onLoad() {
    this.loadMenu();
    const shopId = app.globalData.shopId || uni.getStorageSync('shopId') || 'demo-shop';
    this.shopName = uni.getStorageSync('shopName') || '菜单';
    this.loadCart();   // 先读回本地购物车，再统计
    this.calcCart();
    // 评分汇总与菜单并行拉，互不阻塞：拉不到评分只是少一行星级，菜单照常用
    this.loadReviewStats();
  },

  onShow() {
    // 从详情/套餐/结算返回时都要重新读一次：
    // combo 页与结算页会直接写 cart_<shopId>，只看内存会丢数据或把套餐项覆盖掉
    this.loadCart();
    this.calcCart();
  },

  methods: {
    // 替代原生 wxs 的金额格式化（uni-app 不支持 <wxs> 标签）
    fmt(n) {
      n = Number(n) || 0;
      return '¥' + n.toFixed(2);
    },

    // 时间戳 → 2026-10-20
    fmtDate(ts) {
      if (!ts) return '';
      const d = new Date(Number(ts));
      const pad = n => (n < 10 ? '0' : '') + n;
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    },

    // 评分 → ★★★☆☆ 文本
    starsText(n) {
      const filled = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
      return '★★★★★'.slice(0, filled) + '☆☆☆☆☆'.slice(0, 5 - filled);
    },

    // 晒单图是逗号分隔的多个路径
    splitImages(images) {
      if (!images) return [];
      return String(images).split(',').filter(s => s && s.trim());
    },

    // 取某道菜的均分；没有评价返回 0（调用处用 v-if 隐藏，不显示「0.0 分」）
    ratingOf(dishId) {
      const s = this.reviewStats[dishId];
      return s && s.count ? Number(s.rating) : 0;
    },
    reviewCountOf(dishId) {
      const s = this.reviewStats[dishId];
      return s ? s.count : 0;
    },

    /** 拉取评分汇总：一次拿到所有菜的均分与条数，避免逐菜查询 */
    async loadReviewStats() {
      const shopId = app.globalData.shopId || uni.getStorageSync('shopId') || 'demo-shop';
      try {
        const res = await call('cloudReview', 'summary', { shopId });
        const d = res.data || {};
        const map = {};
        (d.dishes || []).forEach(x => { map[x.dishId] = { rating: x.rating, count: x.count }; });
        this.reviewStats = map;
      } catch (e) {
        console.warn('[menu] 评分汇总加载失败：', e);
      }
    },

    // 拉取菜单（分类 + 上架菜品）
    async loadMenu() {
      const shopId = app.globalData.shopId || uni.getStorageSync('shopId') || 'demo-shop';
      try {
        const res = await call('cloudMenu', 'getShopMenu', { shopId, role: 'customer' });
        const categories = (res.data && res.data.categories) || [];
        const dishes = (res.data && res.data.dishes) || [];
        const menuList = categories.map(cat => ({
          category: cat,
          dishes: dishes.filter(d => d.categoryId === cat._id)
        }));
        this.categories = categories;
        this.menuList = menuList;
        // 当前分类可能是空的（菜品被整体移除后分类还在，例如「热销」），这时默认落位到
        // 第一个有菜的分类；否则一进菜单页就是「该分类暂无可售商品」，看着像加载失败。
        const firstNonEmpty = menuList.findIndex(m => m.dishes.length > 0);
        const current = menuList[this.activeCat];
        if (firstNonEmpty >= 0 && (!current || current.dishes.length === 0)) {
          this.activeCat = firstNonEmpty;
        }
      } catch (e) {
        // 真实原因不能吞：只弹「菜单加载失败」会让人无从下手（连不上后端 / 后端报错 /
        // 域名未放行，三种情况界面一模一样）。完整错误进控制台，toast 只补一个方向性提示。
        console.error('[menu] 菜单加载失败：', e);
        const raw = String(e || '');
        const hint = /无法连接后端|请确认后端已启动|网络|timeout|request:fail/i.test(raw)
          ? '（连不上后端）' : '';
        uni.showToast({ title: '菜单加载失败' + hint, icon: 'none' });
      }
    },

    // 切换分类
    switchCat(index) {
      this.activeCat = index;
    },

    // ---------- 搜索 ----------
    // 输入即搜（本地数据集小，无需防抖）；computed 自动重算结果
    onSearchInput(e) {
      this.keyword = e.detail.value;
    },

    // 清空关键字，回到分类视图
    clearSearch() {
      this.keyword = '';
    },

    /**
     * 把文本按关键字切成 [{t, hit}] 片段，供模板渲染高亮。
     *
     * 返回空片段时渲染一个空 text，比在模板里判空更简单；
     * 命中比较统一转小写，但切片用原文本，保证大小写原样展示。
     */
    highlightSegs(text) {
      if (text === undefined || text === null || text === '') return [{ t: '', hit: false }];
      const s = String(text);
      const kw = (this.keyword || '').trim();
      if (!kw) return [{ t: s, hit: false }];
      const lower = s.toLowerCase();
      const k = kw.toLowerCase();
      const out = [];
      let i = 0;
      while (i < s.length) {
        const idx = lower.indexOf(k, i);
        if (idx < 0) {
          out.push({ t: s.slice(i), hit: false });
          break;
        }
        if (idx > i) out.push({ t: s.slice(i, idx), hit: false });
        out.push({ t: s.slice(idx, idx + k.length), hit: true });
        i = idx + k.length;
      }
      return out;
    },

    // 是否售罄/下架：后端会把这类菜一并返回，前端置灰而不是让它从菜单里消失
    isSoldOut(dish) {
      return !!dish && !!dish.status && dish.status !== 'on';
    },

    // 该商品当前是否已达数量上限
    atLimit(dishId) {
      const it = this.cart[dishId];
      return !!it && it.qty >= this.MAX_QTY;
    },

    /**
     * 列表页「+」快速加购，不必先弹详情。
     *
     * <p>连点保护：180ms 内的重复点击忽略。手机上双击很容易连发，
     * 没有这道闸会一次加 2~3 份，用户往往到结算页才发现。
     */
    quickAdd(dish) {
      if (this.isSoldOut(dish)) {
        uni.showToast({ title: '该商品已售罄', icon: 'none' });
        return;
      }
      const now = Date.now();
      if (this.lastAddAt && now - this.lastAddAt < 180) return;
      this.lastAddAt = now;

      if (this.atLimit(dish._id)) {
        uni.showToast({ title: '单道菜最多 ' + this.MAX_QTY + ' 份', icon: 'none' });
        return;
      }
      const cart = this.cart;
      if (cart[dish._id]) {
        cart[dish._id].qty += 1;
      } else {
        cart[dish._id] = { dish: dish, qty: 1, spec: '' };
      }
      this.saveCart();
      this.calcCart();
      this.playBump();
    },

    // 购物车角标轻微弹跳，给一个「加进去了」的视觉反馈
    playBump() {
      this.bump = false;
      // 先置 false 再置 true，确保连续触发时动画能重新播放
      this.$nextTick(() => {
        this.bump = true;
        setTimeout(() => { this.bump = false; }, 320);
      });
    },

    // 打开商品详情
    openDetail(dish) {
      if (this.isSoldOut(dish)) {
        uni.showToast({ title: '该商品已售罄', icon: 'none' });
        return;
      }
      this.showDetail = true;
      this.current = dish;
      this.qty = 1;
      this.spec = '';
      this.loadDishReviews(dish._id);
    },

    closeDetail() {     this.showDetail = false; },

    // 拉取该菜品的评价列表（失败不打扰用户，弹层里显示「还没有人评价」）
    async loadDishReviews(dishId) {
      this.reviews = [];
      try {
        const res = await call('cloudReview', 'byDish', { dishId });
        this.reviews = (res.data || []).slice(0, 5);
      } catch (e) {
        console.warn('[menu] 评价加载失败：', e);
      }
    },

    // 规格标签单选：再点一次取消
    toggleSpec(t) {
      this.spec = this.spec === t ? '' : t;
    },

    // 详情内数量加减
    inc() {
      if (this.qty < this.MAX_QTY) this.qty = this.qty + 1;
    },
    dec() { if (this.qty > 1) this.qty = this.qty - 1; },

    // 加入购物车
    addToCart() {
      const dish = this.current;
      // 菜单数据是本地缓存的，可能已经过时；这里再挡一道，
      // 真正的拦截在后端下单接口（服务端会再校验一次 status）
      if (this.isSoldOut(dish)) {
        uni.showToast({ title: '该商品已售罄', icon: 'none' });
        return;
      }
      const qty = this.qty;
      const existing = this.cart[dish._id];
      // 合并后不能超上限：此时把详情里的数量下调到刚好用满，
      // 用户立刻能看到还能加多少，而不是被一次 toast 打断
      if (existing && existing.qty + qty > this.MAX_QTY) {
        this.qty = this.MAX_QTY - existing.qty;
        uni.showToast({ title: '单道菜最多 ' + this.MAX_QTY + ' 份', icon: 'none' });
        return;
      }

      const cart = this.cart;
      if (existing) {
        existing.qty += qty;
        // 同一道菜多次加购，规格以最后一次为准；
        // 不把多次规格拼起来，避免拼出「去冰 + 微辣」这类自相矛盾的要求
        if (this.spec) existing.spec = this.spec;
      } else {
        cart[dish._id] = { dish: dish, qty: qty, spec: this.spec };
      }
      this.showDetail = false;
      this.saveCart();
      this.calcCart();
      this.playBump();
      uni.showToast({ title: '已加入购物车', icon: 'success' });
    },

    // 购物车弹层内加减
    cartInc(id) {
      if (this.atLimit(id)) {
        uni.showToast({ title: '单道菜最多 ' + this.MAX_QTY + ' 份', icon: 'none' });
        return;
      }
      this.cart[id].qty++;
      this.saveCart();
      this.calcCart();
    },
    cartDec(id) {
      this.cart[id].qty--;
      if (this.cart[id].qty <= 0) delete this.cart[id];
      this.saveCart();
      this.calcCart();
    },

    // 一键清空购物车。二次确认：误触一次不该丢掉已选了半天的东西
    clearCart() {
      uni.showModal({
        title: '清空购物车',
        content: '将移除已选的全部商品，确定吗？',
        success: r => {
          if (!r.confirm) return;
          this.cart = {};
          this.saveCart();
          this.calcCart();
          this.showCart = false;
          uni.showToast({ title: '已清空', icon: 'none' });
        }
      });
    },

    toggleCart() {     this.showCart = !this.showCart; },

    // 持久化购物车
    /**
     * 读回本地购物车。
     *
     * 此前本页对 cart_<shopId> 「只写不读」：加购后杀掉小程序重进，车是空的，
     * 但结算页从 storage 读得到 → 菜单显示 0 件、结算页显示 N 件。
     * 从套餐页返回后再加购，还会把套餐行整块覆盖掉。
     */
    loadCart() {
      const shopId = app.globalData.shopId || uni.getStorageSync('shopId') || 'demo-shop';
      const saved = uni.getStorageSync('cart_' + shopId);
      this.cart = saved && typeof saved === 'object' ? saved : {};
    },

    saveCart() {
      const shopId = app.globalData.shopId || uni.getStorageSync('shopId') || 'demo-shop';
      uni.setStorageSync('cart_' + shopId, this.cart);
    },

    // 计算购物车数量与金额
    calcCart() {
      let count = 0, total = 0;
      const items = [];
      Object.keys(this.cart).forEach(id => {
        const it = this.cart[id];
        count += it.qty;
        // 金额统一保留两位，避免 0.1+0.2 的浮点误差在页面上累积
        total += it.qty * (Number(it.dish.price) || 0);
        items.push({ id, dish: it.dish, qty: it.qty, spec: it.spec || '' });
      });
      this.cartCount = count;
      this.cartTotal = Math.round(total * 100) / 100;
      this.cartItems = items;
    },

    // 去结算
    goConfirm() {
      if (this.cartCount === 0) {
        uni.showToast({ title: '购物车为空', icon: 'none' });
        return;
      }
      uni.navigateTo({ url: '/pages/customer/confirm/confirm' });
    }
  }
}
</script>
<style scoped>
/* pages/customer/menu/menu.wxss */
.menu-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #fff;
}
.header {
  height: 88rpx;
  line-height: 88rpx;
  text-align: center;
  font-weight: 700;
  font-size: 32rpx;
  background: var(--primary);
  color: #fff;
}
/* 搜索栏：贴店铺名下方，胶囊输入框（仿外卖 App 惯例） */
.search-bar {
  padding: 16rpx 24rpx;
  background: #fff;
  border-bottom: 1rpx solid #f2f8f6;
}
.search-box {
  display: flex;
  align-items: center;
  background: #f2f8f6;
  border-radius: 32rpx;
  padding: 12rpx 24rpx;
}
.search-icon { font-size: 26rpx; margin-right: 12rpx; }
.search-input { flex: 1; font-size: 26rpx; height: 44rpx; line-height: 44rpx; }
.search-clear {
  width: 36rpx; height: 36rpx; line-height: 32rpx; text-align: center;
  border-radius: 50%; background: #dce9e4; color: #fff; font-size: 26rpx;
}
.search-count {
  font-size: 24rpx; color: var(--muted);
  padding: 20rpx 0 8rpx;
}
/* 命中关键字：主题色加粗，一眼看到「为什么搜出这条」 */
.hit { color: var(--primary); font-weight: 700; }
.body {
  flex: 1;
  display: flex;
  overflow: hidden;
}
/* 左侧分类 */
.cat-list {
  width: 180rpx;
  background: #f2f8f6;
  height: 100%;
}
.cat-item {
  padding: 36rpx 12rpx;
  text-align: center;
  font-size: 28rpx;
  color: #3e5e55;
}
.cat-item.active {
  background: #fff;
  color: var(--primary);
  font-weight: 700;
  border-left: 6rpx solid var(--primary);
}
/* 右侧菜品 */
.dish-list {
  flex: 1;
  height: 100%;
  padding: 0 24rpx;
}
.dish-item {
  display: flex;
  align-items: center;
  padding: 24rpx 0;
  border-bottom: 1rpx solid #f2f8f6;
}
.dish-thumb {
  width: 96rpx;
  height: 96rpx;
  line-height: 96rpx;
  text-align: center;
  border-radius: 12rpx;
  background: #eaf4fb;
  color: var(--primary);
  font-size: 40rpx;
  font-weight: 700;
  margin-right: 20rpx;
  flex-shrink: 0;
}
.dish-info { flex: 1; overflow: hidden; }
.dish-name { font-size: 30rpx; font-weight: 600; }
.dish-desc { color: var(--muted); font-size: 24rpx; margin: 6rpx 0; }
/* 价格与评分同行：评分是弱信息，压小字号不抢价格的视觉层级 */
.dish-meta { display: flex; align-items: baseline; }
.dish-price { font-size: 30rpx; }
.dish-rate { font-size: 21rpx; color: #f5a623; margin-left: 14rpx; }
.dish-add {
  width: 56rpx;
  height: 56rpx;
  line-height: 52rpx;
  text-align: center;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  font-size: 40rpx;
  flex-shrink: 0;
}
/* 达上限：按钮变灰并把「+」换成「满」，让状态一眼可辨 */
.dish-add.off { background: #dce9e4; color: #fff; font-size: 24rpx; }
/* 售罄：整行降透明度并换成灰字，但保留在列表里不让菜单凭空变短 */
.dish-item.sold { opacity: .55; }
.dish-item.sold .dish-name,
.dish-item.sold .dish-desc,
.dish-item.sold .dish-price { color: #5c786f; }
.dish-item.sold .dish-thumb { filter: grayscale(1); }
.sold-tag {
  flex-shrink: 0;
  font-size: 22rpx;
  color: #5c786f;
  background: #f2f8f6;
  border: 1rpx solid #e2e2e2;
  border-radius: 20rpx;
  padding: 6rpx 16rpx;
}
.empty { text-align: center; color: var(--muted); padding: 60rpx 0; }

/* 空数据兜底 */
.empty-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80rpx 40rpx;
}
.empty-tip { color: var(--muted); font-size: 28rpx; margin-bottom: 24rpx; }
.load-btn { width: 400rpx; }

/* 底部购物车栏 */
.cart-bar {
  height: 100rpx;
  display: flex;
  align-items: center;
  background: #14526c;
  color: #fff;
  padding: 0 24rpx;
}
/* 加购反馈：整条栏轻微放大一下，320ms 后由 JS 摘掉 bump 类 */
.cart-bar.bump { animation: barBump .32s ease; }
@keyframes barBump {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.035); }
  100% { transform: scale(1); }
}
.cart-icon {
  position: relative;
  font-size: 28rpx;
  padding-right: 16rpx;
}
.badge {
  position: absolute;
  top: -10rpx;
  right: -6rpx;
  background: var(--primary);
  color: #fff;
  font-size: 20rpx;
  min-width: 32rpx;
  height: 32rpx;
  line-height: 32rpx;
  text-align: center;
  border-radius: 16rpx;
}
.cart-total { flex: 1; font-weight: 700; }
.checkout-btn {
  background: var(--primary);
  color: #fff;
  padding: 0 40rpx;
  height: 100rpx;
  line-height: 100rpx;
  font-size: 30rpx;
}

/* 弹层通用 */
.mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.5);
  z-index: 10;
}
.sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  background: #fff;
  border-radius: 24rpx 24rpx 0 0;
  z-index: 11;
  padding: 32rpx;
  max-height: 70vh;
  box-sizing: border-box;
}
.sheet-title { font-weight: 700; font-size: 32rpx; margin-bottom: 16rpx; }
.sheet-head { display: flex; justify-content: space-between; align-items: center; }
.sheet-clear { color: #5c786f; font-size: 26rpx; padding-left: 20rpx; }
.sheet-list { max-height: 50vh; }
.sheet-row {
  display: flex;
  align-items: center;
  padding: 20rpx 0;
  border-bottom: 1rpx solid #f2f8f6;
}
.sheet-thumb {
  width: 68rpx;
  height: 68rpx;
  line-height: 68rpx;
  text-align: center;
  border-radius: 10rpx;
  background: #eaf4fb;
  color: var(--primary);
  font-size: 30rpx;
  font-weight: 700;
  margin-right: 16rpx;
  flex-shrink: 0;
}
.sheet-name { flex: 1; font-size: 28rpx; }
.sheet-price { width: 140rpx; font-size: 28rpx; }

/* 步进器 */
.stepper {
  display: flex;
  align-items: center;
}
.step-btn {
  width: 52rpx;
  height: 52rpx;
  line-height: 48rpx;
  text-align: center;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  font-size: 36rpx;
}
.step-btn.off { background: #dce9e4; }
.step-num { width: 64rpx; text-align: center; font-size: 30rpx; }

/* 详情弹层内元素 */
.detail-thumb {
  width: 120rpx; height: 120rpx; line-height: 120rpx; text-align: center;
  border-radius: 16rpx; background: #eaf4fb; color: var(--primary);
  font-size: 52rpx; font-weight: 700; margin: 0 auto 16rpx;
}
.detail-name { text-align: center; font-size: 34rpx; font-weight: 700; }
.detail-rate { text-align: center; margin-top: 8rpx; }
.dr-star { color: #f5a623; font-size: 26rpx; }
.dr-count { color: var(--muted); font-size: 22rpx; margin-left: 10rpx; }
.detail-desc { text-align: center; color: var(--muted); font-size: 26rpx; margin: 8rpx 0; }
.detail-price { text-align: center; font-size: 36rpx; margin: 8rpx 0 16rpx; }
.detail-stepper { justify-content: center; margin-bottom: 24rpx; }

/* 规格要求：横向可换行的小标签，单选 */
.spec-wrap { margin: 20rpx 0; }
.spec-title { font-size: 26rpx; color: var(--muted); margin-bottom: 14rpx; }
.spec-tags { display: flex; flex-wrap: wrap; }
.spec-tag {
  font-size: 24rpx;
  color: #4d6f65;
  background: #f2f8f6;
  border: 1rpx solid #e8e8e8;
  border-radius: 26rpx;
  padding: 8rpx 22rpx;
  margin: 0 12rpx 12rpx 0;
}
.spec-tag.on {
  color: #fff;
  background: var(--primary);
  border-color: var(--primary);
}

/* 评价列表 */
.review-block {
  margin-top: 24rpx;
  padding-top: 20rpx;
  border-top: 1rpx solid #f2f8f6;
}
.rv-title { font-size: 28rpx; font-weight: 700; margin-bottom: 12rpx; }
.rv-item {
  padding: 14rpx 0;
  border-bottom: 1rpx solid #f2f8f6;
}
.rv-stars { color: #f5a623; font-size: 24rpx; letter-spacing: 2rpx; }
.rv-content { font-size: 26rpx; color: #183c34; margin-top: 8rpx; line-height: 1.5; }
.rv-img {
  width: 140rpx;
  height: 140rpx;
  border-radius: 10rpx;
  margin: 12rpx 12rpx 0 0;
}
.rv-time { font-size: 22rpx; color: #9bb2aa; margin-top: 8rpx; }
/* 商家回复：浅绿底，与顾客评价正文区分开，一眼能看出是谁说的 */
.rv-reply {
  margin-top: 10rpx;
  padding: 10rpx 14rpx;
  background: #e9f7ef;
  border-left: 6rpx solid #087c61;
  border-radius: 8rpx;
}
.rv-reply-tag {
  font-size: 20rpx;
  color: #087c61;
  font-weight: 600;
  margin-right: 10rpx;
}
.rv-reply-text { font-size: 24rpx; color: #224d61; line-height: 1.5; }
.review-empty {
  text-align: center;
  color: var(--muted);
  font-size: 24rpx;
  padding: 30rpx 0 10rpx;
}
</style>

// ===============================================================
// mixins/menu-cart.js —— 菜单页行为（分类 / 搜索 / 购物车 / 详情弹层）
// ===============================================================
// 从 menu.vue 抽出：页面只保留模板与样式，业务逻辑集中在这里。
// 购物车存储键与 combo、confirm 共用 cart_<shopId> 结构。
const { call } = require('@/common/cloud.js');
const app = getApp();

module.exports = {

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

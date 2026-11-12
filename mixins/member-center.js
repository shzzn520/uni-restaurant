// ===============================================================
// mixins/member-center.js —— 会员中心行为（储值 / 积分 / 券包）
// ===============================================================
// 从 member.vue 抽出：页面只保留模板与样式，资产与领券逻辑集中在这里。
const { call } = require('@/common/cloud.js');
const session = require('@/common/session.js');
const app = getApp();

// 常用充值档位。给固定档位比让用户自己输入数字更少犹豫
const RECHARGE_OPTIONS = [50, 100, 200, 500];

module.exports = {

  data() {
    return {
    logged: false,       // 是否已登录
    userId: '',           // 会员编号（手机号）
    profile: {},          // 会员档案
    phone: '',
    code: '',             // 短信验证码（6 位）
    countdown: 0,         // 重发倒计时（秒），>0 时按钮禁用
    sending: false,       // 验证码发送中
    nickname: '',
    submitting: false,    // 登录中
    recharging: false,    // 充值中
    amount: 100,          // 预选充值金额
    customAmount: '',     // 自定义金额输入
    templates: [],        // 领券中心
    myCoupons: { usable: [], used: [], expired: [] },
    tab: 'usable',
    // 「我的服务」入口的状态角标。'…' = 加载中，'--' = 接口失败，
    // 未登录时整个网格不渲染（登录卡片本身就是状态展示）。
    orderText: '查看',
    flashText: '抢购中',
    favText: '…',
    flashOrderText: '…',
    couponText: '…',
    addressText: '…'
    };
  },

  computed: {
    balanceText() {
      return Number(this.profile.balance || 0).toFixed(2);
    },
    // 累计消费去掉小数位尾巴，整数更好读
    spendText() {
      return Number(this.profile.totalSpend || 0).toFixed(0);
    },
    // 折扣率转「几折」：0.95 → 9.5，只用于展示，实际打折由服务端按 levelRate 算
    levelZhe() {
      const r = Number(this.profile.levelRate || 1);
      return Math.round(r * 100) / 10;
    },
    // 验证码按钮文案：倒计时期间显示剩余秒数，比单纯置灰更能说明还要等多久
    codeBtnText() {
      if (this.countdown > 0) return this.countdown + 's 后重发';
      return this.sending ? '发送中...' : '获取验证码';
    }
  },

  onLoad() {
    this.userId = session.getUserId();
    this.logged = !!this.userId;
    if (this.logged) {
      this.refresh();
    }
  },

  onShow() {
    // 从结算页返回时余额可能变了，进入时重新拉一次档案
    if (this.logged) this.refresh();
  },

  onUnload() {
    // 离开页面必须清定时器：否则页面销毁后回调仍在跑，会对着已卸载的实例赋值
    this.clearCountdown();
  },

  methods: {
    fmt(n) {
      n = Number(n) || 0;
      return '¥' + n.toFixed(2);
    },

    fmtDate(ts) {
      if (!ts) return '';
      const d = new Date(Number(ts));
      const pad = n => (n < 10 ? '0' : '') + n;
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    },

    shopId() {
      return app.globalData.shopId || uni.getStorageSync('shopId') || 'demo-shop';
    },

    // ---------- 登录 ----------
    onPhone(e) {
      const phone = e.detail.value;
      if (phone !== this.phone) this.code = '';
      this.phone = phone;
    },
    onCode(e) { this.code = e.detail.value; },
    onNickname(e) { this.nickname = e.detail.value; },

    /**
     * 发送登录验证码。
     *
     * 服务端负责 60 秒频控、每日 10 条上限与 5 分钟有效期；
     * 前端倒计时只是体验层，不能替代服务端限制（改客户端就能绕过）。
     */
    async sendCode() {
      if (this.sending || this.countdown > 0) return;
      const phone = (this.phone || '').trim();
      if (!/^1\d{10}$/.test(phone)) {
        uni.showToast({ title: '请输入 11 位手机号', icon: 'none' });
        return;
      }
      this.sending = true;
      try {
        const res = await call('cloudMember', 'sendCode', { phone, scene: 'login' });
        const d = (res && res.data) || {};
        this.startCountdown(Number(d.resendAfter) || 60);
        if (d.demoCode) {
          // 演示环境没有真实短信通道，服务端把码回传，这里自动填入省去手输
          this.code = d.demoCode;
          uni.showToast({ title: '演示验证码 ' + d.demoCode, icon: 'none' });
        } else {
          uni.showToast({ title: '验证码请求已受理', icon: 'none' });
        }
      } catch (e) {
        uni.showToast({ title: String(e).slice(0, 20) || '发送失败', icon: 'none' });
      } finally {
        this.sending = false;
      }
    },

    /** 启动重发倒计时（秒） */
    startCountdown(seconds) {
      this.clearCountdown();
      this.countdown = seconds;
      this.timer = setInterval(() => {
        if (this.countdown <= 1) {
          // 到 0 时 clearInterval 一起收掉，避免留下空转的定时器
          this.countdown = 0;
          this.clearCountdown();
          return;
        }
        this.countdown--;
      }, 1000);
    },

    /** 清理倒计时与定时器（重复发送 / 页面卸载都要调） */
    clearCountdown() {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    },

    /**
     * 微信一键登录 —— 按官方「小程序登录」时序：
     *   1. uni.login() 取临时 code（静默，不弹授权框）
     *   2. code 交后端 /auth/wx-login → jscode2session 换 openid
     *   3. 后端按 openid 查/建会员，返回自定义登录态（memberId）
     *   4. 前端把 memberId + 档案存 storage，后续业务请求自动携带
     */
    async wxLogin() {
      if (this.submitting) return;
      this.submitting = true;
      try {
        // 第 1 步：取 code。code 一次性、5 分钟有效，必须现取现用
        const lg = await new Promise((resolve, reject) => {
          uni.login({
            provider: 'weixin',
            success: resolve,
            fail: () => reject('uni.login 调用失败（请在微信小程序环境运行）')
          });
        });
        const code = lg.code || (lg.detail && lg.detail.code) || '';
        if (!code) throw '未获取到 code，请在微信小程序/开发者工具中运行';

        // 第 2~3 步：code 换登录态（后端完成 jscode2session + 会员开户）
        const res = await call('cloudMember', 'wxLogin', { code });
        const p = res.data || {};
        if (!p._id) throw '登录态返回异常';
        // 登录态必须两半齐全：memberId + memberToken。
        // 缺令牌时服务端会把后续所有会员操作（充值/查档案/券包）判为未登录，
        // 但界面已经切到「已登录」—— 就是个什么都干不了的假状态。
        // 微信一键登录曾漏发令牌（手机号登录正常），所以这里宁可当场失败
        // 也不要静默吞下去：问题暴露在登录那一刻，而不是散落到每个功能上。
        if (!p.memberToken) throw '服务端未签发会话令牌';

        // 第 4 步：存自定义登录态。
        // 必须走 saveLogin 而不是只存 memberId：登录返回里的 memberToken 要落盘，
        // 服务端现在凭令牌认人，没有它就享受不了余额与优惠券。
        session.saveLogin(p._id, p);
        this.userId = p._id;
        this.profile = p;
        this.logged = true;
        this.refresh();
        uni.showToast({ title: p.demo ? '登录成功（演示模式）' : '登录成功', icon: 'none' });
      } catch (e) {
        uni.showToast({ title: String(e).slice(0, 20) || '微信登录失败', icon: 'none' });
      } finally {
        this.submitting = false;
      }
    },

    async login() {
      const phone = (this.phone || '').trim();
      const code = (this.code || '').trim();
      if (!/^1\d{10}$/.test(phone)) {
        uni.showToast({ title: '请输入 11 位手机号', icon: 'none' });
        return;
      }
      // 前端先挡一道：验证码格式不对时没必要发请求，用户也能立刻知道缺什么
      if (!/^\d{6}$/.test(code)) {
        uni.showToast({ title: '请输入 6 位验证码', icon: 'none' });
        return;
      }
      this.submitting = true;
      try {
        const res = await call('cloudMember', 'login', { phone, code, nickname: this.nickname });
        const p = res.data || {};
        // 与微信登录同一条硬约束：没有会话令牌就不算登录成功
        // （两端下发字段曾经漂移过，这里做统一兜底）
        if (!p.memberToken) throw '服务端未签发会话令牌';
        // 同上：saveLogin 会一起保存服务端签发的 memberToken
        session.saveLogin(p._id || phone, p);
        this.userId = p._id || phone;
        this.profile = p;
        this.logged = true;
        // 登录成功后清掉验证码并停掉倒计时：已用过的码不会再用，留着只是脏状态
        this.code = '';
        this.clearCountdown();
        this.countdown = 0;
        this.refresh();
        uni.showToast({ title: '登录成功', icon: 'success' });
      } catch (e) {
        const message = String(e);
        if (/验证码已过期|验证码已使用|验证码错误次数过多/.test(message)) {
          this.code = '';
          uni.showToast({ title: '验证码已失效，请重新获取', icon: 'none' });
        } else {
          uni.showToast({ title: message.slice(0, 16) || '登录失败', icon: 'none' });
        }
      } finally {
        this.submitting = false;
      }
    },

    async doLogout() {
      const r = await new Promise(resolve => {
        uni.showModal({
          title: '退出登录',
          content: '已持有的优惠券会保留，重新登录后仍可使用',
          success: resolve,
          fail: () => resolve({ confirm: false })
        });
      });
      if (!r.confirm) return;

      // 先吊销服务端会话（2026-10-27 加）。
      // 此前只清本地 storage，服务端的 member_session 记录仍然有效 30 天——
      // 换手机、借用设备、令牌泄露之后旧令牌一直能用，等于「登了个假登录」。
      // 失败也不阻断：网络异常时用户仍然应该能退出本机登录，
      // 只是服务端令牌会留到过期（两害相权，本地退出更要紧）。
      try {
        await call('cloudMember', 'logout', {});
      } catch (e) {
        console.warn('[member] 服务端会话吊销失败，仅清本地登录态', e);
      }

      session.logout();
      this.logged = false;
      this.profile = {};
      this.userId = '';
      this.myCoupons = { usable: [], used: [], expired: [] };
      this.templates = [];
      // 服务入口角标一并归位，避免退出后仍显示上一位会员的数量
      this.orderText = '查看';
      this.flashText = '抢购中';
      this.favText = '…';
      this.flashOrderText = '…';
      this.couponText = '…';
      this.addressText = '…';
      uni.showToast({ title: '已退出', icon: 'none' });
    },

    // 跳资产流水页：余额/积分逐笔变动
    goBill() {
      uni.navigateTo({ url: '/pages/customer/bill/bill' });
    },

    // ---------- 我的服务入口与状态角标 ----------
    /** 各入口数量并行拉取；单个接口失败只把该项标成 '--'，不影响其他入口 */
    loadEntries() {
      if (!this.logged || !this.userId) return;
      this.favText = '…';
      this.flashOrderText = '…';
      this.addressText = '…';

      call('cloudFlash', 'favorites', { memberId: this.userId })
        .then(res => { this.favText = (res.data || []).length + ' 件'; })
        .catch(() => { this.favText = '--'; });

      call('cloudFlash', 'orders', { memberId: this.userId })
        .then(res => {
          const list = res.data || [];
          const pending = list.filter(o => o.status === 'pending').length;
          this.flashOrderText = pending > 0 ? (pending + ' 笔待支付') : (list.length + ' 笔');
        })
        .catch(() => { this.flashOrderText = '--'; });

      // 地址身份仅由 X-Member-Token 决定，无需传 memberId
      call('cloudAddress', 'list', {})
        .then(res => {
          const d = res.data;
          const list = Array.isArray(d) ? d : ((d && d.list) || []);
          this.addressText = list.length + ' 个';
        })
        .catch(() => { this.addressText = '--'; });

      call('cloudFlash', 'sessions', {})
        .then(res => {
          const active = ((res.data || {}).sessions || []).find(s => s.status === 'active');
          this.flashText = active ? (active.range + ' 抢购中') : '即将开抢';
        })
        .catch(() => { this.flashText = '抢购中'; });
    },

    goOrders() {
      uni.navigateTo({ url: '/pages/customer/orders/orders' });
    },

    goFlash() {
      uni.navigateTo({ url: '/pages/customer/flash/flash' });
    },

    goFlashOrders() {
      uni.navigateTo({ url: '/pages/customer/flashOrders/flashOrders' });
    },

    goFavorites() {
      uni.navigateTo({ url: '/pages/customer/favorites/favorites' });
    },

    goAddress() {
      uni.navigateTo({ url: '/pages/customer/address/address' });
    },

    /** 券包就在本页下方；个别端不支持 selector 时降级为文字提示 */
    scrollToCoupon() {
      uni.pageScrollTo({
        selector: '.coupon-section',
        duration: 300,
        fail: () => uni.showToast({ title: '优惠券在页面下方', icon: 'none' })
      });
    },

    // ---------- 拉数据 ----------
    async refresh() {
      await this.loadProfile();
      await this.loadTemplates();
      await this.loadMyCoupons();
      // 服务入口角标单独并行拉，失败只影响角标，不阻塞会员卡与券包
      this.loadEntries();
    },

    // 会员档案。失败不清登录态：可能是网络抖动，用户不该被踢出
    async loadProfile() {
      try {
        const res = await call('cloudMember', 'info', { userId: this.userId });
        this.profile = res.data || {};
        this.orderText = (this.profile.orderCount || 0) + ' 单';
        session.setProfile(this.profile);
      } catch (e) {
        console.warn('[member] 会员档案加载失败', e);
      }
    },

    async loadTemplates() {
      try {
        const res = await call('cloudCoupon', 'templates', {
          shopId: this.shopId(), userId: this.userId
        });
        this.templates = res.data || [];
      } catch (e) {
        console.warn('[member] 领券中心加载失败', e);
      }
    },

    async loadMyCoupons() {
      try {
        const res = await call('cloudCoupon', 'my', {
          shopId: this.shopId(), userId: this.userId
        });
        const d = res.data || {};
        this.myCoupons = {
          usable: d.usable || [],
          used: d.used || [],
          expired: d.expired || []
        };
        this.couponText = this.myCoupons.usable.length + ' 张可用';
      } catch (e) {
        console.warn('[member] 券包加载失败', e);
        this.couponText = '--';
      }
    },

    // ---------- 领券 ----------
    async claim(c) {
      if (!c.claimable) {
        uni.showToast({ title: '该券已领过或已领完', icon: 'none' });
        return;
      }
      try {
        await call('cloudCoupon', 'claim', { couponId: c._id, userId: this.userId });
        uni.showToast({ title: '领取成功', icon: 'success' });
        // 领取后模板的已领数与券包都会变，两个都重拉
        this.loadTemplates();
        this.loadMyCoupons();
      } catch (e) {
        uni.showToast({ title: String(e).slice(0, 16) || '领取失败', icon: 'none' });
        // 可能是并发下的限领冲突，重拉一次让界面归位
        this.loadTemplates();
      }
    },

    // ---------- 充值 ----------
    onCustomAmount(e) {
      this.customAmount = e.detail.value;
      // 填了自定义金额就取消档位高亮，避免两个位置都显示「选中 100」
      if (this.customAmount) this.amount = Number(this.customAmount) || 0;
    },

    async recharge() {
      const amt = Number(this.amount) || 0;
      if (amt <= 0) {
        uni.showToast({ title: '请选择或输入充值金额', icon: 'none' });
        return;
      }
      this.recharging = true;
      try {
        const res = await call('cloudMember', 'recharge', { userId: this.userId, amount: amt });
        this.profile = res.data || this.profile;
        session.setProfile(this.profile);
        this.customAmount = '';
        uni.showToast({ title: '充值成功', icon: 'success' });
      } catch (e) {
        uni.showToast({ title: String(e).slice(0, 16) || '充值失败', icon: 'none' });
      } finally {
        this.recharging = false;
      }
    }
  }
}

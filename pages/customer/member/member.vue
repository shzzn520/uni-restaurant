<template>
<!-- pages/customer/member/member.vue —— 会员中心
     储值余额 + 积分 + 我的券包 + 领券中心，四块合一 -->
<view class="container">

  <!-- ============ 未登录：登录入口 ============ -->
  <view class="login-wrap" v-if="!logged">
    <view class="login-card">
      <view class="lg-icon">👤</view>
      <view class="lg-title">登录会员</view>
      <view class="lg-desc">登录后可使用优惠券、储值余额与积分</view>
      <!-- 微信一键登录：uni.login 静默取 code（不弹授权框），按官方小程序登录时序走 -->
      <button class="wx-btn" @tap="wxLogin" :disabled="submitting">
        {{submitting ? '登录中...' : '微信一键登录'}}
      </button>
      <view class="lg-divider"><text>或使用手机号登录</text></view>
      <input class="lg-input" type="number" maxlength="11" placeholder="请输入手机号"
             :value="phone" @input="onPhone" />
      <!-- 验证码：手机号不能单独作为登录凭据，必须证明号码在你手上 -->
      <view class="code-row">
        <input class="lg-input code-input" type="number" maxlength="6" placeholder="请输入 6 位验证码"
               :value="code" @input="onCode" />
        <button class="code-btn" :class="{off: countdown > 0 || sending}"
                :disabled="countdown > 0 || sending" @tap="sendCode">{{codeBtnText}}</button>
      </view>
      <input class="lg-input" placeholder="昵称（选填）" :value="nickname" @input="onNickname" />
      <button class="primary-btn" @tap="login" :disabled="submitting">
        {{submitting ? '登录中...' : '立即登录'}}
      </button>
      <view class="lg-tip">验证码 5 分钟内有效；演示模式自动填入演示码，生产模式请填写收到的短信验证码</view>
      <view class="lg-services">登录后可使用：我的订单 · 优惠券 · 收藏 · 收货地址 · 限时抢购</view>
    </view>
  </view>

  <!-- ============ 已登录：会员卡 ============ -->
  <template v-else>
    <view class="vip-card">
      <view class="vip-top">
      <view class="vip-name">{{profile.nickname || '会员'}}</view>
      <view class="vip-level">{{profile.level || '普通会员'}}</view>
      </view>
      <!-- 账号主体：手机号登录时 userId 就是手机号，微信登录时用档案里的 phone -->
      <view class="vip-phone">账号 {{profile.phone || userId}}</view>
      <!-- 等级权益：折扣是真的会算进金额的，不是一句话术。
           后端 levelRate 与计价共用同一个来源，这里是它的展示面。 -->
      <view class="vip-benefit" v-if="profile.levelBenefit">
        {{profile.levelBenefit}}<text v-if="profile.levelRate && profile.levelRate < 1"> · 已享 {{levelZhe}} 折</text>
      </view>
      <view class="vip-balance">
        <text class="vb-label">储值余额</text>
        <view class="vb-num"><text class="vb-sign">¥</text>{{balanceText}}</view>
      </view>
      <view class="vip-stats">
        <view class="vs-item">
          <view class="vs-num">{{profile.points || 0}}</view>
          <view class="vs-label">积分</view>
        </view>
        <view class="vs-item">
          <view class="vs-num">{{profile.pointsValue || 0}}</view>
          <view class="vs-label">可抵 ¥</view>
        </view>
        <view class="vs-item">
          <view class="vs-num">{{profile.orderCount || 0}}</view>
          <view class="vs-label">消费次数</view>
        </view>
        <view class="vs-item">
          <view class="vs-num">¥{{spendText}}</view>
          <view class="vs-label">累计消费</view>
        </view>
      </view>
    </view>

    <!-- ============ 我的服务：入口 + 对应状态角标 ============ -->
    <view class="card service-card">
      <view class="block-title">我的服务</view>
      <view class="service-grid">
        <view class="service-item" @tap="goOrders">
          <view class="si-icon">🧾</view>
          <view class="si-name">我的订单</view>
          <view class="si-stat">{{orderText}}</view>
        </view>
        <view class="service-item" @tap="goFlash">
          <view class="si-icon">⚡</view>
          <view class="si-name">限时抢购</view>
          <view class="si-stat">{{flashText}}</view>
        </view>
        <view class="service-item" @tap="goFlashOrders">
          <view class="si-icon">🛒</view>
          <view class="si-name">抢购订单</view>
          <view class="si-stat">{{flashOrderText}}</view>
        </view>
        <view class="service-item" @tap="goFavorites">
          <view class="si-icon">♥</view>
          <view class="si-name">我的收藏</view>
          <view class="si-stat">{{favText}}</view>
        </view>
        <view class="service-item" @tap="scrollToCoupon">
          <view class="si-icon">🎟</view>
          <view class="si-name">优惠券</view>
          <view class="si-stat">{{couponText}}</view>
        </view>
        <view class="service-item" @tap="goAddress">
          <view class="si-icon">📍</view>
          <view class="si-name">收货地址</view>
          <view class="si-stat">{{addressText}}</view>
        </view>
      </view>
    </view>

    <!-- 充值 -->
    <view class="card">
      <view class="block-title">储值充值</view>
      <view class="amt-tags">
        <text v-for="a in RECHARGE_OPTIONS" :key="a" class="amt-tag"
              :class="{on: amount === a}" @tap="amount = a">{{a}} 元</text>
      </view>
      <input class="note-input" type="digit" placeholder="或输入自定义金额"
             :value="customAmount" @input="onCustomAmount" />
      <button class="primary-btn" @tap="recharge" :disabled="recharging">
        {{recharging ? '处理中...' : '立即充值 ¥' + (amount || 0)}}
      </button>
      <view class="tip-inline">演示环境直接加余额；真实项目应走支付回调</view>
    </view>

    <!-- ============ 资产流水入口 ============ -->
    <view class="card entry-card" @tap="goBill">
      <view class="block-title">资产流水</view>
      <view class="entry-row">
        <view class="entry-main">
          <view class="entry-name">余额与积分明细</view>
          <view class="entry-desc">充值、消费、赠分、退款逐笔可查，带变动后快照</view>
        </view>
        <view class="entry-arrow">›</view>
      </view>
    </view>

    <!-- ============ 领券中心 ============ -->
    <view class="card">
      <view class="block-title">领券中心</view>
      <view v-for="c in templates" :key="c._id" class="tpl">
        <view class="tpl-left">
          <view class="tpl-amount"><text class="tp-sign">¥</text>{{c.amount}}</view>
          <view class="tpl-cond">{{c.threshold > 0 ? '满 ' + c.threshold + ' 可用' : '无门槛'}}</view>
        </view>
        <view class="tpl-main">
          <view class="tpl-name">{{c.name}}</view>
          <view class="tpl-meta">有效期 {{c.validDays}} 天 · 限领 {{c.perUserLimit}} 张</view>
          <view class="tpl-meta" v-if="c.myClaimed > 0">已领 {{c.myClaimed}} 张</view>
        </view>
        <view class="tpl-btn" :class="{off: !c.claimable}"
              @tap="claim(c)">{{c.claimable ? '领取' : '已领完'}}</view>
      </view>
      <view class="empty" v-if="templates.length === 0">暂无可领优惠券</view>
    </view>

    <!-- ============ 我的券包 ============ -->
    <view class="card coupon-section">
      <view class="block-title">我的优惠券</view>

      <view class="tab-row">
        <text class="tab" :class="{on: tab === 'usable'}" @tap="tab = 'usable'">
          可用 ({{myCoupons.usable.length}})
        </text>
        <text class="tab" :class="{on: tab === 'used'}" @tap="tab = 'used'">
          已使用 ({{myCoupons.used.length}})
        </text>
        <text class="tab" :class="{on: tab === 'expired'}" @tap="tab = 'expired'">
          已过期 ({{myCoupons.expired.length}})
        </text>
      </view>

      <view v-for="c in myCoupons[tab]" :key="c._id" class="cp-item" :class="tab">
        <view class="cp-left">
          <view class="cp-amount"><text class="cp-sign">¥</text>{{c.amount}}</view>
          <view class="cp-cond">{{c.threshold > 0 ? '满 ' + c.threshold + ' 可用' : '无门槛'}}</view>
        </view>
        <view class="cp-main">
          <view class="cp-name">{{c.couponName}}</view>
          <view class="cp-exp">
            {{tab === 'usable' ? '有效期至 ' + fmtDate(c.expireAt)
              : (tab === 'used' ? '使用于 ' + fmtDate(c.useTime) : '已于 ' + fmtDate(c.expireAt) + ' 过期')}}
          </view>
        </view>
      </view>
      <view class="empty" v-if="myCoupons[tab].length === 0">
        {{tab === 'usable' ? '暂无优惠券，去上面领一张' : '暂无记录'}}
      </view>
    </view>

    <view class="logout" @tap="doLogout">退出登录</view>
  </template>
</view>
</template>

<script>
// pages/customer/member/member.js —— 会员中心：储值 + 积分 + 券包
const { call } = require('@/common/cloud.js');
const session = require('@/common/session.js');
const app = getApp();

// 常用充值档位。给固定档位比让用户自己输入数字更少犹豫
const RECHARGE_OPTIONS = [50, 100, 200, 500];

export default {

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
</script>

<style scoped>
/* pages/customer/member/member.wxss */
.container { padding-bottom: 60rpx; }
.card {
  background: #fff;
  border-radius: 20rpx;
  margin: 24rpx;
  padding: 28rpx;
}
.block-title { font-weight: 700; font-size: 30rpx; margin-bottom: 20rpx; }
.empty { text-align: center; color: var(--muted); font-size: 26rpx; padding: 50rpx 0; }

/* ---------- 我的服务入口（3 列网格 + 状态角标）---------- */
.service-grid { display: flex; flex-wrap: wrap; }
.service-item { width: 33.33%; box-sizing: border-box; text-align: center; padding: 18rpx 4rpx 22rpx; }
.si-icon { font-size: 42rpx; line-height: 1.2; }
.si-name { font-size: 25rpx; color: #183c34; margin-top: 8rpx; }
.si-stat { font-size: 20rpx; color: #087c61; margin-top: 4rpx; }
.vip-phone { font-size: 22rpx; opacity: .8; margin-top: 10rpx; }
.lg-services { font-size: 22rpx; color: #5c786f; margin-top: 20rpx; line-height: 1.5; }

/* ---------- 登录卡 ---------- */
.login-wrap { padding: 60rpx 40rpx; }
.login-card {
  background: #fff;
  border-radius: 20rpx;
  padding: 60rpx 40rpx 40rpx;
  text-align: center;
}
.lg-icon { font-size: 80rpx; margin-bottom: 20rpx; }
.lg-title { font-size: 36rpx; font-weight: 700; }
.lg-desc { color: var(--muted); font-size: 24rpx; margin: 12rpx 0 40rpx; }
.lg-input {
  background: #f2f8f6;
  border-radius: 12rpx;
  padding: 22rpx;
  font-size: 28rpx;
  margin-bottom: 20rpx;
}
.lg-tip { color: #9bb2aa; font-size: 22rpx; margin-top: 20rpx; }

/* 验证码行：输入框自适应剩余宽度，按钮固定宽并与之等高（80rpx） */
.code-row { display: flex; align-items: center; margin-bottom: 20rpx; }
/* 覆盖 .lg-input 的 margin-bottom，否则输入框比按钮高一截、行内对不齐。
   width:0 + min-width:0 是必须的：flex 子项默认 min-width:auto，
   输入框会按内在宽度撑开，把右侧按钮挤出卡片（H5 实测踩到）。 */
.code-input { flex: 1 1 0; width: 0; min-width: 0; margin: 0 16rpx 0 0; }
.code-btn {
  width: 210rpx;
  flex-shrink: 0;
  margin: 0;
  padding: 0;
  background: #FFC72C;
  color: #7A2E00;
  font-size: 24rpx;
  font-weight: 600;
  line-height: 80rpx;
  border-radius: 12rpx;
}
.code-btn::after { border: none; }
/* 倒计时/发送中：明确置灰，避免看起来还能点 */
.code-btn.off { background: #dce9e4; color: #5c786f; }

/* 微信一键登录按钮：微信品牌绿，与普通主按钮区分来源 */
.wx-btn {
  background: #07C160;
  color: #fff;
  border-radius: 44rpx;
  font-size: 30rpx;
  font-weight: 600;
  line-height: 88rpx;
  margin-bottom: 8rpx;
}
.wx-btn::after { border: none; }
/* 分隔线：中间嵌文字的横线 */
.lg-divider {
  display: flex;
  align-items: center;
  margin: 24rpx 0;
  color: #9bb2aa;
  font-size: 22rpx;
}
.lg-divider::before, .lg-divider::after {
  content: '';
  flex: 1;
  height: 1rpx;
  background: #dce9e4;
}
.lg-divider text { padding: 0 20rpx; }

/* ---------- 会员卡 ---------- */
.vip-card {
  background: linear-gradient(135deg, #14526c, #3e5e55);
  color: #fff;
  border-radius: 20rpx;
  margin: 24rpx;
  padding: 32rpx;
}
.vip-top { display: flex; justify-content: space-between; align-items: center; }
.vip-name { font-size: 34rpx; font-weight: 700; }
.vip-level {
  font-size: 22rpx;
  background: #FFC72C;
  color: #7A2E00;
  padding: 4rpx 16rpx;
  border-radius: 20rpx;
}
/* 等级权益说明：浅色底、不抢余额的视觉权重。
   注意底色必须不透明 —— 原先用 rgba(255,199,44,.22) 半透明压在 #14526c
   深色卡上，再配 #7A2E00 深棕文字，实际渲染出来几乎看不见。
   align-self 对非 flex 父级无效（.vip-card 不是 flex 容器），改用 inline-block 让它贴合文字宽度。 */
.vip-benefit {
  margin-top: 14rpx;
  font-size: 22rpx;
  color: #6B2D00;
  background: #FFE9A8;
  padding: 8rpx 16rpx;
  border-radius: 8rpx;
  display: inline-block;
}
.vip-balance { margin: 30rpx 0; }.vb-label { font-size: 24rpx; opacity: .8; }
.vb-num { font-size: 64rpx; font-weight: 800; line-height: 1.2; }
.vb-sign { font-size: 30rpx; margin-right: 4rpx; }
.vip-stats { display: flex; border-top: 1rpx solid rgba(255,255,255,.18); padding-top: 24rpx; }
.vs-item { flex: 1; text-align: center; }
.vs-num { font-size: 30rpx; font-weight: 700; }
.vs-label { font-size: 22rpx; opacity: .75; margin-top: 6rpx; }

/* ---------- 充值 ---------- */
.amt-tags { display: flex; flex-wrap: wrap; }
.amt-tag {
  font-size: 26rpx;
  padding: 12rpx 30rpx;
  border-radius: 30rpx;
  background: #f2f8f6;
  color: #4d6f65;
  margin: 0 16rpx 16rpx 0;
}
.amt-tag.on { background: var(--primary); color: #fff; }
.note-input {
  background: #f2f8f6;
  border-radius: 12rpx;
  padding: 20rpx;
  font-size: 28rpx;
  margin: 8rpx 0 24rpx;
}
.tip-inline { color: var(--muted); font-size: 22rpx; text-align: center; margin-top: 16rpx; }

/* ---------- 资产流水入口 ---------- */
.entry-row { display: flex; align-items: center; }
.entry-main { flex: 1; overflow: hidden; }
.entry-name { font-size: 28rpx; }
.entry-desc { font-size: 22rpx; color: var(--muted); margin-top: 6rpx; }
.entry-arrow { font-size: 40rpx; color: #dce9e4; margin-left: 16rpx; }

/* ---------- 券模板行 ---------- */
.tpl {
  display: flex;
  align-items: center;
  padding: 24rpx 0;
  border-bottom: 1rpx solid #f2f8f6;
}
.tpl-left {
  width: 160rpx;
  flex-shrink: 0;
  border-right: 1rpx dashed #dce9e4;
  text-align: center;
}
.tpl-amount { color: var(--primary); font-weight: 700; font-size: 40rpx; line-height: 1.1; }
.tp-sign { font-size: 22rpx; }
.tpl-cond { font-size: 20rpx; color: var(--muted); margin-top: 4rpx; }
.tpl-main { flex: 1; padding-left: 20rpx; overflow: hidden; }
.tpl-name { font-size: 28rpx; }
.tpl-meta { font-size: 22rpx; color: var(--muted); margin-top: 6rpx; }
.tpl-btn {
  flex-shrink: 0;
  font-size: 24rpx;
  color: #fff;
  background: var(--primary);
  border-radius: 26rpx;
  padding: 10rpx 28rpx;
}
.tpl-btn.off { background: #dce9e4; color: #fff; }

/* ---------- 我的券包 ---------- */
.tab-row { display: flex; border-bottom: 1rpx solid #f2f8f6; margin-bottom: 10rpx; }
.tab {
  flex: 1;
  text-align: center;
  font-size: 26rpx;
  color: var(--muted);
  padding: 16rpx 0;
}
.tab.on { color: var(--primary); font-weight: 700; }

.cp-item {
  display: flex;
  align-items: center;
  padding: 22rpx 0;
  border-bottom: 1rpx solid #f2f8f6;
}
/* 已使用/已过期整体压暗，视觉上一眼区分状态 */
.cp-item.used, .cp-item.expired { opacity: .5; }
.cp-left {
  width: 150rpx;
  flex-shrink: 0;
  border-right: 1rpx dashed #dce9e4;
  text-align: center;
}
.cp-amount { color: var(--primary); font-weight: 700; font-size: 38rpx; line-height: 1.1; }
.cp-sign { font-size: 20rpx; }
.cp-cond { font-size: 20rpx; color: var(--muted); margin-top: 4rpx; }
.cp-main { flex: 1; padding-left: 20rpx; overflow: hidden; }
.cp-name { font-size: 28rpx; }
.cp-exp { font-size: 22rpx; color: var(--muted); margin-top: 6rpx; }

.logout {
  text-align: center;
  color: var(--muted);
  font-size: 28rpx;
  padding: 40rpx 0;
}
</style>
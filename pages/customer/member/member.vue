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
// 会员中心行为见 mixins/member-center.js
const memberCenter = require('@/mixins/member-center.js');
export default { mixins: [memberCenter] };
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
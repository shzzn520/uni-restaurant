<template>
<!-- pages/customer/confirm/confirm.vue —— 订单确认 + 优惠结算 + 提交支付
     金额拆四行展示（原价 / 券减 / 余额抵 / 实付），
     与后端 OrderService.quote 的返回字段一一对应 -->
<view class="container">
  <!-- ============ 订单明细 ============ -->
  <view class="card">
    <view class="block-title">订单明细</view>
    <view v-for="(item, index) in items" :key="item.dishId" class="row"
          :class="{ stale: staleFlags[index] }">
      <view class="row-name">
        {{item.name}}
        <text class="stale-tag" v-if="staleFlags[index]">已下架</text>
      </view>
      <view class="row-qty">x{{item.qty}}</view>
      <view class="row-price price">{{fmt(item.price * item.qty)}}</view>
      <text class="row-del" v-if="staleFlags[index]" @tap.stop="removeItem(index)">移除</text>
    </view>
    <view class="stale-bar" v-if="hasStale">
      有商品已下架，移除后才能提交。失效商品的金额已不计入合计。
    </view>
  </view>

  <!-- ============ 优惠结算 ============ -->
  <view class="card">
    <view class="block-title">优惠结算</view>

    <!-- 优惠券行 -->
    <view class="kv tap" @tap="openCouponSheet">
      <text>优惠券</text>
      <view class="kv-right">
        <text class="coupon-picked" :class="{none: !pickedCouponId}">{{couponLabel}}</text>
        <text class="kv-arrow">›</text>
      </view>
    </view>

    <!-- 余额抵扣开关：默认关闭，不能替顾客默认花掉他的钱 -->
    <view class="kv" v-if="balance > 0">
      <view class="kv-left">
        <text>储值余额抵扣</text>
        <text class="kv-sub">可用 ¥{{fmt(balance)}}</text>
      </view>
      <switch :checked="useBalance" color="#087c61"
              @change="onToggleBalance" />
    </view>
    <view class="kv" v-else>
      <view class="kv-left">
        <text>储值余额抵扣</text>
        <text class="kv-sub">登录会员后可使用</text>
      </view>
      <text class="kv-link" @tap="goLogin">去登录 ›</text>
    </view>

    <!-- 积分抵现开关：与余额同理，是资产就不能替顾客默认花掉 -->
    <view class="kv" v-if="points >= 100">
      <view class="kv-left">
        <text>积分抵现</text>
        <text class="kv-sub">{{points}} 分 ≈ ¥{{pointsValue}}（每 100 分抵 1 元）</text>
      </view>
      <switch :checked="usePoints" color="#087c61"
              @change="onTogglePoints" />
    </view>
    <view class="kv" v-else-if="userId">
      <view class="kv-left">
        <text>积分抵现</text>
        <text class="kv-sub">当前 {{points}} 分，满 100 分可用</text>
      </view>
      <text class="kv-sub">—</text>
    </view>
  </view>

  <!-- ============ 金额明细 ============ -->
  <view class="card">
    <view class="block-title">费用明细</view>
    <amount-summary
      :rows="amountRows"
      total-label="实付金额"
      :total-amount="payAmount"
      :saved="savedAmount"
      :wait-label="mode === 'delivery' ? '预计送达' : '预计等候'"
      :wait-value="waitMinutes > 0 ? '约 ' + waitMinutes + ' 分钟' : ''"
    />
  </view>

  <!-- ============ 配送方式与备注 ============ -->
  <view class="card">
    <view class="block-title">配送方式</view>
    <!-- 双 tab：与首页入口一致；切换会改变配送费与等待文案，需重新试算 -->
    <view class="mode-tabs">
      <view class="mtab" :class="{on: mode === 'delivery'}" @tap="switchMode('delivery')">🛵 外卖配送</view>
      <view class="mtab" :class="{on: mode === 'pickup'}" @tap="switchMode('pickup')">🏪 到店自取</view>
    </view>
    <!-- 外卖：收货信息三件套。地址是骑手找到顾客的前提，
         服务端也会硬校验（绕过表单直接打接口下不了无地址单） -->
    <block v-if="mode === 'delivery'">
      <!-- 收货地址：优先从地址簿选择（带回填）；也保留手动填写兜底 -->
      <view class="addr-pick" @tap="goAddress">
        <view v-if="address" class="addr-picked">
          <view class="ap-top"><text class="ap-name">{{receiver}}</text><text class="ap-phone">{{phone}}</text></view>
          <view class="ap-detail">{{address}}</view>
        </view>
        <view v-else class="addr-empty">+ 选择收货地址</view>
        <text class="kv-arrow">›</text>
      </view>
      <view class="addr-quick" @tap="showManual = !showManual">
        {{showManual ? '收起手动填写' : '没有地址？手动填写'}}
      </view>
      <block v-if="showManual">
        <input class="addr-input" placeholder="收货人姓名" :value="receiver" @input="onField('receiver', $event)" />
        <input class="addr-input" placeholder="联系电话" type="number" :value="phone" @input="onField('phone', $event)" />
        <input class="addr-input" placeholder="收货地址（如：体育西路 101 号 2201 室）" :value="address" @input="onField('address', $event)" />
      </block>

      <!-- 配送时间：立即送 / 预约时段（外卖平台常见交互） -->
      <view class="block-sub">配送时间</view>
      <view class="mode-tabs sm">
        <view class="mtab" :class="{on: deliveryTimeMode === 'now'}" @tap="switchDTime('now')">立即送</view>
        <view class="mtab" :class="{on: deliveryTimeMode === 'book'}" @tap="switchDTime('book')">预约配送</view>
      </view>
      <view v-if="deliveryTimeMode === 'book'" class="slots">
        <view v-for="(s, i) in bookSlots" :key="i" class="slot"
              :class="{on: selectedSlot === s}" @tap="pickSlot(s)">{{s}}</view>
      </view>

      <view class="fee-tip">配送费 ¥5 · 商品满 ¥39 免配送费 · 金额以服务端计算为准</view>
    </block>
    <!-- 自取：桌号仅自取场景有意义（堂食遗存能力，与外卖共存） -->
    <view class="kv" v-else><text>桌号</text><text>{{tableNo || '未指定'}}</text></view>
    <view class="kv"><text>备注</text></view>
    <input class="note-input" placeholder="如：少辣、要香菜,多加葱（选填）" :value="note" @input="onNote" />
  </view>

  <button class="primary-btn" @tap="submit" :disabled="submitting || hasStale || !quoteOk || quoting">
    {{submitting ? '提交中...'
      : (items.length === 0 ? '购物车是空的'
      : (hasStale ? '请先移除下架商品'
      : (quoting ? '金额计算中...'
      : (!quoteOk ? '金额计算失败，请下拉重试'
      : (payAmount <= 0 ? '确认模拟支付 ¥0.00（全额抵扣）' : '提交订单并模拟支付 ' + fmt(payAmount))))))}}
  </button>
  <view class="tip">当前支付接口仅模拟订单支付，不会发起真实微信支付。接入限制见 README。</view>

  <!-- ============ 优惠券选择弹层 ============ -->
  <coupon-sheet
    :visible="showCouponSheet"
    :coupons="usableCoupons"
    :disabled-coupons="disabledCoupons"
    :picked-id="pickedCouponId"
    :loading="loadingCoupons"
    :formatter="fmtDate"
    @close="closeCouponSheet"
    @pick="pickCoupon"
    @member="goMember"
  />
</template>

<script>
// 结算页行为见 mixins/checkout.js
const checkout = require('@/mixins/checkout.js');
export default { mixins: [checkout] };
</script>

<style scoped>
/* pages/customer/confirm/confirm.wxss */
.block-title { font-weight: 700; font-size: 30rpx; margin-bottom: 16rpx; }
.row { display: flex; align-items: center; padding: 16rpx 0; }
.row-name { flex: 1; font-size: 28rpx; }
.row-qty { color: var(--muted); margin: 0 24rpx; font-size: 26rpx; }
.row-price { font-size: 28rpx; width: 160rpx; text-align: right; }

/* 已下架项：红字 + 灰底 + 可移除 */
.row.stale { background: #fff5f5; border-radius: 8rpx; }
.row.stale .row-name,
.row.stale .row-price { color: #c0392b; }
.stale-tag {
  font-size: 20rpx;
  color: #fff;
  background: #c0392b;
  border-radius: 4rpx;
  padding: 2rpx 8rpx;
  margin-left: 10rpx;
}
.row-del {
  font-size: 24rpx;
  color: #c0392b;
  margin-left: 16rpx;
  text-decoration: underline;
}
.stale-bar {
  font-size: 24rpx;
  color: #c0392b;
  background: #fff5f5;
  border-radius: 8rpx;
  padding: 16rpx 20rpx;
  margin-top: 12rpx;
  line-height: 1.5;
}
.kv { display: flex; justify-content: space-between; align-items: center; font-size: 28rpx; padding: 12rpx 0; }
.kv-left { display: flex; align-items: baseline; }
.kv-sub { color: var(--muted); font-size: 22rpx; margin-left: 12rpx; }
.kv-right { display: flex; align-items: center; }
.kv-arrow { color: #dce9e4; margin-left: 10rpx; font-size: 30rpx; }
.kv-link { color: var(--primary); font-size: 26rpx; }
.kv.tap:active { background: #f2f8f6; }
.coupon-picked { color: var(--primary); font-size: 26rpx; }
.coupon-picked.none { color: var(--muted); }


/* 配送方式双 tab */
.mode-tabs {
  display: flex;
  background: #f2f8f6;
  border-radius: 12rpx;
  padding: 6rpx;
  margin-bottom: 16rpx;
}
.mtab {
  flex: 1;
  text-align: center;
  font-size: 26rpx;
  padding: 14rpx 0;
  border-radius: 10rpx;
  color: #4d6f65;
}
.mtab.on { background: #fff; color: #087c61; font-weight: 700; }

/* 配送时间双 tab：复用 mode-tabs，缩窄一点 */
.mode-tabs.sm { margin-top: 8rpx; margin-bottom: 12rpx; }
.mode-tabs.sm .mtab { padding: 10rpx 0; }

/* 地址选择入口行（点击跳地址簿） */
.addr-pick {
  display: flex; align-items: center;
  background: #f2f8f6; border-radius: 12rpx;
  padding: 20rpx; margin-top: 12rpx;
}
.addr-picked { flex: 1; }
.ap-top { display: flex; align-items: baseline; }
.ap-name { font-size: 28rpx; font-weight: 600; }
.ap-phone { font-size: 26rpx; color: #3e5e55; margin-left: 16rpx; }
.ap-detail { font-size: 26rpx; color: #4d6f65; margin-top: 6rpx; line-height: 1.5; }
.addr-empty { flex: 1; font-size: 28rpx; color: var(--primary); }
.addr-quick { font-size: 24rpx; color: var(--muted); margin-top: 12rpx; }

/* 预约时段按钮组 */
.block-sub { font-size: 26rpx; color: #3e5e55; margin-top: 16rpx; }
.slots { display: flex; flex-wrap: wrap; gap: 16rpx; margin-top: 12rpx; }
.slot {
  font-size: 24rpx; color: #3e5e55;
  background: #f2f8f6; border-radius: 8rpx;
  padding: 12rpx 20rpx;
}
.slot.on { background: #eaf4fb; color: #087c61; border: 2rpx solid #087c61; font-weight: 600; }

/* 收货信息输入 */
.addr-input {
  background: #f2f8f6;
  border-radius: 12rpx;
  padding: 20rpx;
  margin-top: 12rpx;
  font-size: 28rpx;
}
.fee-tip {
  font-size: 22rpx;
  color: var(--muted);
  margin-top: 12rpx;
  line-height: 1.5;
}

.note-input {
  background: #f2f8f6;
  border-radius: 12rpx;
  padding: 20rpx;
  margin-top: 12rpx;
  font-size: 28rpx;
}
.tip { color: var(--muted); font-size: 24rpx; text-align: center; margin-top: 16rpx; }

</style>
<template>
<!--
THESIS: Delivery progress follows the store-updated order stages, not a decorative map or invented courier dot.
OWN-WORLD: A dispatch manifest in deep service green, cobalt route marks, white paper, and clear station rules.
STORY: Diners see the current order stage, delivery address, and estimate, then know what happens next.
FIRST VIEWPORT: Order state and estimate lead; a vertical delivery ticket follows immediately, with address and cost beneath.
FORM: Customer order detail, candidate 3 from the grounded delivery systems; staging is a numbered vertical handoff stack (seed 5fdce4f5).
-->
<!-- pages/customer/order/order.wxml -->
<view class="container" v-if="order">
  <!-- 当前状态 -->
  <view class="status-card" :class="order.status === 'canceled' ? 'cancel' : ''">
    <!-- 取餐号：自取单凭它到柜台领餐；外卖单号供门店核对配送订单 -->
    <view class="pickup" v-if="order.pickupNo && order.status !== 'canceled'">
      <view class="pickup-label">{{isDelivery ? '配送单号' : '取餐号'}}</view>
      <view class="pickup-no">{{order.pickupNo}}</view>
      <view class="pickup-hint">{{isDelivery ? '门店按此号核对配送订单' : '请凭此号到柜台取餐'}}</view>
    </view>
    <!-- 外卖单收货信息：骑手联系与送达依据，跟取餐号同级展示 -->
    <view class="addr-block" v-if="isDelivery && order.address">
      <view class="addr-line">🛵 {{order.receiver}} {{order.phone}}</view>
      <view class="addr-line sub">{{order.address}}</view>
      <view class="addr-line sub" v-if="order.deliveryTime">🕐 期望送达：{{order.deliveryTime}}</view>
    </view>
    <view class="status-text">{{statusText}}</view>
    <view class="order-no">订单号：{{order.orderNo}}</view>
    <view class="order-table" v-if="!isDelivery && tableNo">桌号：{{tableNo}}</view>
    <!-- 等候时间是下单时算定的预估；自取在出餐后隐藏，外卖在配送完成前保留送达预估。 -->
    <view class="wait-tip" v-if="showWait">
      {{isDelivery ? '预计约 ' + waitMinutes + ' 分钟送达 · 约 ' + readyTimeText + ' 前送达'
                   : '预计等候约 ' + waitMinutes + ' 分钟 · 约 ' + readyTimeText + ' 可取'}}
    </view>
  </view>

  <!-- 外卖按真实订单状态呈现交接节点；不展示未接入的骑手身份或 GPS 位置 -->
  <order-progress
    :is-delivery="isDelivery"
    :order="order"
    :nodes="deliveryNodes"
    :steps="steps"
    :state-label="deliveryStateLabel"
  />

  <!-- 商品明细 -->
  <view class="card">
    <view class="block-title">点餐明细</view>
    <view v-for="(item, index) in order.items" :key="item.dishId" class="row">
      <view class="row-name">{{item.name}}</view>
      <view class="row-qty">x{{item.qty}}</view>

      <!-- 评价入口：仅「已完成」订单可见。已评价显示星级摘要，未评价给按钮。
           外层只判断「能不能评价」，内层再分「评过/没评过」，
           避免同一元素上写两个 v-if（后者会覆盖前者，条件永远以最后一个为准） -->
      <view v-if="canReview(item)" class="fb-btn" @tap.stop="goReview(item)">
        {{ rvOf(item.dishId) ? starsText(rvOf(item.dishId)) : '评价' }}
      </view>

      <!-- 投诉反馈：菜品有问题才点，与上面的「评价」是两件事 -->
      <view
        v-if="fbOf(item.dishId)"
        class="fb-state"
        :class="fbOf(item.dishId) === 'handled' ? 'done' : 'wait'"
      >{{ fbOf(item.dishId) === 'handled' ? '已处理' : '待处理' }}</view>
      <view
        v-else-if="order && (order.status === 'paid' || (order.status === 'done' && !isDelivery))"
        class="fb-btn"
        @tap.stop="feedback(item)"
      >反馈</view>

      <view class="row-price price">{{fmt(item.price * item.qty)}}</view>
    </view>

    <!-- 优惠明细：只有真发生了优惠才展开，避免每单都多三行「¥0.00」 -->
    <amount-summary
      :rows="amountRows"
      :total-label="saving > 0 ? '实付金额' : '合计'"
      :total-amount="payAmount"
      :saved="saving"
      saved-prefix="本单共省"
    />
    <view class="note-line" v-if="order.note">备注：{{order.note}}</view>
  </view>

  <view class="tip" v-if="isDelivery">配送状态由门店更新；订单状态会自动刷新，送达后停止刷新。</view>
  <view class="tip" v-else>状态自动刷新，备餐完成后会更新为「已完成」。</view>

  <!-- 继续支付：下单成功但支付请求失败时，订单停在 unpaid。
       券在下单一刻就已核销、余额已扣，所以必须给顾客两条明确的出路：
       继续支付，或取消（取消会退券退余额）。否则顾客只能反复回结算页重下单，
       那才是真的资损——券被烧、余额被扣，还多出一张废单。 -->
  <view class="pay-wrap" v-if="canPay">
    <button class="pay-btn" @tap="onPay" :disabled="paying">{{paying ? '处理中...' : '继续模拟支付'}}</button>
    <view class="pay-hint">当前接口仅模拟订单支付，不会发起真实微信支付。本单优惠券与储值余额已被占用，完成模拟支付或取消订单后才会释放。</view>
  </view>

  <!-- 顾客自主取消：状态机允许 unpaid/paid → canceled。
       只给这两个状态显示——备餐中厨师已动工、已完成已出餐，都不该让顾客反悔。
       取消会把该单用掉的券和余额退回来（数据层 refund），这点要在文案里说清，
       否则顾客不敢点，演示时也不敢点。 -->
  <view class="cancel-wrap" v-if="canCancel">
    <button class="cancel-btn" @tap="onCancel">取消订单</button>
    <view class="cancel-hint">取消后本单使用的优惠券与储值余额会退回到账户</view>
  </view>
  <view class="refund-wrap" v-if="canRequestRefund">
    <button class="refund-btn" @tap="requestRefund">申请售后退款</button>
    <view class="refund-hint">申请提交后由商家审核；批准仅代表审核通过，退款需商家人工处理，不会自动发起微信退款。</view>
  </view>
  <view class="refund-state" v-else-if="refundStatusLoading">
    正在查询售后申请…
  </view>
  <view class="refund-state" v-else-if="refundStatusError">
    {{refundStatusError}}
    <text class="refund-retry" @tap="loadRefundRequest">重新查询</text>
  </view>
  <view class="refund-state" v-else-if="refundRequestStatus">
    售后申请：{{refundStatusText(refundRequestStatus)}}
    <view class="refund-hint" v-if="refundRequestStatus === 'approved_pending_manual_refund' || refundRequestStatus === 'approved'">
      商家已批准申请；退款仍待人工处理，当前不代表款项已退回。
    </view>
    <view class="refund-hint" v-if="refundRequestNote">{{refundRequestNote}}</view>
  </view>
</view>

<view class="container" v-else >
  <view class="loading">加载中...</view>
</view>
</template>

<script>
// 订单详情行为见 mixins/order-detail.js
const orderDetail = require('@/mixins/order-detail.js');
export default { mixins: [orderDetail] };
</script>

<style scoped>
/* pages/customer/order/order.wxss */
.status-card {
  background: var(--primary);
  color: #fff;
  border-radius: 20rpx;
  padding: 40rpx 32rpx;
  text-align: center;
}
.status-card.cancel { background: #5c786f; }
.status-text { font-size: 40rpx; font-weight: 700; }

/* 取餐号：白底卡片里的大号数字，店员喊号、顾客记号的都是它 */
.pickup {
  background: rgba(255, 255, 255, .16);
  border-radius: 16rpx;
  padding: 20rpx 24rpx 24rpx;
  margin-bottom: 24rpx;
}
.pickup-label { font-size: 24rpx; opacity: .85; }
.pickup-no {
  font-size: 84rpx;
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: 4rpx;
  color: #FFC72C;
}
.pickup-hint { font-size: 22rpx; opacity: .8; margin-top: 4rpx; }
.order-no, .order-table { font-size: 26rpx; opacity: 0.9; margin-top: 8rpx; }
/* 外卖收货信息：跟在配送单号下方，白字与状态卡同色系 */
.addr-block { margin-top: 14rpx; text-align: center; }
.addr-line { color: #fff; font-size: 28rpx; font-weight: 600; }
.addr-line.sub { font-size: 24rpx; font-weight: 400; opacity: .85; margin-top: 6rpx; }
/* 预计等候：状态卡里的一行小字，紧跟桌号，不抢取餐号的视觉权重 */
.wait-tip { font-size: 24rpx; opacity: 0.92; margin-top: 10rpx; }


.block-title { font-weight: 700; font-size: 30rpx; margin-bottom: 16rpx; }
.row { display: flex; align-items: center; padding: 16rpx 0; }
.row-name { flex: 1; font-size: 28rpx; }
.row-qty { color: var(--muted); margin: 0 24rpx; font-size: 26rpx; }
.fb-btn {
  flex-shrink: 0;
  font-size: 22rpx;
  color: var(--primary);
  border: 2rpx solid var(--primary);
  border-radius: 16rpx;
  padding: 4rpx 16rpx;
  margin-right: 16rpx;
}
/* 反馈状态徽标：待处理=暖色，已处理=绿。 */
.fb-state {
  flex-shrink: 0;
  font-size: 22rpx;
  border-radius: 16rpx;
  padding: 4rpx 16rpx;
  margin-right: 16rpx;
}
.fb-state.wait { color: #e67e22; background: #fdf2e3; }
.fb-state.done { color: #087c61; background: #e9f7ef; }
.row-price { font-size: 28rpx; width: 160rpx; text-align: right; }
.note-line { color: var(--muted); font-size: 26rpx; margin-top: 12rpx; }
.tip { color: var(--muted); font-size: 24rpx; text-align: center; margin-top: 16rpx; }

/* 取消订单：描边按钮而非实心，避免和主操作（去结算/支付）抢视觉。
   放在页面最底部，与「取消」这个低频且破坏性的动作相匹配 */
/* 继续支付：与「取消订单」并列，但视觉上是主操作 */
.pay-wrap { margin-top: 28rpx; }
.pay-btn {
  background: var(--primary);
  color: #fff;
  border-radius: 48rpx;
  font-size: 30rpx;
}
.pay-hint {
  font-size: 22rpx;
  color: var(--muted);
  text-align: center;
  margin-top: 12rpx;
  line-height: 1.5;
}
.cancel-wrap { margin-top: 40rpx; }
.cancel-btn {
  background: #fff;
  color: #e6432d;
  border: 1rpx solid #f3b5ac;
  border-radius: 48rpx;
  font-size: 30rpx;
  height: 84rpx;
  line-height: 84rpx;
}
.cancel-hint {
  text-align: center;
  color: var(--muted);
  font-size: 22rpx;
  margin-top: 14rpx;
}
.refund-wrap, .refund-state { margin-top: 20rpx; background: #fff; border-radius: 16rpx; padding: 22rpx; }
.refund-btn { background: #fff; color: var(--primary); border: 2rpx solid var(--primary); border-radius: 48rpx; font-size: 28rpx; }
.refund-hint { color: var(--muted); font-size: 22rpx; line-height: 1.5; margin-top: 12rpx; }
.refund-state { color: #8a5a00; font-size: 27rpx; }
.refund-retry { display: block; color: var(--primary); margin-top: 12rpx; }
.loading { text-align: center; color: var(--muted); padding: 80rpx 0; }
</style>

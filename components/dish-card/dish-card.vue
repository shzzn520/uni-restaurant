<template>
  <!-- 菜品行：菜单分类视图与搜索结果共用，避免两处模板/样式各写一遍 -->
  <view class="dish-item" :class="{ sold }" @tap="$emit('tap', item)">
    <image v-if="item.image" class="dish-thumb" :src="item.image" mode="aspectFill"></image>
    <view v-else class="dish-thumb">{{ item.name[0] }}</view>

    <view class="dish-info">
      <!-- 搜索态：按关键字分段渲染并高亮；普通态直接输出菜名 -->
      <view class="dish-name">
        <template v-if="nameSegs && nameSegs.length">
          <text v-for="(s, si) in nameSegs" :key="si" :class="{ hit: s.hit }">{{ s.t }}</text>
        </template>
        <template v-else>{{ item.name }}</template>
      </view>

      <view class="dish-desc ellipsis">
        <template v-if="item.desc">
          <template v-if="descSegs && descSegs.length">
            <text v-for="(s, si) in descSegs" :key="si" :class="{ hit: s.hit }">{{ s.t }}</text>
          </template>
          <template v-else>{{ item.desc }}</template>
        </template>
        <text v-else>暂无描述</text>
      </view>

      <view class="dish-meta">
        <text class="dish-price price">{{ priceText }}</text>
        <!-- 无人评价时不显示 0.0 分，避免误导 -->
        <text class="dish-rate" v-if="Number(rating) > 0">★ {{ rating }} · {{ reviewCount }} 条</text>
      </view>
    </view>

    <!-- 售罄 / 已达单菜上限：按钮置灰并换成「满」 -->
    <view
      v-if="!sold"
      class="dish-add"
      :class="{ off: atLimit }"
      @tap.stop="$emit('add', item)"
    >{{ atLimit ? '满' : '+' }}</view>
    <view class="sold-tag" v-else>已售罄</view>
  </view>
</template>

<script>
// components/dish-card/dish-card.vue —— 菜品列表行
// 只负责展示与抛出事件，加购上限等业务判断仍由页面传入：
//   sold    是否售罄
//   atLimit 是否达到单菜购买上限
//   nameSegs/descSegs 搜索高亮分段（不传则按纯文本渲染）
export default {
  name: 'DishCard',
  props: {
    item: { type: Object, required: true },
    rating: { type: [Number, String], default: 0 },
    reviewCount: { type: [Number, String], default: 0 },
    sold: { type: Boolean, default: false },
    atLimit: { type: Boolean, default: false },
    nameSegs: { type: Array, default: null },
    descSegs: { type: Array, default: null }
  },
  computed: {
    priceText() {
      return '¥' + (Number(this.item.price) || 0).toFixed(2);
    }
  }
};
</script>

<style scoped>
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
.dish-meta { display: flex; align-items: baseline; }
.dish-price { font-size: 30rpx; }
.dish-rate { font-size: 21rpx; color: #f5a623; margin-left: 14rpx; }
.hit { color: var(--primary); font-weight: 700; }
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
</style>
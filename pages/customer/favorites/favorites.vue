<template>
  <view class="fav-page">
    <!-- 未登录：明确的权限态 + 去登录入口 -->
    <empty-state v-if="!logged" icon="🔒" title="登录后查看我的收藏" tip="收藏会跟随会员账号，换设备也不会丢">
      <button class="primary-btn" @tap="goLogin">去登录</button>
      <button class="ghost-btn" @tap="goFlash">先逛抢购会场</button>
    </empty-state>

    <empty-state v-else-if="loading" icon="⏳" title="正在加载收藏…" />

    <empty-state v-else-if="error" icon="⚠" :title="error">
      <button class="primary-btn" @tap="load">重新加载</button>
    </empty-state>

    <empty-state v-else-if="list.length === 0" icon="♡" title="还没有收藏的商品" tip="在限时抢购会场点 ♡ 即可收藏">
      <button class="primary-btn" @tap="goFlash">去抢购会场</button>
    </empty-state>

    <view v-else class="list">
      <view class="top-hint">共 {{list.length}} 件收藏 · 售罄商品会保留，方便下次蹲守</view>
      <view v-for="it in list" :key="it._id" class="card">
        <view class="main" @tap="goDetail(it)">
          <image class="thumb" :src="it.image" mode="aspectFill" />
          <view class="info">
            <view class="name">{{it.name}}</view>
            <view class="price-row">
              <text class="price">¥{{it.flashPrice}}</text>
              <text class="origin">¥{{it.originalPrice}}</text>
              <text class="tag">{{it.discount}} 折</text>
            </view>
            <view class="stock" :class="{soldout: it.status === 'soldout'}">
              {{it.status === 'soldout' ? '已售罄' : '仅剩 ' + it.remain + ' 件'}}
            </view>
          </view>
        </view>
        <view class="actions">
          <view class="remove-btn" @tap="removeFav(it)">取消收藏</view>
          <view class="go-btn" @tap="goDetail(it)">去抢购 ›</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
// pages/customer/favorites/favorites.vue —— 我的收藏
const { call } = require('@/common/cloud.js');
const session = require('@/common/session.js');

export default {
  data() {
    return {
      loading: false,
      loadedOnce: false,      // 跳过紧跟 onLoad 的首次 onShow
      logged: false,
      userId: '',
      error: '',
      list: [],
      feedback: '',
      feedbackTimer: null
    };
  },

  onLoad() { this.load(); },

  onShow() {
    // 从会场/详情返回后收藏可能已变化；首次 onShow 紧跟 onLoad，交给 onLoad 那次
    if (this.loadedOnce) this.load();
    this.loadedOnce = true;
  },

  onPullDownRefresh() {
    this.load(() => uni.stopPullDownRefresh());
  },

  onUnload() {
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
  },

  methods: {
    load(done) {
      if (this.loading) { if (done) done(); return; }
      this.logged = session.isLogin();
      this.userId = this.logged ? session.getUserId() : '';
      if (!this.logged) {
        this.list = [];
        this.error = '';
        if (done) done();
        return;
      }
      this.loading = true;
      this.error = '';
      call('cloudFlash', 'favorites', { memberId: this.userId })
        .then(res => {
          this.list = res.data || [];
          this.loading = false;
          if (done) done();
        })
        .catch(err => {
          this.loading = false;
          this.error = err && err.msg ? err.msg : String(err || '加载失败');
          if (done) done();
        });
    },

    removeFav(it) {
      uni.showModal({
        title: '取消收藏',
        content: '确定不再收藏「' + it.name + '」？',
        success: r => {
          if (!r.confirm) return;
          call('cloudFlash', 'toggleFavorite', { itemId: it._id, memberId: this.userId })
            .then(() => {
              this.list = this.list.filter(x => x._id !== it._id);
              this.showFeedback('已取消收藏');
            })
            .catch(err => {
              this.showFeedback(err && err.msg ? err.msg : String(err || '操作失败'));
            });
        }
      });
    },

    goDetail(it) {
      uni.navigateTo({ url: '/pages/customer/flashDetail/flashDetail?id=' + it._id });
    },

    goFlash() {
      uni.navigateTo({ url: '/pages/customer/flash/flash' });
    },

    goLogin() {
      uni.navigateTo({ url: '/pages/customer/member/member' });
    },

    showFeedback(text) {
      this.feedback = text;
      uni.showToast({ title: text, icon: 'none' });
      if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
      this.feedbackTimer = setTimeout(() => { this.feedback = ''; }, 3000);
    }
  }
};
</script>

<style>
.fav-page { min-height: 100vh; background: #f2f8f6; padding: 20rpx 24rpx 40rpx; }
.primary-btn {
  margin: 36rpx auto 0; width: 300rpx; height: 72rpx; line-height: 72rpx;
  font-size: 27rpx; color: #fff; background: #087c61; border-radius: 36rpx;
}
.ghost-btn {
  margin: 18rpx auto 0; width: 300rpx; height: 72rpx; line-height: 72rpx;
  font-size: 27rpx; color: #5c786f; background: #fff; border: 1rpx solid #dce9e4; border-radius: 36rpx;
}

.top-hint { font-size: 22rpx; color: #5c786f; padding: 4rpx 6rpx 16rpx; }
.card { background: #fff; border-radius: 16rpx; padding: 20rpx; margin-bottom: 18rpx; }
.main { display: flex; }
.thumb { width: 160rpx; height: 160rpx; border-radius: 12rpx; background: #f2f8f6; flex-shrink: 0; }
.info { flex: 1; margin-left: 20rpx; min-width: 0; }
.name { font-size: 30rpx; font-weight: 700; color: #183c34; }
.price-row { display: flex; align-items: baseline; margin-top: 16rpx; }
.price { font-size: 34rpx; font-weight: 700; color: #087c61; }
.origin { font-size: 22rpx; color: #9bb2aa; text-decoration: line-through; margin-left: 12rpx; }
.tag { font-size: 20rpx; color: #087c61; background: #eaf4fb; padding: 4rpx 10rpx; border-radius: 6rpx; margin-left: 12rpx; }
.stock { font-size: 22rpx; color: #5c786f; margin-top: 16rpx; }
.stock.soldout { color: #9bb2aa; }
.actions { display: flex; justify-content: flex-end; align-items: center; margin-top: 16rpx; border-top: 1rpx solid #f2f8f6; padding-top: 16rpx; }
.remove-btn { font-size: 24rpx; color: #5c786f; padding: 8rpx 20rpx; }
.go-btn { font-size: 24rpx; color: #087c61; padding: 8rpx 0 8rpx 20rpx; }
</style>

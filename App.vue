<script>
// ===============================================================
// App.vue —— 应用入口
// 原生小程序 app.js 的 globalData / onLaunch 迁移到这里
// ===============================================================
const config = require('./common/config.js');
const session = require('./common/session.js');

export default {
  globalData: {
    // 后端地址（HTTP 模式使用，页面报错时可提示用）
    apiBase: config.apiBase,
    shopId: '',   // 当前店铺 ID（顾客扫码 / 商家登录后写入）
    tableNo: ''   // 桌号（顾客扫码带入）
  },

  onLaunch() {
    // ---------- 登录态自愈 ----------
    // 登录态 = memberId + memberToken，缺了令牌服务端一律当未登录，
    // 但界面还显示着已登录 —— 用户看到的就是「登录了却处处说我没登录」。
    // 历史版本里微信一键登录漏发过令牌（2026-10-16 修），这批本地状态只能清掉，
    // 逼用户重新登录一次；否则升级小程序后仍会卡在这个假状态里。
    if (session.healLoginState()) {
      console.warn('[登录态] 检测到残缺登录态（有会员编号、无会话令牌），已清除，请重新登录');
    }

    // ---------- 两种数据来源，由 common/config.js 的 useMock 决定 ----------
    if (config.useMock) {
      // 本地模拟：不需要任何后端，直接跑
      console.log('[模式] 本地模拟（useMock=true），数据存在本机 storage');
    } else {
      // HTTP 后端：请求本机 Spring Boot 服务
      console.log('[模式] HTTP 后端，后端地址：' + config.apiBase);
      console.log('[提示] 若请求失败，请检查：');
      console.log('  1) 后端服务是否已启动（restaurant-server 端口 8080）');
      console.log('  2) 开发者工具是否勾选「不校验合法域名」');
    }
  },

  onShow() {},
  onHide() {}
}
</script>

<style>
/* 全局样式：原生 app.wxss / page 选择器迁移过来 */
page {
  --primary: #087c61;
  --primary-dark: #075c4a;
  --accent: #176db3;
  --accent-soft: #eaf4fb;
  --bg: #f2f8f6;
  --surface: #fff;
  --text: #183c34;
  --muted: #5c786f;
  --border: #dce9e4;
  background: var(--bg);
  color: var(--text);
  font-size: 28rpx;
}

.container {
  padding: 32rpx;
  box-sizing: border-box;
}

/* 主按钮 */
.primary-btn {
  background: var(--primary);
  color: #fff;
  border-radius: 48rpx;
  font-size: 32rpx;
  margin-top: 24rpx;
}
.primary-btn[disabled] {
  background: #8eb6aa;
}

/* 输入框 */
.input {
  background: var(--surface);
  border-radius: 12rpx;
  padding: 24rpx;
  margin-bottom: 24rpx;
  font-size: 30rpx;
}

/* 价格文字 */
.price {
  color: var(--primary);
  font-weight: 600;
}

/* 通用卡片 */
.card {
  background: var(--surface);
  border-radius: 16rpx;
  padding: 24rpx;
  margin-bottom: 24rpx;
}

/* 文本省略 */
.ellipsis {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
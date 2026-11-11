// ===============================================================
// common/config.js —— 全局运行模式开关
// ===============================================================
// uni-app 版保留了两种数据来源（微信原生云开发 wx.cloud 在 uni-app 不可用）：
//
//   1) 本地模拟  useMock = true
//      走 common/mock.js，用 uni.getStorageSync 存数据。编译即跑。
//
//   2) HTTP 后端 useMock = false   ← 实验作业默认用这个
//      走 common/http.js，请求本机 Spring Boot 服务。
//      这才是真正的「前端小程序 + 后台联动」。
//
// ⚠️ 用 HTTP 后端时，请务必在微信开发者工具里勾选：
//    详情 → 本地设置 → 「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」
//
// ⚠️ 发布到线上前必须切回 useMock = true：
//    小程序上线后跑在顾客手机上，localhost 指的是「顾客的手机」，
//    访问不到开发者电脑上的 Spring Boot（localhost:8080），
//    保持 false 会导致所有接口超时、白屏。
//    线上真要连后端，需先把后端部署到公网 + 已备案的 HTTPS 域名，
//    并在小程序后台「开发管理 → 服务器域名」配好 request 合法域名，
//    再把下面 useMock 改回 false、apiBase 换成你的域名。
// ===============================================================

module.exports = (function () {
  // ---------- 模式开关 ----------
  // 基础值：本地开发走真实后端（需后端在 8080 运行）。
  let useMock = false;

  // #ifdef H5
  // H5 部署（如发布成在线外卖点单链接）时：跑在别人浏览器里的页面
  // 访问不到发布者电脑的 localhost:8080，必须切回本地模拟层才能独立运行。
  // 按域名判定而非写死开关 —— localhost/127.0.0.1 联调仍走后端，一键两不误。
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    useMock = !(host === 'localhost' || host === '127.0.0.1');
  }
  // #endif

  return {
    useMock: useMock,   // true = 本地模拟；false = 走真实后端

    // ---------- HTTP 后端地址 ----------
    // 仅在 useMock = false 时生效：
    //   微信开发者工具模拟器访问本机，直接写 localhost 即可；
    //   真机预览需改成电脑局域网 IP，例如 http://192.168.1.10:8080/api
    //   线上需改成已备案的公网 HTTPS 域名，并在小程序后台配 request 合法域名
    apiBase: 'http://localhost:8080/api'
  };
})();
// ===============================================================
// common/cloud.js —— 数据访问统一入口（两模式路由）
// ===============================================================
// 页面统一调用 call('cloudMenu', 'getShopMenu', {...})，
// 由 common/config.js 里的开关决定实际走哪条链路：
//
//   useMock = true  → common/mock.js（本地模拟）
//   useMock = false → common/http.js（本机 Spring Boot 后端）
//
// 这样设计的价值：页面代码与数据源完全解耦，
// 实验课上要演示「关掉后端用模拟数据」，只要改一个开关即可。
//
// 说明：微信原生云开发（wx.cloud）在 uni-app 中不可用，
//       uni-app 对应方案是 uniCloud，此处未接入。
// ===============================================================
const config = require('./config.js');
const mock = require('./mock.js');
const http = require('./http.js');

function call(name, action, data = {}) {

  // ---------- 1) 本地模拟 ----------
  if (config.useMock) {
    return mock.call(name, action, data);
  }

  // ---------- 2) HTTP 后端（本机 Spring Boot + MySQL） ----------
  return http.call(name, action, data);
}

module.exports = { call };
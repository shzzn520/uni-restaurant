// ESLint 配置：只启用能稳定通过的规则，避免历史代码一次性刷出上千条噪音
module.exports = {
  root: true,
  env: { browser: true, es2021: true, node: true },
  parserOptions: { ecmaVersion: 2021, sourceType: 'module' },
  extends: ['plugin:vue/essential'],
  globals: {
    uni: 'readonly',        // uni-app 全局对象
    wx: 'readonly',         // 微信小程序全局对象
    getApp: 'readonly',
    getCurrentPages: 'readonly'
  },
  rules: {
    'no-undef': 'error',
    'no-unused-vars': ['warn', { args: 'none' }],
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'vue/no-unused-components': 'warn',
    'vue/require-v-for-key': 'warn',
    'vue/no-parsing-error': ['error', { 'x-invalid-end-tag': false }],
    // uni-app 页面按目录命名（menu/order/login），不适用多词组件名规则
    'vue/multi-word-component-names': 'off',
    // v-for 的 index 未使用很常见，不作为错误
    'vue/no-unused-vars': 'warn'
  }
};
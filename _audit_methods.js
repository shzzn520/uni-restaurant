/**
 * _audit_methods.js —— 静态审查：找出「事件函数没写在 methods 内」的页面
 *
 * 为什么需要它：uni-app(Vue2) 的页面选项对象会走 Vue.extend()，
 * 只有 options.methods 里的函数才会挂到 vm 实例上；写在顶层的普通函数
 * （onLoad/onShow 等生命周期除外——运行时 initHooks 会把它们单独收走）
 * 在点击时会被 mp 运行时的 handleEvent 判为「不是函数」并抛
 *   Page "pages/xxx/xxx" does not have a method "yyy"
 * 表现就是「按钮点了完全没反应」，且编译期没有任何提示。
 *
 * 用法：node _audit_methods.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

// 顶层允许的键：生命周期钩子 + Vue 内置选项
const LIFECYCLE = new Set([
  'onLoad', 'onShow', 'onHide', 'onUnload', 'onReady', 'onPullDownRefresh',
  'onReachBottom', 'onShareAppMessage', 'onShareTimeline', 'onPageScroll',
  'onResize', 'onTabItemTap', 'onNavigationBarButtonTap', 'onBackPress',
  'created', 'beforeCreate', 'mounted', 'beforeMount', 'updated',
  'beforeUpdate', 'destroyed', 'beforeDestroy', 'activated', 'deactivated'
]);
const OPTIONS = new Set([
  'data', 'computed', 'watch', 'methods', 'props', 'components', 'mixins',
  'filters', 'directives', 'name', 'emits', 'expose', 'setup', 'options',
  'behaviors', 'globalData', '$emit', '__file', 'render', 'onLaunch', 'onError',
  'onPageNotFound', 'onThemeChange', 'onShow', 'onHide'
]);

/** 去掉注释与字符串字面量，避免解析被干扰 */
function strip(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      i++; out += '""'; continue;
    }
    out += c; i++;
  }
  return out;
}

/**
 * 解析一个对象字面量的一级键名。
 * @param {string} s       已 strip 过的源码
 * @param {number} braceAt 左花括号的下标
 * @param {function} onKey 命中一级键时回调
 */
function scanObject(s, braceAt, onKey) {
  let depth = 1;
  let buf = '';
  let expectKey = true;

  for (let i = braceAt + 1; i < s.length; i++) {
    const ch = s[i];

    if (expectKey && depth === 1) {
      if (ch === ':' || ch === '(') {
        const k = buf.trim();
        if (k) onKey(k);
        buf = '';
        expectKey = false;
        if (ch === '(') depth++;          // 吃掉参数表
        continue;
      }
      if (ch === ',' || ch === '}') {
        if (ch === '}') { depth--; if (depth === 0) return; }
        buf = ''; continue;
      }
      if (/\s/.test(ch)) {
        // 单独的 async 是关键字，不是函数名的一部分（避免把 asyncenter 当成名字）
        if (buf === 'async') buf = '';
        continue;
      }
      buf += ch;
      continue;
    }

    if (ch === '{' || ch === '[' || ch === '(') { depth++; continue; }
    if (ch === '}' || ch === ']' || ch === ')') {
      depth--;
      if (depth === 0) return;
      continue;
    }
    if (ch === ',' && depth === 1) { buf = ''; expectKey = true; continue; }
  }
}

/** export default {...} 的一级键 */
function topLevelKeys(script) {
  const s = strip(script);
  const start = s.indexOf('export default');
  if (start < 0) return [];
  const braceAt = s.indexOf('{', start);
  if (braceAt < 0) return [];
  const keys = [];
  scanObject(s, braceAt, k => keys.push(k));
  return keys;
}

/** methods: {...} 内的函数名 */
function methodKeys(script) {
  const s = strip(script);
  const m = s.match(/methods\s*:\s*\{/);
  if (!m) return new Set();
  const braceAt = s.indexOf('{', m.index);
  const names = new Set();
  scanObject(s, braceAt, k => names.add(k));
  return names;
}

/** 模板里绑定的事件处理函数名：@tap="fn" / @click="fn(a)" / bind:tap="fn" */
function templateHandlers(full) {
  const tpl = full
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '');
  const names = new Set();
  const re = /(?:@|bind:?|catch:?)[a-zA-Z]+(?:\.\w+)?\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(tpl))) {
    const fn = m[1].trim().match(/^([A-Za-z_$][\w$]*)\s*\(/);
    if (fn) names.add(fn[1]);
  }
  return names;
}

function walk(dir, out) {
  fs.readdirSync(dir).forEach(name => {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) {
      if (['unpackage', 'node_modules', 'static', '.git'].indexOf(name) >= 0) return;
      walk(p, out);
    } else if (name.endsWith('.vue')) {
      out.push(p);
    }
  });
  return out;
}

const files = walk(ROOT, []).sort();
let bad = 0;

files.forEach(f => {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  if (rel === 'App.vue') return;                 // 应用级，无模板事件
  const full = fs.readFileSync(f, 'utf8');
  const sm = full.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  if (!sm) return;
  const script = sm[1];
  const tops = topLevelKeys(script);
  const inMethods = methodKeys(script);
  const handlerNames = templateHandlers(full);

  const problems = [];

  // ① 顶层写了自定义函数（会被 Vue 忽略，点击时报 does not have a method）
  tops.forEach(k => {
    if (OPTIONS.has(k) || LIFECYCLE.has(k)) return;
    if (inMethods.has(k)) return;
    problems.push('顶层函数未进 methods：' + k + '()');
  });

  // ② 模板里绑定了、但 methods 里也找不到的处理函数
  handlerNames.forEach(n => {
    if (inMethods.has(n)) return;
    if (tops.indexOf(n) >= 0) return;            // 已在 ① 报过
    problems.push('模板绑定了 ' + n + '()，但 methods 中不存在');
  });

  if (problems.length) {
    bad++;
    console.log('[X] ' + rel);
    Array.from(new Set(problems)).forEach(p => console.log('      - ' + p));
  } else {
    console.log('[OK] ' + rel + '  (' + inMethods.size + ' 个 methods)');
  }
});

console.log(bad === 0 ? '\n== 全部页面通过：事件函数都在 methods 内 ==' : '\n== ' + bad + ' 个页面有问题 ==');

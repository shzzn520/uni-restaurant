// ===============================================================
// tests/_check.js —— 页面 / 组件 / 混入 / 公共模块的语法自检
// 运行：npm run test:syntax
// 说明：只做「能否被 JS 引擎解析」的静态检查，不执行代码。
// ===============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DIRS = ['pages', 'components'];

// 收集 .vue 文件（页面与组件）
const files = [];
function walkVue(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return;
  for (const f of fs.readdirSync(abs, { withFileTypes: true })) {
    const p = path.join(abs, f.name);
    if (f.isDirectory()) walkVue(path.relative(ROOT, p));
    else if (f.name.endsWith('.vue')) files.push(p);
  }
}
DIRS.forEach(walkVue);

// 纯 JS 模块：common、mixins
const jsFiles = [];
for (const dir of ['common', 'mixins']) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  for (const name of fs.readdirSync(abs)) {
    if (name.endsWith('.js')) jsFiles.push(path.join(abs, name));
  }
}

let ok = 0;
let bad = 0;

// .vue：抽出 <script> 后按模块语法编译
for (const f of files) {
  const rel = path.relative(ROOT, f);
  const src = fs.readFileSync(f, 'utf8');
  const m = src.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) {
    console.log('NO-SCRIPT  ' + rel);
    bad++;
    continue;
  }
  // export default -> module.exports，才能在 vm 中作为普通脚本编译
  const code = m[1].replace(/export\s+default\s*/, 'module.exports = ');
  try {
    new vm.Script(code, { filename: rel });
    console.log('OK      ' + rel);
    ok++;
  } catch (e) {
    console.log('BAD     ' + rel);
    console.log('        ' + String(e.message).slice(0, 260));
    bad++;
  }
}

// .js：直接编译
for (const f of jsFiles) {
  const rel = path.relative(ROOT, f);
  try {
    new vm.Script(fs.readFileSync(f, 'utf8'), { filename: rel });
    console.log('OK      ' + rel);
    ok++;
  } catch (e) {
    console.log('BAD     ' + rel);
    console.log('        ' + String(e.message).slice(0, 260));
    bad++;
  }
}

console.log('\n合计: OK=' + ok + '  BAD=' + bad);
process.exit(bad ? 1 : 0);
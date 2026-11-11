// 用 vm.Script 在进程内做语法检查（避免 spawn 子进程）
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name.endsWith('.vue')) files.push(p);
  }
})('pages');

let ok = 0, bad = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const m = src.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) { console.log('NO-SCRIPT  ', f); bad++; continue; }
  const code = m[1].replace(/export\s+default\s*/, 'module.exports = ');
  try {
    new vm.Script(code, { filename: f });
    console.log('OK      ', f);
    ok++;
  } catch (e) {
    console.log('BAD     ', f);
    console.log('        ', String(e.message).slice(0, 260));
    bad++;
  }
}
console.log('\n合计: OK=' + ok + '  BAD=' + bad);
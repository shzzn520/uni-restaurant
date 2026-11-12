// ===============================================================
// upload-ci.js —— 用微信官方 miniprogram-ci 上传小程序代码包
// ===============================================================
// 前置条件（必须由你自己完成，脚本无法代做）：
//   1. 浏览器打开 https://mp.weixin.qq.com 登录你的小程序
//   2. 开发管理 → 开发设置 → 「小程序代码上传密钥」
//      → 生成并下载，得到 private.wx28468c1b71960f58.key
//   3. 把该 .key 文件放到【项目根目录】（E:\uni-restaurant\）下
//   4. 若后台配了「IP 白名单」，需把本机公网 IP 加进去
//
// 用法：
//   node scripts/upload-ci.js --version 1.0.0 --desc "餐厅点单系统首发版"
//
// 行为说明：
//   - 优先使用新鲜的发行产物；发行产物过期时可回退到新鲜开发产物
//   - 若构建产物早于任一小程序源码文件，则中止上传并要求重新编译
//   - 上传成功后代码进入「开发版本」，可在后台「版本管理」看到
//   - ⚠️ 上传 ≠ 发布。提交审核、发布必须在小程序后台手动操作
// ===============================================================

const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');

// ---------- 依赖解析 ----------
// miniprogram-ci 装在受管 node workspace 下（避免污染项目）。
// 若项目本地没有 node_modules/miniprogram-ci，则把 workspace 的 node_modules
// 追加进解析路径，这样在项目根目录直接 `node scripts/upload-ci.js` 即可运行。
const WORKSPACE_NM = 'C:/Users/那年夏天/.workbuddy/binaries/node/workspace/node_modules';
const LOCAL_NM = path.join(ROOT, 'node_modules');
if (!fs.existsSync(path.join(LOCAL_NM, 'miniprogram-ci'))) {
  if (fs.existsSync(path.join(WORKSPACE_NM, 'miniprogram-ci'))) {
    module.paths.push(WORKSPACE_NM);
  } else {
    console.error('[失败] 找不到 miniprogram-ci，请先安装：');
    console.error('  cd "C:/Users/那年夏天/.workbuddy/binaries/node/workspace" && node <npm-cli.js> install miniprogram-ci --registry=https://registry.npmmirror.com');
    process.exit(1);
  }
}
const ci = require('miniprogram-ci');

// ---------- 基本配置 ----------
const APPID = 'wx28468c1b71960f58';          // 你的小程序 appid
const ROBOT = 1;                              // CI 机器人编号 1~30，后台可配多个

// ---------- 解析命令行参数 ----------
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const i = args.indexOf('--' + name);
  return i > -1 && args[i + 1] ? args[i + 1] : fallback;
}
const VERSION = getArg('version', '1.0.0');
const DESC = getArg('desc', 'uni-restaurant 上传');
const KEY_PATH = path.resolve(getArg('key', path.join(ROOT, 'private.' + APPID + '.key')));

// ---------- 检查源码与构建产物新鲜度 ----------
const BUILD_DIR = path.join(ROOT, 'unpackage', 'dist', 'build', 'mp-weixin');
const DEV_DIR = path.join(ROOT, 'unpackage', 'dist', 'dev', 'mp-weixin');
// 遍历源码和产物的最近修改时间，阻止把旧构建当成最新代码上传。
function latestMtime(paths) {
  let latest = 0;
  function visit(target) {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(target)) {
        visit(path.join(target, name));
      }
    } else {
      latest = Math.max(latest, stat.mtimeMs);
    }
  }
  for (const target of paths) {
    if (fs.existsSync(target)) visit(target);
  }
  return latest;
}

const SOURCE_PATHS = [
  'App.vue', 'main.js', 'manifest.json', 'pages.json', 'uni.scss',
  'common', 'components', 'mixins', 'pages', 'static'
].map((name) => path.join(ROOT, name));
const sourceMtime = latestMtime(SOURCE_PATHS);
const buildMtime = fs.existsSync(BUILD_DIR) ? latestMtime([BUILD_DIR]) : 0;
const devMtime = fs.existsSync(DEV_DIR) ? latestMtime([DEV_DIR]) : 0;

// 优先新鲜的发行产物；如果它已过期但 HBuilderX 开发产物是新的，则使用开发产物。
// 若两者都落后于源码，就拒绝上传，避免静默发布旧代码。
let PROJECT;
if (buildMtime >= sourceMtime && buildMtime > 0) {
  PROJECT = BUILD_DIR;
} else if (devMtime >= sourceMtime && devMtime > 0) {
  PROJECT = DEV_DIR;
} else if (!buildMtime && !devMtime) {
  console.error('找不到可上传的产物目录，请先编译到 mp-weixin：');
  console.error('  cd /f/Soft/HBuilderX && ./cli.exe launch mp-weixin --project "E:/uni-restaurant" --compile true');
  process.exit(1);
} else {
  console.error('\n[中止] 微信构建产物早于当前源码，不能安全上传。');
  console.error('请先用 HBuilderX 重新编译到 mp-weixin，再重新运行上传脚本。');
  console.error('源码最近修改：', new Date(sourceMtime).toLocaleString());
  if (buildMtime) console.error('发行产物最近修改：', new Date(buildMtime).toLocaleString());
  if (devMtime) console.error('开发产物最近修改：', new Date(devMtime).toLocaleString());
  process.exit(1);
}

// ---------- 上传前自检 ----------
console.log('────────────────────────────────────────');
console.log('appid      :', APPID);
console.log('产物目录   :', PROJECT.replace(ROOT, '.'));
console.log('版本号     :', VERSION);
console.log('版本描述   :', DESC);
console.log('上传密钥   :', KEY_PATH.replace(ROOT, '.'));

// 微信的 2 MiB 限制针对主包，不应把独立分包的文件重复计入。
const appJsonPath = path.join(PROJECT, 'app.json');
if (!fs.existsSync(appJsonPath)) {
  console.error('\n[中止] 构建产物缺少 app.json，无法校验主包体积。');
  process.exit(1);
}

let appConfig;
try {
  appConfig = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
} catch (error) {
  console.error('\n[中止] 无法解析构建产物 app.json：', error.message);
  process.exit(1);
}

const subpackageRoots = (appConfig.subPackages || appConfig.subpackages || [])
  .map((item) => String(item.root || '').replace(/\\/g, '/').replace(/^\/|\/$/g, '') + '/')
  .filter((root) => root !== '/');
// 统计主包体积，超 2 MiB 时提前拦（微信错误码 80051）。
let total = 0;
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else {
      const relative = path.relative(PROJECT, p).split(path.sep).join('/');
      const isSubpackage = subpackageRoots.some((root) => relative.startsWith(root));
      const isDevConfig = relative === 'project.config.json'
        || relative === 'project.private.config.json';
      if (!isSubpackage && !isDevConfig) total += st.size;
    }
  }
})(PROJECT);
const LIMIT = 2 * 1024 * 1024;
console.log('代码包体积 :', (total / 1048576).toFixed(3), 'MiB',
            total < LIMIT ? '✅ 低于 2 MiB 上限' : '❌ 已超 2 MiB，必然报 80051');
if (total >= LIMIT) {
  console.error('\n[中止] 主包超限，先压缩素材再上传。');
  process.exit(1);
}

if (!fs.existsSync(KEY_PATH)) {
  console.error('\n[失败] 上传密钥不存在：', KEY_PATH);
  console.error('请到 mp.weixin.qq.com → 开发管理 → 开发设置 → 小程序代码上传密钥 生成并下载，');
  console.error('保存为项目根目录下的 private.' + APPID + '.key 后重试。');
  process.exit(1);
}

// ---------- 执行上传 ----------
const project = new ci.Project({
  appid: APPID,
  type: 'miniprogram',
  projectPath: PROJECT,
  privateKeyPath: KEY_PATH,
  ignores: ['node_modules/**/*'],
});

ci.upload({
  project,
  version: VERSION,
  desc: DESC,
  robot: ROBOT,
  setting: {
    es6: true,          // ES6 转 ES5
    es7: true,
    minify: true,       // 压缩代码
    codeProtect: false,
    autoPrefixWXSS: true,
  },
}).then((res) => {
  console.log('\n[成功] 代码已上传。');
  console.log('  响应:', JSON.stringify(res));
  console.log('\n下一步（只能手动）：');
  console.log('  1. 打开 https://mp.weixin.qq.com → 版本管理');
  console.log('  2. 找到刚上传的开发版本 → 选为体验版或直接「提交审核」');
  console.log('  3. 审核通过后点「发布」');
}).catch((err) => {
  console.error('\n[失败]', err && err.message ? err.message : err);
  if (err && err.code) console.error('  code:', err.code);
  if (err && err.errCode) console.error('  errCode:', err.errCode);
  process.exit(1);
});

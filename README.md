# 餐厅扫码点单系统（uni-app 版）

> 原生微信小程序 `restaurant-miniprogram` 的 **uni-app 迁移工程**。
> 用 HBuilderX 打开本目录，即可编译运行到「微信开发者工具」中预览/调试。

---

## 一、工程结构

```
uni-restaurant/
├── App.vue              # 应用入口（原 app.js 的 globalData / onLaunch 迁移）
├── main.js              # Vue2 标准入口
├── manifest.json        # 应用配置（已填 mp-weixin AppID + 关闭域名校验）
├── pages.json           # 页面路由与导航栏主题
├── uni.scss / index.html# uni-app 脚手架文件
├── common/              # 数据访问层
│   ├── config.js        # 唯一开关：useMock（true=本地模拟 / false=走后端）
│   ├── cloud.js         # 统一入口 call(name, action, data)，页面不感知数据源
│   ├── http.js          # useMock=false 时，把 action 翻译成 REST 请求
│   ├── mock.js          # useMock=true 时，用 uni.storage 模拟云函数
│   ├── rules.js         # 优惠券/等级/积分/配送规则（mock 与页面唯一来源）
│   ├── session.js       # 会员登录态（手机号）与本地会话缓存
│   └── format.js        # 状态机文案、金额/时间格式化、投诉原因常量
├── components/          # 通用组件（easycom 自动注册，无需 import）
│   ├── dish-card/       # 菜品行（菜单分类 + 搜索结果共用）
│   ├── stepper/         # 数量加减
│   ├── amount-summary/  # 费用明细（结算页 + 订单详情共用）
│   ├── coupon-sheet/    # 优惠券选择弹层
│   ├── order-progress/  # 外卖交接节点 / 自取进度条
│   └── empty-state/     # 空态 / 错误态 / 未登录态
├── mixins/              # 大页面的行为逻辑（页面只保留模板与样式）
│   ├── menu-cart.js     # 菜单：分类 / 搜索 / 购物车 / 详情
│   ├── checkout.js      # 结算：试算 / 选券 / 提交支付
│   ├── member-center.js # 会员：储值 / 积分 / 券包
│   └── order-detail.js  # 订单详情：状态轮询 / 评价 / 售后
├── pages/
│   ├── customer/        # index / menu / combo / confirm / order / orders / member / review
│   │                    #   / stores / bill / address / favorites / flash / flashDetail / flashOrders
│   └── merchant/        # login / orders / orderDetail / menu / feedback / stats / coupons / refundRequests
├── static/food/         # 菜品图（打包资源）
├── tests/               # 自动化测试
│   ├── rules.test.js    # 业务规则单元测试（零依赖）
│   ├── _check.js        # 页面/组件/混入/模块语法自检
│   ├── _audit_methods.js# 事件函数是否都在 methods 内
│   ├── _e2e_mock.js     # mock 全链路测试（217 项，无需后端）
│   ├── _e2e2.js         # 后端联调测试（需启动 Spring Boot）
│   └── _verify_backend.py
├── scripts/             # 运维与演示脚本
│   ├── _demo.js / _sim_demo_orders.js
│   ├── upload-ci.js     # 小程序 CI 上传
│   └── db/              # 数据库初始化/重置 SQL
├── docs/                # 产品说明与审查报告
├── assets/backup-food/  # 菜品图历史备份（不参与打包）
├── package.json         # npm scripts（test / lint）
└── .github/workflows/ci.yml
```

### 与原生工程的关键差异（迁移已处理）

| 原生小程序 | uni-app 写法 |
|-----------|-------------|
| `Page({})` / `Component({})` | `export default {}`（单文件组件 `.vue`） |
| `wx:for` / `wx:if` / `wx:key` | `v-for` / `v-if` / `:key` |
| `bindtap` + `data-index` | `@tap="fn(index)"` 直接传参 |
| `this.setData({a:1})` | `this.a = 1` |
| `<wxs>` 金额格式化 | `methods.fmt()` |
| `wx.request` | `uni.request` |
| `wx.getStorageSync` | `uni.getStorageSync` |
| `wx.cloud`（云开发） | **已移除**：uni-app 不支持，改走 `useMock` 或 HTTP 后端 |

---

## 二、用 HBuilderX 连接微信小程序运行

> 前置：安装 [HBuilderX](https://www.dcloud.net.cn/hbuilderx.html) 与[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)，并扫码登录同一微信账号。

### 步骤 1：打开微信开发者工具的服务端口
1. 打开微信开发者工具 → 右上角「设置」→「安全设置」
2. 打开 **「服务端口」**（默认开启，若被关掉请重新开启）
3. 记下端口号（默认 `19021` 之类，无需手填，HBuilderX 会自动发现）

### 步骤 2：在 HBuilderX 里配置微信开发者工具路径
1. HBuilderX 顶部菜单「运行」→「运行到小程序模拟器」→「运行设置」
2. 在 **微信开发者工具安装路径** 里，指向你机器上的 `微信开发者工具.exe`
   - 常见路径：`C:\Program Files (x86)\Tencent\微信web开发者工具\微信开发者工具.exe`

### 步骤 3：导入并运行
1. HBuilderX →「文件」→「打开目录」，选择本工程 `E:\uni-restaurant`
2. 选中 `uni-restaurant` 项目根，点顶部菜单 **「运行」→「运行到小程序模拟器」→「微信开发者工具」**
3. HBuilderX 会先编译（`.vue` → `unpackage/dist/dev/mp-weixin`），再自动调起微信开发者工具加载产物
4. 之后**改代码请在 HBuilderX 里改**，保存即自动重新编译；在开发者工具里手改会被下次编译覆盖

> ⚠️ 常见坑：HBuilderX **只能运行 uni-app 工程**，无法接管原生小程序。
> 原生工程只有 `app.json`，uni-app 需要 `manifest.json`+`pages.json`+`.vue`，二者不是一回事。

---

## 三、两种数据模式（改一个开关即可）

打开 `common/config.js`：

```js
module.exports = {
  useMock: false,   // ← 改这里
  apiBase: 'http://localhost:8080/api'
};
```

### 模式 A：本地模拟（无需后端，推荐先跑通）
```js
useMock: true
```
- 走 `common/mock.js`，用 `uni.storage` 模拟全部云函数 action
- 手机号登录验证码只在本地生成并通过 `demoCode` 返回，页面自动填入；**不会发送短信，也不能用于验证生产短信接入**
- 首次调用自动播种演示数据（3 门店，**每店** 6 分类 / 17 个顾客可见菜品；三店共用同一套菜单，首页「就近推荐」切到任一门店都能正常展示）
- 在微信开发者工具里**直接能跑**，不依赖任何服务器

### 模式 B：连真实后端（Spring Boot）
```js
useMock: false
```
- 走 `common/http.js`，请求本机 `http://localhost:8080/api`
- 需先启动后端 `restaurant-server`（见下方「四」）
- 接口映射：`cloudOrder/create` → `POST /api/order`、`cloudMenu/getShopMenu` → `GET /api/menu` …（详见 `common/http.js` 注释）
- 手机号验证码的演示/生产行为由后端 profile 和短信供应商配置决定；`useMock: false` 本身不代表真实短信已接通

### 真机预览的额外设置（模式 B 才需要）
微信开发者工具默认只放行 localhost。用手机预览时：
1. 把 `config.js` 里的 `apiBase` 改成电脑局域网 IP，例如 `http://192.168.1.10:8080/api`
2. 微信开发者工具 → 详情 → 本地设置 → 勾选 **「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」**
   （`manifest.json` 已设 `mp-weixin.setting.urlCheck:false`，模拟器内可省，真机仍需勾）

---

## 四、后端（可选，模式 B 用）

后端是独立的 Spring Boot 工程 `restaurant-server`（与本工程平级或自行放置）：

```bat
cd restaurant-server
start-server.bat        :: 默认强制端口 8080，启动后访问 http://localhost:8080/api
```

启动后，商家端「一键初始化演示数据」会 `POST /api/shop/init-demo` 建好 `demo-shop` 及示例菜单。
后端细节见 `restaurant-server/截图指引.md`。

---

## 五、自检与测试

```bash
npm install          # 首次安装 ESLint 等开发依赖
npm test             # 规则单测 + 语法自检 + mock 全链路（217 项）
npm run lint         # ESLint（页面 / 组件 / 公共模块 / 测试）
npm run audit:methods# 事件函数是否都挂在 methods 内
```

| 命令 | 作用 |
|---|---|
| `npm run test:rules` | `common/rules.js` 的优惠/等级/积分/配送规则单测（零依赖） |
| `npm run test:syntax` | 用 `vm.Script` 编译 41 个页面/组件/混入/模块，查低级语法错误 |
| `npm run test:mock` | 无需后端，跑 mock 全链路 217 项断言 |
| `node tests/_e2e2.js` | 后端联调测试（需先启动 MySQL 与 Spring Boot） |

> CI：`.github/workflows/ci.yml` 会在 push / PR 时执行 `npm run lint` 与 `npm test`。
> `tests/_e2e_mock.js` 会自造 `uni` 桩跑 `common/mock.js`，验证「前端显示金额」与
> 「服务端实收金额」使用同一套规则。

`_e2e_mock.js` 会自造 `uni` 桩跑 `common/mock.js`。它的存在意义是：
**mock 与后端必须算出同一个金额**，否则课堂上切换数据源演示时，
「显示的优惠」与「实收的钱」会对不上。两个脚本的断言文案刻意写成同一句，
方便一眼比对两端行为是否漂移。

---

## 六、顾客投诉 / 反馈功能（哪个菜不好吃 → 改进）

### 顾客怎么用
1. 下单付款后进入「我的订单」页（`customer/order`）
2. 每道菜右侧有 **「反馈」** 按钮 → 点开弹出原因选择（`味道不好 / 太咸 / 太淡 / 不新鲜 / 分量少 / 其他`）
3. 选完即提交，写入后端 `complaint` 表

### 商家怎么看
- 商家端「订单管理」页底部新增 **「顾客反馈」** 入口 → `merchant/feedback` 看板
- 按菜品聚合，**被投诉次数从高到低排序**；单道菜投诉 ≥3 次会标红提醒
- 每道菜展示投诉次数 + 出现过的原因标签 + 最近一次时间

### 接口
| 前端调用 | 后端接口 | 说明 |
|---------|---------|------|
| `cloudFeedback/create` | `POST /api/complaint` | 提交一条投诉（reason 必填） |
| `cloudFeedback/list` | `GET /api/complaint?shopId=&orderId=` | 明细列表 |
| `cloudFeedback/stats` | `GET /api/complaint/stats?shopId=` | 按菜聚合，返回 `{dishId,dishName,count,reasons,lastTime}` |

> `reason` 常量统一放在 `common/format.js` 的 `FEEDBACK_REASONS`，改选项只改这一处。

---

## 六（续）、收货地址、优惠券管理与售后申请

- **会员地址**：已登录会员通过 `X-Member-Token` 使用云端地址簿；接口失败会明确报错，不会回退到本地地址或覆盖账号地址。未登录访客/演示模式继续使用设备本地地址簿。
- **商家优惠券**：商家订单页进入「优惠券管理」，可查看、新建、编辑、启用和停用券模板；字段为名称、使用门槛、减免金额、有效天数、总发行量（`0` 表示不限）和每人限领数。
- **售后退款**：顾客可在已支付、制作中、已出餐或已送达订单申请售后；商家在「售后申请」审核并填写处理说明。

| 前端调用 | HTTP 接口 | 说明 |
|---------|-----------|------|
| `cloudAddress/list/create/update/delete` | `GET/POST /api/member/addresses`、`PUT/DELETE /api/member/addresses/{id}` | 会员身份只从 `X-Member-Token` 读取 |
| `cloudCoupon/adminList/adminCreate/adminUpdate/adminToggle` | `GET/POST /api/admin/coupons`、`PUT /api/admin/coupons/{id}`、`PATCH /api/admin/coupons/{id}/status?status=on|off` | 商家模板管理 |
| `cloudRefund/create` | `POST /api/order/{id}/refund-request` | 顾客提交 `{reason}` |
| `cloudRefund/get` | `GET /api/order/{id}/refund-request` | 查本人订单最新申请；无申请返回 `data: null` |
| `cloudRefund/list/decision` | `GET /api/admin/refund-requests?shopId=&status=`、`POST /api/admin/refund-requests/{requestId}/decision` | 商家提交 `{decision,note}` |

本地 mock 覆盖以上列表、写入与审核流程，便于离线演示；mock 与 HTTP 模式中的 `/pay` 都只是把订单状态改为已支付，**不是真实微信支付**。售后批准同样只是审核结论，**不会创建真实微信退款或代表款项已到账**；商家仍需按支付渠道流程人工处理退款。客户端不保存支付密钥。
售后状态由服务器查询并展示：`pending`、`approved_pending_manual_refund`、`rejected`、`closed_by_cancellation`；“已批准”只表示审核通过，不表示已退款。

**生产支付未实现**：尚未接入支付网关或配置生产支付/退款渠道；当前 `/pay` 仅用于演示。

## 外卖订单进度与界面主题

- 顾客外卖订单详情按订单状态展示「已提交 → 门店接单 → 备餐 → 出餐 → 配送中 → 已送达」进度；自取订单继续显示原有紧凑进度条。
- 配送状态由门店更新，页面轮询现有订单状态；演示系统未接入骑手派单、实时定位或真实支付，不展示虚构的骑手与地图。
- 全站主色采用服务绿与配送蓝，配合冷调浅色背景；红色、橙色仍仅用于取消、待处理等语义状态。

---

## 七、营销与会员（优惠券 / 储值卡 / 评价）

### 核心设计原则：金额一律由服务端算

前端**只传「用哪张券」「要不要用余额」这两个意图，绝不传「减了多少钱」**。
否则把前端改成 `discountAmount: 999` 就能 0 元下单。落点：

- `POST /api/order/quote` —— 无副作用试算，确认订单页每次切换券/开关都调它
- `POST /api/order` —— 真正核销，走的是 `CouponService.consume()`，**与试算同一套规则**

`OrderService.priceItems()` 被 `create()` 与 `quote()` 共用，
避免出现「结算页显示 ¥38、提交后变 ¥42」这种对不上账的情况。

### 优惠规则（四条，按顺序叠加）

计价链固定为 **小计 → 券 → 等级折扣 → 余额 → 积分抵现**，每一步的基数都是上一步的结果。

1. **优惠券**：门槛 `threshold` 满足才可用；减免额最多减到剩 ¥1（不打成 0 元单）
2. **会员等级折扣**：按累计消费分档 —— 0=普通(不打折) / 200=银卡(95 折) / 500=金卡(9 折) / 1000=黑卡(85 折)。
   基数取**券后金额**：券是活动让利，若按原价打折，券让掉的钱也会被再打一次折，商家成本被重复计算
3. **储值余额**：抵扣基数是**券+等级折后金额**，单笔最多抵该金额的 **80%**
4. **积分抵现**：**每 100 积分抵 1 元、按整元抵扣**，单笔最多抵应付金额的 **20%**
   （按整元是为了让「用了多少积分」恒等于「抵了多少钱 × 100」，对账时不用解释小数）

积分在**支付成功时**按实付 1 元 = 1 分累积（不是 `create()`，否则「下单又取消」的白嫖单也刷积分）。
取消订单时两笔方向相反的动作分开处理：**花掉的积分原额退回**、**挣到的积分收回**，
混在一起抵账会出现「花了 500 分只挣到 30 分」的单取消后倒亏 470 分。

> 余额与积分都是**开关**而非默认行为 —— 顾客卡里有钱、账户里有积分，
> 不代表这单就想用，替他花掉属于越权。

### 数据模型

| 表 | 实体 | 用途 |
|----|------|------|
| `coupon` | `Coupon` | 券模板：门槛/面额/有效期/限量/每人限领 |
| `member_coupon` | `MemberCoupon` | 用户**持有**的券：归属、绝对到期时间、核销订单号 |
| `member` | `Member` | 会员：储值余额、积分、累计消费、等级 |
| `review` | `Review` | 菜品评价：1~5 星 + 文字 + 晒图 + **商家回复**（`reply` / `replyTime`） |
| `member_session` | `MemberSession` | 顾客会话令牌（30 天），涉及资产的接口凭它认人 |

`orders` 上的优惠列拆成四个：`discountAmount`(券) / `levelDiscount`(会员折扣) /
`balancePay`(余额) / `pointsPay`(积分)。分开存而不是只留净额，是因为商家复盘时要看到
「原本多少钱、券让了多少、会员权益让了多少」——混成一个字段这个信息就永久丢失了。


拆 `coupon` / `member_coupon` 两张表而非合一：合一则规则会随每张已发出的券重复存 N 份，
商家改活动时无法区分「改模板」还是「改某张已发出的券」。持券上的门槛/面额是**快照**，
模板以后改不影响已发出的券。

四张表均由 JPA `ddl-auto: update` 自动创建，无需手工建表。

### 接口

| 前端调用 | 后端接口 | 说明 |
|---------|---------|------|
| `cloudOrder/quote` | `POST /api/order/quote` | 试算优惠（无副作用） |
| `cloudCoupon/templates` | `GET /api/coupon/templates` | 领券中心，含「我已领几张/还能否领」 |
| `cloudCoupon/my` | `GET /api/coupon/my` | 券包，分 `usable/used/expired` 三区 |
| `cloudCoupon/claim` | `POST /api/coupon/claim` | 领券（限领/限量服务端硬校验） |
| `cloudMember/sendCode` | `POST /api/member/send-code` | 发送手机登录验证码，6 位/5 分钟/60 秒重发/每日 10 条 |
| `cloudMember/login` | `POST /api/member/login` | 手机号 + **验证码**登录，不存在则开户 |
| `cloudMember/recharge` | `POST /api/member/recharge` | 充值，需 `X-Member-Token`（顾客自助，**不要求商户口令**） |
| `cloudReview/create` | `POST /api/review` | 发表评价（须订单已完成且买过该菜） |
| `cloudReview/summary` | `GET /api/review/summary` | 全店评分 + 每菜均分（列表页展示） |
| `cloudReview/reply` | `PATCH /api/review/{id}/reply` | **商家回复评价，需商户口令** |
| `cloudReview/deleteReply` | `DELETE /api/review/{id}/reply` | 撤回回复，评价回到「待回复」 |
| `cloudOrder/list` | `GET /api/order` | **分页**：`shopId/status/tableNo/page/size` |
| `cloudAdmin/exportOrders` | `GET /api/admin/orders/export.json` | 导出 CSV（文本），含 BOM |

> **券 id 有两种**：下单传的是 `member_coupon._id`（持有记录），不是 `coupon._id`（模板）。
> 同一模板可被同一用户领多张，每张到期时间不同，核销的是具体那一张。

### 顾客怎么用

1. 首页顶部「登录享优惠」→ 进 `customer/member`，输手机号即注册
2. 会员中心：充值 / 领券中心领券 / 我的券包；顶部会员卡显示**等级 + 实享折扣 + 积分可抵金额**
3. 结算页 `customer/confirm`：选优惠券 → 打开余额/积分开关 → 费用明细拆六行（原价/券减/会员折扣/余额抵/积分抵现/实付）
4. 订单完成后，每道菜可 **「评价」**（星星 + 文字 + 快速短语）；菜品详情弹层能看真实评价与**商家回复**

### 评价与投诉的区别

两者**独立并存，不要混淆**：
- **投诉**（`cloudFeedback`）：菜品有问题，顾客表达不满 → 商家跟进整改（已有闭环）
- **评价**（`cloudReview`）：菜品还行，顾客打个分 → 沉淀口碑；商家可**回复**，形成双向

### 商家回复评价

入口在 `merchant/feedback`（顾客反馈页）下半部分的「顾客评价」区：
- 排序为**待回复优先 → 星级低优先 → 时间新优先**，打开就是最该处理的
- 1~2 星卡片左侧描边标红
- 回复写在 `review` 同一行（`reply` / `replyTime`），不另建表：一条评价只有一次官方回复，
  建表会多一次 join 却不带来任何表达能力；将来要做多轮对话再拆表，那时 `reply` 原样迁成第一条记录
- **重复回复视为「改口」**（覆盖并刷新时间），不限制只能回一次 —— 打错字、想补充说明都是常态

### 订单数据导出（CSV）

- 小程序端：商家端「经营统计」页底部 **「导出订单 CSV」** → 内容写入剪贴板 → 粘贴到 Excel/WPS 即成表
  （不做「写文件 + openDocument」：官方文档里 `openDocument` 不支持 csv 类型，真机上直接失败）
- 电脑端：浏览器直接打开 `GET /api/admin/orders/export?shopId=` 即触发下载
- 两个入口共用同一段生成逻辑，**逐字节相同**：同表头、同转义、开头同带 **UTF-8 BOM**
  （不带 BOM，Excel 会按 GBK 解析，中文列名全乱码 —— 这是导出功能最常见的投诉来源）

### 列表分页

`GET /api/order` 返回 `{list, total, page, size, hasMore}`：
- `size` 上限 100，防止前端传 `size=99999` 把整库拉出来
- **桌号由数据库筛**（`tableNo` 参数），不是前端筛：原先顾客「本桌订单」把全店订单拉回来再前端过滤，一旦分页，第 2 页里的本桌订单就永远看不到
- 商家端订单列表在 `scroll-view` 里，触底用 `@scrolltolower`（页面级 `onReachBottom` 在这里永远不会触发）
- 订单列表的明细查询从「每单一条 SQL」（N+1）改为 `findByOrderIdInOrderByIdAsc` 一次查回再分组


### 演示券（`DataSeeder.seedCoupons`）

只对 `demo-shop` 发放：连锁三店菜单一样，但营销活动通常只在一个店试点，
体现「券按门店维度独立配置」。播种条件与门店解绑 —— 若绑在「门店表为空」上，
追加活动券就得清空整库重灌。

### 演示会员（后端模式，`DemoMemberSeeder`）

后端模式下新登录的会员是**空账号**（余额 / 积分 / 券全为 0），
要现场充值、现场领券才能演示优惠结算，很影响答辩节奏。
`DemoMemberSeeder` 因此补了一个开箱可用的演示账号：

| 字段 | 值 |
|---|---|
| 手机号 | `13800001234`（昵称「演示会员」） |
| 储值余额 | ¥50 |
| 积分 | 320（= ¥3.2 可抵现） |
| 累计消费 | ¥468 → **银卡（95 折）** |
| 券包 | 2 张未用：无门槛减 5 / 满 30 减 8 |
| 资产流水 | 8 笔（充值 1 + 窗口内赠分 6 + 早期历史 1），末笔快照与档案严格一致 |

> 余额/积分/累计消费三个数与 **mock 层演示账号逐项相同**，切换 `useMock` 演示时
> 会员中心数字不跳变。积分 320 不是窗口内赠分的合计——演示订单只覆盖最近 7 天，
> 更早的消费不在窗口内，差额由播种器自动补一笔「早期消费赠分」流水，
> 重放结果与档案现值强行对齐（不一致会直接抛异常，不存在对不上账的演示数据）。
>
> 累计消费 **468 是刻意选的**：银卡门槛 200、金卡门槛 500，差 ¥32 就升级 ——
> 演示时再下一单就能当场看到等级提升。
>
> **幂等策略：账号已存在就完全不动。** 刻意不做「不足则补足」——
> 顾客可能已经花掉余额或用掉券，每次重启都加回去等于把演示变成作弊。
> 只在一个全新的库上（账号还不存在）才写入。
> 流水表按「该账号流水为空」补播，老库升级上来的账号因此也能有流水可看。

### 演示订单（后端模式，`DemoOrderSeeder`）

后端模式下订单表原本是空的，而订单驱动的三个页面（商家订单看板、经营统计、
顾客本桌订单）恰恰是答辩的主要看点——空着就没法讲。
另外开发期间测试脚本会堆出几十条**无桌号、无会员**的残单，
统计出来的 7 日趋势会出现莫名为 0 的断层。

`DemoOrderSeeder` 一次性生成一批**跨 7 天、跨全部状态、带真实桌号与菜品**的订单：

| 项 | 值 |
|---|---|
| 订单数 | 34 单，按天分布 `3 / 4 / 5 / 4 / 5 / 6 / 7`（递增） |
| 状态 | 已完成 27 / 待接单 2 / 制作中 1 / 未支付 1 / 已取消 3 |
| 关联数据 | 6 条评价（2 条带商家回复）、2 条投诉（1 条待处理）|
| 演示账号订单 | 恰好 6 单，与会员档案的「6 单」对得上 |

> 三处刻意的设计：
> ① **全部用确定性规则，不用随机数** —— 任意机器生成的演示数据完全一致，便于对着固定数据写讲稿；
> ② **评价与投诉的文案不指名菜品** —— 它们按顺序挂到不同订单的菜上，写成「招牌牛肉面汤头很足」
> 可能被挂到流沙包上，一眼穿帮；
> ③ **今天留 2 单待接单 + 1 单制作中** —— 演示时商家端一进去就有「活」可干。

### 演示数据三件套与重置方法

| 播种器 | 负责 | 幂等条件 |
|---|---|---|
| `DataSeeder` | 门店 / 分类 / 菜品 / 券模板 | 门店表为空 |
| `DemoOrderSeeder` | 订单 / 明细 / 评价 / 投诉 | **订单表为空** |
| `DemoMemberSeeder` | 演示会员 + 券包 + 资产流水 | 账号不存在才建号；流水按「该账号流水为空」补播 |

**想把演示数据重置成初始状态**（例如答辩前清掉自己试出来的脏数据）：

```sql
DELETE FROM order_item;  DELETE FROM orders;
DELETE FROM review;      DELETE FROM complaint;
DELETE FROM member_coupon; DELETE FROM member_session; DELETE FROM member;
DELETE FROM member_transaction;   -- 2026-10-17 新增的资产流水表，一并清掉
```

然后重启后端即可 —— 三个播种器会按序重建全套演示数据。
（`shop` / `category` / `dish` / `coupon` 不要删，那是 `DataSeeder` 的产物，
删了要连菜单一起重灌。）

---

## 八、经营统计（商家端首页概览）

商家端「订单管理」页底部 **「经营统计」** 入口 → `merchant/stats` 页，一次拉全：

| 指标 | 字段 | 口径 |
|-----|------|------|
| 今日营业额 | `todayAmount` | **只算 `paid`/`preparing`/`done`**，未支付与已取消都不计收入 |
| 今日订单数 | `todayOrderCount` | 今日 0 点起创建的全部订单（含未支付） |
| 待接单 | `pendingCount` | 当前状态为 `paid` 的订单，**跨天累计**，不是今日 |
| 累计订单 / 菜品 / 分类 | `orderTotal` / `dishTotal` / `categoryTotal` | 均按门店过滤 |
| 状态分布 | `statusCount` | 固定五键：`unpaid`/`paid`/`preparing`/`done`/`canceled` |
| 近 7 日趋势 | `daily` | `[{date, orderCount, amount}]`，含今天，营业额与今日同口径 |

- 接口：`cloudAdmin/stats` → `GET /api/admin/stats?shopId=`（`shopId` 可选；
  不传则全局汇总，后台 `static/admin/index.html` 老页面行为不变）
- 图表为**纯 CSS 柱状图 + 条形图**，不引第三方图表库 —— 小程序主包 2MiB 是硬约束
- mock 层 `cloudAdmin` 与后端 `AdminController.stats` **逐字段同源**，
  切换 `useMock` 时两端数字一致（`_verify_stats.js` 曾逐字段比对过）

---

## 九、近期新增功能（2026-10-17）

### 1. 菜品搜索（顾客菜单页）

菜单页顶部常驻搜索框，按**菜名 + 描述**实时模糊匹配，命中片段高亮。
纯前端本地过滤，不新增接口：`menu.vue` 的 `filteredMenu` 计算属性在
「全量菜单」上过滤，分类栏同步显示每类的命中数；搜索时自动展示全部分类
（避免「搜到的菜不在当前分类里却看不到」）。空结果有明确空状态文案。

### 2. 预计等候时间

下单后告诉顾客「大概多久能取」——仿麦当劳取餐体验的关键一环。

- 口径：**基础备餐 2 分钟 + 菜品件数 × 1 分钟，封顶 30 分钟**
  （按件数不按品类：5 份薯条确实比 1 薯条 + 1 可乐更慢；封顶防止超大单
  给出「两小时后可取」这种没人信的数字）
- `mock.js` 的 `estimateWaitMinutes` 与后端 `OrderService.estimateWaitMinutes`
  **逐字同源**；`orders.wait_minutes` 列随单落库，历史单也能展示
- 顾客端两处可见：结算页费用明细下方「预计 X 分钟可取」、订单状态页
  「预计 X 分钟可取（约 HH:MM）」

### 3. 菜单扩充（9 → 17 个顾客可见菜品）

补全「热销 / 主食 / 饮品 / 小吃」各线，新增 8 个菜品：

| 菜品 | 价格 | 分类 | 菜品 | 价格 | 分类 |
|---|---|---|---|---|---|
| 板烧鸡腿堡 | ¥24 | 热销 | 柠檬红茶 | ¥9 | 饮品 |
| 台式卤肉饭 | ¥22 | 主食 | 香芋奶茶 | ¥13 | 饮品 |
| 酸菜鱼面 | ¥30 | 主食 | 葡式蛋挞 | ¥8 | 小吃 |
| 黄金洋葱圈 | ¥12 | 小吃 | 香甜玉米杯 | ¥7 | 小吃 |

- `mock.js`、`DataSeeder.java`、`static/food/` 三端同源同序；
  **刻意整体追加在套餐分区之后**，不打乱前 15 项的下标 ——
  `seedDemoData` 按下标取菜，`_e2e_mock` / `_e2e2` 的套餐虚拟 ID
  写死了 `d9@d13`（双层吉士汉堡@中杯可乐），插前面会让演示订单与套餐测试整片错位
- 配图为 AI 生成（144px / JPEG q70，单张 ≤6KB），主包体积增量约 34KB，仍守住 2MiB 上限
- 门店演示库需手工补菜（`DataSeeder` 幂等，已有门店不会重播）：

```sql
-- 三个门店各插 8 个新菜品（分类 c0=热销 c1=主食 c2=饮品 c3=小吃）
INSERT INTO dish (_id, shop_id, category_id, name, price, description, image, status, create_time, update_time)
VALUES ('demo-shop-d15','demo-shop','demo-shop-c0','板烧鸡腿堡',24.00,'炭烤鸡腿排，秘制酱料','/static/food/d15-grilled-chicken-burger.jpg','on',0,0);
-- …其余 7 个菜品 × 3 门店同理，ID 下标 15-22 与图片文件名一一对应
```

### 4. 会员资产流水（`customer/bill` 页）

此前会员资产只有 `member` 表上的两个数（balance / points），
「钱花哪去了、积分怎么少的」只能翻订单猜。新增 `member_transaction` 表后，
每一笔变动可追溯：**变动额、变动后快照、关联订单号**。

- 入口：会员中心「资产流水」（资产卡片右下角）
- 七种流水类型（前端按 type 匹配图标，红入绿出）：
  `recharge` 充值 / `consume` 余额抵扣 / `points_pay` 积分抵现 /
  `earn` 消费赠分 / `refund` 取消退余额 / `refund_points` 退回抵扣积分 /
  `reclaim_points` 收回奖励积分
- 记账原则：**与资产变动同事务落库**（要么都成功要么都回滚，
  不会「余额退了流水没记」）；快照由调用方传变动后的真实值
- 取消订单的退还要**分三笔记**：花掉的原额退回、挣到的收回、余额加回 ——
  混成一笔记会出现「花了 500 分只挣到 30 分」取消后倒亏 470 分
- 接口：`cloudMember/transactions` → `GET /api/member/transactions?userId=`
  （会员会话认人，查他人流水被拒）
- **时间戳严格单调递增**：取消订单连记三笔发生在同一毫秒，
  时间戳相同则倒序查询顺序不稳，账单页按「首笔=最新」取快照会拿到旧值
  （后端 `AtomicLong` CAS、mock 层游标，两端同思路）

> 演示账号的流水由 `DemoMemberSeeder` 从真实订单反推播种，末笔快照与档案现值
> 强行对齐；mock 层的流水种子同样从订单程序化反推 —— 两边都不手写数字，
> 订单种子一改流水自动跟着改，从结构上杜绝「流水与档案对不上」。

---

## 十、已知约定 & 注意事项

- **订单状态机**：`unpaid → paid → preparing → done`，`canceled` 为终态。
  商家端「完成出餐」会把状态置 `done`，顾客端 `order` 页轮询会显示「已完成」。
- **支付为模拟**：演示环境直接把订单置 `paid`，未接真实微信支付（需商户资质）。
- **退款不自动到账**：售后批准只记录商家审核结果；真实退款需商家另行人工发起，当前客户端没有接入微信退款。
- **图片**：17 道顾客可见菜品均带配图，存放在 `static/food/`，随小程序一起打包（不走云存储、不依赖网络）。
  其中 9 张为 Pexels 实拍图、8 张为 2026-10-17 扩充菜单时生成的 AI 配图（144px / JPEG q70，单张 ≤6KB，原图备份在 `_backup_food_assets/`）。
  后端数据库 `dish.image` 存的是项目内相对路径 `/static/food/xxx.jpg`，前端 `<image>` 直接可用；图片缺失时前端回退显示「菜名首字」占位块。
- **投诉表**：后端 `complaint` 表由 JPA `ddl-auto: update` 依 `Complaint` 实体自动创建，无需手工建表。
- 演示店铺固定 ID：`demo-shop`；顾客端无扫码参数时默认进入 `demo-shop`、桌号 `1`。
- **单菜数量上限 99**：前端（`menu.vue` / `combo.vue`）与服务端（`OrderService.priceItems`）各拦一道。
  前端拦是为了体验，服务端那道才是硬约束 —— 绕过页面直接调接口也会被拒。
- **mock 层缓存键**：见 `common/mock.js` 顶部的 `STORE_KEY` 常量（此处不再写死版本号，避免升版后文档漂移）。数据结构变更时升一位即可自动重建缓存，不必手动清。**升版时必须同步改 `_e2e_mock.js` 里硬编码的同一个键**，否则测试会读到 undefined 直接抛异常。

---

## 十一、安全与部署补充说明（近期优化）

### 商户端轻量鉴权
- 所有**改动数据的商户接口**（菜品/分类的增改删、订单状态流转 `PATCH /api/order/{id}/status`、初始化演示数据 `POST /api/shop/init-demo`、图片上传 `POST /api/upload`）现在需要请求头携带 `X-Shop-Token`。
- 口令在 `restaurant-server/src/main/resources/application.yml` 的 `restaurant.admin-key`（可用环境变量 `ADMIN_KEY` 覆盖），**默认 `demo1234`**。
- 商家端登录页已加入「操作口令」输入框，登录后自动保存令牌，后续写接口自动带上；缺令牌会被拦截并返回 `{success:false, msg:"未授权"}`。
- 读取类接口（菜单查询、顾客下单/反馈）不拦截，顾客端体验不受影响。
- **`POST /api/member/recharge`（会员充值）不在商户鉴权范围内** —— 充值的操作主体是**顾客自己**
  （掏钱给自己账户加余额），顾客端不会有 `X-Shop-Token`。
  这里校验的是**会员会话**（`X-Member-Token` 必须属于请求里的 `userId`），与领券、下单同一套。
  > 曾经把它当「往账户加钱的高危操作」要求商户口令，结果顾客点「充值」直接弹
  > 「未授权，请提供正确的商户口令」—— 和 `POST /api/order/{id}/pay` 是同一个错误：
  > **把顾客侧动作当成商户操作**。若将来需要「商家后台代客充值」，应另开 `/api/admin/**` 接口。
- 这是教学演示级防护，**正式上线请替换为微信登录 code2Session + 会话态**。

### 会员登录态：`memberId` + `memberToken` 两半齐全才算登录
会员登录有两个入口，**两条路都必须签发会话令牌**：

| 入口 | 接口 | 前端调用 |
|---|---|---|
| 手机号 + 验证码登录 | `POST /api/member/send-code` → `POST /api/member/login` | `cloudMember/sendCode` → `cloudMember/login` |
| 微信一键登录 | `POST /api/auth/wx-login` | `cloudMember/wxLogin` |

- 登录返回的档案里带 `memberToken`，前端存进 storage（`common/session.js` 的 `saveLogin`），
  之后 `common/http.js` 自动给每个请求带上 `X-Member-Token`；服务端 `MemberSessionService.requireIdentity`
  凭它认人，**不认请求体里声称的 `memberId`**。
- **要改会员下发的字段，只改 `dto/MemberView.java` 一处**。
  此前 `MemberController` 与 `WxAuthService` 各自手写了一份字段 map，2026-10-16 就漂移了：
  微信登录那份**漏了 `memberToken`**，于是微信一键登录进去的会员，界面显示已登录，
  一充值就报「请先登录后再使用该会员权益」（手机号登录因为签了令牌，一切正常）。
- 前端在 `pages/customer/member/member.vue` 的两个登录分支都加了硬校验：
  **返回里没有 `memberToken` 就直接判定登录失败**，宁可当场报错，也不静默进入
  「界面已登录、什么都干不了」的假状态。
- 存量用户自愈：`common/session.js` 的 `healLoginState()` 在 `App.vue` 的 `onLaunch` 里跑，
  发现「有会员编号、无会话令牌」的残缺登录态就清掉，逼用户重登一次 ——
  否则修了服务端，本地那个假登录态还会一直卡着。

### 手机号登录：必须过短信验证码
- 流程：`POST /api/member/send-code` 发码 → `POST /api/member/login` 带 `{phone, code}` 校验并签发 `memberToken`。
- 服务端规则（`SmsCodeService`，mock 层 `common/mock.js` 逐条同源）：**6 位数字、5 分钟有效、一次性使用、
  60 秒重发间隔、每日 10 条上限、连续输错 5 次作废**。验证码在库里只存 SHA-256 哈希，不存明文。
- **先校验验证码再开户**：验证失败不会产生任何会员记录，避免「验证不过也能凭空建号」并污染手机号主键的关联数据。
- **本地 mock**（`common/config.js` 的 `useMock: true`）和**后端演示模式**
  （`restaurant.sms.demo-mode=true`）都不发送短信：验证码作为 `demoCode` 返回，会员页自动填入并明确提示演示码。
  该模式仅用于本地/课堂演示，不是手机号所有权验证。
- **生产模式**须使用 `useMock: false` 并由服务器运行 prod profile（`application-prod.yml` 将
  `restaurant.sms.demo-mode` 固定为 `false`）。生产 `send-code` 不应返回 `demoCode`；前端只显示请求状态，
  用户手动输入实际收到的 6 位短信验证码。界面上的请求成功提示不等于运营商已将短信送达设备。
  缺少供应商配置或短信发送失败时，后端必须拒绝请求并返回错误，
  不得退回明文演示码或报告发送成功。
- 生产短信需在**后端服务器**设置以下环境变量；它们不是前端构建参数，uni-app 不读取或打包这些值：

  | 环境变量 | 用途 |
  |---|---|
  | `TENCENT_SMS_SECRET_ID` | 腾讯云 API 密钥 ID |
  | `TENCENT_SMS_SECRET_KEY` | 腾讯云 API 密钥（仅服务端密钥存储） |
  | `TENCENT_SMS_APP_ID` | 短信应用 SDK AppId |
  | `TENCENT_SMS_SIGN_NAME` | 已审核通过的短信签名 |
  | `TENCENT_SMS_TEMPLATE_ID` | 已审核通过且与验证码内容匹配的模板 ID |
  | `TENCENT_SMS_REGION` | 腾讯云地域；未设置时默认为 `ap-guangzhou` |

  签名和模板必须先在腾讯云审核通过。缺少任何必需配置、供应商请求失败或签名/模板未获批准时，
  生产 `send-code` 必须 fail closed 并返回错误；**不得回传 `demoCode`、自动退回演示码或伪报发送成功**。
  SecretId/SecretKey 只可注入后端服务器环境或密钥管理服务，绝不可写入小程序、H5、仓库或请求参数。
  不得用真实凭证进行本地 mock 验证。
- 该前端仓库不能证明云端短信已成功送达。启用生产手机号登录前，部署方须确认 prod profile 下的服务端 Tencent
  配置完整、缺配置时 fail closed，并在非生产环境验证真实供应商的发送与回执/错误路径；未完成这些步骤前，
  应将生产手机号短信登录视为**未就绪**，不能宣称真实短信已接通。
- 若登录提示验证码已过期、已使用或尝试次数已用尽，会员页会清空旧码并保留手机号；按按钮倒计时等待后重新获取。
  普通网络错误或验证码输入错误会保留输入，便于重试。

### 商家端图片上传
- 商家新增/编辑菜品时上传实拍图，走 `POST /api/upload`（需令牌），文件存到 `restaurant-server/uploads/food/`，通过 `GET /food/<文件名>` 对外提供，返回**完整可访问 URL** 存入 `dish.image`。
- 顾客端 `<image>` 既能显示打包内的种子图（`/static/food/...`），也能直接加载商家上传的 HTTP 图片 URL。
- 真机预览时，把后端 `restaurant.base-url`（环境变量 `BACKEND_BASE_URL`）改成电脑局域网 IP，否则顾客端加载不到上传图。

### 工程边界说明
- **uni-app 工程（`E:\uni-restaurant`）为当前权威交付物**；同目录外的 `restaurant-miniprogram`（原生微信小程序）已不再维护，仅作历史参考，请勿在原生版上继续改功能。
- 编译产物 `unpackage/` 已加入 `.gitignore`，不要手动编辑其中的 `dist/`，改完请在 HBuilderX 重新编译。

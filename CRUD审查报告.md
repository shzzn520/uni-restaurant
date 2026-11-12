# CRUD 实现审查报告

> 审查对象：`E:\uni-restaurant`（uni-app 前端）+ `restaurant-server`（Spring Boot 3 + JPA + MySQL）
> 审查方式：静态代码审查（实体 / 仓储 / 服务 / 控制器 / DTO / 配置 / 前端页面全覆盖）
> 审查日期：2026-10-26
> 说明：本次审查时 MySQL 未启动，**未做运行时压测**；涉及索引的结论依据「代码中索引声明 + 是否存在手写 DDL」推定，非 `information_schema` 实测。
>
> **2026-10-27 修订**：MySQL 已恢复，做了 `information_schema` 实测，**推定的索引结论有一处被推翻**（见 P1-1，已按实测改写）。同日已执行第一批修复，相关条目下标 ✅。
>
> **2026-11-05 复核（重要）**：距上次审查 10 天，期间代码有大量新增与修复。下方「一、结论摘要」与「三、处理状态总表」中的**原始结论已部分过时**，请优先阅读 [§三之「2026-11-05 现状总表」](#处理状态总表2026-11-05-复核)。P0 级正确性/安全漏洞已基本清零；新增了收货地址、退款售后、券模板管理、登录鉴权改造与单元测试。本轮（11-05）又完成主包拆分、统计接口重构、日志与脱敏、分页能力等收尾项。

---

## 一、结论摘要

**总体判断：业务功能完整度较高，但工程化程度明显落后于功能开发速度。** 系统已经具备真实点单业务的完整链路（下单 → 支付 → 状态流转 → 评价/反馈 → 会员资产 → 统计导出），且在很多细节上体现出明确的工程意识（乐观锁、幂等键、隐私打码、双端同源、统一响应信封）。但存在三类系统性问题：

1. **并发正确性存在两个可复现的漏洞**（领券超发、幂等失效），都属于「代码看起来对、并发下错」的类型；
2. **数据库索引基本为零**，13 张表只有 1 张声明了索引，所有高频查询都是全表扫描；
3. **CRUD 覆盖不均衡**——`Dish` 有完整增删改查，而**券模板、门店、分类改、会员资料、评价删除完全没有写接口**，管理员无法通过接口管理这些核心数据。

**关键数字**（括号内为 2026-10-27 第一批修复后的值）

| 维度 | 审查时 | 修复后 |
|---|---|---|
| 实体 / 仓储 / 服务 / 控制器 / DTO | 13 / 13 / 9 / 12 / 8 | — |
| REST 端点总数 | 45 | **46**（+logout） |
| `@Valid` 覆盖的控制器 | **3 / 12** | 3 / 12（未动） |
| 声明了索引的实体 | **1 / 13** | **10 / 13**（21 条 @Index） |
| 库里实际索引数 | 8 | **34** |
| 做了分页的列表接口 | **1 / 5** | 1 / 5（未动） |
| `@Version` 乐观锁覆盖 | 5 / 13 | **6 / 13**（+Dish） |
| `@Transactional` 总数 | 17，其中 **3 个在 Controller 层** | 未动 |
| 单元测试 | **0**（`src/test/` 不存在） | 未动 |

**2026-11-05 复核后的当前值**：**16 实体 / 16 控制器 / 59 端点**；`@Valid` **6/16** 控制器；`db/schema.sql` **16 表 / 27 索引**；`src/test/` **5 个 JUnit 类**；Controller 层 `@Transactional` **0**；分页能力 **4 个端点**（可选参数）；主包 **1.697 MiB**。

---

## 二、CRUD 覆盖矩阵

> ✅ 已实现　⚠️ 部分　❌ 缺失

| 实体 | Create | Read | Update | Delete | 评价 |
|---|---|---|---|---|---|
| `Dish` 菜品 | ✅ `POST /dish` | ✅ `GET /menu` | ✅ `PUT /dish/{id}` + `PATCH .../status` | ✅ `DELETE /dish/{id}` | **唯一完整 CRUD，可作范本** |
| `Category` 分类 | ✅ `POST /category` | ✅ 随 `/menu` | ❌ | ✅ `DELETE /category/{id}` | **不能改名、不能调排序** |
| `Shop` 门店 | ❌ | ✅ `GET /shop`、`/shop/list` | ❌ | ❌ | 只能靠 `DataSeeder` 写死 |
| `Order` 订单 | ✅ `POST /order` | ✅ `/order`、`/order/{id}` | ✅ `PATCH .../status`、`/pay` | ❌ | 不硬删是**正确设计**；但无退款 |
| `OrderItem` 明细 | 随订单 | 随订单 | ❌ | ❌ | 正确（下单时快照） |
| `Review` 评价 | ✅ `POST /review` | ✅ `list`/`byDish`/`summary` | ✅ 商家回复/删回复 | ❌ | **商家无法下架恶意差评** |
| `Complaint` 投诉 | ✅ `POST /complaint` | ✅ `list`/`stats` | ✅ `PATCH .../status` | ❌ | |
| `Coupon` **券模板** | ❌ | ✅ `GET /coupon/templates` | ❌ | ❌ | **最大缺口：无法建券/停发/改面额** |
| `MemberCoupon` 持券 | ✅ `claim` | ✅ `GET /coupon/my` | ✅ 下单核销 | ❌ 退券 | 取消订单有回滚，无独立退券接口 |
| `Member` 会员 | ✅ 登录开户 | ✅ `GET /member` | ❌ | ❌ | **不能改昵称、不能注销** |
| `MemberSession` 会话 | ✅ 登录签发 | ✅ 内部解析 | — | ✅ 过期清理 | **无主动 logout 接口** |
| `MemberTransaction` 流水 | ✅ 内部记账 | ✅ `/member/transactions` | ❌ | ❌ | 正确（审计记录不可改） |
| `SmsCode` 验证码 | ✅ `send-code` | ✅ 内部校验 | — | ✅ 消费即删 | 正确 |
| **收货地址** | ❌ | ❌ | ❌ | ❌ | **后端无实体，仅存前端 localStorage** |

**矩阵暴露的两个结论：**

- **不是「CRUD 写得不全」，而是「写接口的分布严重不均」**：顾客侧动作（下单、领券、评价）接口齐全，管理员侧的数据维护接口大面积缺失。真实门店运营中，「改一个门店营业时间」「停发一张券」是天天要做的事，现在只能改数据库或改代码。
- **`Dish` 是唯一实现完整的资源**，可作为其余实体补齐写接口时的参考范式（`@Valid` + 状态校验 + 更新时间戳）。

---

## 三、按优先级分类的改进建议

### 处理状态总表（2026-11-05 复核）

> **本表是当前有效状态**。10-27 的表保留在下方作为历史记录，不要再按它执行。

| 编号 | 事项 | 状态 | 说明 |
|---|---|---|---|
| P0-1 | 领券并发超发 | ✅ 已修复 | `findByIdForUpdate` 悲观锁 |
| P0-2 | 订单号碰撞 | ✅ 已修复 | 6 位随机 + 冲突重试 |
| P0-3 | 下单幂等失效 | ✅ 已修复 | unique 约束 + 控制器层重试回查 |
| **P0-4** | **鉴权默认放行** | ✅ **已修复（10-27 后）** | `AuthInterceptor` 改为白名单式**默认拒绝**：`publicWrites` 放行顾客侧写、`protectedReads` 保护 `GET /api/admin/**` |
| P0-5 | 令牌无法吊销 | ✅ 已修复 | `/api/member/logout` |
| P1-1 | 索引未版本化 | ✅ 已修复 | 16 表 / 27 索引写入 `db/schema.sql`，新表 `member_address`、`refund_request` 均带索引 |
| **P1-2** | **统计全表加载** | ✅ **已修复（11-05）** | `AdminController.stats` 原为约 **17 次全量遍历**（7 天各一次 + 状态分布约 10 次 `stream().count()`），重构为**单次遍历聚合**，返回结构与营业额口径不变 |
| **P1-3** | **列表无分页** | 🟡 **能力已就绪（11-05）** | 新增 `common/PageSlice`；`transactions`、`review`、`review/byDish`、`complaint` 支持可选 `page`/`size`，**不传即全量**以保持前端兼容。数据库层分页下推与前端接入仍待做 |
| **P1-4** | **券模板无写接口** | ✅ **已修复（10-27 后）** | `AdminCouponController`：list / create / update / `PATCH status` 上下线。无硬删除是刻意设计（历史券不能被抹掉） |
| P1-5 | `Dish` 缺 `@Version` | ✅ 已修复 | `@Version` + `VersionBackfill` 回填 |
| — | **收货地址服务端化** | ✅ **已完成（10-27 后）** | `MemberAddressController` 完整 CRUD + 索引 |
| — | **退款 / 售后** | ✅ **已完成（10-27 后）** | `RefundRequestController` + 商家审核页；批准仅记录结果、需人工退款（页面已明示） |
| — | **评价删除** | ✅ **已完成（10-27 后）** | `DELETE /api/review/{id}` |
| — | **单元测试** | ✅ **0 → 5 个 JUnit 类** | 含 2 个 `@DataJpaTest`、鉴权拦截器与短信并发测试 |
| — | **参数校验** | 🟡 **3/12 → 6/16 控制器** | 新增的券模板/地址/售后接口都用了 `@Valid`，老接口仍是裸 Map |
| — | **日志与脱敏**（11-05） | ✅ 已修复 | `GlobalExceptionHandler` / `OrderController` / `UploadController` 改 SLF4J；上传不再回传 `e.getMessage()`（含磁盘路径）；未映射路径从「服务器内部错误」改为「接口不存在或路径错误」 |
| — | **Controller 层 3 处 `@Transactional`**（11-05） | ✅ 已清理 | `ReviewController` 三处均为「单表读 + 一次 save」，`save` 自带事务，注解是冗余；直接删除而非机械下沉 Service |
| — | **主包体积**（11-05） | ✅ **已缓解** | 5 个低频页移入分包，**1.889 → 1.697 MiB**，余量 114 → **310 KB**；页面路径与跳转 URL 完全不变 |

**仍未处理（含判定为不改的项）**

| 事项 | 判断 |
|---|---|
| `shop` / `sms_send_lock` 无二级索引 | **无需改动**：`shop` 仅 3 行，`sms_send_lock` 主键即 `phone`，查询已走主键。上一版把它列为待办属于结论过头，此处更正 |
| 删除菜品检查引用 / 软删除 | **判定跳过**：演示库 46 单几乎覆盖全部菜品，硬加引用检查会让商家端删除按钮全部失效，属「改了反而退化」；需要时应改为软删除 + 全查询过滤，单独一轮做 |
| `Dish` 无 `sort` 字段 | **待做**：需配套前端拖拽排序才有意义，单加字段无收益 |
| 失败一律 HTTP 200 | **待做**：前端靠 `success` 判错，改真实状态码需同步 `http.js`、mock 层、拦截器与全部 e2e 脚本，风险高，应单独提交回归 |
| Shop 无 CUD / Member 无资料编辑与注销 | **部分完成**：本仓库新增商家端门店 CRUD 页面、mock 操作及 HTTP 路由；HTTP 模式仍需外部 Spring Boot 服务实现 `POST/PUT/DELETE /api/shop`，Member 资料编辑与注销仍缺失 |
| 游客地址登录后不迁移 | **体验缺口**：游客地址只存 localStorage，登录后不迁移，用户感知是「地址消失」 |
| `@Valid` 未覆盖的老接口、Controller 层其余分层问题 | **低优先**：不影响正确性 |

---

### 历史记录：第一批处理状态（2026-10-27）

| 编号 | 事项 | 状态 | 落地方式 |
|---|---|---|---|
| P0-1 | 领券并发可突破每人限领 | ✅ 已修复 | `CouponRepository.findByIdForUpdate` 加行锁，领取逻辑串行化 |
| P0-2 | 订单号每日仅 9000 组合 | ✅ 已修复 | 生成器改 6 位随机（90 万组合）+ 控制器捕获冲突重试 |
| P0-3 | `client_request_id` 无唯一约束 | ✅ 已修复 | 实体 `unique = true` + 迁移脚本补约束 + 冲突时回查返回已有订单 |
| P0-4 | 鉴权默认放行 | ⬜ 待做 → **11-05 已修复** | 见上方现状总表 |
| P0-5 | 无 logout 接口 | ✅ 已修复 | 后端 `/member/logout` + mock + 前端调用 |
| P1-1 | 索引未版本化 | ✅ 已修复 | 9 个实体补 `@Index`、新增 `schema.sql` 与迁移脚本 |
| P1-2 | 统计全表加载 | ⬜ 待做 → **11-05 已修复** | 见上方现状总表 |
| P1-3 | 4 处列表无分页 | ⬜ 待做 → **11-05 能力就绪** | 见上方现状总表 |
| P1-4 | 券模板无写接口 | ⬜ 待做 → **11-05 前已完成** | 见上方现状总表 |
| P1-5 | `Dish` 缺 `@Version` | ✅ 已修复 | 加 `@Version` + 登记进 `VersionBackfill` |

**第一批验证**：新增 `_e2e_p0.js`（14 项，专测并发，串行脚本照不出来的场景）全部通过；`_e2e2.js` 96/96、`_e2e_mock.js` 141/141 无回归。

---

### P0 —— 正确性与安全（建议立即处理）

#### P0-1　领券并发可突破「每人限领」　✅ 已修复（2026-10-27）

**位置**　`service/CouponService.java:147` `claim()`

```java
long myClaimed = memberCouponRepo.countByUserIdAndCouponId(userId, couponId);
if (c.getPerUserLimit() != null && myClaimed >= c.getPerUserLimit()) {
    throw new BizException("每人限领 " + c.getPerUserLimit() + " 张，你已领过");
}
// ... 中间没有任何锁或唯一约束 ...
memberCouponRepo.save(mc);
```

**问题**　「先 count 再 insert」不是原子操作。两个并发请求同时读到 `myClaimed = 0`，都能通过检查，各自插入一条 → 实际领到 2 张。`member_coupon` 表**没有 `(user_id, coupon_id)` 唯一约束**兜底，数据库层面不会拦。

**理由**　限领规则是优惠券业务的核心风控。`perUserLimit` 目前只是「界面上置灰」，绕过前端直接压接口即可刷券——而领券接口是公开的（只需登录）。

**预期收益**　关闭一个可直接造成营销费用损失的漏洞。

**改动量**　小。加唯一索引 `uk_member_coupon(user_id, coupon_id, coupon_id_seq)`（因限领可能 >1，需引入序号列）或改用 `SELECT ... FOR UPDATE` 锁定 `coupon` 行；最简单的做法是在 `claim` 上用 `synchronized`/Redis 锁按 `(userId, couponId)` 串行化。

---

#### P0-2　`orderNo` 每日只有 9000 种组合　✅ 已修复（2026-10-27）

> **实测修正**：初版说「且无唯一约束」不准确。库里其实**已有 `uk_order_no` UNIQUE**，
> 所以碰撞的后果不是「产生两笔同号订单」，而是**第二笔下单直接失败**
> （唯一键冲突 → 兜底处理器返回「服务器内部错误」）。风险仍然成立，只是失败形态不同。

**位置**　`service/IdGenerator.java:28` `orderNo()`

```java
int rand = (int) (Math.random() * 9000 + 1000);  // 1000~9999，共 9000 种
return "ORD" + date + rand;
```

**问题**　订单号在**同一天内**只有 9000 个可能值，且 `order.order_no` 列没有唯一约束、生成后没有冲突重试。按生日问题估算：

| 日订单量 | 至少一次碰撞的概率 |
|---|---|
| 30 | ≈ 4.8% |
| 100 | ≈ 42% |
| 200 | ≈ 89% |

**理由**　订单号是顾客与店员沟通的唯一凭据（取餐、客服、对账）。两单同号时，`findByOrderNo` 类查询和人工核对都会出错。当前演示数据 40 余单，碰撞概率已接近 8%。

**预期收益**　消除一个「越用越容易出、且出了很难查」的缺陷。

**改动量**　小。改为「时间戳 + 随机/递增序列」（如 `ORD20261026` + 6 位序列），并加 `UNIQUE` 约束 + 捕获重复键重试。

---

#### P0-3　`client_request_id` 无唯一约束 → 下单幂等实际失效　✅ 已修复（2026-10-27）

**位置**　`entity/Order.java:72`、`repository/OrderRepository.java:16` `findByClientRequestId`

```java
@Column(name = "client_request_id", length = 64)   // 没有 unique = true
private String clientRequestId;
```

**问题**　幂等靠「先查后插」实现，同样不是原子操作：两个并发请求带同一个 `clientRequestId`，都查不到 → 都插入 → 产生两笔订单。且该列无索引，每次下单都要全表扫描一次。

**理由**　这个字段存在的唯一目的就是防重复下单。没有唯一约束，它在并发下等于不存在。而用户连点提交、网络重试恰恰是最容易产生并发的场景。

**预期收益**　让幂等从「大概率有效」变成「数据库保证有效」。

**改动量**　小。`@Column(unique = true)` + 捕获 `DataIntegrityViolationException` 后回查并返回已有订单。

---

#### P0-4　鉴权是「默认放行」，新增写接口天然裸奔

**位置**　`security/AuthInterceptor.java`

```java
private boolean isProtected(String method, String uri) {
    for (Rule r : rules) { if (r.method.equals(m) && match(r.pattern, uri)) return true; }
    return false;   // ← 没命中规则 = 不拦截
}
```

**问题**　规则表是**白名单式的保护清单**，但**判定逻辑是黑名单式的**：只有显式登记的方法+路径才校验，其余一律放行。后果是——将来任何人新增一个 `DELETE /api/xxx`，只要忘了往 `rules` 里加一行，这个接口就是完全开放的。

**理由**　代码注释里已经记录了两次踩坑（`pay`、`recharge` 被误加商户口令），说明规则表本身就是易错点。而「漏加 = 裸奔」比「多加 = 误伤」危险得多：误伤会被测试立刻发现，裸奔可能上线几个月没人在意。

**预期收益**　把「记性」问题转成「默认安全」。新接口默认被保护，开发者必须显式声明「这个接口是公开的」，安全决策从被动遗漏变为主动确认。

**改动量**　中。改为「按 HTTP 方法分流」：`GET` 默认放行、`POST/PUT/PATCH/DELETE` 默认校验，再维护一个 `PUBLIC_WRITES` 显式放行清单（下单、支付、评价、领券、充值等顾客侧动作）。改完必须重跑 `_e2e2.js` 验证顾客主流程不被误伤。

---

#### P0-5　没有 logout 接口，令牌无法吊销　✅ 已修复（2026-10-27）

**位置**　`MemberController` 无 `/logout`；前端 `common/session.js:105` `logout()` 只清本机 storage

**问题**　会话令牌有效期 30 天，登出只在客户端删除，服务端 `member_session` 记录仍然有效。换手机、令牌泄露、他人借用设备登录后，旧令牌在 30 天内始终可用。

**理由**　这是「登出」这个动作的语义基础。当前实现下，「退出登录」只是本机不再发送令牌，而不是令牌失效。

**预期收益**　登出语义正确；为后续「查看登录设备」「一键下线」打基础。

**改动量**　小。`POST /api/member/logout`（带 `X-Member-Token`）删除对应 `member_session` 行；前端 `session.logout()` 改为先调接口再清本地（失败也清本地）。

---

### P1 —— 性能与数据一致性（有量级影响）

#### P1-1　索引没有版本化（实测修正版）✅ 已修复

**位置**　全部 13 个实体。

**⚠️ 初版结论有误，此处按实测改写。** 初次审查时 MySQL 未启动，我依据「代码里只声明了 1 个索引 + 无 `schema.sql` + 无 JPA 关联」推定「13 张表只有主键索引」。**恢复数据库后实测发现：库里其实有一批手工建的索引**，只是**代码里没有声明**：

| 库里已有（代码未声明） | 库里也没有 |
|---|---|
| `orders.uk_order_no`(UNIQUE)、`orders.idx_shop_status`、`orders.idx_create_time`、`order_item.idx_order`、`dish.idx_shop`、`dish.idx_category`、`category.idx_shop`、`sms_code.idx_sms_code_phone_scene` | `client_request_id`、`member.phone/openid`、`member_session.expire_time`、`member_coupon.*`、`review.*`、`complaint.*`、`member_transaction.*`、`orders(shop_id,table_no)` |

**所以真正的问题不是「没有索引」，而是「索引只活在某一台机器的数据库里」**——换台机器、重建库、CI 环境，这些索引全部消失，查询从毫秒退化成全表扫描，而且**不会有任何报错提示**。这比「一开始就没有索引」更危险，因为开发机上一切正常，问题只在别人机器上暴露。

**理由**　`ddl-auto: update` 只是运行时补丁，不是结构版本管理。索引、唯一约束这类**影响正确性与性能的结构**必须有可复现的来源。

**修复（2026-10-27 已执行）**
1. 给 9 个实体补 `@Table(indexes = ...)` 声明（共 21 条），`columnList` 一律用**物理列名**（踩过一个坑：`category.sort` 的物理列是 `sort_no`，写字段名会报 `Unknown column`）；
2. 新增 `src/main/resources/db/schema.sql`（13 表 / 22 索引 / 2 唯一约束，已在临时库上实测可完整建出）；
3. 新增 `db/migration-2026-10-27.sql`（只做 `ddl-auto` 做不到的事：给已有列补唯一约束）。

**实测结果**　索引从 8 个（库内实际数）增至 **34 个**，可在 `information_schema.STATISTICS` 复核。

**预期收益**　新环境一次建表即完整；索引不再依赖「谁的机器」。

---

#### P1-2　经营统计全表加载 + 7 次重复遍历

**位置**　`controller/AdminController.java:58` `stats()`

```java
List<Order> orderEntities = orderRepo.findAll();          // ① 全表读进内存
List<OrderDto> all = orderEntities.stream()
        .map(o -> OrderDto.from(o, List.of())).toList();   // ② 每单构造一个 DTO
...
for (int i = 0; i < 7; i++) {                              // ③ 每天再全量扫一遍
    for (OrderDto o : all) { if (ct < start || ct >= end) continue; ... }
}
```

**问题**　三层叠加：全表加载 → 全量 DTO 构造 → 7 × n 次遍历。订单涨到 1 万单时，打开一次统计页要构造 1 万个 DTO、做 7 万次日期判断。

**理由**　这是典型的「小数据量下完全没问题、数据一多就崩」的写法。统计页是商家每天都要看的页面，且前端每次 `onShow` 都会调用。

**预期收益**　统计接口复杂度从 O(7n) 降到 O(n)（单次遍历分组），配合下推 SQL 可到 O(分组数)；万单规模下响应时间预计从数百毫秒降到几十毫秒。

**改动量**　中。方案 A（改动小）：`findAll()` 换成只查必要列的投影查询 + 单次遍历分桶；方案 B（更彻底）：用 `@Query` 写聚合 SQL：
```sql
SELECT DATE(FROM_UNIXTIME(create_time/1000)) d, status, COUNT(*), SUM(...)
FROM orders WHERE shop_id=? AND create_time>=? GROUP BY d, status
```
口径（营业额只算已支付及之后）必须与 mock 层保持一致，改完两边都要重新对齐。

---

#### P1-3　5 个列表接口中 4 个没有分页

**位置**
- `GET /api/review?shopId=` → `ReviewController:144`
- `GET /api/review/byDish?dishId=` → `ReviewController:163`
- `GET /api/complaint?shopId=` → `ComplaintController:73`
- `GET /api/member/transactions?userId=` → `MemberController:132`

**问题**　全部返回整个结果集。评价与流水是**只增不减**的数据：流水每笔订单至少产生 2 条（赠分 + 消费），一个活跃会员一年就是上千条；评价会随经营持续增长。

**理由**　`Order` 已经做了规范分页（`page/size/hasMore`，且 `size` 上限 100），说明团队清楚该怎么做——只是这 4 处没有跟进。账单页 `bill.vue` 一次拉全部流水，在真机上是可见的卡顿来源。

**预期收益**　账单页首屏数据量从「全部历史」降到 20 条；接口响应体大小与内存占用可预期。

**改动量**　小（沿用 `OrderService.page` 的现成范式）。

---

#### P1-4　券模板完全没有写接口（业务闭环缺失）

**位置**　`CouponController` 只有 `templates` / `my` / `claim` 三个读+领接口

**问题**　券模板 `Coupon` 是营销活动的载体，但**无法创建、无法修改面额/门槛、无法停发、无法删除**。当前只能靠 `DataSeeder` 在初始化时写死 4 张，之后永久不变。

**理由**　这是本次审查发现的最大功能缺口。真实运营中「新客立减 5 元」「周末满 30 减 8」这类活动是不断上下线的；现在改一张券的面额要改代码 + 重启 + 手动改库。

**预期收益**　补齐后，整套优惠体系才真正可运营。也是答辩时最能体现「业务闭环」的一块。

**改动量**　中。后端 3 个接口（`POST/PUT/DELETE /api/admin/coupon`）+ 一个商家端管理页；`Coupon` 已有 `status`（on/off）与 `totalQty`，模型无需改动。

---

#### P1-5　`@Version` 覆盖不足，且冲突提示语义不准　⚠️ 部分修复（Dish 已补，冲突文案待改）

**位置**　`entity/` —— 已有 `@Version`：Coupon、Member、MemberCoupon、MemberTransaction、Order；**缺失**：Review、Complaint、Dish、Category、Shop

**问题**　两件事：
1. `Dish` 缺乐观锁。商家在后台编辑菜品的同时，顾客端可能正在用这份数据下单，两边各自 `save` 会互相覆盖（后写覆盖先写）。当前菜品管理页有「保存中」防连点，但防不住多端并发。
2. `claim()` 里 `c.setClaimedQty(qty + 1)` 是读-改-写，行锁冲突时抛 `OptimisticLockingFailureException`，被全局处理器统一转成**「操作过于频繁，请重试」**。语义上这是错的——用户看到这句话不知道发生了什么，正确提示应是「该券太抢手，已被领完」。

**理由**　乐观锁的价值在于「挡住覆盖」，但挡住的理由要说人话。

**预期收益**　菜品多端编辑不再丢改动；领券失败提示可被用户理解。

**改动量**　小。`Dish` 加 `@Version` + 回填旧行（项目里已有 `VersionBackfill` 机制，按已有范式加即可，注意旧行 NULL 会让该表所有写操作静默失败）；`claim` 里 catch 冲突后改抛 `BizException("该券太抢手，请重试")`。

---

### P2 —— 一致性与可维护性

#### P2-1　`@Transactional` 写在 Controller 层

**位置**　`controller/ReviewController.java:76、181、203`（3 处）

**问题**　业务事务边界定义在表现层。其余 14 处都在 service 层，这 3 处是不一致。

**理由**　Controller 的职责是「协议适配」；事务边界属于业务语义。混在 Controller 里会导致：同一个 service 方法被 Controller A 调用时有事务、被 Controller B 调用时没有；事务范围也难以复用到非 HTTP 入口（定时任务、消息消费）。

**预期收益**　分层清晰，事务边界可复用。

**改动量**　小。把 3 处下沉到 `ReviewService`（目前评价逻辑直接写在 Controller 里，可顺带抽出 service，与 Menu/Order 保持一致）。

---

#### P2-2　所有失败都返回 HTTP 200

**位置**　`exception/GlobalExceptionHandler.java`（4 个 handler 全部 `@ResponseStatus(HttpStatus.OK)`）

**问题**　未授权、参数错误、资源不存在、并发冲突、服务器内部错误，全部是 `HTTP 200 + {success:false}`。

**理由**　这是一个明确的设计取舍（为了让小程序端 `catch` 统一），但它带来三方面代价：
- 网关/负载均衡/APM 无法按状态码统计错误率；
- 浏览器与服务端缓存无法区分成功与失败；
- 标准重试库（识别 5xx 重试）失效，必须自己解析 body。

**权衡建议**　**不建议整体推翻**（前端已全面依赖现有约定，改动面大、收益不明显）。折中方案：仅对 `401/403/404/500` 四类返回真实状态码，业务校验失败（如「该券已领完」）仍用 200 + `success:false`。前端 `http.js` 已经会检查 `statusCode`，兼容成本低。

**预期收益**　监控可用性 + 语义正确，且不破坏现有前端。

**改动量**　小。

---

#### P2-3　日志用 `System.out`，没有结构化日志与 trace id

**位置**　`exception/GlobalExceptionHandler.java` 三处：`System.out.println(...)`、`e.printStackTrace()`

**问题**　没有 SLF4J/Logback，异常只打到标准输出；无时间戳、无级别、无请求上下文，`printStackTrace` 还会输出到 stdout 而非 stderr。

**理由**　线上排查问题第一步就是「找到这个请求的日志」。当前实现下，并发时多个异常的堆栈会交错，无法关联到具体请求。

**预期收益**　异常可检索、可聚合；为后续接入 ELK/Loki 打基础。

**改动量**　小。引入 `@Slf4j`（Spring Boot 已自带 Logback），`log.error("...", e)`；配一个 `MDC` 过滤器注入 `traceId`。

---

#### P2-4　参数校验策略不统一

**位置**　`@Valid` 仅 3 个控制器使用；`ReviewController.create` / `MemberController.login` / `CouponController.claim` 用 `Map<String,Object>` 接参 + 手工 `if` 判断

**问题**　同一项目里存在两种接参风格：DTO + Bean Validation，和裸 Map + 手写校验。裸 Map 的写法丢失了类型信息，也没有统一错误格式。

**对比示例**　`DishDto` 有 `@NotBlank/@DecimalMin`，而 `Review` 的 `rating` 是 `int rating = num(body.get("rating"))` + 手工 `if (rating < 1 || rating > 5)`。两者效果类似，但后者在 Swagger 里没有契约、也不受 `@Valid` 统一处理。

**预期收益**　Swagger 文档自动完整（`OpenApiConfig` 已配好，裸 Map 的接口在文档里是空 schema）；校验错误格式统一。

**改动量**　中。为 Review/Member/Coupon 各建 DTO。

---

#### P2-5　删除不检查引用，且无软删除

**位置**　`service/MenuService.java:158` `deleteDish()`

```java
if (!dishRepo.existsById(id)) throw new BizException(...);
dishRepo.deleteById(id);   // 直接硬删，不检查任何引用
```

**问题**　菜品被删后，`order_item`、`review`、`complaint` 里仍保留该 `dishId`，形成悬空引用。

**实际影响需要区分清楚**（避免夸大）：因为三处都保存了名称快照（`order_item.name`、`review.dishName`、`complaint.dishName`），**历史订单与评价的展示不会坏**。真正的损失是：

1. **没有任何机制阻止误删**——一句 `DELETE /api/dish/d3` 就能抹掉一道有上千条历史订单的招牌菜，且不可恢复（无软删除、无回收站）。
2. **关联关系不自洽**——`review.dishId` / `complaint.dishId` 指向一个不存在的实体。当前没有代码按 `dishId` 反查菜品，所以不报错；但一旦新增「按菜品聚合的运营报表」「菜品详情页展示历史评分」，就会拿到空数据，且很难定位原因。
3. **磁盘上的图片变成孤儿**（见 P2-7）。

**理由**　菜品有「下架」（`status=off`）和「删除」两种语义，前者保留历史关联、后者只应针对从未被点过的菜。当前两者没有边界。

**预期收益**　历史数据自洽；防止不可逆的误操作。

**改动量**　小。`deleteDish` 里加一次 `orderItemRepo` 引用计数，有引用则抛 `BizException("该菜品已有历史订单，请改用下架")`。若之后要做软删除，加 `deleted` 标记 + 全局查询过滤即可。

---

#### P2-6　`Dish` 无排序字段，列表顺序不稳定

**位置**　`entity/Dish.java`（无 `sort` 字段）；`DishRepository.findByShopId` 无 `ORDER BY`

**问题**　分类有 `sort` 字段并按之排序，但**菜品没有**。`findByShopId(shopId)` 不带 `ORDER BY`，MySQL 返回顺序**不做任何保证**：一旦发生 `UPDATE`，行可能被移到页尾，顾客端菜单顺序就会莫名变化。

**理由**　菜单顺序直接影响点单转化（招牌菜要在前面）。当前顺序实际上是「插入顺序」，但这是 InnoDB 的副作用，不是契约。

**预期收益**　菜单顺序可控、可运营（商家可置顶招牌菜）。

**改动量**　小。`Dish` 加 `sort` + `findByShopIdOrderBySortAscCreateTimeAsc`，并为存量数据回填。

---

#### P2-7　上传接口泄露内部信息，且不清理孤儿文件

**位置**　`controller/UploadController.java:74`

```java
} catch (Exception e) {
    return ApiResponse.fail("上传失败：" + e.getMessage());   // ← 会带出磁盘路径
}
```

**问题**　三点：
1. `e.getMessage()` 通常包含本地绝对路径（如 `C:\...`），是信息泄露；这与 `GlobalExceptionHandler` 刻意「不把异常回给前端」的策略**自相矛盾**。
2. 只校验扩展名，不校验 magic byte。一个改名为 `.jpg` 的 HTML 文件会被接受并通过 `/food/**` 对外提供。
3. 菜品删除/换图后，旧文件永久留在磁盘，无清理机制。

**预期收益**　一致性 + 降低上传攻击面 + 控制磁盘增长。

**改动量**　小到中（magic byte 可用 `ImageIO.read()` 判定）。

---

### P3 —— 工程化（长期收益）

#### P3-1　零单元测试

**位置**　`src/test/` 不存在；`spring-boot-starter-test` 已引入但未使用

**问题**　现有验证完全依赖 3 个 Node 脚本（`_e2e2.js` 81 项、`_e2e_mock.js` 95 项、`_demo.js` 22 步）。这些脚本很扎实，但：**必须有 MySQL + 运行中的后端**，无法在 CI 里跑；也无法定位「哪一行业务逻辑错了」，只能告诉你「这个接口结果不对」。

**理由**　本次审查发现的 P0-1/P0-3 都是并发正确性问题，**这类缺陷恰恰是端到端脚本最容易漏的**（单线程串行执行，永远测不出并发窗口）。只有单元测试 + 并发测试才能覆盖。

**预期收益**　计价链（小计→券→等级折扣→余额→积分抵现）这种「纯函数、分支多、金额敏感」的逻辑，用单元测试覆盖的性价比远高于端到端。定价一旦算错，端到端脚本只能发现「金额对不上」，单元测试能指出「是余额 80% 上限那一步舍入方向错了」。

**改动量**　中。建议从 `CouponService.quote` 开始（纯计算，无 IO），配 H2 或 Testcontainers 覆盖 `@Transactional` 场景。

#### P3-2　CORS 配置过宽

**位置**　`config/WebConfig.java:33`

```java
.allowedOriginPatterns("*").allowCredentials(true)
```

**问题**　通配来源 + 允许携带凭证。虽然本项目令牌走请求头而非 Cookie（降低了一部分风险），但这仍是不该带到生产配置的写法。

**预期收益**　上线前需收敛到具体域名白名单。

#### P3-3　收货地址仅存本地，跨设备丢失

**位置**　`pages/customer/address/address.vue:50` —— 注释写明「地址簿走本地存储，不依赖后端表结构扩展」

**问题**　后端无 `Address` 实体。用户换手机、清缓存、重装小程序后地址簿全空。外卖订单本身存了地址快照，所以历史订单不受影响；但「常用地址」这个功能在真实场景下必须跨设备。

**预期收益**　补齐后是「会员资料」体系的一部分，也顺带解决「一键下单」的体验前提。

#### P3-4　状态字段用裸字符串

**位置**　`Dish.status`、`Order.status`、`MemberCoupon.status`、`Coupon.status` 均为 `String`

**问题**　合法值散落在各处的字面量判断里（`"on".equals(...)`、`"delivered".equals(...)`），靠人记。已出现过的隐患：`OrderService.allStatuses()` 必须与 mock 层「同序同全集」，靠注释约束。

**权衡建议**　不必改成 Java enum（会牵动 JPA 映射与前端 JSON），**但应抽成常量类**（`OrderStatus.PAID`），让 IDE 能跳转、编译期能发现拼写错误。

#### P3-5　`OpenApiConfig` 与 `application.yml` 注释提到的东西不存在

**位置**　`application.yml:37` 注释写「执行 `src/main/resources/db/schema.sql`」，但**该文件不存在**

**问题**　配置注释引导后来者去找一个不存在的文件，属于文档漂移。

**预期收益**　补上 `schema.sql`（含索引定义）后，正好一并解决 P1-1。

---

## 四、可以继续实现的功能

按「投入产出比」排序，前三项建议优先。

| # | 功能 | 为什么值得做 | 工作量 |
|---|---|---|---|
| 1 | **优惠券模板管理**（商家端新建/编辑/停发/删除券） | 补齐 P1-4 的功能缺口；营销活动可自主运营；答辩时能讲「完整业务闭环」 | 中 |
| 2 | **订单退款 / 售后流程** | 目前只有「取消订单」且仅限未完成状态；已完成订单出现问题无出口。含退款金额计算（券/余额/积分如何回滚，`CouponService.refund` 已有基础） | 中 |
| 3 | **收货地址服务端化** | 补齐 P3-3；`address` 页 UI 已成型，只缺后端 | 小 |
| 4 | **菜品排序 / 分类排序（拖拽）** | 补齐 P2-6；直接影响点单转化，商家有强需求 | 小 |
| 5 | **评价审核**（商家隐藏/申诉恶意差评） | 补齐 CRUD 缺口；真实经营必备 | 小 |
| 6 | **会员资料编辑 + 注销** | 补齐 CRUD 缺口；注销涉及资产清算，是正式上线的合规要求 | 小 |
| 7 | **经营看板增强**：菜品销量 Top N、时段热力、复购率、客单价 | 现有 `stats` 只有营业额与状态分布，信息量偏薄；且正好借 P1-2 的重构一并实现 | 中 |
| 8 | **库存/售罄管理** | 当前「售罄」是全店手动的 `status=off`；真实场景需要按门店库存自动置灰 | 中 |
| 9 | **操作审计日志**（谁改了什么价、谁发的券） | 多店/多员工场景的基础；也便于答辩讲「可追溯」 | 中 |
| 10 | **限流与防刷**（领券、下单、发短信） | 直接对应 P0-1 的防护纵深；短信发送已是真实成本项 | 小 |
| 11 | **报表导出扩展**（按菜品维度、Excel 格式、自定义时间范围） | 现有 CSV 只有订单维度 | 小 |
| 12 | **多门店后台管理** | 本仓库已补管理界面与 mock CRUD；HTTP 模式需外部 Spring Boot 服务补齐 `POST /api/shop`、`PUT /api/shop/{id}`、`DELETE /api/shop/{id}` | 中 |

---

## 五、建议的执行顺序

如果时间有限，按下面三批推进，每批都是独立可交付的：

**第一批（1~2 天）：补正确性，不加新功能**
1. P0-3 `client_request_id` 唯一约束 + P0-2 `orderNo` 改序列 → 两个小改动，直接消除数据错乱风险
2. P0-1 领券加锁/唯一约束
3. P0-5 logout 接口
4. P1-5 `Dish` 加 `@Version`（用已有 `VersionBackfill` 范式）
5. 改完重跑 `_e2e2.js` / `_e2e_mock.js` / `_demo.js` 三件套

**第二批（2~3 天）：补性能与索引**
6. P1-1 索引 + `schema.sql`
7. P1-3 四处补分页
8. P1-2 统计接口重构（与 mock 层同步改）
9. P0-4 鉴权改默认拒绝（**风险最高的一项，务必单独提交、单独回归**）

**第三批（按需）：补功能**
10. P1-4 券模板管理 → 退款 → 地址服务端化（前三项 ROI 最高）

---

## 六、值得保留的做法

审查中确认，以下几处是超出「课程作业」水准的实现，整改时不要顺手改掉：

1. **计价链全部在服务端**，前端只传「用哪张券/要不要用余额」，金额一律不信前端——`quote` 与 `create` 走同一套 `CouponService.quote`。
2. **下单幂等键**（`client_request_id`）+ **订单归属令牌**（`ownerKey`）覆盖游客场景。
3. **`OrderService.toDtos` 批量查明细**，明确规避了 N+1，注释里写清了「1000 单 = 1001 次 SQL」的后果。
4. **`MemberView` 单一出口**——会员档案下发只有一处，避免手机号/微信两条登录链路的字段漂移（这条是踩过坑后修的）。
5. **`MemberTransactionService.nextStamp()` 用 AtomicLong 游标**，处理「同一毫秒多笔流水」的排序稳定性。
6. **隐私打码分层**：商家看全量、归属人看全量、其他一律打码，且列表接口逐条处理。
7. **双端同源意识**：mock 与后端的每个口径都有对应注释，且 `_e2e_mock.js` 刻意用同一组断言。

---

*本报告基于静态代码审查。若要验证 P0-1 / P0-3 的并发问题，建议用 `ab` 或 `hey` 对 `/api/coupon/claim` 与 `/api/order` 发起 50 并发，观察 `member_coupon` 行数与订单数是否超出预期。*

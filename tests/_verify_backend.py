#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""验证真实后端（MySQL + Spring Boot 8080）的外卖相关能力，与 mock 同源口径比对。"""
import json, urllib.request, urllib.error, sys

BASE = "http://localhost:8080"
PHONE = "13800001234"

pass_n = 0
fail_n = 0
def log(ok, name, extra=""):
    global pass_n, fail_n
    if ok:
        pass_n += 1
        print("  PASS  " + name + ("  " + extra if extra else ""))
    else:
        fail_n += 1
        print("  FAIL  " + name + ("  " + extra if extra else ""))

def call(method, path, body=None, token=None, shop_token=None, expect_fail=False):
    url = BASE + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("X-Member-Token", token)
    if shop_token:
        req.add_header("X-Shop-Token", shop_token)
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read().decode("utf-8")), None
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            return json.loads(raw), e.code
        except Exception:
            return {"raw": raw}, e.code
    except Exception as e:
        return {"error": str(e)}, None

# 1) 登录拿会员令牌（手机号登录已强制短信验证码）
#    演示模式把验证码放在 demoCode 里返回；撞上 60 秒频控就按提示等待重试
import re, time
sent, _ = call("POST", "/api/member/send-code", {"phone": PHONE, "scene": "login"})
m = re.search(r"请 (\d+) 秒后重试", (sent or {}).get("msg", ""))
if (sent or {}).get("success") is False and m:
    time.sleep(int(m.group(1)) + 1)
    sent, _ = call("POST", "/api/member/send-code", {"phone": PHONE, "scene": "login"})
code = ((sent or {}).get("data") or {}).get("demoCode")
log(bool(code), "发送手机登录验证码（6 位）", code or str(sent))

r, _ = call("POST", "/api/member/login", {"phone": PHONE, "code": code, "nickname": "测试"})
token = (r.get("data") or {}).get("memberToken")
log(bool(token), "会员登录签发 X-Member-Token", token or "无令牌")

# 2) 外卖试算：d1(14)+d5(6)=20 < 39 → 配送费 5
q, _ = call("POST", "/api/order/quote", {
    "shopId": "demo-shop", "memberId": PHONE,
    "items": [{"dishId": "demo-shop-d1", "qty": 1}, {"dishId": "demo-shop-d18", "qty": 1}],
    "deliveryType": "delivery"
}, token=token)
log((q.get("data") or {}).get("deliveryFee") == 5, "外卖试算收配送费 5 元（原价未满 39）",
    "deliveryFee=" + str((q.get("data") or {}).get("deliveryFee")))

# 3) 自取同明细不收配送费
q2, _ = call("POST", "/api/order/quote", {
    "shopId": "demo-shop", "memberId": PHONE,
    "items": [{"dishId": "demo-shop-d1", "qty": 1}, {"dishId": "demo-shop-d18", "qty": 1}]
}, token=token)
log((q2.get("data") or {}).get("deliveryFee") == 0, "到店自取不收配送费",
    "deliveryFee=" + str((q2.get("data") or {}).get("deliveryFee")))

# 4) 外卖单不带地址被拒
r4, code4 = call("POST", "/api/order", {
    "shopId": "demo-shop", "memberId": PHONE, "deliveryType": "delivery",
    "items": [{"dishId": "demo-shop-d1", "qty": 1}]
}, token=token)
log(r4.get("success") is False, "外卖单不带地址被拒（服务端硬校验）",
    ("msg=" + str(r4.get("msg"))) if r4.get("msg") else ("code=" + str(code4)))

# 5) 外卖单完整下单
c, _ = call("POST", "/api/order", {
    "shopId": "demo-shop", "memberId": PHONE, "deliveryType": "delivery",
    "receiver": "真实后端测试", "phone": "13900005678", "address": "天河区真实路 8 号",
    "items": [{"dishId": "demo-shop-d1", "qty": 1}]
}, token=token)
oid = c.get("orderId") or ((c.get("data") or {}).get("orderId"))
log(bool(oid), "外卖单下单成功并返回 orderId", oid or str(c))

# 6) 落库校验：配送方式 / 收货信息 / B 前缀 / 配送费 / 配送时间
g, _ = call("GET", "/api/order/" + oid)
d = g.get("data") or {}
log(d.get("deliveryType") == "delivery" and d.get("address") == "天河区真实路 8 号"
    and d.get("receiver") == "真实后端测试" and d.get("phone") == "13900005678",
    "外卖单落库配送方式与收货信息",
    d.get("deliveryType") + " / " + str(d.get("address")))
log(str(d.get("pickupNo") or "").startswith("B"), "外卖取餐号用 B 前缀", str(d.get("pickupNo")))
log(d.get("deliveryFee") == 5, "外卖单配送费服务端算 ¥5（前端不可改）", "deliveryFee=" + str(d.get("deliveryFee")))
log(d.get("deliveryTime") == "立即送", "外卖单默认配送时间=立即送", str(d.get("deliveryTime")))

# 7) 状态机流转：外卖单 done 之后推进 delivering → delivered
flow = ["paid", "preparing", "done", "delivering", "delivered"]
ok_flow = True
for st in flow:
    r7, _ = call("PATCH", "/api/order/%s/status?status=%s" % (oid, st), shop_token="demo1234")
    g7, _ = call("GET", "/api/order/" + oid)
    if not (r7.get("success") and (g7.get("data") or {}).get("status") == st):
        ok_flow = False
        log(False, "状态推进到 " + st, "实际=" + str((g7.get("data") or {}).get("status")))
        break
if ok_flow:
    log(True, "外卖单状态机 done→delivering→delivered 全流转放行",
        "终态=" + str((g7.get("data") or {}).get("status")))

# 8) 终态校验：已送达再退回配送中必须被拒
r8, code8 = call("PATCH", "/api/order/%s/status?status=delivering" % oid, shop_token="demo1234")
log(r8.get("success") is False, "已送达为终态（不能退回配送中）",
    ("msg=" + str(r8.get("msg"))) if r8.get("msg") else ("code=" + str(code8)))

# 9) 镜像：自取单 done 之后不能进配送中
c9, _ = call("POST", "/api/order", {
    "shopId": "demo-shop", "memberId": PHONE,
    "items": [{"dishId": "demo-shop-d1", "qty": 1}]
}, token=token)
oid9 = c9.get("orderId") or ((c9.get("data") or {}).get("orderId"))
for st in ["paid", "preparing", "done"]:
    call("PATCH", "/api/order/%s/status?status=%s" % (oid9, st), shop_token="demo1234")
r9, code9 = call("PATCH", "/api/order/%s/status?status=delivering" % oid9, shop_token="demo1234")
log(r9.get("success") is False, "自取单 已完成→配送中 被拒（与外卖相反）",
    ("msg=" + str(r9.get("msg"))) if r9.get("msg") else ("code=" + str(code9)))

# 10) 演示数据含外卖单
lst, _ = call("GET", "/api/order?shopId=demo-shop&size=100")
orders = ((lst.get("data") or {}).get("list") or [])
deliv = [o for o in orders if o.get("deliveryType") == "delivery"]
log(len(deliv) >= 2, "演示数据含外卖单（商家端可见配送标签）",
    "外卖单 " + str(len(deliv)) + " / 总 " + str(len(orders)) + "，配送费 "
    + "/".join(str(o.get("deliveryFee")) for o in deliv[:6]))

# 11) 门店就近推荐（haversine）：给定坐标应返回距离排序
sl, _ = call("GET", "/api/shop/list?lat=23.1443&lng=113.3246")
shops = ((sl.get("data") or {}).get("shops") or [])
log(len(shops) == 3 and shops[0].get("_id") == "demo-shop",
    "门店就近排序（坐标贴近天河北路店排第一）",
    " -> ".join(s.get("_id") for s in shops))

# 12) 经营统计：daily 带当日 statusCount（点选日期的地基），与订单列表独立重算一致
import datetime
stt, _ = call("GET", "/api/admin/stats?shopId=demo-shop")
sd = stt.get("data") or {}
daily = sd.get("daily") or []
log(len(daily) == 7, "stats.daily 为近 7 日（含今天）", str(len(daily)) + " 天")

STATUS_KEYS = ["unpaid", "paid", "preparing", "done", "delivering", "delivered", "canceled"]
day_status_ok = len(daily) == 7
for dd in daily:
    sc = dd.get("statusCount") or {}
    if not all(k in sc for k in STATUS_KEYS):
        day_status_ok = False
    if sum(sc.values()) != dd.get("orderCount"):
        day_status_ok = False
log(day_status_ok, "每日 statusCount 七键齐全且合计=当日单数（点选日期有数可看）",
    "; ".join(d.get("date", "?") + ":" + str(d.get("orderCount")) for d in daily))

# 独立重算：从订单列表反推今日营业额与最后一天日期串，比对 stats
def revenue_of(o):
    return max(0.0, (o.get("totalPrice") or 0) - (o.get("discountAmount") or 0)
              - (o.get("levelDiscount") or 0) - (o.get("pointsPay") or 0) + (o.get("deliveryFee") or 0))
PAID_LIKE = {"paid", "preparing", "done", "delivering", "delivered"}
midnight = datetime.datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
today_start_ms = int(midnight.timestamp() * 1000)
exp_today = round(sum(revenue_of(o) for o in orders
                     if (o.get("createTime") or 0) >= today_start_ms
                     and o.get("status") in PAID_LIKE), 2)
log(abs(round(float(sd.get("todayAmount") or 0), 2) - exp_today) < 0.01,
    "今日营业额与订单列表独立重算一致",
    "stats=" + str(sd.get("todayAmount")) + " 重算=" + str(exp_today))
today_str = "%02d-%02d" % (midnight.month, midnight.day)
log(bool(daily) and daily[-1].get("date") == today_str, "趋势最后一天是今天",
    str(daily[-1].get("date") if daily else None) + "（期望 " + today_str + "）")

# 清理刚建的测试单（真实库，保持演示数据干净）
for t in [oid, oid9]:
    if t:
        call("PATCH", "/api/order/%s/status?status=canceled" % t, shop_token="demo1234")

print("\n========================================")
print("  通过 %d 项，失败 %d 项" % (pass_n, fail_n))
print("========================================")
sys.exit(1 if fail_n > 0 else 0)

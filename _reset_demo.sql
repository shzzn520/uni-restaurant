-- 2026-10-17 菜单扩充 + 演示数据重置
-- 1) 三个门店各补 8 个新菜品（与 DataSeeder.java / mock.js 同源同序，ID 下标 15-22）
-- 2) 清空 7 张演示表，让 DemoOrderSeeder / DemoMemberSeeder 按新菜品池重建

INSERT INTO dish (_id, shop_id, category_id, name, price, description, image, status, create_time, update_time) VALUES
-- ===== demo-shop =====
('demo-shop-d15','demo-shop','demo-shop-c0','板烧鸡腿堡',24.00,'炭烤鸡腿排，秘制酱料','/static/food/d15-grilled-chicken-burger.jpg','on',1791736675000,1791736675000),
('demo-shop-d16','demo-shop','demo-shop-c1','台式卤肉饭',22.00,'卤肉软糯，酱汁拌饭','/static/food/d16-braised-pork-rice.jpg','on',1791736674000,1791736674000),
('demo-shop-d17','demo-shop','demo-shop-c1','酸菜鱼面',30.00,'酸辣鱼片，手工面条','/static/food/d17-fish-noodle-soup.jpg','on',1791736673000,1791736673000),
('demo-shop-d18','demo-shop','demo-shop-c2','柠檬红茶',9.00,'鲜柠檬现泡，冰爽回甘','/static/food/d18-lemon-black-tea.jpg','on',1791736672000,1791736672000),
('demo-shop-d19','demo-shop','demo-shop-c2','香芋奶茶',13.00,'芋香绵密，Q弹珍珠','/static/food/d19-taro-milk-tea.jpg','on',1791736671000,1791736671000),
('demo-shop-d20','demo-shop','demo-shop-c3','葡式蛋挞',8.00,'酥皮蛋香，现烤出炉','/static/food/d20-egg-tarts.jpg','on',1791736670000,1791736670000),
('demo-shop-d21','demo-shop','demo-shop-c3','黄金洋葱圈',12.00,'外脆内软，蘸酱更香','/static/food/d21-onion-rings.jpg','on',1791736669000,1791736669000),
('demo-shop-d22','demo-shop','demo-shop-c3','香甜玉米杯',7.00,'清甜玉米粒，便携杯装','/static/food/d22-corn-cup.jpg','on',1791736668000,1791736668000),
-- ===== shop-tiyuxi =====
('shop-tiyuxi-d15','shop-tiyuxi','shop-tiyuxi-c0','板烧鸡腿堡',24.00,'炭烤鸡腿排，秘制酱料','/static/food/d15-grilled-chicken-burger.jpg','on',1791736675000,1791736675000),
('shop-tiyuxi-d16','shop-tiyuxi','shop-tiyuxi-c1','台式卤肉饭',22.00,'卤肉软糯，酱汁拌饭','/static/food/d16-braised-pork-rice.jpg','on',1791736674000,1791736674000),
('shop-tiyuxi-d17','shop-tiyuxi','shop-tiyuxi-c1','酸菜鱼面',30.00,'酸辣鱼片，手工面条','/static/food/d17-fish-noodle-soup.jpg','on',1791736673000,1791736673000),
('shop-tiyuxi-d18','shop-tiyuxi','shop-tiyuxi-c2','柠檬红茶',9.00,'鲜柠檬现泡，冰爽回甘','/static/food/d18-lemon-black-tea.jpg','on',1791736672000,1791736672000),
('shop-tiyuxi-d19','shop-tiyuxi','shop-tiyuxi-c2','香芋奶茶',13.00,'芋香绵密，Q弹珍珠','/static/food/d19-taro-milk-tea.jpg','on',1791736671000,1791736671000),
('shop-tiyuxi-d20','shop-tiyuxi','shop-tiyuxi-c3','葡式蛋挞',8.00,'酥皮蛋香，现烤出炉','/static/food/d20-egg-tarts.jpg','on',1791736670000,1791736670000),
('shop-tiyuxi-d21','shop-tiyuxi','shop-tiyuxi-c3','黄金洋葱圈',12.00,'外脆内软，蘸酱更香','/static/food/d21-onion-rings.jpg','on',1791736669000,1791736669000),
('shop-tiyuxi-d22','shop-tiyuxi','shop-tiyuxi-c3','香甜玉米杯',7.00,'清甜玉米粒，便携杯装','/static/food/d22-corn-cup.jpg','on',1791736668000,1791736668000),
-- ===== shop-zhujiang =====
('shop-zhujiang-d15','shop-zhujiang','shop-zhujiang-c0','板烧鸡腿堡',24.00,'炭烤鸡腿排，秘制酱料','/static/food/d15-grilled-chicken-burger.jpg','on',1791736675000,1791736675000),
('shop-zhujiang-d16','shop-zhujiang','shop-zhujiang-c1','台式卤肉饭',22.00,'卤肉软糯，酱汁拌饭','/static/food/d16-braised-pork-rice.jpg','on',1791736674000,1791736674000),
('shop-zhujiang-d17','shop-zhujiang','shop-zhujiang-c1','酸菜鱼面',30.00,'酸辣鱼片，手工面条','/static/food/d17-fish-noodle-soup.jpg','on',1791736673000,1791736673000),
('shop-zhujiang-d18','shop-zhujiang','shop-zhujiang-c2','柠檬红茶',9.00,'鲜柠檬现泡，冰爽回甘','/static/food/d18-lemon-black-tea.jpg','on',1791736672000,1791736672000),
('shop-zhujiang-d19','shop-zhujiang','shop-zhujiang-c2','香芋奶茶',13.00,'芋香绵密，Q弹珍珠','/static/food/d19-taro-milk-tea.jpg','on',1791736671000,1791736671000),
('shop-zhujiang-d20','shop-zhujiang','shop-zhujiang-c3','葡式蛋挞',8.00,'酥皮蛋香，现烤出炉','/static/food/d20-egg-tarts.jpg','on',1791736670000,1791736670000),
('shop-zhujiang-d21','shop-zhujiang','shop-zhujiang-c3','黄金洋葱圈',12.00,'外脆内软，蘸酱更香','/static/food/d21-onion-rings.jpg','on',1791736669000,1791736669000),
('shop-zhujiang-d22','shop-zhujiang','shop-zhujiang-c3','香甜玉米杯',7.00,'清甜玉米粒，便携杯装','/static/food/d22-corn-cup.jpg','on',1791736668000,1791736668000);

-- 演示数据重建：清空后由 seeder 按新菜品池重播（演示账号的 100 万实验余额、
-- 672 实验积分、14 笔历史测试单一并清掉，避免流水页出现对不上账的数据）
-- ⚠️ 必须连 member_transaction 一起清（8 张表）：会员档案会被 seeder 重建，
--    流水不删就会残留一批指向已不存在的会员/订单的记录，流水页对不上账。
--    member_transaction 没有外键约束，TRUNCATE 顺序无关。
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE order_item;
TRUNCATE TABLE orders;
TRUNCATE TABLE review;
TRUNCATE TABLE complaint;
TRUNCATE TABLE member_coupon;
TRUNCATE TABLE member_session;
TRUNCATE TABLE member;
TRUNCATE TABLE member_transaction;
SET FOREIGN_KEY_CHECKS = 1;

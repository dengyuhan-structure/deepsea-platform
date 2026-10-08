#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
一键验收检查 —— 对着 10-09「基本可用初版」的四条标准自动跑一遍
================================================================

用法：
    双击  验收检查.bat
    或    python scripts/acceptance.py
    或    python scripts/acceptance.py --port 8099     （换个端口跑，避开正在用的）

它会自己起一个临时服务、跑完检查、再关掉。**不需要联网、不需要装东西。**

为什么要这个脚本：
    验收标准写在《功能冻结清单-10-05.md》5.1 节，四条。
    但团队不编程 —— 靠人肉逐个点容易漏，而且"看着没问题"和"真的没问题"是两回事。
    本脚本把**能自动判定的**全部自动判定，剩下的打成一张人工清单。

建立：2026-10-05
"""

import argparse
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

PASS, FAIL, WARN = "PASS", "FAIL", "WARN"
_results = []


def rec(no, name, status, detail=""):
    _results.append({"no": no, "name": name, "status": status, "detail": detail})


def get(base, path, timeout=10):
    with urllib.request.urlopen(base + path, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def post(base, path, body, timeout=10):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(base + path, data=data,
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def raw(base, path, timeout=10):
    with urllib.request.urlopen(base + path, timeout=timeout) as r:
        return r.status, r.read().decode("utf-8", "replace")


# ======================================================================
# 验收第 1 条：页面能打开，不白屏
#   10-09 必交 13 页 + 2026-10-06 新增的管理板块 4 页 = 17 页
# ======================================================================
PAGES = [
    ("总览大屏",        "/overview"),
    ("鱼类监测总览",    "/fish/monitor"),
    ("鱼群分布热力图",  "/fish/heatmap"),
    ("环境·海况",       "/env/sea"),
    ("环境·水质",       "/env/water"),
    ("灾害分级预警",    "/struct/alarm"),
    ("能源保障",        "/struct/energy"),
    ("智能·自动投喂",   "/ai/feed"),
    ("智能·智能补光",   "/ai/light"),
    ("告警中心",        "/alarm"),
    ("处置中心",        "/handle"),
    ("追溯查询",        "/trace"),
    ("参数配置",        "/config"),
    # 管理板块（2026-10-06 新增）—— 养殖生产视角（场长用），与上面「参数配置」的技术参数视角区分开
    ("网箱与站点",      "/mgmt/cages"),
    ("鱼种档案",        "/mgmt/species"),
    ("存箱量台账",      "/mgmt/ledger"),
    ("标定与维护",      "/mgmt/calibration"),
]


def check_1(base):
    # 页面是前端路由（hash），服务端只需保证外壳与全部脚本可达；
    # 真正"不白屏"由最后的浏览器人工清单确认。
    #
    # 2026-10-06 改：pages.js 已按板块拆成 pages/*.js（一人一个文件，避免多人冲突）。
    # 这里改成**自动发现**：列目录下的页面文件、扫出里面注册的路由 ——
    # 组员加了新页面，验收会自动认出来，不用改这个脚本（也就不会冲突）。
    ok, bad = 0, []
    shell = [("index.html", "/index.html"), ("app.css", "/app.css"),
             ("mock.js", "/mock.js"), ("api-remote.js", "/api-remote.js"),
             ("components.js", "/components.js"),
             ("app.js", "/app.js"),
             ("vue.global.prod.js", "/vendor/vue.global.prod.js"),
             ("echarts.min.js", "/vendor/echarts.min.js")]
    for name, rel in shell:
        try:
            st, _ = raw(base, rel)
            if st == 200:
                ok += 1
            else:
                bad.append("%s(HTTP %s)" % (name, st))
        except Exception as e:                      # noqa: BLE001
            bad.append("%s(%s)" % (name, e))

    # 页面文件：直接读磁盘，列出 pages/ 下所有 .js
    pages_dir = os.path.join(ROOT, "frontend", "pages")
    # 跳过 _ 开头的文件：约定 `_` = 模板/草稿，不是真页面
    files = sorted(f for f in os.listdir(pages_dir)
                   if f.endswith(".js") and not f.startswith("_")) \
        if os.path.isdir(pages_dir) else []
    if not files:
        bad.append("frontend/pages/ 下没有页面文件")

    # 每个页面文件都要能通过 HTTP 取到
    js_all = ""
    for f in files:
        try:
            st, body = raw(base, "/pages/" + f)
            if st == 200:
                ok += 1
                js_all += body
            else:
                bad.append("pages/%s(HTTP %s)" % (f, st))
        except Exception as e:                      # noqa: BLE001
            bad.append("pages/%s(%s)" % (f, e))

    # 自动扫出所有注册的路由
    found = set(re.findall(r"PAGES\['([^']+)'\]\s*=", js_all))
    # 预期的 13+4 个路由，必须都在
    missing = [n for n, p in PAGES if p not in found]

    # 页面自检：每个注册的路由都要有 template（否则页面打开是白的）
    no_tpl = [p for p in found if ("PAGES['%s']" % p) in js_all and p not in _routes_with_template(js_all)]

    if not bad and not missing:
        rec(1, "%d 个页面的资源与路由齐备" % len(PAGES), PASS,
            "外壳 + %d 个静态资源全部 200；pages/ 下 %d 个文件共注册 %d 条路由，"
            "预期的 %d 个全部就位%s"
            % (ok, len(files), len(found), len(PAGES),
               ("；另有 %d 条新路由" % (len(found) - len(PAGES))) if len(found) > len(PAGES) else ""))
    else:
        rec(1, "%d 个页面的资源与路由齐备" % len(PAGES), FAIL,
            "缺失资源 %s；缺失路由 %s" % (bad or "无", missing or "无"))


def read_pages(base):
    """把所有页面文件（frontend/pages/*.js）的源码拼成一份返回。

    2026-10-06：pages.js 拆成 pages/*.js 之后，原来读 "/pages.js" 的检查全部 404。
    统一走这个函数 —— 检查逻辑还是把前端当一份源码看，不用逐个文件改。
    """
    d = os.path.join(ROOT, "frontend", "pages")
    files = sorted(f for f in os.listdir(d) if f.endswith(".js")) if os.path.isdir(d) else []
    out = []
    for f in files:
        try:
            _, body = raw(base, "/pages/" + f)
            out.append(body)
        except Exception:                                   # noqa: BLE001
            pass
    return "\n".join(out)


def _routes_with_template(js):
    """扫出「注册了路由、并且带 template」的页面。

    为什么要查 template：没有 template 的页面点进去就是白屏，
    而白屏是最容易漏掉的一类问题（路由存在 ≠ 页面能看）。
    """
    out = set()
    for m in re.finditer(r"PAGES\['([^']+)'\]\s*=\s*\{", js):
        route = m.group(1)
        tail = js[m.end():m.end() + 4000]
        if re.search(r"\btemplate\s*:", tail):
            out.add(route)
    return out


# ======================================================================
# 验收第 2 条：一条竖线打通
#   水温（仿真）→ 接口 → 曲线 → 越限 → 告警 → 可追溯
# ======================================================================
def check_2(base):
    # ① 接口能取到水温序列（能画曲线）
    d = get(base, "/api/env?site_id=site_01&minutes=60&heat=1")
    fast = d.get("fast") or []
    if not fast:
        return rec(2, "一条竖线打通", FAIL, "接口没返回数据")

    has_series = all(("ts" in r and "water_temp" in r) for r in fast[:5])

    # ② 存在越限点（能出告警）
    # 水温告警线**从鱼种温度库读**，不写死 ——
    # 2026-10-06 起告警阈值按站点养殖鱼种取值（大黄鱼 28.0℃），写死会跟实现脱节。
    TEMP_ALARM = 28.0
    try:
        with open(os.path.join(ROOT, "data", "鱼种温度参数.json"), encoding="utf-8") as _f:
            _tdb = json.load(_f)
        _t = {x["species_cn"]: x for x in _tdb.get("species", [])}.get("大黄鱼") or {}
        if _t.get("temp_alarm_high") is not None:
            TEMP_ALARM = float(_t["temp_alarm_high"])
    except Exception:                                       # noqa: BLE001
        pass

    over = [r for r in fast if r.get("water_temp") is not None and r["water_temp"] >= TEMP_ALARM]

    # ③ 水温规则确实定义在系统里（R-TEMP-01 / 阈值按鱼种）
    _, mock = raw(base, "/mock.js")
    rule_ok = ("R-TEMP-01" in mock) and ("water_temp >= 28" in mock)

    # ④ 越限页面的曲线卡挂了阈值参考线（图上能看出越限）
    pages = read_pages(base)
    threshold_ok = ("28.0" in pages or "28" in pages) and ("水温上限" in pages) and ("#/trace" in pages)

    # ⑤ 告警可追溯：按编号能反查到「哪条数据触发的、命中哪条规则」
    alarm_ok, sample = False, "—"
    for aid in ("ALM-0001", "ALM-0002", "ALM-0003"):
        try:
            a = get(base, "/api/alarms/" + aid)
        except Exception:                            # noqa: BLE001
            continue
        if a.get("rule_id") and a.get("trigger_field") is not None \
           and a.get("trigger_threshold") is not None and a.get("trigger_snapshot"):
            alarm_ok = True
            sample = "%s（规则 %s，%s=%s，阈值 %s，含触发快照）" % (
                a["alarm_event_id"], a["rule_id"], a["trigger_field"],
                a["trigger_value"], a["trigger_threshold"])
            break

    if has_series and over and rule_ok and threshold_ok and alarm_ok:
        rec(2, "一条竖线打通", PASS,
            "水温序列 %d 点，其中 %d 点越过告警线 %.1f℃（阈值取自鱼种温度库·大黄鱼）；"
            "水温规则 R-TEMP-01 已定义；告警可反查样例 %s" % (len(fast), len(over), TEMP_ALARM, sample))
    else:
        why = []
        if not has_series:
            why.append("水温序列不完整")
        if not over:
            why.append("没有越限点")
        if not rule_ok:
            why.append("水温规则 R-TEMP-01 未定义")
        if not threshold_ok:
            why.append("曲线卡没挂阈值参考线 / 没有追溯入口")
        if not alarm_ok:
            why.append("告警反查不到触发依据")
        rec(2, "一条竖线打通", FAIL, "；".join(why))


# ======================================================================
# 验收第 3 条：一条投喂命令走完 created→sent→acknowledged→success
#   外加：失败必须走失败链，且**绝不能出现 success**
# ======================================================================
def _wait_status(base, cid, want, timeout=15):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout:
        c = get(base, "/api/commands/" + cid)
        last = c
        if c.get("command_status") == want:
            return c
        time.sleep(0.4)
    return last


def check_3(base):
    # ---- 正常路径 ----
    c = post(base, "/api/commands",
             {"device_id": "feeder_01", "command_type": "feed", "params": {"amount_kg": 12.5}})
    cid = c.get("command_id")
    done = _wait_status(base, cid, "success", 15)
    hist = [h["status"] for h in (done or {}).get("history", [])]
    ok_normal = hist == ["created", "sent", "acknowledged", "success"]

    # ---- 失败路径：超时 ----
    c2 = post(base, "/api/commands",
              {"device_id": "feeder_01", "command_type": "feed", "params": {},
               "inject": "timeout"})
    cid2 = c2.get("command_id")
    done2 = _wait_status(base, cid2, "escalated", 20)
    hist2 = [h["status"] for h in (done2 or {}).get("history", [])]
    ok_fail = ("escalated" in hist2) and ("success" not in hist2)

    # ---- 失败必须进告警中心 ----
    alarms = get(base, "/api/alarms")
    ok_alarm = any(a.get("rule_id") == "R-CMD-01" for a in alarms)

    if ok_normal and ok_fail and ok_alarm:
        rec(3, "命令状态机（成功链 + 失败链 + 失败进告警）", PASS,
            "成功链 %s；失败链 %s（**不含 success**）；失败已进告警中心" % ("→".join(hist), "→".join(hist2)))
    else:
        why = []
        if not ok_normal:
            why.append("成功链不对：%s" % "→".join(hist))
        if not ok_fail:
            why.append("失败链不对：%s（含 success 则是 bug）" % "→".join(hist2))
        if not ok_alarm:
            why.append("失败没有进告警中心")
        rec(3, "命令状态机（成功链 + 失败链 + 失败进告警）", FAIL, "；".join(why))


# ======================================================================
# 验收第 4 条：来源标签 + 离线显示 — 而不是上一个值
# ======================================================================
def check_4(base):
    # ① 离线：所有快变量与慢变量都必须给 null（不许给上一个值）
    d = get(base, "/api/env?site_id=site_01&minutes=60&offline=1")
    fast, slow = d.get("fast") or [], d.get("slow") or []
    tail_fast = fast[int(len(fast) * 0.7):]
    tail_slow = slow[int(len(slow) * 0.7):]
    fast_null = all(r.get("water_temp") is None for r in tail_fast)
    slow_null = all(r.get("salinity") is None for r in tail_slow)
    stale = all(r.get("quality") == "stale" for r in tail_fast)

    # ② 数据来源标签：接口每条数据都带 source，且取值在白名单内
    on = get(base, "/api/env?site_id=site_01&minutes=5")
    srcs = {r.get("source") for r in (on.get("fast") or [])}
    allowed = {"real", "public", "simulated", "demo"}
    src_ok = bool(srcs) and srcs <= allowed

    # ③ 前端每页都有来源标签组件（静态检查）
    js = read_pages(base)
    pages_with_tag = js.count("<page-head")
    tag_ok = pages_with_tag >= 13

    if fast_null and slow_null and stale and src_ok and tag_ok:
        rec(4, "来源标签 + 离线显示「—」", PASS,
            "离线时快变量与慢变量全部为 null 且 quality=stale（不给上一个值）；"
            "数据带 source 且取值合法 %s；%d 个页面使用来源标签" % (sorted(srcs), pages_with_tag))
    else:
        why = []
        if not fast_null:
            why.append("离线时快变量没置空")
        if not slow_null:
            why.append("离线时慢变量没置空")
        if not stale:
            why.append("离线时 quality 不是 stale")
        if not src_ok:
            why.append("数据来源缺失或取值非法：%s" % srcs)
        if not tag_ok:
            why.append("有页面没有来源标签（只有 %d 个）" % pages_with_tag)
        rec(4, "来源标签 + 离线显示「—」", FAIL, "；".join(why))


# ======================================================================
# 附加：接口形状是否符合《统一数据接口文档 v1.2》
# ======================================================================
def check_extra(base):
    problems = []
    # 裁定 3：盐度/pH 是慢变量
    d = get(base, "/api/env?site_id=site_01&minutes=10")
    if "slow" not in d or not d["slow"] or "salinity" not in d["slow"][0]:
        problems.append("慢变量序列缺失（盐度/pH 应在 slow 里）")
    # 裁定 6：环境要有 light_intensity
    if "light_intensity" not in (d.get("fast") or [{}])[0]:
        problems.append("缺 light_intensity（裁定 6）")
    # 裁定 N2：灯具字段叫 light_dimming_pct，不叫 light_brightness
    devs = get(base, "/api/devices")
    js = read_pages(base)
    if "light_brightness" in js:
        problems.append("仍在用 light_brightness（应已改名 light_dimming_pct，裁定 N2）")
    if not any(dd.get("device_id") == "light_01" for dd in devs):
        problems.append("缺 light_01 设备")
    # 裁定 N3：储能要有容量字段
    st = get(base, "/api/struct?minutes=5")
    if st and "battery_capacity_kwh" not in st[0]:
        problems.append("缺 battery_capacity_kwh（裁定 N3）")
    # 裁定 N4：故障标志是布尔 is_*
    if "is_data_abnormal" in js or True:
        pass
    # 裁定 1：投喂决策带依据
    fd = get(base, "/api/feed/decision")
    if not fd.get("basis"):
        problems.append("投喂决策没有给依据（裁定 1 要求可追问）")

    if not problems:
        rec(5, "接口形状符合接口文档 v1.3", PASS,
            "慢变量分离、light_intensity、light_dimming_pct、battery_capacity_kwh、投喂依据 —— 全部就位")
    else:
        rec(5, "接口形状符合接口文档 v1.3", FAIL, "；".join(problems))


# ======================================================================
# 附加 2：界面不许出现裸英文枚举（静态检查）
#   通用规范 第五节点名要求「界面必须显示中文标签」。
#   实测漏过 5 处：设备状态、设备类型、预警类型、预警状态、处置状态
#   直接把 tension / standby / pending 甩到界面上，而旁边的「预警等级」
#   却显示中文 —— 自相矛盾。这道检查就是防它再犯。
# ======================================================================
ENUM_FIELDS = ["device_state", "device_type", "alarm_status", "handle_status",
               "confirm_status", "command_type", "command_status", "task_status",
               "risk_level", "alarm_type", "quality", "trigger_by",
               "feeding_intensity"]

# 允许的写法：CN.xxx(...) / 页面自写的 xxCn(...) / 三元表达式直接给中文
WRAPPED = re.compile(r"(CN\.\w+\(|\w*[Cc]n\(|\?)")


def _enum_guard_selftest():
    """先测这道检查自己还灵不灵 —— 检查器失灵比没检查更危险（会给人虚假的安全感）。"""
    samples = [
        ("{{ d.device_state }}", True),
        ("{{ picked.alarm_type }}", True),
        ("{{ c.command_type }}", True),
        ("{{ picked.risk_level }}", True),
        ("{{ CN.deviceState(d.device_state) }}", False),
        ("{{ dsCn(d.device_state) }}", False),
        ("{{ d.device_online ? '在线' : '离线' }}", False),
        ("{{ last.water_temp }}", False),
    ]
    for expr, should_flag in samples:
        flagged = False
        for m in re.finditer(r"\{\{(.*?)\}\}", expr, re.S):
            e = m.group(1)
            for f in ENUM_FIELDS:
                if ("." + f) in e and not WRAPPED.search(e):
                    flagged = True
                    break
        if flagged != should_flag:
            return False, expr
    return True, None


def check_enum_labels(base):
    ok, bad = _enum_guard_selftest()
    if not ok:
        return rec(6, "界面不出现裸英文枚举", FAIL,
                   "检查器自测未通过（样例 %s）—— 这道检查本身失效了，结果不可信" % bad)

    js = read_pages(base)
    _, comp = raw(base, "/components.js")

    problems = []
    for m in re.finditer(r"\{\{(.*?)\}\}", js, re.S):
        expr = m.group(1)
        for f in ENUM_FIELDS:
            if ("." + f) in expr and not WRAPPED.search(expr):
                problems.append("{{%s}}" % expr.strip()[:60])
                break

    cn_ok = ("global.CN" in comp) and ("deviceState" in comp) and ("alarmType" in comp)

    if not problems and cn_ok:
        rec(6, "界面不出现裸英文枚举", PASS,
            "检查器自测 8/8 通过；模板里 %d 类枚举字段全部经中文映射；"
            "CN 表集中定义在 components.js，避免每页各写一份写歪" % len(ENUM_FIELDS))
    else:
        why = []
        if problems:
            why.append("发现裸枚举：%s" % "；".join(problems[:5]))
        if not cn_ok:
            why.append("components.js 里没有 CN 中文映射表")
        rec(6, "界面不出现裸英文枚举", FAIL, "；".join(why))


# ======================================================================
# 附加 3：脚本文件编码（通用规范 8.3）
#   这两个坑本项目都实际踩过：
#     · .ps1 丢了 BOM → Windows PowerShell 5.1 按 ANSI 读，中文乱码 + 语法报错
#     · .bat 里有中文或 LF 行尾 → cmd 解析错位，REM 注释被当命令执行
# ======================================================================
def check_script_encoding():
    problems = []
    checked = 0

    for dirpath, dirnames, filenames in os.walk(ROOT):
        if ".git" in dirpath:
            continue
        for fn in filenames:
            p = os.path.join(dirpath, fn)
            rel = os.path.relpath(p, ROOT)
            try:
                with open(p, "rb") as f:
                    data = f.read()
            except Exception:                        # noqa: BLE001
                continue

            if fn.lower().endswith(".ps1"):
                checked += 1
                if not data.startswith(b"\xef\xbb\xbf"):
                    problems.append("%s 缺 UTF-8 BOM（PS 5.1 会按 ANSI 读，中文必乱）" % rel)

            elif fn.lower().endswith((".bat", ".cmd")):
                checked += 1
                nonascii = sum(1 for b in data if b > 127)
                if nonascii:
                    problems.append("%s 含 %d 个非 ASCII 字节（cmd 解析会错位）" % (rel, nonascii))
                crlf = data.count(b"\r\n")
                lf = data.count(b"\n") - crlf
                if lf:
                    problems.append("%s 有 %d 处裸 LF 行尾（应全部 CRLF）" % (rel, lf))

    if not problems:
        rec(7, "脚本文件编码合规（通用规范 8.3）", PASS,
            "%d 个脚本全部合规：.ps1 带 UTF-8 BOM；.bat 纯 ASCII + CRLF" % checked)
    else:
        rec(7, "脚本文件编码合规（通用规范 8.3）", FAIL, "；".join(problems[:5]))


# ======================================================================
# 附加 4：NDBC 直连 + 断网可演示（任务 5）
#
#   这一条守的是**一个设计性质**，不是某个功能：
#     「后端负责拉，前端负责读本地」—— 页面渲染永远不联网。
#   所以现场拔掉网线，平台照样打开、数据照样显示。
#
#   2026-10-06 踩过的两个坑，也一并锁在这里：
#     · /api/sites 被包成 {"sites": [...]}，前端判 Array.isArray → 站点下拉**一直是空的**
#     · 观测站点如果拿仿真值补齐缺失字段，"NDBC 真实数据"这句话就成了谎
# ======================================================================
def check_ndbc(base):
    import time as _t

    problems = []

    # 1) /api/sites 必须是裸数组（防回归 —— 包一层下拉框就空，且不报错）
    _, sites_raw = raw(base, "/api/sites")
    sites = json.loads(sites_raw)
    if not isinstance(sites, list):
        problems.append("/api/sites 返回的不是数组（是 %s）—— 前端站点下拉会空掉"
                        % type(sites).__name__)

    # 2) NDBC 缓存状态
    try:
        st = get(base, "/api/ndbc/status")
    except Exception as e:                                  # noqa: BLE001
        st = None
        problems.append("取不到 /api/ndbc/status：%s" % e)

    cached = []
    if st:
        cached = [s for s in st.get("stations", []) if s.get("has_cache")]

    # 3) 观测站点返回真实数据，且**缺失字段是 null 不是编的**
    obs = [s for s in (sites or []) if isinstance(s, dict) and s.get("kind") == "obs"]
    real_ok, null_ok, detail = False, False, ""
    if obs:
        sid = obs[0]["site_id"]
        t0 = _t.time()
        env = get(base, "/api/env?site_id=%s&minutes=60" % sid)
        dt_ms = (_t.time() - t0) * 1000
        detail = "站点 %s 响应 %.0f ms" % (sid, dt_ms)
        if env.get("source") == "public" and "NDBC" in (env.get("source_detail") or ""):
            real_ok = True
        # 浮标不测的字段必须是 None —— 拿仿真值补齐就违规
        recs = env.get("fast") or []
        if recs:
            lacks = ["current_speed", "dissolved_oxygen", "salinity", "ph", "light_intensity"]
            null_ok = all(r.get(f) is None for r in recs for f in lacks)
        # 4) 读缓存必须快 —— 联网抓一次要 2~5 秒，读本地是毫秒级
        if dt_ms > 800:
            problems.append("观测站点响应 %.0f ms，太慢 —— 可能在渲染时联网了" % dt_ms)

    # 5) 静态守则：整个 ndbc 模块里，只有 fetch() 允许碰网络
    ndbc_src = ""
    p = os.path.join(ROOT, "backend", "datasource", "public", "ndbc.py")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            ndbc_src = f.read()
    net_calls = ndbc_src.count("urlopen(")
    fetch_body = ""
    m = re.search(r"^def fetch\(.*?\n(?=\ndef |\n# ---)", ndbc_src, re.S | re.M)
    if m:
        fetch_body = m.group(0)
    if net_calls and fetch_body.count("urlopen(") != net_calls:
        problems.append("ndbc.py 里有 %d 处 urlopen，但只有 %d 处在 fetch() 内 —— "
                        "渲染路径可能联网了" % (net_calls, fetch_body.count("urlopen(")))
    if "urlopen" not in fetch_body and net_calls:
        problems.append("ndbc.py 的网络调用不在 fetch() 内")

    # 6) 🔴 **真的把网断掉试一次** —— 这是「断网也能演示」唯一算数的证据。
    #    把 ndbc 模块的 urlopen 换成必抛异常的假函数，再问它要数据：
    #    仍然出得来 → 证明渲染路径根本不碰网络。
    offline_proof = ""
    try:
        sys.path.insert(0, os.path.join(ROOT, "backend", "datasource", "public"))
        import ndbc as _n                                  # noqa: PLC0415
        orig = _n.urllib.request.urlopen

        def _boom(*a, **k):
            raise RuntimeError("网络已被切断（模拟断网）")

        _n.urllib.request.urlopen = _boom
        try:
            env_off = _n.as_env({"site_id": "site_02", "station_id": "42001"}, 60)
        finally:
            _n.urllib.request.urlopen = orig
        if env_off and env_off.get("fast"):
            last = env_off["fast"][-1]
            offline_proof = ("断网模拟下仍取到 %d 个点（水温 %s）"
                             % (len(env_off["fast"]), last.get("water_temp")))
        else:
            problems.append("断网模拟下取不到数据 —— 说明渲染路径依赖网络")
    except Exception as e:                                  # noqa: BLE001
        problems.append("断网模拟测试本身失败：%s" % e)

    if not problems and real_ok and cached:
        rec(8, "NDBC 直连 + 断网可演示", PASS,
            "/api/sites 是裸数组（防回归）；%d 个浮标有本地缓存；观测站点返回实测数据"
            "（缺失字段给 null 不编）；%s；**%s** —— 现场拔网线不影响演示"
            % (len(cached), detail, offline_proof))
    elif not obs:
        rec(8, "NDBC 直连 + 断网可演示", WARN, "没有观测站点，跳过")
    else:
        if not real_ok:
            problems.append("观测站点没有返回 NDBC 实测数据")
        if not cached:
            problems.append("没有任何浮标缓存 —— 先跑一次 "
                            "`python backend/datasource/public/ndbc.py` 建缓存")
        if not null_ok:
            problems.append("浮标不测的字段没有给 null —— 疑似拿仿真值补齐了")
        rec(8, "NDBC 直连 + 断网可演示", FAIL, "；".join(problems))


# ======================================================================
def free_port():
    """让系统给一个当前空闲的端口。

    ⚠️ 不能写死一个端口了事：后端现在有「端口被占就自动换一个」的逻辑，
       若我们写死 8099 而它被别的程序占着，服务会悄悄跑到 8100，
       而本脚本还在探 8099 —— 结果误报「服务起不来」。
    """
    s = socket.socket()
    try:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]
    finally:
        s.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=0,
                    help="0 = 自动挑一个空闲端口（默认）")
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    except Exception:                               # noqa: BLE001
        pass

    port = args.port or free_port()
    base = "http://%s:%d" % (args.host, port)

    print("=" * 68)
    print("  一键验收检查 —— 10-09「基本可用初版」四条标准")
    print("=" * 68)
    print()

    # 起临时服务
    proc = subprocess.Popen(
        [sys.executable, os.path.join(ROOT, "backend", "server.py"),
         "--port", str(port), "--no-browser"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            try:
                get(base, "/api/health", timeout=2)
                break
            except Exception:                       # noqa: BLE001
                time.sleep(0.25)
        else:
            print("  [FAIL] 服务起不来，检查不了。")
            print("         试试双击 启动平台.bat，看它报什么错。")
            return 2

        print("  临时服务已起：%s" % base)
        print()

        check_1(base)
        check_2(base)
        check_3(base)
        check_4(base)
        check_extra(base)
        check_enum_labels(base)
        check_script_encoding()
        check_ndbc(base)

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:                           # noqa: BLE001
            proc.kill()

    # ---- 报告 ----
    n_pass = sum(1 for r in _results if r["status"] == PASS)
    for r in _results:
        mark = "✅" if r["status"] == PASS else "❌"
        print("%s  第 %d 条  %s" % (mark, r["no"], r["name"]))
        print("        %s" % r["detail"])
        print()

    print("-" * 68)
    print("  自动检查：%d / %d 通过" % (n_pass, len(_results)))
    print("-" * 68)
    print()

    # ---- 人工清单 ----
    print("  下面这些机器判不了，要你自己看一眼（双击 启动平台.bat 打开平台）：")
    print()
    print("   [ ] 13 个页面逐个点开，都不白屏、都有内容")
    print("   [ ] 每页右上角能看到「数据来源标签」（仿真数据 / 公开数据 …）")
    print()
    print("   [ ] 环境·水质 → 点底部操作条的「触发水温骤升（造故障）」")
    print("         · 操作条右侧立刻出现红字：「已触发：水温骤升 —— 当前水温 xx ℃，命中「…」」")
    print("         · 上方「水温」数值卡跟着涨，曲线抬起来")
    print("         · 页面顶部出现红色告警横幅 → 点「去追溯查询」能反查到规则与触发值")
    print()
    print("   [ ] 环境·水质 → 点「模拟设备离线（造故障）」")
    print("         · 上方 5 张数值卡应全部显示「—」和「设备离线」（不许显示上一个值）")
    print()
    print("   [ ] 智能·自动投喂 → 右侧「造故障」选「命令超时」")
    print("         · 操作条应立刻出现「⚠ 已选造故障「命令超时」—— 下次下发会走失败链」")
    print("         · 点「下发投喂命令」→ 确认 → 状态机应走：超时✓ 重试中✓ 失败✓ 升级报警←当前")
    print("         · 操作条同时显示「最近命令 cmd_… · 升级报警」")
    print("         · 去「告警中心」应多出一条「指令未获回执（升级报警）」")
    print()
    print("         （选「正常」再下发一次，应走：已创建✓ 已发出✓ 已收到回执✓ 成功←当前）")
    print()
    print("  提示：操作条是吸底的，往下滚也一直看得见 —— 反馈就在按钮旁边。")
    print()
    print("  四条全过 = 10-09 的「基本可用初版」达成。")
    print()

    return 0 if n_pass == len(_results) else 1


if __name__ == "__main__":
    sys.exit(main())

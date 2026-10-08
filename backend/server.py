#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
深远海养殖与海洋牧场智能管控平台 —— 后端服务
================================================

一个进程同时干两件事（前端骨架规范 / 项目总体计划 的要求）：
  1. 提供 /api/*  数据与指令接口（口径见《统一数据接口文档 v1.2》）
  2. 托管 ../frontend/ 的静态页面

★ 为什么不用 FastAPI ★
--------------------------------------------------------------
原计划写的是 "Python FastAPI"。实测环境里 FastAPI / uvicorn / pydantic
都没有安装，而捆绑运行时是只读资源，装不进去。

本项目的硬约束是两条（项目记录 1.5 节）：
  · R1 —— 11-14 现场**没人会改代码**，崩了没有第二次机会
  · 部署必须"一键启动、离线自包含"

所以这里改用**纯标准库**（http.server + json + threading）：
  · 零依赖 —— 有 Python 3 就能跑，不需要 pip install、不需要联网
  · 少一层就少一个翻车点 —— 与前端"免构建"同一个理由

**接口形状与 FastAPI 版本完全一致**。若日后要换回 FastAPI，
只需把 route 表换成 FastAPI 的装饰器，数据层与状态机可直接搬。

启动：
    python backend/server.py                # 默认 http://127.0.0.1:8080
    python backend/server.py --port 9000
    python backend/server.py --no-browser

建立：2026-10-05
"""

import argparse
import json
import math
import mimetypes
import os
import random
import re
import sys
import threading
import time
import urllib.request
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

# NDBC 公开浮标数据源（backend/datasource/public/ndbc.py）
# 用 sys.path 显式加目录 —— 这样双击 .bat 从任意工作目录启动都能 import 到
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "datasource", "public"))
import ndbc                                                  # noqa: E402

# 养殖生产配置（管理板块）：网箱养什么鱼、存箱量台账、设备标定
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import farm as farmmod                                       # noqa: E402
FARM = farmmod.Farm()

# ----------------------------------------------------------------------
# 路径
# ----------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FRONTEND = os.path.join(ROOT, "frontend")

# ----------------------------------------------------------------------
# 鱼种体长体重参数库（data/鱼种体长体重参数.json）
#
# 为什么要有这个库：
#   原来代码里把 a、b **硬编码**在这一行——`(avg_w / 0.0218) ** (1 / 3.02)`
#   参数没有鱼种、没有出处，答辩被问「这数哪来的」答不上来。
#   现在改成从参数库查表，每一条都带文献出处（FishBase Ref. / 原始研究）。
# ----------------------------------------------------------------------
DATA_DIR = os.path.join(ROOT, "data")
SPECIES_DB = {"species": [], "by_cn": {}}

# ----------------------------------------------------------------------
# 鱼种温度参数库（data/鱼种温度参数.json）
#
# 为什么水温告警要按鱼种走：
#   原来用**一个统一阈值**（20.5℃ 提示 / 21.5℃ 告警）。但不同鱼种适宜温度差极大 ——
#   大黄鱼最适 18~25℃、大菱鲆 15~18℃、罗非鱼 24~32℃、虹鳟 12~18℃。
#   统一取 20.5℃ 的结果是：**大黄鱼在长得最好的时候被报警，大菱鲆常年误报。**
#   现在改成「网箱里养什么鱼，就用什么鱼的温度阈值」。
# ----------------------------------------------------------------------
TEMP_DB = {"species": [], "by_cn": {}}


def sync_sites_from_farm():
    """把 farm.json 里的养殖信息覆盖到 SITES 上。

    为什么：以前 species / stock_init_count 是写死在 SITES 里的，
    改了 farm.json 也不生效。现在**以 farm.json 为准** —— 它才是"养什么鱼"的唯一事实来源。
    """
    global SITES
    for s in SITES:
        if s.get("kind") != "farm":
            continue
        cages = [c for c in FARM.all_cages() if c["site_id"] == s["site_id"]]
        if not cages:
            continue
        main = cages[0]                      # 主网箱决定站点的"主养鱼种"
        s["species"] = main.get("species")
        s["cage_id"] = main.get("cage_id")
        s["cage_count"] = len(cages)
        s["cages"] = [{"cage_id": c["cage_id"], "cage_name": c.get("cage_name"),
                       "species": c.get("species"),
                       "current_count": FARM.stock_of(c["cage_id"])} for c in cages]
        st = FARM.stock_summary(main["cage_id"])
        if st.get("current_count"):
            s["stock_init_count"] = st["current_count"]
        if st.get("init_size_g"):
            s["stock_init_size_g"] = st["init_size_g"]


def load_temp_db():
    """加载鱼种温度参数库；读不到不致命，页面会提示。"""
    global TEMP_DB
    path = os.path.join(DATA_DIR, "鱼种温度参数.json")
    try:
        with open(path, encoding="utf-8") as f:
            rows = json.load(f).get("species", [])
        TEMP_DB = {"species": rows, "by_cn": {r["species_cn"]: r for r in rows}}
        n_ok = sum(1 for r in rows if r.get("temp_alarm_high") is not None)
        if rows:
            print("  鱼种温度库：%d 种，其中 %d 种给出了高温告警线" % (len(rows), n_ok))
    except Exception as e:                                  # noqa: BLE001
        print("  [警告] 鱼种温度库没读进来（%s）—— 水温阈值将回落到通用值" % e)
        TEMP_DB = {"species": [], "by_cn": {}}


def temp_of(species_cn):
    """取某鱼种的温度参数；查不到返回 None，由调用方决定回落。"""
    return TEMP_DB["by_cn"].get(species_cn)



def load_species_db():
    """加载鱼种参数库；失败不致命，回落到一条内置默认值并**明确标注**。

    分两层，跟 `data/README.md` 写的一致：
      1. `鱼种体长体重参数.json`   —— FishBase 贝叶斯估计（自动抓取，30 种全覆盖）
      2. `原始文献补充.json`       —— 原始研究实测值（人工维护，**优先级更高**）

    为什么必须有第 2 层：FishBase 的贝叶斯估计在物种数据不足时会掺入同亚科/科的鱼，
    已实测有一个种偏差达 1.8 倍（卵形鲳鲹：原始研究 0.0640/2.5349 vs FishBase 0.01122/2.89）。
    **有原始研究的种，一律用原始研究。**
    """
    global SPECIES_DB
    path = os.path.join(DATA_DIR, "鱼种体长体重参数.json")
    try:
        with open(path, encoding="utf-8") as f:
            rows = json.load(f).get("species", [])
    except Exception as e:                                  # noqa: BLE001
        print("  [警告] 鱼种参数库没读进来（%s），生长估算将用内置默认值" % e)
        SPECIES_DB = {"species": [], "by_cn": {}}
        return

    # 盖上原始文献（有就用，并标明用了哪条）
    ov_path = os.path.join(DATA_DIR, "原始文献补充.json")
    n_primary = 0
    try:
        with open(ov_path, encoding="utf-8") as f:
            overlay = json.load(f).get("species", {})
    except Exception:                                       # noqa: BLE001
        overlay = {}

    for r in rows:
        lst = overlay.get(r.get("species_cn"))
        if not lst:
            r["used_source"] = "FishBase"
            r["evidence"] = "predicted"
            r["evidence_cn"] = "贝叶斯预测"
            r["used_note"] = ("FishBase 贝叶斯预测值，**不是实测**。"
                              "FishBase 原文写明「based on LWR estimates for this species "
                              "& (Sub)family-body」—— 该种实测数据不足时会掺入同亚科/科的其他鱼。")
            continue
        o = lst[0]
        # 原始值换算到 cm / g 口径（本库统一口径，见 data/README.md）
        r["fb_lw_a"], r["fb_lw_b"] = r.get("lw_a"), r.get("lw_b")
        r["fb_source_ref"] = r.get("source_ref", "")
        r["lw_a"], r["lw_b"] = o["a"], o["b"]
        r["length_type"] = o.get("length_type", r.get("length_type", ""))
        r["source_ref"] = (o.get("source") or "原始文献").split(".")[0]
        r["source_url"] = o.get("source_url", "")
        r["used_source"] = "原始研究"
        r["evidence"] = o.get("evidence", "measured_farmed")
        r["evidence_cn"] = {"measured_farmed": "实测·养殖",
                            "measured_wild": "实测·野生",
                            "predicted": "贝叶斯预测",
                            "predicted_no_data": "预测·零记录"}.get(r["evidence"], r["evidence"])
        r["used_note"] = o.get("note", "")
        if o.get("n") is not None:
            r["n"] = o["n"]
        if o.get("r2") is not None:
            r["r2"] = o["r2"]
        n_primary += 1

    SPECIES_DB = {"species": rows,
                  "by_cn": {r["species_cn"]: r for r in rows if r.get("status") == "OK"},
                  "n_primary": n_primary}
    if n_primary:
        print("  鱼种参数库：%d 种，其中 %d 种用原始研究覆盖" % (len(rows), n_primary))


def lwr_of(species_cn):
    """取某鱼种的 (a, b, 出处)；查不到就给 None，由调用方决定怎么办。"""
    r = SPECIES_DB["by_cn"].get(species_cn)
    if not r:
        return None
    return {"a": r["lw_a"], "b": r["lw_b"],
            "length_type": r.get("length_type", ""),
            "source": r.get("source_ref", "FishBase"),
            "url": r.get("source_url", "")}


# ----------------------------------------------------------------------
# 站点（接口文档 8.1）
# ----------------------------------------------------------------------
SITES = [
    {"site_id": "site_01", "site_name": "模拟养殖站点", "kind": "farm",
     "latitude": 26.10, "longitude": 119.90, "farming_depth_m": 20,
     # 主养种：大黄鱼（福建宁德一带的主养鱼种，与站点位置 26.1N/119.9E 对得上）
     "species": "大黄鱼", "stock_init_count": 1200, "stock_init_size_g": 420},
    # site_02：原为 41001（EAST HATTERAS，美国东海岸），2026-10-06 更换。
    # 原因：41001 是**停用站** —— 在 NDBC 在册（有经纬度）但 met=n / currents=n，
    # 所有数据文件实测 404，连站点页都没有。平台上写着它的编号，评委一查就穿帮。
    # 换成的 42001 实测数据新鲜完整（风速 199/200、水温 196、浪高 103 行有值）。
    # 选它的理由：与 46001 形成**最大温差（11.5↔30.2℃）和最大海况反差（3.5↔0.4 m）**，
    # 且暖水场景更接近中国南海的实际养殖条件。
    {"site_id": "site_02", "site_name": "NDBC 观测站点 42001", "kind": "obs",
     "station_id": "42001",
     "latitude": 25.92, "longitude": -89.64, "farming_depth_m": 0},
    {"site_id": "site_03", "site_name": "NDBC 观测站点 46001", "kind": "obs",
     "station_id": "46001",
     "latitude": 56.30, "longitude": -148.02, "farming_depth_m": 0},
    {"site_id": "site_04", "site_name": "NDBC 观测站点 51001", "kind": "obs",
     "station_id": "51001",
     "latitude": 24.45, "longitude": -162.00, "farming_depth_m": 0},
]

STEP_FAST = 5 * 1000        # 快变量 5 秒
STEP_SLOW = 30 * 1000       # 慢变量 30 秒（盐度 / pH，裁定 3）

# 造故障「水温骤升」的目标温度。
# ⚠️ 必须是**绝对值**，不能是「在基线上加几度」：
#    水温基线带昼夜项 18.6 + sin((h-6)/24·2π)×1.8，
#    夜里 22 点时 diurnal≈-0.87，基线只有 17.0℃ —— 加 4.2 也只到 21.4℃，
#    刚好差 0.1 够不到告警阈值。
#    🔴 2026-10-06：目标从 23.5℃ 上调到 30.5℃ —— 水温告警改为按鱼种取值后，
#       大黄鱼（平台主养种）的告警线是 28.0℃，23.5℃ 再也触发不了了。
#    结果就是「白天点造故障会报警、晚上点没反应」。
#    现场答辩要是排在下午或晚上，这条竖线演示当场失败。
HEAT_TARGET_C = 30.5


# ======================================================================
# 仿真数据生成（与前端 mock.js 同口径）
# ======================================================================
def _rng(seed=20261005):
    return random.Random(seed)


def env_series(site_id, minutes=60, storm=False, heat=False, offline_from=None, offline=False):
    """环境时序（接口文档 4.1 / 4.2 / 4.3）"""
    n = max(2, int(minutes * 60 * 1000 / STEP_FAST))
    n_slow = max(2, int(minutes * 60 * 1000 / STEP_SLOW))
    if offline:
        # 设备离线：从时段 60% 起所有值给 null（验收第 4 条）
        offline_from = int(n * 0.6)
    now = int(time.time() * 1000) // 1000 * 1000
    t0 = now - minutes * 60 * 1000
    r = _rng()

    fast = []
    for i in range(n):
        ts = t0 + i * STEP_FAST
        h = datetime.fromtimestamp(ts / 1000).hour + datetime.fromtimestamp(ts / 1000).minute / 60.0
        diurnal = math.sin((h - 6) / 24 * 2 * math.pi)
        offline = offline_from is not None and i >= offline_from

        wave = r.gauss(4.6, .55) if storm else r.gauss(1.4, .25)
        wind = r.gauss(19, 2.5) if storm else r.gauss(8.3, 1.2)
        base_water = 18.6 + diurnal * 1.8
        if heat:
            # 朝 HEAT_TARGET_C 爬：无论几点，最后一定能越过 28.0℃（大黄鱼告警线）
            prog = max(0.0, (i / n - 0.55) / 0.45)
            water = base_water + (HEAT_TARGET_C - base_water) * prog + r.gauss(0, .12)
        else:
            water = base_water + r.gauss(0, .15)
        air = 22.4 + diurnal * 3.2 + r.gauss(0, .4) + (water - base_water) * .6
        light = max(0.0, (4000 if storm else 12000) * max(0.0, math.sin((h - 6) / 12 * math.pi)) + r.gauss(0, 400))

        fast.append({
            "ts": ts,
            "site_id": site_id,
            "source": "simulated",
            "quality": "stale" if offline else "good",
            # 离线给 null，不给上一个值（通用规范 4.2 硬纪律）
            "wave_height": None if offline else round(wave, 1),
            "wind_speed": None if offline else round(wind, 1),
            "current_speed": None if offline else round(r.gauss(1.4 if storm else .6, .12), 1),
            "air_temp": None if offline else round(air, 1),
            "water_temp": None if offline else round(water, 1),
            "dissolved_oxygen": None if offline else round(9.2 - (water - 18.6) * .45 + r.gauss(0, .12), 1),
            "light_intensity": None if offline else round(light),
        })

    # 慢变量（盐度 / pH）：30 秒一条，单独一条序列
    # 离线要同样置空 —— 慢变量也是设备测出来的，设备断了它就没有读数
    off_ts = (t0 + offline_from * STEP_FAST) if offline_from is not None else None
    slow = []
    for i in range(n_slow):
        ts = t0 + i * STEP_SLOW
        off = off_ts is not None and ts >= off_ts
        slow.append({
            "ts": ts,
            "site_id": site_id,
            "quality": "stale" if off else "good",
            "salinity": None if off else round(r.gauss(32.1, .15), 1),   # ‰（裁定 10）
            "ph": None if off else round(r.gauss(8.1, .06), 1),          # 1 位小数
        })

    return {"fast": fast, "slow": slow}


def fish_series(minutes=60):
    """鱼类（接口文档 第三节；4 项指标本期不做）"""
    n = max(2, int(minutes * 60 * 1000 / STEP_FAST))
    now = int(time.time() * 1000) // 1000 * 1000
    t0 = now - minutes * 60 * 1000
    r = _rng()
    site = SITES[0]
    sp_cn = site.get("species", "大黄鱼")
    lwr = lwr_of(sp_cn)
    if lwr:
        a, b = lwr["a"], lwr["b"]
    else:
        # 参数库缺失时的兜底。**必须标注出来**，不许当成正常值用。
        a, b = 0.00891, 3.06
        lwr = {"a": a, "b": b, "source": "参数库缺失，用大黄鱼默认值", "url": ""}
    out, count = [], site.get("stock_init_count", 1200)
    for i in range(n):
        count += round(r.gauss(0, .6))
        avg_w = site.get("stock_init_size_g", 420) + i / n * 6 + r.gauss(0, 3)
        out.append({
            "ts": t0 + i * STEP_FAST,
            "site_id": "site_01",
            "source": "public",
            "quality": "good",
            "fish_count": count,
            "fish_density": round(count / 285, 1),
            # 由体重反推体长：W = a·L^b  →  L = (W/a)^(1/b)
            # a、b 来自鱼种参数库（带文献出处），不再硬编码
            "avg_length_cm": round((avg_w / a) ** (1.0 / b), 1),
            "avg_weight_g": round(avg_w, 1),
            "total_biomass_kg": round(count * avg_w / 1000, 1),
            "feeding_intensity": r.choice(["none", "weak", "mid", "strong"]),
        })
    return out


def heat_grid():
    """10×10 网格（拍板问题单 问题 5 建议 A）"""
    r = _rng()
    g = []
    for y in range(10):
        row = []
        for x in range(10):
            d = math.hypot(x - 4.5, y - 5.2)
            row.append(round(max(0.0, 12 - d * 2.2 + r.gauss(0, 1.4)), 1))
        g.append(row)
    return g


def struct_series(minutes=60, storm=False):
    """结构安全（接口文档 第五节）

    storm 参数：造故障「大风大浪」要能让网箱倾角与锚泊张力真的抬起来。
    2026-10-06 加 —— 倾角阈值从 2°/3° 改成 5°/15° 后，
    如果不联动海况，演示时永远触发不到预警。
    """
    n = max(2, int(minutes * 60 * 1000 / STEP_FAST))
    now = int(time.time() * 1000) // 1000 * 1000
    t0 = now - minutes * 60 * 1000
    r = _rng()
    out, soc, design = [], 68.0, 60.0
    for i in range(n):
        ts = t0 + i * STEP_FAST
        h = datetime.fromtimestamp(ts / 1000).hour
        day = max(0.0, math.sin((h - 6) / 12 * math.pi))

        # 姿态与张力：平时平稳，每 10 分钟来一次持续约 70 秒的「涌浪 / 阵风」事件。
        # 为什么要这样建模：原来俯仰角是 gauss(2.4, .4) —— 长期骑在阈值上，
        # 噪声反复穿越阈值，一小时刷出上千条告警，界面上看着像系统坏了。
        # 真实网箱平时就是平稳的，倾斜是「事件」，不是常态。
        #
        # 🔴 2026-10-06 改：阈值从 2°/3° 改为 5°/15° 后，原来的幅值（峰 ~3.4°）永远触不到。
        #    同时把倾斜与「大风大浪」造故障**联动** —— 物理上说得通（海况差 → 网箱倾斜），
        #    演示时也有明确路径：点「触发大风大浪」→ 倾角抬升 → 红色预警。
        per = 120                       # 120 个点 = 10 分钟
        phase = i % per
        if phase < 14:
            # mag 5.5 → 峰值约 6.7°，越过 5° 黄色线；台风级 mag 15 → 峰值约 16°，越过 15° 红色线
            if storm:
                mag = 15.0              # 造故障：大风大浪 → 达到 CCS 稳性衡准角量级
            else:
                # 平常幅值刻意压在 5° 提示线**下方**（峰 4.2° + 噪声 ≈ 4.9°），
                # 否则每 10 分钟就报一次橙色预警，又变成「狼来了」
                mag = 3.0 if (i // per) % 2 == 0 else 1.6
            excursion = mag * math.sin(phase / 14 * math.pi)
        else:
            excursion = 0.0

        roll = 1.1 + excursion * 0.5 + r.gauss(0, .18)
        pitch = 1.2 + excursion + r.gauss(0, .22)
        # 海况差 → 张力跟着涨（物理上说得通：大浪对锚泊的载荷是非线性的，
        # 所以造故障时耦合系数更大）。
        # 数值配着 design_tension = 60 kN 调，让两条线各就各位 ——
        # **平常海况不许越 80% 黄线**，否则黄色预警天天响，等于没有预警（"狼来了"）：
        #   平常（excursion 峰 4.6，系数 1.15）→ 约 42.8 + 噪声 ≈ 77%  < 80%  ✅
        #   造故障（excursion 峰 15，系数 1.6） → 约 61.5 + 噪声 ≈ 105% > 95%  ✅
        tension = 37.5 + excursion * (1.6 if storm else 1.15) + r.gauss(0, 1.2)
        soc = min(100.0, max(8.0, soc + (0.18 if day > .2 else -0.22) + r.gauss(0, .12)))
        out.append({
            "ts": ts,
            "site_id": "site_01",
            "anchor_tension": round(tension, 1),
            "design_tension": design,
            "tension_pct": round(tension / design * 100, 1),
            "net_tension": round(r.gauss(18.3, .8), 1),
            "tilt_roll": round(roll, 1),
            "tilt_pitch": round(pitch, 1),
            "tilt_angle": round(max(abs(roll), abs(pitch)), 1),
            "accel_x": round(r.gauss(0.12, .05), 2),
            "accel_y": round(r.gauss(-0.08, .05), 2),
            "accel_z": round(r.gauss(9.79, .06), 2),
            "pv_power": round(day * 4.6, 2),
            "pv_energy_today": round(day * 14, 1),
            "battery_soc": round(soc, 1),
            "battery_capacity_kwh": 30,
            "battery_energy": round(soc / 100 * 30, 1),
            "total_power": round(r.gauss(2.1, .2), 2),
            "energy_self_sufficiency": round(day * 130),
        })
    return out


def feed_decision():
    """投喂决策（裁定 1：投喂量归智能算）"""
    fish = fish_series(5)
    last = fish[-1]
    water = env_series("site_01", 5)["fast"][-1]["water_temp"]
    h = datetime.now().hour
    intensity = "strong" if (5 <= h <= 9 or 16 <= h <= 19) else ("mid" if 10 <= h <= 15 else "weak")
    w = {"none": 0, "weak": 0.45, "mid": 0.75, "strong": 1}[intensity]
    cn = {"none": "无", "weak": "弱", "mid": "中", "strong": "强"}[intensity]
    per_day = last["total_biomass_kg"] * 0.012
    times = 4
    return {
        "ts": last["ts"],
        "biomass_kg": last["total_biomass_kg"],
        "feeding_intensity": intensity,
        "feeding_intensity_cn": cn,
        "water_temp": water,
        "suggest_kg_h": round(max(0.1, per_day / times * w), 1),
        "day_total_kg": round(per_day * w, 1),
        "times_per_day": times,
        "basis": [
            "依据 1：生物量 %s kg × 日投饲率 1.2%% = %.1f kg/日" % (last["total_biomass_kg"], per_day),
            "依据 2：当前时段（%d 时）摄食强度「%s」→ 折算系数 %s" % (h, cn, w),
            "依据 3：水温 %s ℃ 处于适宜摄食区间（15–25 ℃）" % water,
            "分 %d 次投喂，单次上限 %.1f kg" % (times, per_day / times),
        ],
        "mode": "manual",
    }


# ======================================================================
# 设备 / 指令状态机（接口文档 6.3 / 6.4 / 7.6）
# ======================================================================
class Platform(object):
    def __init__(self):
        self.lock = threading.Lock()
        self.devices = [
            {"device_id": "feeder_01", "device_type": "feeder", "device_online": True,
             "device_state": "standby", "device_params": {"feed_remain_kg": 62.5, "feed_remain_pct": 62.5},
             "site_id": "site_01"},
            {"device_id": "light_01", "device_type": "light", "device_online": True,
             "device_state": "standby", "device_params": {"light_dimming_pct": 0},
             "site_id": "site_01"},
            {"device_id": "tension_01", "device_type": "sensor", "device_online": True,
             "device_state": "running", "device_params": {}, "site_id": "site_01"},
            {"device_id": "pv_01", "device_type": "sensor", "device_online": True,
             "device_state": "running", "device_params": {}, "site_id": "site_01"},
        ]
        self.commands = []
        self._seq = 0
        self.alarms = self._seed_alarms()
        self._seed_commands()      # 预置几条真实历史命令（投喂记录从它派生）


    def _seed_alarms(self):
        now = int(time.time() * 1000)
        return [
            {"alarm_event_id": "ALM-0001", "alarm_type": "tension", "risk_level": "yellow",
             "alarm_status": "active", "alarm_ts": now - 8 * 60 * 1000,
             "trigger_field": "tension_pct", "trigger_value": 83.2, "trigger_threshold": 80,
             "rule_id": "R-TENSION-01", "rule_name": "锚泊张力黄色预警",
             "rule_condition": "张力利用率 R > 80%（R = T_max / T_design，T_design = PB/1.67）",
             "combine_condition": None,
             "trigger_snapshot": {"anchor_tension": 49.9, "design_tension": 60, "tension_pct": 83.2, "ts": now - 8 * 60 * 1000},
             "handling_advice": "检查锚链受力，必要时降低流速影响",
             "handle_status": "pending", "confirm_status": "unconfirmed"},
            {"alarm_event_id": "ALM-0002", "alarm_type": "tilt", "risk_level": "orange",
             "alarm_status": "acknowledged", "alarm_ts": now - 26 * 60 * 1000,
             "trigger_field": "tilt_pitch", "trigger_value": 6.2, "trigger_threshold": 5,
             "rule_id": "R-TILT-01", "rule_name": "网箱倾斜橙色预警",
             "rule_condition": "tilt_pitch > 5 且 wave_height > 1.5",
             "combine_condition": "AND(wave_height>1.5)",
             "trigger_snapshot": {"tilt_pitch": 6.2, "tilt_roll": 2.4, "wave_height": 1.8, "ts": now - 26 * 60 * 1000},
             "handling_advice": "关注网箱姿态，检查配重",
             "handle_status": "handling", "confirm_status": "confirmed"},
            {"alarm_event_id": "ALM-0003", "alarm_type": "low_battery", "risk_level": "yellow",
             "alarm_status": "recovered", "alarm_ts": now - 55 * 60 * 1000,
             "trigger_field": "battery_soc", "trigger_value": 19.4, "trigger_threshold": 20,
             "rule_id": "R-BAT-01", "rule_name": "储能低电量黄色预警",
             "rule_condition": "battery_soc < 20", "combine_condition": None,
             "trigger_snapshot": {"battery_soc": 19.4, "battery_energy": 5.8, "ts": now - 55 * 60 * 1000},
             "handling_advice": "优先保障关键设备供电",
             "handle_status": "handled", "confirm_status": "confirmed",
             "recover_ts": now - 31 * 60 * 1000},
        ]

    # ---------- 指令状态机 ----------
    def cancel_command(self, command_id, reason="值班人手动停止"):
        """手动停止一条还没走到终态的命令（组员反馈：投喂要能中途停）。

        ⚠️ 只允许停「未到终态」的命令。
        已经 success / failed / escalated 的不能改 —— 那是历史事实，不能篡改。
        这正是这个平台「不允许静默失败」的另一面：**也不允许悄悄改历史**。
        """
        FINAL = ("success", "failed", "escalated", "cancelled")
        for c in self.commands:
            if c.get("command_id") != command_id:
                continue
            st = c.get("command_status")
            if st in FINAL:
                raise ValueError("命令已到终态（%s），不能再停止" % st)
            now = int(time.time() * 1000)
            c["command_status"] = "cancelled"
            c["fail_reason"] = reason
            c["history"].append({"ts": now, "status": "cancelled",
                                 "note": "值班人手动停止"})
            return {"ok": True, "command_id": command_id,
                    "command_status": "cancelled",
                    "stopped_at": now, "reason": reason}
        raise ValueError("命令不存在：%s" % command_id)

    def send_command(self, device_id, command_type, params, inject=None):
        with self.lock:
            self._seq += 1
            ymd = datetime.now().strftime("%Y%m%d")
            cmd = {
                "command_id": "cmd_%s_%04d" % (ymd, self._seq),
                "device_id": device_id,
                "command_type": command_type,
                "params": params or {},
                "timeout_ms": 5000,      # 裁定 8
                "max_retry": 3,          # 裁定 8
                "command_status": "created",
                "retry_count": 0,
                "state_changed_ts": int(time.time() * 1000),
                "ts": int(time.time() * 1000),
                "fail_reason": None,
                "receipt_result": None,
                "history": [],
            }
            self.commands.insert(0, cmd)

        t = threading.Thread(target=self._advance, args=(cmd, inject), daemon=True)
        t.start()
        return cmd

    def _advance(self, cmd, inject):
        """created → sent → acknowledged → success
        ；注入 timeout / offline 时走失败链（绝不允许静默失败）

        ⚠️ 注入故障时**不能走完成功链**：
           超时的命令根本没收到回执，不可能出现 acknowledged / success。
           这里曾经写成"先走完整成功链再补失败链"，导致命令历史里
           同时存在 success 和 escalated —— 自相矛盾，答辩时会被问倒。

        🔴 2026-10-07 加「手动停止」支持：
           状态机跑在**独立线程**里，之前只往前进、不看命令当前状态 ——
           结果 cancel_command 把状态改成 cancelled 之后，
           这个线程睡醒照样把命令推到 success，**"手动停止"变成一句空话**。
           现在每一步之前都检查一次，被停过就立刻收手。
        """
        if inject in ("offline", "timeout"):
            steps = ["created", "sent"]      # 发出去了，但等不到回执
        else:
            steps = ["created", "sent", "acknowledged", "success"]

        for st in steps:
            # 每步 1.4 秒（原 0.7）。
            # 🔴 2026-10-07 改：0.7 秒时整条链 2.8 秒就跑完，**人手根本来不及点「停止」** ——
            #    组员要的"手动停止"变成摆设。1.4 秒 × 4 步 = 5.6 秒，够看清状态流转，
            #    也够点一下停止。这个值同时影响演示观感，改之前先想清楚。
            time.sleep(1.4)
            if cmd.get("command_status") == "cancelled":
                return                        # 值班人已停止，不许再往前走
            self._set(cmd, st)
            if cmd.get("command_status") == "cancelled":
                return
            if st == "success":
                cmd["receipt_result"] = {"success": True, "result": "executed",
                                         "actual_ts": int(time.time() * 1000), "error_code": None}
                # 命令成功 → 设备状态更新
                with self.lock:
                    for d in self.devices:
                        if d["device_id"] == cmd["device_id"]:
                            d["device_state"] = "running"

        if inject == "timeout":
            time.sleep(1.2)
            self._set(cmd, "timeout")
            time.sleep(0.6)
            cmd["retry_count"] = 1
            self._set(cmd, "retrying")
            time.sleep(0.6)
            cmd["fail_reason"] = "超时未收到回执，重试 3 次后失败"
            self._set(cmd, "failed")
            time.sleep(0.6)
            cmd["fail_reason"] = "已升级报警"
            self._set(cmd, "escalated")
            self._raise_command_alarm(cmd)
        elif inject == "offline":
            time.sleep(1.2)
            cmd["fail_reason"] = "设备离线，命令未能送达"
            self._set(cmd, "failed")
            self._raise_command_alarm(cmd)

    def _set(self, cmd, status):
        with self.lock:
            cmd["command_status"] = status
            cmd["state_changed_ts"] = int(time.time() * 1000)
            cmd["history"].append({"status": status, "ts": cmd["state_changed_ts"]})

    def _raise_command_alarm(self, cmd):
        """命令失败必须进告警中心 —— 不允许悄悄地失败"""
        now = int(time.time() * 1000)
        with self.lock:
            n = len(self.alarms) + 1
            self.alarms.insert(0, {
                "alarm_event_id": "ALM-%04d" % n,
                "alarm_type": "power_supply" if cmd["command_type"] == "light" else "tension",
                "risk_level": "red",
                "alarm_status": "active",
                "alarm_ts": now,
                "trigger_field": "command_status",
                "trigger_value": "failed",
                "trigger_threshold": "success",
                "rule_id": "R-CMD-01",
                "rule_name": "指令未获回执（升级报警）",
                "rule_condition": "command_status == failed 且 重试耗尽",
                "combine_condition": None,
                "trigger_snapshot": {"command_id": cmd["command_id"], "device_id": cmd["device_id"],
                                     "retry_count": cmd["retry_count"], "ts": now},
                "handling_advice": "检查设备与链路；确认设备是否真的没动",
                "handle_status": "pending",
                "confirm_status": "unconfirmed",
            })

    def feed_records(self):
        """投喂记录 —— **从真实命令派生，不再凭空生成**。

        🔴 2026-10-07 改（组员反馈「投喂要能手动停止」时暴露的）：
           原来这里用 _rng() 编了 9 条记录，命令号形如 cmd_20261005_0100。
           界面上看不出问题，但一点「停止」就报「命令不存在」——
           因为那些命令号**后端根本没有**。这就是"编数据"埋的雷：
           静态看一眼没事，一交互就穿帮。

           现在改成从 self.commands 里筛（设备=feeder_01 且类型=feed），
           每一条都是真命令，都有真实状态机历史，都能被停止。
           历史之所以不为空，是因为启动时预置了几条**真实存在**的命令（见 _seed_commands）。
        """
        out = []
        for c in self.commands:
            if c.get("device_id") != "feeder_01" or c.get("command_type") != "feed":
                continue
            st = c.get("command_status")
            out.append({
                "ts": c.get("created_ts") or (c.get("history") or [{}])[0].get("ts"),
                "amount_kg": (c.get("params") or {}).get("amount_kg"),
                "trigger_by": (c.get("params") or {}).get("trigger_by", "manual"),
                "task_status": "done" if st in ("success", "failed", "escalated", "cancelled") else "running",
                "command_id": c.get("command_id"),
                "command_status": st,
            })
        return out

    def _seed_commands(self):
        """预置几条**真实存在**的历史命令。

        为什么要预置：记录表现在从真实命令派生，不预置的话演示一开始是空表。
        预置的是"过去几小时投喂过几次"这种事实，每条都在命令表里查得到、停得掉 ——
        跟原来那种"编个号糊上去"有本质区别。
        """
        now = int(time.time() * 1000)
        seed = [
            (9, 11.2, "auto", "success"),
            (6, 12.0, "auto", "success"),
            (3, 10.5, "manual", "success"),
            (1, 11.8, "auto", "success"),
        ]
        for hours_ago, kg, trigger, st in seed:
            self._seq += 1
            ts = now - hours_ago * 3600 * 1000
            ymd = datetime.fromtimestamp(ts / 1000).strftime("%Y%m%d")
            self.commands.append({
                "command_id": "cmd_%s_%04d" % (ymd, self._seq),
                "device_id": "feeder_01", "command_type": "feed",
                "params": {"amount_kg": kg, "duration_s": 60, "trigger_by": trigger},
                "timeout_ms": 5000, "max_retry": 3,
                "command_status": st, "retry_count": 0, "fail_reason": None,
                "created_ts": ts,
                "history": [
                    {"ts": ts, "status": "created"},
                    {"ts": ts + 700, "status": "sent"},
                    {"ts": ts + 1400, "status": "acknowledged"},
                    {"ts": ts + 2100, "status": "success"},
                ],
                "receipt_result": {"success": True, "result": "executed",
                                   "actual_ts": ts + 2100, "error_code": None},
            })
        self.commands.sort(key=lambda c: c.get("created_ts") or 0, reverse=True)


    def rule_check(self, row):
        """「一条竖线」用的水温判定 —— 与前端同口径"""
        if not row or row.get("water_temp") is None:
            return None
        t = row["water_temp"]
        if t >= 28.0:
            return {"alarm_type": "tilt", "risk_level": "red", "trigger_field": "water_temp",
                    "trigger_value": t, "trigger_threshold": 28.0,
                    "rule_id": "R-TEMP-01", "rule_name": "水温上限告警",
                    "rule_condition": "water_temp >= 28.0（大黄鱼高告警线，见鱼种温度库）"}
        if t >= 25.5:
            return {"alarm_type": "tilt", "risk_level": "yellow", "trigger_field": "water_temp",
                    "trigger_value": t, "trigger_threshold": 25.5,
                    "rule_id": "R-TEMP-02", "rule_name": "水温偏高提示",
                    "rule_condition": "water_temp >= 25.5（大黄鱼高提示线，见鱼种温度库）"}
        return None


PLATFORM = Platform()


# ======================================================================
# HTTP 服务
# ======================================================================
class Handler(BaseHTTPRequestHandler):
    server_version = "DeepSeaPlatform/1.0"
    protocol_version = "HTTP/1.1"

    # ---------- 工具 ----------
    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _err(self, code, msg):
        """统一出错格式（通用规范 7.2）"""
        self._json({"code": code, "msg": msg}, status=200 if code < 400 else code)

    def _js(self, code):
        body = code.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/javascript; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _file(self, path):
        if not os.path.isfile(path):
            self.send_error(404, "Not Found")
            return
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        with open(path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # 静音静态资源日志，只留 API
        if "/api/" in (self.path or ""):
            sys.stderr.write("[%s] %s\n" % (datetime.now().strftime("%H:%M:%S"), self.path))

    # ---------- 路由 ----------
    def do_GET(self):
        u = urlparse(self.path)
        p, q = u.path, parse_qs(u.query)

        try:
            # 前端靠这个文件判断"有没有后端"：
            #   由本服务托管 → 文件存在 → 前端走真实接口
            #   由普通静态服务器托管 → 404 → 前端自动退回本地 mock
            if p == "/api/boot.js":
                return self._js('window.__API_BASE__ = "";\n')

            if p.startswith("/api/"):
                return self._api_get(p, q)
            # 静态资源
            rel = "index.html" if p in ("/", "") else p.lstrip("/")
            target = os.path.normpath(os.path.join(FRONTEND, rel))
            if not target.startswith(FRONTEND):       # 防目录穿越
                return self.send_error(403, "Forbidden")
            return self._file(target)
        except Exception as e:                        # noqa: BLE001
            return self._err(500, "服务内部错误：%s" % e)

    def _api_get(self, p, q):
        one = lambda k, d: (q.get(k) or [d])[0]   # noqa: E731
        minutes = int(one("minutes", "60") or 60)
        site = one("site_id", "site_01")

        if p == "/api/health":
            return self._json({"code": 200, "msg": "ok", "ts": int(time.time() * 1000)})

        if p == "/api/sites":
            # ⚠️ 必须返回**裸数组**，不能包成 {"sites": [...]}。
            # 前端 api-remote.js 判的是 Array.isArray(d)，包一层就永远取不到值 ——
            # 症状是站点下拉框**一直是空的**，而且不报任何错，很难发现。
            # （2026-10-06 踩过：加 /api/species 时顺手把这里包了一层，属于回归。）
            out = []
            for x in SITES:
                y = dict(x)
                if y.get("species"):
                    t = temp_of(y["species"])
                    if t:
                        y["temp_warn_high"] = t.get("temp_warn_high")
                        y["temp_alarm_high"] = t.get("temp_alarm_high")
                        y["temp_warn_low"] = t.get("temp_warn_low")
                        y["temp_alarm_low"] = t.get("temp_alarm_low")
                        y["temp_opt"] = [t.get("temp_opt_low"), t.get("temp_opt_high")]
                        y["temp_evidence"] = t.get("evidence")
                        y["temp_source"] = t.get("source")
                        y["temp_note"] = t.get("note")
                out.append(y)
            return self._json(out)

        # 鱼种体长体重参数库 —— 页面上要能看到「这个 a、b 是哪来的」
        if p == "/api/species":
            sp = one("species", "")
            if sp:
                row = SPECIES_DB["by_cn"].get(sp)
                return self._json({"species": row} if row else
                                  {"error": "没有这个鱼种: %s" % sp})
            return self._json({
                "formula": "W(g) = lw_a * L(cm) ** lw_b",
                "count": len(SPECIES_DB["species"]),
                "species": SPECIES_DB["species"],
            })

        # 鱼种温度参数库 —— 水温告警阈值按站点养殖鱼种取值
        if p == "/api/species/temp":
            cn = one("species", "")
            if cn:
                row = TEMP_DB["by_cn"].get(cn)
                return self._json({"species": row} if row else
                                  {"error": "温度库里没有这个鱼种: %s" % cn})
            return self._json({
                "unit": "℃",
                "count": len(TEMP_DB["species"]),
                "note": "水温告警按网箱养殖鱼种取值，不用统一阈值",
                "species": TEMP_DB["species"],
            })

        if p == "/api/env":
            storm = one("storm", "0") in ("1", "true")
            heat = one("heat", "0") in ("1", "true")
            off = one("offline", "0") in ("1", "true")
            off_from = one("offline_from", "")

            # 观测站点：返回 **NDBC 实测数据**（接口文档 8.2 的对外口径靠这里坐实）。
            # 只在「没有造故障注入」时走真实数据 —— 造故障是对仿真的操作，
            # 往真实数据里注入假故障会让「真实」两个字失效。
            if not (storm or heat or off or off_from):
                s = next((x for x in SITES if x["site_id"] == site), None)
                if s and s.get("kind") == "obs":
                    real = ndbc.as_env(s, minutes)
                    if real:
                        return self._json(real)

            return self._json(env_series(site, minutes, storm, heat,
                                         int(off_from) if off_from else None, off))

        # ---------- 管理板块：养殖生产配置 ----------
        if p == "/api/farm":
            return self._json({
                "summary": FARM.summary(),
                "sites": FARM.farm_sites(),
                "cages": FARM.all_cages(),
                "devices": FARM.devices(),
            })

        if p == "/api/farm/ledger":
            cid = one("cage_id", "")
            rows = FARM.ledger_of(cid or None)
            return self._json({
                "cage_id": cid or None,
                "count": len(rows),
                "ledger": rows,
                "summaries": [FARM.stock_summary(c["cage_id"]) for c in FARM.all_cages()],
                "type_cn": farmmod.LEDGER_CN,
            })

        if p == "/api/farm/devices":
            devs = FARM.devices()
            return self._json({
                "count": len(devs),
                "devices": devs,
                "summary": FARM.summary(),
            })

        # NDBC 直连：状态查询 + 显式拉取
        if p == "/api/ndbc/status":
            return self._json(ndbc.status())

        if p == "/api/fish":
            return self._json(fish_series(minutes))

        if p == "/api/heatmap":
            return self._json({"grid": heat_grid(), "resolution": "10x10"})

        if p == "/api/struct":
            # storm 透传：造故障「大风大浪」要能让网箱倾角真的抬起来，
            # 否则倾角阈值改成 5°/15° 之后演示时永远触发不到（2026-10-06 踩过）
            return self._json(struct_series(minutes, one("storm", "0") in ("1", "true")))

        if p == "/api/feed/decision":
            return self._json(feed_decision())

        if p == "/api/feed/records":
            return self._json(PLATFORM.feed_records())

        if p == "/api/devices":
            return self._json(PLATFORM.devices)

        if p == "/api/commands":
            return self._json(PLATFORM.commands)

        m = re.match(r"^/api/commands/([^/]+)$", p)
        if m:
            cid = m.group(1)
            for c in PLATFORM.commands:
                if c["command_id"] == cid:
                    return self._json(c)
            return self._err(404, "命令号不存在：%s" % cid)

        if p == "/api/alarms":
            return self._json(PLATFORM.alarms)

        m = re.match(r"^/api/alarms/([^/]+)$", p)
        if m:
            for a in PLATFORM.alarms:
                if a["alarm_event_id"] == m.group(1):
                    return self._json(a)
            return self._err(404, "告警事件编号不存在")

        m = re.match(r"^/api/config/meta$", p)
        if m:
            return self._json({"cursor": _CURSOR})

        return self._err(404, "接口不存在：%s" % p)

    def do_POST(self):
        u = urlparse(self.path)
        p = u.path
        try:
            n = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(n) if n else b"{}"
            body = json.loads(raw.decode("utf-8") or "{}")
        except Exception:                              # noqa: BLE001
            return self._err(400, "参数错误：请求体不是合法 JSON")

        try:
            # ---------- 管理板块：写操作 ----------
            # 手动停止未到终态的命令（组员反馈：投喂要能中途停）
            m = re.match(r"^/api/commands/([\w\-]+)/cancel$", p)
            if m:
                try:
                    return self._json(PLATFORM.cancel_command(m.group(1),
                                                              body.get("reason")))
                except ValueError as e:
                    return self._err(400, str(e))

            if p == "/api/farm/ledger":
                cid = body.get("cage_id")
                ltype = body.get("type")
                cnt = body.get("count")
                if not cid or not ltype or cnt is None:
                    return self._err(400, "参数错误：缺少 cage_id / type / count")
                try:
                    return self._json(FARM.add_ledger(cid, ltype, cnt, body.get("note", ""),
                                                      body.get("ts")))
                except ValueError as e:
                    return self._err(400, str(e))

            if p == "/api/farm/cage/species":
                cid = body.get("cage_id")
                sp = body.get("species")
                if not cid or not sp:
                    return self._err(400, "参数错误：缺少 cage_id 或 species")
                if not temp_of(sp):
                    return self._err(400, "鱼种档案里没有「%s」—— 没有它的温度参数就不能养" % sp)
                try:
                    r = FARM.set_species(cid, sp)
                    sync_sites_from_farm()      # 立刻生效，不用重启
                except ValueError as e:
                    return self._err(400, str(e))
                t = temp_of(sp) or {}
                return self._json({
                    "ok": True, "cage_id": cid,
                    "old_species": r["old_species"], "new_species": sp,
                    "applied": {
                        "temp_warn_high": t.get("temp_warn_high"),
                        "temp_alarm_high": t.get("temp_alarm_high"),
                        "temp_warn_low": t.get("temp_warn_low"),
                        "temp_alarm_low": t.get("temp_alarm_low"),
                        "temp_opt": [t.get("temp_opt_low"), t.get("temp_opt_high")],
                    },
                    "note": "全平台阈值已按新品种重算（水温告警线、体长体重参数等）",
                })

            if p == "/api/farm/calibrate":
                did = body.get("device_id")
                if not did:
                    return self._err(400, "参数错误：缺少 device_id")
                try:
                    return self._json(FARM.calibrate(did, body.get("date"),
                                                     body.get("institution"),
                                                     body.get("cert_no")))
                except ValueError as e:
                    return self._err(400, str(e))

            # 显式拉取 NDBC 最新数据并写本地缓存。
            # **这是唯一的联网动作**，只在用户点「立即拉取最新」或启动时触发；
            # 页面渲染永远只读本地缓存，所以断网也能演示。
            if p == "/api/ndbc/refresh":
                ids = body.get("stations") or None
                if ids and not isinstance(ids, list):
                    return self._err(400, "参数错误：stations 应为数组")
                res = ndbc.refresh(ids)
                return self._json({
                    "results": res,
                    "ok_count": sum(1 for r in res if r.get("ok")),
                    "fail_count": sum(1 for r in res if not r.get("ok")),
                    "status": ndbc.status(),
                })

            if p == "/api/commands":
                did = body.get("device_id")
                ctype = body.get("command_type")
                if not did or not ctype:
                    return self._err(400, "参数错误：缺少 device_id 或 command_type")
                if did not in [d["device_id"] for d in PLATFORM.devices]:
                    return self._err(404, "设备号不存在：%s" % did)
                cmd = PLATFORM.send_command(did, ctype, body.get("params"), body.get("inject"))
                return self._json(cmd)

            m = re.match(r"^/api/alarms/([\w\-]+)/(confirm|handle)$", p)
            if m:
                aid, act = m.group(1), m.group(2)
                for a in PLATFORM.alarms:
                    if a["alarm_event_id"] == aid:
                        if act == "confirm":
                            a["confirm_status"] = "confirmed"
                            a["confirm_ts"] = int(time.time() * 1000)
                            a["alarm_status"] = "acknowledged"
                            a["handle_status"] = "handled"
                        else:
                            a["handle_status"] = "handling"
                        return self._json(a)
                return self._err(404, "告警事件编号不存在")

            return self._err(404, "接口不存在：%s" % p)
        except Exception as e:                         # noqa: BLE001
            return self._err(500, "服务内部错误：%s" % e)


_CURSOR = "backend/server.py @ 2026-10-05"

MAX_PORT_TRIES = 12


class PlatformServer(ThreadingHTTPServer):
    """⚠️ 必须关掉 SO_REUSEADDR，否则会出现"两个后端同时跑"。

    Python 的 HTTPServer 默认 allow_reuse_address = 1（即 SO_REUSEADDR）。
    在 Linux 上它只影响 TIME_WAIT 复用，但在 **Windows 上它允许两个进程绑定同一个端口**。
    实测过：两个后端同时监听 127.0.0.1:8080，请求随机落到其中一个，
    于是命令与告警状态被切成两半 —— 界面上表现为「我刚下的命令怎么没了」，
    而且完全看不出原因。现场演示遇到这个，基本没救。

    关掉它，第二次绑定会明确失败，我们才能给出人话提示。
    """
    allow_reuse_address = False
    daemon_threads = True


def probe_existing(host, port, timeout=1.5):
    """这个端口上是不是已经有一个「我们的」平台在跑？"""
    try:
        with urllib.request.urlopen("http://%s:%d/api/health" % (host, port), timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8")).get("code") == 200
    except Exception:                                  # noqa: BLE001
        return False


def bind_server(host, want_port):
    """绑定端口。返回 (server, port) 或 (None, None)。

    三种情况：
      1. 端口空着            → 直接绑上
      2. 端口被占，但是我们的平台 → 告诉用户「已经开着了」，别再开第二个
      3. 端口被别的程序占着   → 换下一个端口
    """
    for i in range(MAX_PORT_TRIES):
        p = want_port + i
        try:
            return PlatformServer((host, p), Handler), p
        except OSError as e:
            winerr = getattr(e, "winerror", None)
            busy = (winerr == 10048) or (e.errno in (48, 98, 10048, 13))
            if not busy:
                raise
            if probe_existing(host, p):
                return "ALREADY", p
            if i == 0:
                print("  提示：%d 端口被别的程序占用了，换一个…" % p)
            else:
                print("          %d 也被占了，再换一个…" % p)
    return None, None


def main():
    ap = argparse.ArgumentParser(description="深远海养殖与海洋牧场智能管控平台 —— 后端 + 前端托管")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    if not os.path.isdir(FRONTEND):
        print("!! 找不到前端目录：%s" % FRONTEND)
        return 2

    srv, port = bind_server(args.host, args.port)
    url = "http://%s:%d/" % (args.host, port)

    if srv == "ALREADY":
        print("=" * 62)
        print("  平台已经在运行了 —— 不用再开第二个")
        print("=" * 62)
        print()
        print("  直接打开：%s" % url)
        print()
        print("  （开两个会各跑各的数据，命令和告警会对不上。")
        print("    想重启的话，先把原来那个窗口关掉。）")
        print()
        if not args.no_browser:
            webbrowser.open(url)
        return 0

    if srv is None:
        print("=" * 62)
        print("  [错误] 连续 %d 个端口都被占用了" % MAX_PORT_TRIES)
        print("=" * 62)
        print()
        print("  请关掉一些程序，再双击一次 启动平台.bat。")
        print()
        return 1

    load_species_db()          # 鱼种体长体重参数库（读不到会打警告并回落）
    load_temp_db()             # 鱼种温度参数库（水温告警按鱼种取值）
    sync_sites_from_farm()     # 以 farm.json 为准覆盖站点的养殖信息

    # NDBC 缓存：**启动时后台尽力刷一次**，但绝阻塞启动、绝影响可用性。
    # 为什么要"后台"：整个平台必须在断网时也能起来（R1 现场不能赌网络）。
    # 所以这里是 daemon 线程 + 只在缓存过期时才拉；拉失败只记一行日志。
    def _bg_ndbc_refresh():
        try:
            for st in ndbc.status().get("stations", []):
                age = st.get("age_minutes")
                if (not st.get("has_cache")) or (age is not None and age > 180):
                    r = ndbc.refresh([st["station_id"]])
                    for x in r:
                        if x.get("ok"):
                            print("  [NDBC] %s 已更新：%d 条，最新 %s UTC"
                                  % (x["station_id"], x["count"], x.get("latest_ts_utc")))
                        else:
                            print("  [NDBC] %s 拉取失败（用本地缓存继续）：%s"
                                  % (x["station_id"], x.get("error")))
        except Exception as e:                              # noqa: BLE001
            print("  [NDBC] 后台刷新异常（不影响使用）：%s" % e)
    threading.Thread(target=_bg_ndbc_refresh, daemon=True).start()

    print("=" * 62)
    print("  深远海养殖与海洋牧场智能管控平台")
    print("=" * 62)
    print("  平台地址：%s" % url)
    print("  前端目录：%s" % FRONTEND)
    print("  接口前缀：/api/        （健康检查 /api/health）")
    print("  零依赖：只用 Python 标准库，无需 pip install、无需联网")
    site0 = SITES[0]
    lwr0 = lwr_of(site0.get("species", ""))
    if lwr0:
        print("  主养鱼种：%s    W = %s × L^%s  (%s)"
              % (site0["species"], lwr0["a"], lwr0["b"], lwr0["source"]))
        print("            参数库 %d 个鱼种，出处见 /api/species"
              % len(SPECIES_DB["species"]))
    print()
    print("  按 Ctrl+C 停止     （演示期间别关这个窗口）")
    print("=" * 62)
    # 显式 flush：输出被重定向时 Python 会缓冲，横幅（含网址）就迟迟不显示。
    # 对非技术队员来说"网址是哪一行"必须一眼看到。
    try:
        sys.stdout.flush()
    except Exception:                                  # noqa: BLE001
        pass

    if not args.no_browser:
        threading.Thread(target=lambda: (time.sleep(1.0), webbrowser.open(url)), daemon=True).start()

    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    return 0


if __name__ == "__main__":
    sys.exit(main())

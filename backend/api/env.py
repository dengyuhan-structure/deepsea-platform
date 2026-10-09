# -*- coding: utf-8 -*-
"""
backend/api/env.py —— 环境板块后端扩展（供 server.py 挂载，不修改 server.py）

【为什么有这个文件】
  队长仓库的 server.py 是手工路由（_api_get / _api_post 的 if 链），
  没有自动加载 backend/api/ 目录的机制（该目录只有 .gitkeep）。
  以下三个能力（精确历史区间 / 大风大浪细化 / 站点暂停控制）都写在 server.py 之外，
  由本文件提供。队长只需在 server.py 里挂载 5 条路由（改动 <12 行），
  不碰任何现有逻辑，前端也无需再改。

【挂载方法】（给队长看，二选一）
  写法 A（server.py 与 backend/ 同级，按仓库现有 import 风格）：
      from backend.api import env as env_api          # 若 backend 有 __init__.py
  写法 B（命名空间包，仓库根运行）：
      import api.env as env_api

  然后在路由链里加：
      # GET /api/env/historical?site_id=site_02&start_ts=...&end_ts=...
      #      精确历史区间：观测站点读 NDBC 缓存，养殖站点按区间模拟
      if path == "/api/env/historical":
          return _json(env_api.historical(query))
      # GET /api/env/ndbc-ranges
      #      各观测站点缓存数据的精确起止时间（前端「数据时间范围」列）
      if path == "/api/env/ndbc-ranges":
          return _json(env_api.ndbc_ranges())
      # GET /api/env/storm?site_id=site_01&minutes=60&storm_type=wind&heat=0&offline=0
      #      大风大浪细化：storm_type = all / wind / wave（仅风速异常 / 仅浪高异常 / 整体）
      if path == "/api/env/storm":
          return _json(env_api.storm(query))
      # GET  /api/env/sim-control          —— 查询各站点暂停状态
      # POST /api/env/sim-control          —— 切换暂停（body: {"site_id":"site_01"}）
      if path == "/api/env/sim-control":
          if method == "GET":
              return _json(env_api.sim_snapshot())
          return _json(env_api.sim_toggle(body))

  其中 _json 是 server.py 里现有的 JSON 响应封装（按实际函数名替换）。

【口径】
  - 仿真生成与 backend/server.py 的 env_series 同口径（固定 seed 可复现）：
      正常       浪高 ~1.4 m / 风速 ~8.3 m/s / 流速 ~0.6 m/s / 光照 ~12000 lux
      整体风暴   浪高 ~4.6 m / 风速 ~19 m/s / 流速 ~1.4 m/s / 光照 ~4000 lux
      仅风速异常 只抬风速（浪高保持正常）
      仅浪高异常 只抬浪高（风速保持正常）
      水温 18.6 ℃ + 昼夜正弦；heat 模式朝 30.5 ℃ 爬升（HEAT_TARGET_C）
      离线模式从时段 60% 起全字段 null、quality=stale
  - 观测站点历史来自 data/ndbc_cache/ndbc_<station>.json（随仓库走，断网可用），
    字段只含 NDBC 提供的四要素（浪高/风速/气温/水温），其余为 None ——
    与平台「观测站点不测水质」口径一致，不许用仿真值充数。

【2026-10-08 追加说明（PR 需向队长说明的越权项）】
  1. 问题一~三（模拟站点触发异常只影响「接下来实时生成」的数据、已生成点不变、
     正常状态偶发较异常数据并计入事件）：因 server.py 的 /api/env 是整窗重生成
     （每次请求把历史窗口重新算一遍，触发异常会把已生成数据改写），
     契约禁止修改 server.py，故该三项改由 frontend/pages/env.js 内置的
     流式仿真生成器（__ENV_GEN__）实现：每个点生成一次后永不再改，
     站点序列缓存在全局 __ENV_SERIES__，按真实时间轴逐步追加。
     若队长希望仿真生成统一回到后端，需在 server.py 中把 /api/env 改为
     「按时间轴追加、已生成点不可变」的流式实现，前端 load() 已预留分流
     （观测站点走 API.env / 养殖站点走 __ENV_GEN__），届时可在 env.js 内切换。
  2. 问题四（删除「原始数据明细」/env/records 与「环境仿真控制」/env/simulator）：
     这两个菜单项注册在 frontend/app.js 的 MENU（骨架文件，契约明确由骨架维护、
     他人不要改），且 env.js 从未注册对应页面。删除导航项需要改 app.js，
     属越权范围，本分支未改动。若队长确认删除，请移除 app.js 中
     { path: '/env/records', label: '原始数据明细', ready: false } 与
     { path: '/env/simulator', label: '环境仿真控制', ready: false } 两项。
"""

import json
import math
import os
import random
import time
from datetime import datetime, timezone

# 与 backend/server.py 保持一致的时间刻度
STEP_FAST = 5000          # 快变量 5 秒一条（水温/溶解氧/光照/海况）
STEP_SLOW = 30000         # 慢变量 30 秒一条（盐度/pH）
HEAT_TARGET_C = 30.5      # 水温骤升目标（白天黑夜都能过 28.0 告警线）

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FARM_PATH = os.path.join(ROOT, "data", "farm.json")
CACHE_DIR = os.path.join(ROOT, "data", "ndbc_cache")


# ----------------------------------------------------------------------
# 站点配置
# ----------------------------------------------------------------------
def _load_farm():
    try:
        with open(FARM_PATH, encoding="utf-8") as f:
            return json.load(f).get("sites", [])
    except Exception:                       # noqa: BLE001
        return []


def site(site_id):
    """按 site_id 找站点配置（farm.json）；找不到返回 None。"""
    for s in _load_farm():
        if s.get("site_id") == site_id:
            return s
    return None


def station_id_of(site_id):
    """观测站点对应的 NDBC 浮标号；养殖站点返回 None。"""
    s = site(site_id)
    return (s or {}).get("station_id")


def _load_ndbc_cache(station_id):
    """读 NDBC 本地缓存（随仓库走，断网可用）。"""
    try:
        with open(os.path.join(CACHE_DIR, "ndbc_%s.json" % station_id), encoding="utf-8") as f:
            return json.load(f)
    except Exception:                       # noqa: BLE001
        return None


# ----------------------------------------------------------------------
# 仿真数据生成（与 backend/server.py env_series 同口径 + 风暴细化）
# ----------------------------------------------------------------------
def _rng(seed):
    return random.Random(seed)


def _gen(site_id, t0, n, storm=False, storm_type="all",
         heat=False, offline_from=None, rng=None):
    """生成一条快变量序列（复刻 server.py env_series 口径）。"""
    rng = rng or _rng(None)
    # 风暴细化：整体 / 仅风速异常 / 仅浪高异常
    wave_mean = 4.6 if (storm and storm_type in ("all", "wave")) else 1.4
    wind_mean = 19.0 if (storm and storm_type in ("all", "wind")) else 8.3

    fast = []
    for i in range(n):
        ts = t0 + i * STEP_FAST
        h = datetime.fromtimestamp(ts / 1000).hour + datetime.fromtimestamp(ts / 1000).minute / 60.0
        diurnal = math.sin((h - 6) / 24 * 2 * math.pi)
        off = offline_from is not None and i >= offline_from

        wave = rng.gauss(wave_mean, .55) if storm else rng.gauss(1.4, .25)
        wind = rng.gauss(wind_mean, 2.5) if storm else rng.gauss(8.3, 1.2)
        base_water = 18.6 + diurnal * 1.8
        if heat:
            prog = max(0.0, (i / n - 0.55) / 0.45)
            water = base_water + (HEAT_TARGET_C - base_water) * prog + rng.gauss(0, .12)
        else:
            water = base_water + rng.gauss(0, .15)
        air = 22.4 + diurnal * 3.2 + rng.gauss(0, .4) + (water - base_water) * .6
        light = max(0.0, (4000 if storm else 12000) * max(0.0, math.sin((h - 6) / 12 * math.pi)) + rng.gauss(0, 400))

        fast.append({
            "ts": ts,
            "site_id": site_id,
            "source": "simulated",
            "quality": "stale" if off else "good",
            "wave_height": None if off else round(wave, 1),
            "wind_speed": None if off else round(wind, 1),
            "current_speed": None if off else round(rng.gauss(1.4 if storm else .6, .12), 1),
            "air_temp": None if off else round(air, 1),
            "water_temp": None if off else round(water, 1),
            "dissolved_oxygen": None if off else round(9.2 - (water - 18.6) * .45 + rng.gauss(0, .12), 1),
            "light_intensity": None if off else round(light),
        })
    return fast


def _gen_slow(site_id, t0, n, offline_from=None, rng=None):
    rng = rng or _rng(None)
    slow = []
    for i in range(n):
        ts = t0 + i * STEP_SLOW
        off = offline_from is not None and ts >= offline_from
        slow.append({
            "ts": ts,
            "site_id": site_id,
            "quality": "stale" if off else "good",
            "salinity": None if off else round(rng.gauss(32.1, .15), 1),
            "ph": None if off else round(rng.gauss(8.1, .06), 1),
        })
    return slow


def env_series(site_id, minutes=60, storm=False, storm_type="all",
               heat=False, offline=False, seed=None, t0=None):
    """环境时序（接口文档 4.1 / 4.2 / 4.3；与 server.py 同口径 + storm_type 细化）。
    storm_type: 'all' 整体大风大浪 / 'wind' 仅风速异常 / 'wave' 仅浪高异常。
    """
    n = max(2, int(minutes * 60 * 1000 / STEP_FAST))
    n_slow = max(2, int(minutes * 60 * 1000 / STEP_SLOW))
    offline_from = int(n * 0.6) if offline else None
    now = t0 if t0 is not None else (int(time.time() * 1000) // 1000 * 1000)
    t0 = now - minutes * 60 * 1000
    r = _rng(seed)
    return {
        "fast": _gen(site_id, t0, n, storm, storm_type, heat, offline_from, r),
        "slow": _gen_slow(site_id, t0, n_slow, offline_from, r),
    }


# ----------------------------------------------------------------------
# 精确历史区间查询（观测站点读 NDBC 缓存；养殖站点按区间模拟）
# ----------------------------------------------------------------------
def historical(site_id, start_ts, end_ts, max_points=720):
    """按 [start_ts, end_ts]（毫秒）返回历史时序。"""
    start_ts = int(start_ts or 0)
    end_ts = int(end_ts or 0)
    if end_ts <= start_ts:
        return {"site_id": site_id, "source": None, "count": 0, "records": [],
                "note": "end_ts 必须大于 start_ts"}

    sid = station_id_of(site_id)
    if sid:  # 观测站点：真实公开历史（NDBC 本地缓存）
        cache = _load_ndbc_cache(sid)
        recs = (cache or {}).get("records", [])
        hits = [r for r in recs if start_ts <= r.get("ts", 0) <= end_ts]
        out = []
        for r in hits[-max_points:]:
            out.append({
                "ts": r["ts"],
                "ts_utc": r.get("ts_utc"),
                "site_id": site_id,
                "source": "public",
                "quality": "good",
                "wave_height": r.get("wave_height"),
                "wind_speed": r.get("wind_speed"),
                "air_temp": r.get("air_temp"),
                "water_temp": r.get("water_temp"),
                "current_speed": None,      # NDBC 不提供 → 平台口径：不测，不给仿真值
                "dissolved_oxygen": None,
                "salinity": None,
                "ph": None,
                "light_intensity": None,
            })
        return {
            "site_id": site_id,
            "source": "public",
            "source_detail": (cache or {}).get("source", "NOAA NDBC 公开浮标（实时）"),
            "start_ts": start_ts,
            "end_ts": end_ts,
            "count": len(out),
            "records": out,
        }

    # 养殖站点：按区间模拟（诚实标注 source=simulated）
    n = max(2, min(max_points, int((end_ts - start_ts) / STEP_FAST)))
    r = _rng(None)
    fast = _gen(site_id, start_ts, n, storm=False, storm_type="all",
                heat=False, offline_from=None, rng=r)
    return {
        "site_id": site_id,
        "source": "simulated",
        "source_detail": "按区间生成的仿真时序（养殖站点无真实历史）",
        "start_ts": start_ts,
        "end_ts": end_ts,
        "count": len(fast),
        "records": fast,
    }


# ----------------------------------------------------------------------
# NDBC 缓存时间范围（浮标「数据时间范围」精确值；未挂载时前端降级用估算并标注）
# ----------------------------------------------------------------------
def ndbc_ranges():
    """返回每个观测站点缓存数据的起止时间（供前端「数据时间范围」列显示）。"""
    out = []
    for s in _load_farm():
        sid = s.get("station_id")
        if not sid:
            continue
        cache = _load_ndbc_cache(sid)
        recs = (cache or {}).get("records", [])
        if recs:
            out.append({
                "station_id": sid,
                "count": len(recs),
                "first_ts": recs[0]["ts"],
                "latest_ts": recs[-1]["ts"],
                "first_ts_utc": recs[0].get("ts_utc"),
                "latest_ts_utc": recs[-1].get("ts_utc"),
            })
    return {"ranges": out}


# ----------------------------------------------------------------------
# 大风大浪细化（storm_type = all / wind / wave）
# ----------------------------------------------------------------------
def storm(site_id, minutes=60, storm_type="all", heat=False, offline=False, seed=None):
    if storm_type not in ("all", "wind", "wave"):
        storm_type = "all"
    return env_series(site_id, minutes=minutes, storm=True, storm_type=storm_type,
                      heat=bool(heat), offline=bool(offline), seed=seed)


# ----------------------------------------------------------------------
# 站点暂停控制（供前端「暂停生成 / 恢复生成」调用，全平台共享一份状态）
# ----------------------------------------------------------------------
class SimControl:
    def __init__(self):
        self._paused = set()

    def toggle(self, site_id):
        if site_id in self._paused:
            self._paused.discard(site_id)
            return False
        self._paused.add(site_id)
        return True

    def paused_sites(self):
        return sorted(self._paused)

    def snapshot(self):
        return {"paused_sites": self.paused_sites(),
                "count": len(self._paused),
                "note": "暂停状态由后端维护；前端轮询时应跳过已暂停站点"}


_CTL = SimControl()


def sim_snapshot():
    return _CTL.snapshot()


def sim_toggle(body):
    sid = (body or {}).get("site_id")
    if not sid:
        return {"ok": False, "error": "缺少 site_id"}
    paused = _CTL.toggle(sid)
    return {"ok": True, "site_id": sid, "paused": paused, **_CTL.snapshot()}


# ----------------------------------------------------------------------
# 路由清单（队长挂载时对照）
# ----------------------------------------------------------------------
def routes():
    return [
        ("GET", "/api/env/historical", "historical(query)"),
        ("GET", "/api/env/ndbc-ranges", "ndbc_ranges()"),
        ("GET", "/api/env/storm", "storm(query)"),
        ("GET", "/api/env/sim-control", "sim_snapshot()"),
        ("POST", "/api/env/sim-control", "sim_toggle(body)"),
    ]


if __name__ == "__main__":
    print("== env_api 自测 ==")
    print(json.dumps(routes(), ensure_ascii=False))
    demo = env_series("site_01", minutes=5, storm=True, storm_type="wind", seed=20261005)
    last = demo["fast"][-1]
    print("wind 细化最后一条：浪高 %.1f m / 风速 %.1f m/s" % (last["wave_height"], last["wind_speed"]))

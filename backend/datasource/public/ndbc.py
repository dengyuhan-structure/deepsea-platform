# -*- coding: utf-8 -*-
"""
NOAA NDBC 公开浮标数据源。

【为什么要有这个模块】
  接口文档 8.2 的对外口径是：「采用 **NDBC 真实浮标海域数据**作为环境驱动，站点为模拟养殖站点。」
  但在此之前，**三个观测站点返回的也是仿真值** —— 这句话是空的。
  本模块让观测站点真的去 NDBC 取数，把这句话坐实。

【铁律：演示不能依赖网络】
  整个平台按「零依赖、可离线」设计（R1：现场没人会改代码）。
  所以本模块的策略是 **「后端负责拉，前端负责读本地」**：
    · 取数是**显式动作**（启动时尽力拉一次 + 页面上的「立即拉取最新」按钮）
    · 拉到就写本地缓存；**页面永远读本地缓存**
    · 拔掉网线，平台照样打开、数据照样显示
  **绝不允许页面渲染时同步等网络。**

【数据格式】NDBC realtime2，固定列：
  #YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES ATMP WTMP DEWP VIS PTDY TIDE
   0   1  2  3  4   5    6    7    8    9   10  11   12   13   14   15   16   17   18
  缺失值写作 `MM`。时间是 **UTC**。
"""
import json
import os
import time
import urllib.request
from datetime import datetime, timezone

# 本文件在 backend/datasource/public/ 下，要往上**三层**才是仓库根。
# （踩过：只上两层会算成 backend/datasource，缓存写到 backend/data/ 去了）
_HERE = os.path.dirname(os.path.abspath(__file__))              # backend/datasource/public
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(_HERE)))  # 仓库根
CACHE_DIR = os.path.join(ROOT, "data", "ndbc_cache")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Safari/537.36")
BASE_URL = "https://www.ndbc.noaa.gov/data/realtime2/%s.txt"

# 站点编号 → 说明（与 server.py 的 SITES 对应）
STATIONS = {
    "42001": {"name": "MID GULF", "cn": "墨西哥湾中部", "lat": 25.92, "lon": -89.64},
    "46001": {"name": "WESTERN GULF OF ALASKA", "cn": "阿拉斯加湾西部", "lat": 56.30, "lon": -148.02},
    "51001": {"name": "NORTHWESTERN HAWAII ONE", "cn": "夏威夷西北", "lat": 24.45, "lon": -162.00},
}

# NDBC 列 → 平台字段
#   只取平台接口文档里有的量；NDBC 不提供的（流速/溶解氧/盐度/pH/光照）仍由仿真生成
COL = {
    "wind_speed": 6,      # WSPD  m/s
    "wave_height": 8,     # WVHT  m
    "air_pressure": 12,   # PRES  hPa   ← 平台未定义字段，但拉回来顺手留着
    "air_temp": 13,       # ATMP  ℃
    "water_temp": 14,     # WTMP  ℃
}

# NDBC 能提供、但平台接口文档里没有定义的字段。
# 不许往正式接口里塞未定义字段 —— 记在这里，要用先走变更流程。
EXTRA_FIELDS = ("air_pressure",)

FETCH_TIMEOUT = 20


def _num(s):
    """NDBC 用 `MM` 表示缺失。缺失一律给 None —— 不许拿上一个值顶替。"""
    if s is None or s == "MM" or s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse(text):
    """把 realtime2 文本解析成记录列表（按时间升序）。"""
    out = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        p = line.split()
        if len(p) < 15:
            continue
        try:
            # NDBC 时间戳是 UTC
            dt = datetime(int(p[0]), int(p[1]), int(p[2]), int(p[3]), int(p[4]),
                          tzinfo=timezone.utc)
        except ValueError:
            continue
        rec = {"ts": int(dt.timestamp() * 1000),
               "ts_utc": dt.strftime("%Y-%m-%d %H:%M")}
        for k, i in COL.items():
            rec[k] = _num(p[i]) if i < len(p) else None
        out.append(rec)
    out.sort(key=lambda r: r["ts"])       # NDBC 原文件是新的在前，这里翻成升序
    return out


def fetch(station_id, timeout=FETCH_TIMEOUT):
    """从 NDBC 拉一个站的全部 realtime2 数据。失败抛异常，由调用方决定怎么办。"""
    url = BASE_URL % station_id
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        text = r.read().decode("utf-8", "replace")
    recs = parse(text)
    if not recs:
        raise RuntimeError("NDBC 返回了内容但解析不出数据行（站点可能停用）")
    return recs


# ----------------------------------------------------------------------
# 本地缓存：页面只读它
# ----------------------------------------------------------------------
def _path(station_id):
    return os.path.join(CACHE_DIR, "ndbc_%s.json" % station_id)


def save_cache(station_id, recs):
    os.makedirs(CACHE_DIR, exist_ok=True)
    payload = {
        "station_id": station_id,
        "station": STATIONS.get(station_id, {}),
        "fetched_at": int(time.time() * 1000),
        "source": "NOAA NDBC 公开浮标（实时）",
        "source_url": BASE_URL % station_id,
        "count": len(recs),
        "records": recs,
    }
    tmp = _path(station_id) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    os.replace(tmp, _path(station_id))      # 原子替换：写一半断电也不会留坏文件
    return payload


def load_cache(station_id):
    try:
        with open(_path(station_id), encoding="utf-8") as f:
            return json.load(f)
    except Exception:                                       # noqa: BLE001
        return None


def age_minutes(cache):
    if not cache:
        return None
    return round((time.time() * 1000 - cache.get("fetched_at", 0)) / 60000.0, 1)


def status():
    """给 /api/ndbc/status 用：每个站缓存新不新、有多少条、数据到什么时候。"""
    out = []
    for sid, meta in STATIONS.items():
        c = load_cache(sid)
        item = {"station_id": sid, "station": meta,
                "has_cache": bool(c),
                "fetched_at": c.get("fetched_at") if c else None,
                "age_minutes": age_minutes(c),
                "count": c.get("count") if c else 0}
        if c and c.get("records"):
            last = c["records"][-1]
            item["latest_ts"] = last["ts"]
            item["latest_ts_utc"] = last.get("ts_utc")
            item["latest"] = {k: last.get(k) for k in COL}
        out.append(item)
    return {"stations": out, "cache_dir": CACHE_DIR,
            "note": "缓存文件在 data/ndbc_cache/，随仓库一起走 —— 断网也能演示"}


def refresh(station_ids=None):
    """显式拉取并写缓存。返回每个站的结果（成功/失败都返回，不抛）。"""
    res = []
    for sid in (station_ids or list(STATIONS)):
        t0 = time.time()
        try:
            recs = fetch(sid)
            payload = save_cache(sid, recs)
            res.append({"station_id": sid, "ok": True,
                        "count": len(recs),
                        "latest_ts_utc": recs[-1].get("ts_utc"),
                        "elapsed_ms": int((time.time() - t0) * 1000)})
        except Exception as e:                              # noqa: BLE001
            res.append({"station_id": sid, "ok": False,
                        "error": "%s: %s" % (type(e).__name__, e),
                        "elapsed_ms": int((time.time() - t0) * 1000)})
    return res


# ----------------------------------------------------------------------
# NDBC 能提供什么、不能提供什么 —— **这条决定观测站点页面长什么样**
#
#   能提供：浪高、风速、气温、水温（+ 气压，平台未定义该字段）
#   不能提供：流速、溶解氧、盐度、pH、光照
#
#   所以观测站点这几项**一律返回 null（显示「—」），不用仿真值充数**。
#   理由：接口文档 8.2 的对外口径是「采用 NDBC 真实浮标数据」，
#   如果拿仿真值补齐，**页面看起来齐全，但"真实"两个字就成了谎**。
#   宁可显示「—」并说清楚"浮标不测这项"，也不要把仿真值混进去。
# ----------------------------------------------------------------------
NDBC_PROVIDES = ("wave_height", "wind_speed", "air_temp", "water_temp")
NDBC_LACKS = ("current_speed", "dissolved_oxygen", "salinity", "ph", "light_intensity")

# 平台快变量字段全集（与 server.py 的 env_series 保持一致）
FAST_FIELDS = ("wave_height", "wind_speed", "current_speed", "air_temp",
               "water_temp", "dissolved_oxygen", "light_intensity")


def as_env(site, minutes=60, max_points=720):
    """把 NDBC 缓存转成平台 `/api/env` 的返回形状。

    返回 None 表示「这个站没有可用缓存」—— 由调用方决定回落到仿真还是显示空。
    """
    sid = site.get("station_id")
    if not sid:
        return None
    cache = load_cache(sid)
    if not cache or not cache.get("records"):
        return None

    recs = cache["records"]
    # NDBC 是 10 分钟一个点；截取覆盖 minutes 的尾部
    need = max(2, int(minutes * 60 / 600))
    recs = recs[-need:]

    # 「当前值」取哪一条？
    # NDBC 最新一两条经常是残缺的（浪高处理得慢，最新的点常是 MM）。
    # 直接取最后一条 → 页面上浪高显示「—」，看着像坏了。
    # 所以取**最近一条四个字段齐全的**；全部缺就退回最后一条。
    # ⚠️ 这不是"拿旧值顶替" —— 卡片上显示的 ts 就是那条记录的真实观测时间，没有骗人。
    cur = None
    for r in reversed(recs):
        if all(r.get(f) is not None for f in NDBC_PROVIDES):
            cur = r
            break
    if cur is None:
        cur = recs[-1] if recs else None

    fast = []
    for r in recs:
        item = {"ts": r["ts"], "site_id": site["site_id"],
                "source": "public", "quality": "good",
                "source_detail": "NOAA NDBC %s 实测（%s）"
                                 % (sid, cache.get("station", {}).get("cn", ""))}
        for f in FAST_FIELDS:
            item[f] = r.get(f)            # NDBC 没有的字段 → None → 页面显示「—」
        fast.append(item)

    return {
        "site_id": site["site_id"],
        "source": "public",
        "source_detail": "NOAA NDBC 公开浮标 %s 实测数据" % sid,
        "source_url": BASE_URL % sid,
        "fetched_at": cache.get("fetched_at"),
        "cadence_sec": 600,
        "current": cur,                    # 供页面显示"当前值"用（四字段齐全的那条）
        "fast": fast,
        # 慢变量（盐度/pH）浮标不测 —— 直接给空，不编
        "slow": [],
        "note": ("浮标实测提供：" + "、".join(NDBC_PROVIDES) +
                 "。不提供：" + "、".join(NDBC_LACKS) +
                 "（页面显示「—」，不用仿真值充数）。"),
        "coverage": {f: _coverage(recs, f) for f in NDBC_PROVIDES},
    }


def _coverage(recs, field):
    n = len(recs)
    if not n:
        return 0.0
    return round(sum(1 for r in recs if r.get(field) is not None) * 100.0 / n, 1)


if __name__ == "__main__":
    import sys
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:                                       # noqa: BLE001
        pass
    print("数据源模块自检")
    print("  缓存目录:", CACHE_DIR)
    for r in refresh():
        print("  ", r)

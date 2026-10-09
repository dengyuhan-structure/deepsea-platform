# -*- coding: utf-8 -*-
"""
backend/api/test_env_api.py —— api/env.py 的问题级测试
运行：python backend/api/test_env_api.py
职责：每个能力（历史区间 / 风暴细化 / 暂停控制）都有有效测试，通过后才算完成。
"""
import os
import sys
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# 脚本运行目录（backend/api）在 sys.path[0]，直接 import env（同名模块）
import env  # noqa: E402


class TestEnvSeries(unittest.TestCase):
    """风暴细化：整体 / 仅风速 / 仅浪高，与 server.py 口径一致"""

    def _mean(self, seq):
        return sum(seq) / len(seq)

    def test_storm_all(self):
        d = env.env_series("site_01", minutes=5, storm=True, storm_type="all", seed=20261005)
        w = [r["wave_height"] for r in d["fast"]]
        s = [r["wind_speed"] for r in d["fast"]]
        self.assertAlmostEqual(self._mean(w), 4.6, delta=0.6, msg="整体风暴浪高应约 4.6 m")
        self.assertAlmostEqual(self._mean(s), 19.0, delta=0.8, msg="整体风暴风速应约 19 m/s")

    def test_storm_wind_only(self):
        d = env.env_series("site_01", minutes=5, storm=True, storm_type="wind", seed=20261005)
        w = [r["wave_height"] for r in d["fast"]]
        s = [r["wind_speed"] for r in d["fast"]]
        self.assertAlmostEqual(self._mean(w), 1.4, delta=0.4, msg="仅风速异常：浪高保持正常")
        self.assertAlmostEqual(self._mean(s), 19.0, delta=0.8, msg="仅风速异常：风速抬至约 19 m/s")

    def test_storm_wave_only(self):
        d = env.env_series("site_01", minutes=5, storm=True, storm_type="wave", seed=20261005)
        w = [r["wave_height"] for r in d["fast"]]
        s = [r["wind_speed"] for r in d["fast"]]
        self.assertAlmostEqual(self._mean(w), 4.6, delta=0.6, msg="仅浪高异常：浪高抬至约 4.6 m")
        self.assertAlmostEqual(self._mean(s), 8.3, delta=0.5, msg="仅浪高异常：风速保持正常")

    def test_normal(self):
        d = env.env_series("site_01", minutes=5, storm=False, seed=20261005)
        w = [r["wave_height"] for r in d["fast"]]
        s = [r["wind_speed"] for r in d["fast"]]
        self.assertAlmostEqual(self._mean(w), 1.4, delta=0.4, msg="正常：浪高约 1.4 m")
        self.assertAlmostEqual(self._mean(s), 8.3, delta=0.5, msg="正常：风速约 8.3 m/s")

    def test_heat_reaches_alarm(self):
        d = env.env_series("site_01", minutes=60, heat=True, seed=20261005)
        last = d["fast"][-1]["water_temp"]
        self.assertGreater(last, 28.0, msg="水温骤升最终应越过 28.0 ℃ 告警线")

    def test_offline_nulls_from_60pct(self):
        d = env.env_series("site_01", minutes=10, offline=True, seed=20261005)
        n = len(d["fast"])
        tail = d["fast"][int(n * 0.6):]
        head = d["fast"][:int(n * 0.6)]
        self.assertTrue(all(r["wave_height"] is None and r["quality"] == "stale" for r in tail),
                        msg="离线后 60% 起全字段 None 且 quality=stale")
        self.assertTrue(all(r["wave_height"] is not None for r in head), msg="离线前数据正常")


class TestHistorical(unittest.TestCase):
    """精确历史区间：观测站点读 NDBC 缓存，养殖站点按区间模拟"""

    def _cache(self):
        return {
            "station_id": "42001",
            "source": "NOAA NDBC 公开浮标（实时）",
            "records": [
                {"ts": 1000, "ts_utc": "2026-10-01 00:00",
                 "wave_height": 1.1, "wind_speed": 6.0, "air_temp": 20.0, "water_temp": 21.0},
                {"ts": 2000, "ts_utc": "2026-10-01 00:10",
                 "wave_height": 1.4, "wind_speed": 7.0, "air_temp": 20.2, "water_temp": 21.1},
                {"ts": 3000, "ts_utc": "2026-10-01 00:20",
                 "wave_height": 2.6, "wind_speed": 9.0, "air_temp": 20.4, "water_temp": 21.3},
                {"ts": 4000, "ts_utc": "2026-10-01 00:30",
                 "wave_height": 1.0, "wind_speed": 5.0, "air_temp": 20.0, "water_temp": 21.0},
            ],
        }

    def test_obs_filters_by_range(self):
        with mock.patch.object(env, "_load_ndbc_cache", return_value=self._cache()):
            out = env.historical("site_02", 2000, 3000)
        self.assertEqual(out["source"], "public", msg="观测站点历史来源为 public")
        self.assertEqual(out["count"], 2, msg="只返回区间 [2000,3000] 内的 2 条")
        self.assertEqual([r["ts"] for r in out["records"]], [2000, 3000], msg="区间外记录被剔除")
        r0 = out["records"][0]
        self.assertEqual(r0["wave_height"], 1.4, msg="NDBC 四要素保留")
        self.assertIsNone(r0["current_speed"], msg="NDBC 不测字段一律 None（不许仿真值充数）")
        self.assertIsNone(r0["dissolved_oxygen"], msg="溶氧 None")
        self.assertIsNone(r0["light_intensity"], msg="光照 None")

    def test_obs_no_cache(self):
        with mock.patch.object(env, "_load_ndbc_cache", return_value=None):
            out = env.historical("site_02", 0, 5000)
        self.assertEqual(out["count"], 0, msg="无缓存返回空，不编造数据")

    def test_farm_simulated(self):
        t0 = 1760000000000
        out = env.historical("site_01", t0, t0 + 600000)
        self.assertEqual(out["source"], "simulated", msg="养殖站点历史为模拟并诚实标注")
        self.assertGreater(out["count"], 1, msg="区间内生成多条")
        self.assertTrue(all(t0 <= r["ts"] <= t0 + 600000 for r in out["records"]),
                        msg="所有记录都在区间内")

    def test_invalid_range(self):
        out = env.historical("site_01", 5000, 1000)
        self.assertEqual(out["count"], 0, msg="end<=start 返回空并给提示")


class TestSimControl(unittest.TestCase):
    """站点暂停控制"""

    def setUp(self):
        env._CTL._paused.clear()

    def test_toggle_and_snapshot(self):
        self.assertEqual(env.sim_snapshot()["count"], 0, msg="初始无暂停站点")
        self.assertTrue(env.sim_toggle({"site_id": "site_01"})["paused"], msg="第一次切换 = 暂停")
        self.assertFalse(env.sim_toggle({"site_id": "site_01"})["paused"], msg="第二次切换 = 恢复")
        env.sim_toggle({"site_id": "site_03"})
        snap = env.sim_snapshot()
        self.assertEqual(snap["paused_sites"], ["site_03"], msg="暂停列表只含 site_03")

    def test_toggle_requires_site_id(self):
        out = env.sim_toggle({})
        self.assertFalse(out["ok"], msg="缺 site_id 返回失败")


class TestNdbcRanges(unittest.TestCase):
    """浮标「数据时间范围」精确值（供前端列显示）"""

    def _farm(self):
        return [
            {"site_id": "site_01", "kind": "farm"},
            {"site_id": "site_02", "kind": "obs", "station_id": "42001"},
            {"site_id": "site_03", "kind": "obs", "station_id": "46001"},
        ]

    def _cache(self):
        return {"records": [
            {"ts": 1000, "ts_utc": "2026-01-01 00:00"},
            {"ts": 2000, "ts_utc": "2026-01-01 00:10"},
            {"ts": 3000, "ts_utc": "2026-01-01 00:20"},
        ]}

    def test_ranges_obs_only(self):
        with mock.patch.object(env, "_load_farm", return_value=self._farm()), \
             mock.patch.object(env, "_load_ndbc_cache",
                               side_effect=lambda sid: self._cache() if sid == "42001" else None):
            out = env.ndbc_ranges()["ranges"]
            self.assertEqual(len(out), 1, msg="只统计有缓存的观测站点，无 station_id 的养殖站点跳过")
            self.assertEqual(out[0]["station_id"], "42001", msg="正确关联浮标")
            self.assertEqual(out[0]["first_ts"], 1000, msg="首条时间戳")
            self.assertEqual(out[0]["latest_ts"], 3000, msg="末条时间戳")
            self.assertEqual(out[0]["first_ts_utc"], "2026-01-01 00:00", msg="首条 UTC 文本")
            self.assertEqual(out[0]["latest_ts_utc"], "2026-01-01 00:20", msg="末条 UTC 文本")
            self.assertEqual(out[0]["count"], 3, msg="缓存条数")

    def test_no_cache_empty(self):
        with mock.patch.object(env, "_load_farm", return_value=self._farm()), \
             mock.patch.object(env, "_load_ndbc_cache", return_value=None):
            self.assertEqual(env.ndbc_ranges()["ranges"], [], msg="无缓存 → 空列表")


class TestRoutes(unittest.TestCase):
    def test_routes_list(self):
        r = env.routes()
        self.assertEqual(len(r), 5, msg="5 条路由清单")
        paths = [x[1] for x in r]
        self.assertIn("/api/env/historical", paths, msg="历史区间路由")
        self.assertIn("/api/env/ndbc-ranges", paths, msg="数据时间范围路由")
        self.assertIn("/api/env/storm", paths, msg="风暴细化路由")
        self.assertEqual(paths.count("/api/env/sim-control"), 2, msg="暂停控制 GET+POST")


if __name__ == "__main__":
    unittest.main(verbosity=2)

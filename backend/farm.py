# -*- coding: utf-8 -*-
"""
养殖生产配置（管理板块的数据源）。

【为什么要有这个模块】
  平台原来把「养什么鱼」写死在代码里，导致参数散落各处、改一处漏一处。
  实测踩过两次：后端硬编码体长体重参数 0.0218/3.02；水温阈值写死 20.5℃。
  现在改成 **data/farm.json 说某个网箱养什么鱼，全平台的阈值与参数跟着变**。

【设计约束】
  · R1：现场没人会改代码 → 只用标准库（json），零依赖
  · 数据要**可读、可 diff、可手改** —— 团队能在 GitHub 上看到变更历史
  · 这是**配置**不是运行时状态：UI 改了会写回文件，属于正常变更，可以 commit
"""
import json
import os
import time
from datetime import datetime, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FARM_PATH = os.path.join(ROOT, "data", "farm.json")

# 台账类型 → 中文（界面上不许出现裸英文枚举，见验收第 6 条）
LEDGER_CN = {
    "stock": "放养", "split_in": "分箱入", "split_out": "分箱出",
    "mortality": "死淘", "harvest": "起捕", "transfer_in": "转入", "transfer_out": "转出",
}
# 哪些类型是"加鱼"，哪些是"减鱼"
LEDGER_SIGN = {"stock": 1, "split_in": 1, "transfer_in": 1,
               "split_out": -1, "mortality": -1, "harvest": -1, "transfer_out": -1}


class Farm(object):
    def __init__(self, path=FARM_PATH):
        self.path = path
        self.data = {"sites": [], "ledger": []}
        self.load()

    # ------------------------------------------------------------------
    def load(self):
        try:
            with open(self.path, encoding="utf-8") as f:
                self.data = json.load(f)
        except Exception as e:                              # noqa: BLE001
            print("  [警告] 养殖生产配置没读进来（%s）—— 管理板块将显示为空" % e)
            self.data = {"sites": [], "ledger": []}

    def save(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.path)

    # ------------------------------------------------------------------
    def farm_sites(self):
        return [s for s in self.data.get("sites", []) if s.get("kind") == "farm"]

    def all_cages(self):
        out = []
        for s in self.farm_sites():
            for c in s.get("cages", []):
                d = dict(c)
                d["site_id"] = s["site_id"]
                d["site_name"] = s["site_name"]
                # 存箱量由台账算出来 —— 页面上要显示，所以在这里带上
                # （踩过：/api/farm 的网箱行少了这个字段，页面上"存箱量"列只有单位没有数字）
                d["current_count"] = self.stock_of(c["cage_id"])
                out.append(d)
        return out

    def cage(self, cage_id):
        for c in self.all_cages():
            if c["cage_id"] == cage_id:
                return c
        return None

    # ------------------------------------------------------------------
    def ledger_of(self, cage_id=None):
        rows = self.data.get("ledger", [])
        if cage_id:
            rows = [r for r in rows if r.get("cage_id") == cage_id]
        out = []
        for r in sorted(rows, key=lambda x: x.get("ts", "")):
            d = dict(r)
            d["type_cn"] = LEDGER_CN.get(r.get("type"), r.get("type"))
            out.append(d)
        return out

    def stock_of(self, cage_id):
        """由台账算期末存箱量。**不用仿真漂移** —— 生物量要算得准。"""
        n = 0
        for r in self.ledger_of(cage_id):
            v = r.get("count") or 0
            # 容错：如果记录里写的是正数但类型是减项，按类型定符号
            t = r.get("type")
            if t in LEDGER_SIGN and LEDGER_SIGN[t] < 0:
                n -= abs(v)
            else:
                n += abs(v)
        return n

    def stock_summary(self, cage_id):
        c = self.cage(cage_id) or {}
        st = c.get("stocking", {}) or {}
        now_n = self.stock_of(cage_id)
        init = st.get("init_count") or 0
        return {
            "cage_id": cage_id,
            "species": c.get("species"),
            "init_count": init,
            "init_size_g": st.get("init_size_g"),
            "stocking_date": st.get("date"),
            "current_count": now_n,
            "survival_pct": round(now_n * 100.0 / init, 1) if init else None,
            "plan_harvest": st.get("plan_harvest"),
            "target_size_g": st.get("target_size_g"),
        }

    # ------------------------------------------------------------------
    def add_ledger(self, cage_id, ltype, count, note="", ts=None):
        if not self.cage(cage_id):
            raise ValueError("网箱不存在：%s" % cage_id)
        if ltype not in LEDGER_CN:
            raise ValueError("台账类型不合法：%s（可选：%s）"
                             % (ltype, "、".join(sorted(LEDGER_CN))))
        ts = ts or datetime.now().strftime("%Y-%m-%d")
        self.data.setdefault("ledger", []).append({
            "ts": ts, "cage_id": cage_id, "type": ltype,
            "count": int(count), "note": note,
        })
        self.save()
        return self.stock_summary(cage_id)

    def set_species(self, cage_id, species):
        """改某个网箱养的鱼 —— 这一改，全平台阈值与参数跟着变。"""
        for s in self.farm_sites():
            for c in s.get("cages", []):
                if c["cage_id"] == cage_id:
                    old = c.get("species")
                    c["species"] = species
                    self.save()
                    return {"cage_id": cage_id, "old_species": old, "new_species": species}
        raise ValueError("网箱不存在：%s" % cage_id)

    # ------------------------------------------------------------------
    def devices(self):
        out = []
        for s in self.farm_sites():
            for d in s.get("devices", []):
                x = dict(d)
                x["site_id"] = s["site_id"]
                x["site_name"] = s["site_name"]
                x["cal_status"] = self.cal_status(d)
                out.append(x)
        return out

    def cal_status(self, dev):
        """标定状态。

        三种要区分清楚，不能一律显示「未标定」：
          · 不适用 —— 灯具/开关这类非计量器件，本来就不需要标定
          · 未标定 —— 该标的没标
          · 已超期 / 即将到期 / 有效
        """
        cal = dev.get("calibration") or {}
        cycle = cal.get("cycle_days")
        last = cal.get("last")
        # 非计量器件：显式标了 cycle_days 为 null 或类型是 light 之类
        if cycle is None:
            return {"state": "na", "label": "不适用", "days_left": None,
                    "detail": "非计量器件，不做周期性标定"}
        if not last:
            return {"state": "never", "label": "未标定", "days_left": None,
                    "detail": "从未标定 —— 该通道的数据不能作为计量依据"}
        try:
            d0 = datetime.strptime(last, "%Y-%m-%d")
        except ValueError:
            return {"state": "unknown", "label": "日期异常", "days_left": None, "detail": last}
        due = d0 + timedelta(days=int(cycle))
        left = (due - datetime.now()).days
        if left < 0:
            return {"state": "overdue", "label": "已超期", "days_left": left,
                    "due": due.strftime("%Y-%m-%d"),
                    "detail": "已超期 %d 天，应尽快安排标定" % (-left)}
        if left <= 30:
            return {"state": "soon", "label": "即将到期", "days_left": left,
                    "due": due.strftime("%Y-%m-%d"),
                    "detail": "%d 天后到期" % left}
        return {"state": "ok", "label": "有效", "days_left": left,
                "due": due.strftime("%Y-%m-%d"),
                "detail": "有效期内，%d 天后到期" % left}

    def calibrate(self, device_id, date=None, institution=None, cert_no=None):
        date = date or datetime.now().strftime("%Y-%m-%d")
        for s in self.farm_sites():
            for d in s.get("devices", []):
                if d["device_id"] == device_id:
                    cal = d.setdefault("calibration", {})
                    cal["last"] = date
                    if institution:
                        cal["institution"] = institution
                    if cert_no:
                        cal["cert_no"] = cert_no
                    self.save()
                    return {"device_id": device_id, "last": date,
                            "cal_status": self.cal_status(d)}
        raise ValueError("设备不存在：%s" % device_id)

    # ------------------------------------------------------------------
    def summary(self):
        """管理板块总览用。"""
        cals = [d["cal_status"] for d in self.devices()]
        cages = self.all_cages()
        return {
            "site_count": len(self.farm_sites()),
            "cage_count": len(cages),
            "species_in_use": sorted({c.get("species") for c in cages if c.get("species")}),
            "device_count": len(cals),
            "cal_overdue": sum(1 for c in cals if c["state"] == "overdue"),
            "cal_soon": sum(1 for c in cals if c["state"] == "soon"),
            "cal_never": sum(1 for c in cals if c["state"] == "never"),
            "cal_ok": sum(1 for c in cals if c["state"] == "ok"),
            "cal_na": sum(1 for c in cals if c["state"] == "na"),
        }


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    f = Farm()
    print("养殖生产配置自检")
    print("  文件:", FARM_PATH)
    print("  ", f.summary())
    print()
    for c in f.all_cages():
        s = f.stock_summary(c["cage_id"])
        print("  %s %s  养：%s   存箱 %d 尾（放养 %d，存活率 %s%%）"
              % (c["cage_id"], c.get("cage_name"), c.get("species"),
                 s["current_count"], s["init_count"], s["survival_pct"]))
    print()
    for d in f.devices():
        print("  %-18s %-16s %s" % (d["device_id"], d["device_name"] if "device_name" in d else d["metric"],
                                    d["cal_status"]["label"]))

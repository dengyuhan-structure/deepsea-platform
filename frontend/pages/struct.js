/* ============================================================
   pages/struct.js —— 结构安全板块
   ============================================================
   负责人：邓宇涵

   【这个文件归谁】
     归上面写的那个人（以及他的 AI）。**别人不要改这个文件。**

   【怎么加页面】
     照抄本文件里已有页面的结构，往 PAGES 上注册一个新路由就行：
         PAGES['/struct/xxx'] = { data: ..., computed: ..., methods: ..., template: [...] };

   【三条硬规矩】
     1. 用 components.js 里已有的公共件（stat-card / trend-chart / event-list …），
        不要自己重写一套 —— 全平台要长一个样。
     2. 数据一律走 API.xxx()，不要直接读别的板块的数据，也不要写死数字。
        拿不到就显示「—」，**不许编**。
     3. 界面上不许出现裸英文（比如 quality='good'），必须经 components.js 的 CN 表转成中文。

   【改完必须做】
     双击 验收检查.bat，8 项全过才能发 PR。全过不了就别发 —— 会把别人的页面一起弄坏。

   建立：2026-10-06（从 pages.js 拆出）
   ============================================================ */
(function (global) {
  'use strict';
  /* 自己初始化，不依赖文件加载顺序 —— 这样谁先谁后都不会出错 */
  const PAGES = global.PAGES || (global.PAGES = {});

  PAGES['/struct/alarm'] = {
    data: function () { return { minutes: 60, series: [], picked: null }; },
    computed: {
      last: function () { return this.series.length ? this.series[this.series.length - 1] : {}; },
      charts: function () {
        return [
          { name: '锚泊张力占设计值', unit: '%', data: this.series.map(function (r) { return [r.ts, r.tension_pct]; }) },
          /* axis: 1 → 走右轴。俯仰角是 0–3° 量级，跟 0–100% 的张力共用左轴会被压成一条贴底的直线。 */
          { name: '俯仰角', unit: '°', axis: 1, data: this.series.map(function (r) { return [r.ts, r.tilt_pitch]; }) }
        ];
      },
      /* 规则判定：**边沿触发**，不是电平触发。
         ⚠️ 原来写的是「每个采样点只要越限就报一条」——5 秒一个点，一小时报了 1130 条，
            界面上看着像系统坏了；真实告警系统也绝不会这么干。
            现在只在「状态发生变化」时出一条：黄→红 出一条，恢复正常后再越限才再出。 */
      hits: function () {
        const out = [];
        const prev = {};
        this.series.forEach(function (r) {
          const fams = [
            { fam: 'tension', type: 'tension', field: 'tension_pct', value: r.tension_pct,
              lv: r.tension_pct >= 95 ? 'red' : (r.tension_pct >= 80 ? 'yellow' : null),
              th: r.tension_pct >= 95 ? 95 : 80,
              rule: r.tension_pct >= 95
                ? ['R-TENSION-02', '锚泊张力红色预警', '张力超过设计值 95%']
                : ['R-TENSION-01', '锚泊张力黄色预警', '张力超过设计值 80%'] },
            { fam: 'tilt', type: 'tilt', field: 'tilt_pitch', value: r.tilt_pitch,
              /* 🔴 2026-10-06 由 2°/3° 改为 5°/15°：
                 2°/3° 查不到任何标准或文献出处，而且量级偏小 —— 波浪作用下网箱常态横摇
                 就可能超过 2°，会持续误报，现场一定会把告警关掉（"狼来了"）。
                 15° 有规范出处：CCS《海上渔业养殖设施检验指南》(初稿2023) 3.2.1.7
                 完整稳性衡准 ——「复原力臂从正浮至 15 度内，应均为正值」。 */
              lv: Math.abs(r.tilt_pitch) >= 15 ? 'red' : (Math.abs(r.tilt_pitch) >= 5 ? 'orange' : null),
              th: Math.abs(r.tilt_pitch) >= 15 ? 15 : 5,
              rule: Math.abs(r.tilt_pitch) >= 15
                ? ['R-TILT-02', '网箱倾斜红色预警', '俯仰角超过 15°（CCS 完整稳性衡准角）']
                : ['R-TILT-01', '网箱倾斜橙色预警', '俯仰角超过 5°'] },
            { fam: 'battery', type: 'low_battery', field: 'battery_soc', value: r.battery_soc,
              lv: r.battery_soc < 10 ? 'red' : (r.battery_soc < 20 ? 'yellow' : null),
              th: r.battery_soc < 10 ? 10 : 20,
              rule: r.battery_soc < 10
                ? ['R-BAT-02', '储能严重低电量预警', '储能电量低于 10%']
                : ['R-BAT-01', '储能低电量黄色预警', '储能电量低于 20%'] }
          ];
          fams.forEach(function (d) {
            if (d.lv && prev[d.fam] !== d.lv) {
              out.push({ ts: r.ts, level: d.lv, type: d.type, field: d.field,
                         value: d.value, threshold: d.th,
                         rule_id: d.rule[0], rule_name: d.rule[1], why: d.rule[2], row: r });
            }
            prev[d.fam] = d.lv;
          });
        });
        const rank = { red: 3, orange: 2, yellow: 1, blue: 0 };
        return out.sort(function (a, b) { return rank[b.level] - rank[a.level]; });
      },
      worst: function () {
        if (!this.hits.length) return { level: 'blue', text: '无预警' };
        const rank = { red: 4, orange: 3, yellow: 2, blue: 1 };
        const top = this.hits.slice().sort(function (a, b) { return rank[b.level] - rank[a.level]; })[0];
        return { level: top.level, text: { red: '红色', orange: '橙色', yellow: '黄色', blue: '蓝色' }[top.level] + '预警' };
      },
      events: function () {
        const self = this;
        return this.hits.slice(0, 18).map(function (h) {
          return { id: h.rule_id + h.ts, ts: h.ts, level: h.level,
                   text: h.rule_name + '（' + h.field + ' = ' + h.value + '，阈值 ' + h.threshold + '）', hit: h };
        });
      }
    },
    methods: {
      load: function () {
        const self = this;
        API.resolve(API.struct(this.minutes), function (d) { self.series = d; });
      },
      time: function (ts) { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); },
      lvCn: function (l) { return { blue: '蓝色', yellow: '黄色', orange: '橙色', red: '红色' }[l] || l; },
      lvCls: function (l) { return 'bg-' + (l || 'blue'); },
      pick: function (e) { this.picked = e.hit || e; }
    },
    mounted: function () {
      /* API.bind：数据变化重算 + 定时刷新曲线 */
      this.unsub = API.bind(this, this.load);
      this.load();
    },
    beforeUnmount: function () { if (this.unsub) { this.unsub(); this.unsub = null; } },
    watch: { minutes: function () { this.load(); } },
    template: [
      '<div>',
      '  <page-head title="结构安全 · 灾害分级预警"',
      '    desc="每条预警都能点开看到「哪条数据触发的、命中了哪条规则」—— 答辩必答题"',
      '    :sources="[\'simulated\']" />',
      '',
      '  <div class="grid-stats">',
      '    <stat-card name="当前最高预警等级" unit="" :value="worst.text" source="simulated" />',
      '    <stat-card name="本时段告警条数" unit="条" :value="hits.length" :digits="0" source="simulated" />',
      '    <stat-card name="锚泊张力占设计值" field="tension_pct" unit="%" :value="last.tension_pct" source="simulated" />',
      '    <stat-card name="储能电量" field="battery_soc" unit="%" :value="last.battery_soc" source="simulated" />',
      '    <stat-card name="网箱横滚角" field="tilt_roll" unit="°" :value="last.tilt_roll" source="simulated" />',
      '    <stat-card name="网箱俯仰角" field="tilt_pitch" unit="°" :value="last.tilt_pitch" source="simulated" />',
      '  </div>',
      '',
      '  <div class="split" style="margin-top:12px">',
      '    <trend-chart title="张力与姿态趋势" :series="charts"',
      '      :thresholds="[{value:80,label:\'张力黄线 80%\',color:\'#92400E\'},{value:95,label:\'张力红线 95%\',color:\'#991B1B\'}]" />',
      '    <div class="card">',
      '      <div class="card-title">分级预警列表（近 {{ events.length }} 条）</div>',
      '      <div style="max-height:430px;overflow:auto">',
      '        <event-list :items="events" empty-text="本时段无预警" @pick="pick" />',
      '      </div>',
      '      <div v-if="picked" class="hint" style="margin-top:10px">',
      '        <b>{{ picked.rule_name }}</b>',
      '        <span class="tag tag-simulated" style="margin-left:8px">{{ picked.rule_id }}</span>',
      '        <div class="small" style="margin-top:6px">',
      '          {{ picked.field }} = <b>{{ picked.value }}</b>（阈值 {{ picked.threshold }}）<br>',
      '          时间 {{ time(picked.ts) }}<br>',
      '          快照：<span class="mono">{{ JSON.stringify({anchor_tension: picked.row.anchor_tension, tilt_pitch: picked.row.tilt_pitch, battery_soc: picked.row.battery_soc}) }}</span>',
      '        </div>',
      '        <div style="margin-top:8px"><a href="#/trace"><button>查看触发依据（追溯） →</button></a></div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="hint" style="margin-top:12px;background:#FFFBEB;border-color:#FDE68A">',
      '    ⚠️ <b>阈值来源</b>：张力 80% / 95%、倾角 2° / 3°、电量 20% / 10% 一律标注为',
      '    <b>「经验阈值，未经现场标定」</b>，出处写「参考文献区间 + 经验设定」。',
      '    文档、页面、答辩口径三处必须一致 —— <b>查不到出处就不编</b>（裁定 2）。',
      '    <div style="margin-top:6px">',
      '      <b>告警是边沿触发的</b>：只在状态发生变化时出一条（黄→红 出一条，恢复正常后再越限才再出），',
      '      不是每个采样点都报 —— 否则一小时能刷出上千条，看着像系统坏了。',
      '    </div>',
      '  </div>',
      '',
      '  <div class="opbar" style="margin:12px -16px -16px; border-radius:0">',
      '    <time-range v-model="minutes" />',
      '    <span style="flex:1"></span>',
      '    <a href="#/trace"><button>去追溯查询</button></a>',
      '    <a href="#/alarm"><button>去告警中心</button></a>',
      '  </div>',
      '</div>'
    ].join('\n')
  };

  PAGES['/struct/energy'] = {
    data: function () { return { minutes: 60, series: [] }; },
    computed: {
      last: function () { return this.series.length ? this.series[this.series.length - 1] : {}; },
      charts: function () {
        return [
          { name: '光伏发电功率', unit: 'kW', data: this.series.map(function (r) { return [r.ts, r.pv_power]; }) },
          { name: '总功耗', unit: 'kW', data: this.series.map(function (r) { return [r.ts, r.total_power]; }) },
          { name: '储能 SOC', unit: '%', data: this.series.map(function (r) { return [r.ts, r.battery_soc]; }) }
        ];
      },
      socLevel: function () {
        const s = this.last.battery_soc;
        if (s === undefined) return 'blue';
        return s < 10 ? 'red' : s < 20 ? 'yellow' : 'blue';
      }
    },
    methods: {
      load: function () {
        const self = this;
        API.resolve(API.struct(this.minutes), function (d) { self.series = d; });
      },
      lvCn: function (l) { return { blue: '正常', yellow: '低电量', red: '严重低电量' }[l] || l; }
    },
    mounted: function () {
      /* API.bind：数据变化重算 + 定时刷新曲线 */
      this.unsub = API.bind(this, this.load);
      this.load();
    },
    beforeUnmount: function () { if (this.unsub) { this.unsub(); this.unsub = null; } },
    watch: { minutes: function () { this.load(); } },
    template: [
      '<div>',
      '  <page-head title="结构安全 · 能源保障"',
      '    desc="光伏 / 储能 / 功耗。<b>kWh 是能量、kW 是功率</b> —— 两者差一个时间维度（裁定 N3）"',
      '    :sources="[\'simulated\']" />',
      '',
      '  <div class="grid-stats">',
      '    <stat-card name="光伏发电功率" field="pv_power" unit="kW" :value="last.pv_power" source="simulated" />',
      '    <stat-card name="今日发电量" field="pv_energy_today" unit="kWh" :value="last.pv_energy_today" source="simulated" />',
      '    <stat-card name="储能电量百分比" field="battery_soc" unit="%" :value="last.battery_soc" source="simulated" />',
      '    <stat-card name="储能电量（能量）" field="battery_energy" unit="kWh" :value="last.battery_energy" source="simulated" />',
      '    <stat-card name="电池总容量" field="battery_capacity_kwh" unit="kWh" :value="last.battery_capacity_kwh" source="demo" />',
      '    <stat-card name="总功耗" field="total_power" unit="kW" :value="last.total_power" source="simulated" />',
      '    <stat-card name="能源自给率" field="energy_self_sufficiency" unit="%" :value="last.energy_self_sufficiency" :digits="0" source="simulated" />',
      '    <stat-card name="低电量状态" field="low_battery_status" unit="" :value="lvCn(socLevel)" source="simulated" />',
      '  </div>',
      '',
      '  <div style="margin-top:12px">',
      '    <trend-chart title="发电 / 功耗 / 储能趋势" :series="charts"',
      '      :thresholds="[{value:20,label:\'低电量黄线 20%\',color:\'#92400E\'},{value:10,label:\'严重低电量红线 10%\',color:\'#991B1B\'}]" />',
      '  </div>',
      '',
      '  <div class="hint" style="margin-top:12px">',
      '    换算关系：<code>battery_energy = battery_soc / 100 × battery_capacity_kwh</code>。',
      '    有容量的好处是能源保障页能显示「<b>还剩 x kWh</b>」，而不是只有「剩 y%」—— 后者说不出还剩多少电。',
      '  </div>',
      '',
      '  <div class="opbar" style="margin:12px -16px -16px; border-radius:0">',
      '    <time-range v-model="minutes" />',
      '    <span style="flex:1"></span>',
      '    <span class="small muted">低电量两条线：20% 黄、10% 红</span>',
      '  </div>',
      '</div>'
    ].join('\n')
  };

})(window);

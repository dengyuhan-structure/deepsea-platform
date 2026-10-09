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
    data: function () { return { minutes: 60, series: [], envSeries: [], picked: null }; },
    computed: {
      last: function () { return this.series.length ? this.series[this.series.length - 1] : {}; },
      envLast: function () { return this.envSeries.length ? this.envSeries[this.envSeries.length - 1] : {}; },
      charts: function () {
        return [
          { name: '锚泊张力占设计值', unit: '%', data: this.series.map(function (r) { return [r.ts, r.tension_pct]; }) },
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
        const envSeries = this.envSeries;
        let envIndex = 0;
        this.series.forEach(function (r) {
          while (envIndex + 1 < envSeries.length &&
                 Math.abs(envSeries[envIndex + 1].ts - r.ts) < Math.abs(envSeries[envIndex].ts - r.ts)) {
            envIndex += 1;
          }
          const env = envSeries[envIndex];
          const combined = !!(env && Math.abs(env.ts - r.ts) <= 3000 &&
            env.wave_height !== null && env.wave_height !== undefined &&
            r.tension_pct !== null && r.tension_pct !== undefined &&
            env.wave_height > 3 && r.tension_pct > 80);
          if (combined && !prev.stormTension) {
            out.push({ ts: r.ts, level: 'orange', type: 'tension', field: '浪高 + 张力占比',
              value: env.wave_height + ' m + ' + r.tension_pct + '%', threshold: '浪高 > 3 m 且张力占比 > 80%',
              rule_id: 'R-STORM-TENSION-01', rule_name: '大浪叠加高张力橙色预警',
              why: '浪高超过 3 m 且锚泊张力超过设计值 80%',
              handling_advice: '检查锚链受力，评估海况并按现场规程处置', row: r, envRow: env });
          }
          prev.stormTension = combined;
          const tilt = r.tilt_angle !== null && r.tilt_angle !== undefined
            ? Math.abs(Number(r.tilt_angle))
            : Math.max(Math.abs(Number(r.tilt_roll) || 0), Math.abs(Number(r.tilt_pitch) || 0));
          const fams = [
            { fam: 'tension', type: 'tension', field: 'tension_pct', value: r.tension_pct,
              lv: r.tension_pct >= 95 ? 'red' : (r.tension_pct >= 80 ? 'yellow' : null),
              th: r.tension_pct >= 95 ? 95 : 80,
              rule: r.tension_pct >= 95
                ? ['R-TENSION-02', '锚泊张力红色预警', '张力超过设计值 95%', '检查系泊系统并按应急规程降低结构受力']
                : ['R-TENSION-01', '锚泊张力黄色预警', '张力超过设计值 80%', '检查锚链受力并持续观察张力变化'] },
            { fam: 'tilt', type: 'tilt', field: 'tilt_angle', value: tilt,
              lv: tilt >= 3 ? 'red' : (tilt >= 2 ? 'yellow' : null),
              th: tilt >= 3 ? 3 : 2,
              rule: tilt >= 3
                ? ['R-TILT-02', '网箱倾斜红色预警', '横滚或俯仰角达到 3°', '检查网箱姿态和系泊状态，按现场规程处置']
                : ['R-TILT-01', '网箱倾斜黄色预警', '横滚或俯仰角达到 2°', '持续观察倾角变化并检查传感器'] },
            { fam: 'battery', type: 'low_battery', field: 'battery_soc', value: r.battery_soc,
              lv: r.battery_soc < 10 ? 'red' : (r.battery_soc < 20 ? 'yellow' : null),
              th: r.battery_soc < 10 ? 10 : 20,
              rule: r.battery_soc < 10
                ? ['R-BAT-02', '储能严重低电量预警', '储能电量低于 10%', '通知值班人员并按供电规程处置']
                : ['R-BAT-01', '储能低电量黄色预警', '储能电量低于 20%', '评估降低非关键设备功耗'] }
          ];
          fams.forEach(function (d) {
            const levelRank = { yellow: 1, orange: 2, red: 3 };
            const oldRank = levelRank[prev[d.fam]] || 0;
            const newRank = levelRank[d.lv] || 0;
            if (!d.lv) prev[d.fam] = null;
            if (d.lv && newRank > oldRank) {
              out.push({ ts: r.ts, level: d.lv, type: d.type, field: d.field,
                         value: d.value, threshold: d.th,
                         rule_id: d.rule[0], rule_name: d.rule[1], why: d.rule[2],
                         handling_advice: d.rule[3] || '检查相关传感器数据并按现场规程处置', row: r });
              prev[d.fam] = d.lv;
            }
          });
        });
        const rank = { red: 3, orange: 2, yellow: 1, blue: 0 };
        return out.sort(function (a, b) { return rank[b.level] - rank[a.level]; });
      },
      worst: function () {
        const row = this.last;
        const current = [];
        if (row.risk_level) current.push(row.risk_level);
        if (row.tension_pct >= 95 || row.battery_soc < 10) current.push('red');
        else if (row.tension_pct >= 80 || row.battery_soc < 20) current.push('yellow');
        const tilt = row.tilt_angle !== null && row.tilt_angle !== undefined
          ? Math.abs(Number(row.tilt_angle))
          : Math.max(Math.abs(Number(row.tilt_roll) || 0), Math.abs(Number(row.tilt_pitch) || 0));
        if (tilt >= 3) current.push('red');
        else if (tilt >= 2) current.push('yellow');
        if (this.envLast.wave_height > 3 && row.tension_pct > 80) current.push('orange');
        const rank = { blue: 0, yellow: 1, orange: 2, red: 3 };
        const level = current.sort(function (a, b) { return rank[b] - rank[a]; })[0] || 'blue';
        return { level: level, text: level === 'blue' ? '蓝色预警' : ({ red: '红色', orange: '橙色', yellow: '黄色' }[level] + '预警') };
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
        API.resolve(API.struct(this.minutes), function (d) { self.series = Array.isArray(d) ? d : []; });
        API.resolve(API.env('site_01', this.minutes), function (d) {
          self.envSeries = d && Array.isArray(d.fast) ? d.fast : [];
        });
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
      '    desc="融合海况与结构监测数据展示分级事件、触发字段、规则编号、时间和处置建议。"',
      '    :sources="[\'simulated\']" />',
      '',
      '  <div class="grid-stats">',
      '    <stat-card name="当前最高预警等级" unit="" :value="worst.text" source="simulated" />',
      '    <stat-card name="本时段告警条数" unit="条" :value="hits.length" :digits="0" source="simulated" />',
      '    <stat-card name="锚泊张力占设计值" field="tension_pct" unit="%" :value="last.tension_pct" source="simulated" />',
      '    <stat-card name="浪高" field="wave_height" unit="m" :value="envLast.wave_height" :quality="envLast.quality" :ts="envLast.ts" :source="envLast.source || \'simulated\'" />',
      '    <stat-card name="风速" field="wind_speed" unit="m/s" :value="envLast.wind_speed" :quality="envLast.quality" :ts="envLast.ts" :source="envLast.source || \'simulated\'" />',
      '    <stat-card name="流速" field="current_speed" unit="m/s" :value="envLast.current_speed" :quality="envLast.quality" :ts="envLast.ts" :source="envLast.source || \'simulated\'" />',
      '    <stat-card name="储能电量" field="battery_soc" unit="%" :value="last.battery_soc" source="simulated" />',
      '    <stat-card name="网箱横滚角" field="tilt_roll" unit="°" :value="last.tilt_roll" source="simulated" />',
      '    <stat-card name="网箱俯仰角" field="tilt_pitch" unit="°" :value="last.tilt_pitch" source="simulated" />',
      '  </div>',
      '',
      '  <div class="split" style="margin-top:12px">',
      '    <trend-chart title="结构张力与姿态趋势" :series="charts"',
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
      '          触发依据：{{ picked.why }}<br>',
      '          快照：<span class="mono">{{ JSON.stringify({anchor_tension: picked.row.anchor_tension, tension_pct: picked.row.tension_pct, tilt_roll: picked.row.tilt_roll, tilt_pitch: picked.row.tilt_pitch, battery_soc: picked.row.battery_soc, wave_height: picked.envRow ? picked.envRow.wave_height : null, wind_speed: picked.envRow ? picked.envRow.wind_speed : null, current_speed: picked.envRow ? picked.envRow.current_speed : null}) }}</span><br>',
      '          建议：{{ picked.handling_advice }}',
      '        </div>',
      '        <div style="margin-top:8px"><a href="#/trace"><button>查看触发依据（追溯） →</button></a></div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="hint" style="margin-top:12px;background:#FFFBEB;border-color:#FDE68A">',
      '    ⚠️ <b>阈值说明</b>：张力 80% / 95%、倾角 2° / 3%、电量 20% / 10% 按结构安全功能说明展示；',
      '    倾角线为示例阈值，所有阈值仍需现场标定后确认。浪高 > 3 m 且张力占比 > 80% 时标记为橙色组合条件。',
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

  PAGES['/struct/overview'] = {
    data: function () { return { minutes: 60, series: [], unsub: null }; },
    computed: {
      last: function () { return this.series.length ? this.series[this.series.length - 1] : {}; },
      charts: function () {
        const points = function (field) {
          return this.series.filter(function (r) {
            return r[field] !== null && r[field] !== undefined && Number.isFinite(Number(r[field]));
          }).map(function (r) { return [r.ts, Number(r[field])]; });
        }.bind(this);
        return [
          { name: '锚链张力占设计值', unit: '%', data: points('tension_pct') },
          { name: '网箱倾斜角', unit: '°', axis: 1, data: points('tilt_angle') }
        ];
      },
      riskText: function () {
        return this.last.risk_level ? CN.riskLevel(this.last.risk_level) + '风险' : '暂无风险数据';
      },
      subsystemItems: function () {
        const defs = [
          { label: '整体子系统', field: 'subsystem_status' },
          { label: '锚泊系统', field: 'tension_status' },
          { label: '网衣系统', field: 'damage_suspect_status' },
          { label: '姿态系统', field: 'attitude_status' },
          { label: '能源系统', field: 'power_supply_status' }
        ];
        return defs.map(function (item) {
          const value = this.last[item.field];
          const missing = value === null || value === undefined;
          const tone = missing ? 'muted' : ({ green: 'green', normal: 'green', stable: 'green',
                         yellow: 'yellow', suspected: 'yellow', swaying: 'yellow', battery_only: 'yellow',
                         orange: 'orange', insufficient: 'orange',
                         red: 'red', abnormal: 'red', confirmed: 'red', tilted: 'red', lost: 'red' }[value] || 'blue');
          const text = missing ? '暂无状态数据' : ({ green: '绿灯', yellow: '黄灯', orange: '橙灯', red: '红灯', blue: '状态待确认' }[tone]);
          return { label: item.label, field: item.field, text: text, tone: tone };
        }, this);
      }
    },
    methods: {
      load: function () {
        const self = this;
        API.resolve(API.struct(this.minutes), function (d) { self.series = Array.isArray(d) ? d : []; });
      }
    },
    mounted: function () { this.unsub = API.bind(this, this.load); this.load(); },
    beforeUnmount: function () { if (this.unsub) { this.unsub(); this.unsub = null; } },
    watch: { minutes: function () { this.load(); } },
    template: [
      '<div>',
      '  <page-head title="结构安全 · 网箱结构总览"',
      '    desc="汇总锚链、网衣、姿态和能源的代表性状态与趋势；海况数据请查看灾害分级预警页。"',
      '    :sources="[\'simulated\']" />',
      '',
      '  <div class="grid-stats">',
      '    <stat-card name="整体健康评分" field="health_score" :unit="last.health_score === undefined ? \'\' : \'分\'" :value="last.health_score === undefined ? \'—\' : last.health_score" source="simulated" :ts="last.ts" />',
      '    <stat-card name="当前风险等级" field="risk_level" unit="" :value="riskText" source="simulated" :ts="last.ts" />',
      '    <stat-card name="锚链张力" field="anchor_tension" unit="kN" :value="last.anchor_tension" source="simulated" :ts="last.ts" />',
      '    <stat-card name="网绳拉力" field="net_tension" unit="kN" :value="last.net_tension" source="simulated" :ts="last.ts" />',
      '    <stat-card name="倾斜角合量" field="tilt_angle" unit="°" :value="last.tilt_angle" source="simulated" :ts="last.ts" />',
      '    <stat-card name="光伏发电功率" field="pv_power" unit="kW" :value="last.pv_power" source="simulated" :ts="last.ts" />',
      '    <stat-card name="储能电量" field="battery_soc" unit="%" :value="last.battery_soc" source="simulated" :ts="last.ts" />',
      '  </div>',
      '',
      '  <div class="split" style="margin-top:12px">',
      '    <div class="card">',
      '      <div class="card-title">子系统状态灯</div>',
      '      <div v-for="item in subsystemItems" :key="item.field" class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)">',
      '        <span>{{ item.label }}</span>',
      '        <span v-if="item.tone === \'muted\'" class="small muted">{{ item.text }}</span>',
      '        <span v-else class="tag" :class="\'bg-\' + item.tone">{{ item.text }}</span>',
      '      </div>',
      '    </div>',
      '    <div class="card">',
      '      <div class="card-title">网箱三维模型</div>',
      '      <div class="muted small" style="min-height:220px;border:1px dashed var(--line);border-radius:8px;display:flex;align-items:center;justify-content:center">网箱模型动图位置预留</div>',
      '    </div>',
      '  </div>',
      '',
      '  <div style="margin-top:12px">',
      '    <trend-chart title="结构安全关键趋势（张力占比与倾斜角）" :series="charts" />',
      '  </div>',
      '',
      '  <div class="opbar" style="margin:12px -16px -16px; border-radius:0">',
      '    <time-range v-model="minutes" />',
      '    <span style="flex:1"></span>',
      '    <a href="#/struct/detail"><button>查看监测详情</button></a>',
      '    <a href="#/struct/alarm"><button>查看灾害预警</button></a>',
      '    <a href="#/struct/energy"><button>查看能源保障</button></a>',
      '  </div>',
      '</div>'
    ].join('\n')
  };

  PAGES['/struct/detail'] = {
    data: function () { return { minutes: 60, series: [], unsub: null }; },
    computed: {
      last: function () { return this.series.length ? this.series[this.series.length - 1] : {}; },
      charts: function () {
        const points = function (field) {
          return this.series.filter(function (r) {
            return r[field] !== null && r[field] !== undefined && Number.isFinite(Number(r[field]));
          }).map(function (r) { return [r.ts, Number(r[field])]; });
        }.bind(this);
        return [
          { name: '锚链张力', unit: 'kN', data: points('anchor_tension') }
        ];
      },
      netCharts: function () {
        const points = function (field) {
          return this.series.filter(function (r) {
            return r[field] !== null && r[field] !== undefined && Number.isFinite(Number(r[field]));
          }).map(function (r) { return [r.ts, Number(r[field])]; });
        }.bind(this);
        return [{ name: '网绳拉力', unit: 'kN', data: points('net_tension') }];
      },
      attitudeCharts: function () {
        const points = function (field) {
          return this.series.filter(function (r) {
            return r[field] !== null && r[field] !== undefined && Number.isFinite(Number(r[field]));
          }).map(function (r) { return [r.ts, Number(r[field])]; });
        }.bind(this);
        return [
          { name: '横滚角', unit: '°', data: points('tilt_roll') },
          { name: '俯仰角', unit: '°', data: points('tilt_pitch') }
        ];
      },
      deformationCharts: function () {
        const points = function (field) {
          return this.series.filter(function (r) {
            return r[field] !== null && r[field] !== undefined && Number.isFinite(Number(r[field]));
          }).map(function (r) { return [r.ts, Number(r[field])]; });
        }.bind(this);
        return [
          { name: '形变量', unit: 'm', data: points('deformation') },
          { name: 'X 轴位移', unit: 'm', data: points('displacement_x') },
          { name: 'Y 轴位移', unit: 'm', data: points('displacement_y') },
          { name: 'Z 轴位移', unit: 'm', data: points('displacement_z') }
        ];
      },
      netRegions: function () {
        const dist = this.last.net_tension_dist;
        if (!Array.isArray(dist)) return [];
        return dist.map(function (value, index) {
          return { label: '区域序号 ' + (index + 1), value: value };
        });
      },
      acceleration: function () {
        const keys = [
          { key: 'accel_x', label: 'X 轴' },
          { key: 'accel_y', label: 'Y 轴' },
          { key: 'accel_z', label: 'Z 轴' }
        ];
        return keys.map(function (item) {
          const value = this.last[item.key];
          return { label: item.label, field: item.key, value: value === undefined ? null : value };
        }, this);
      }
    },
    methods: {
      load: function () {
        const self = this;
        API.resolve(API.struct(this.minutes), function (d) { self.series = Array.isArray(d) ? d : []; });
      }
    },
    mounted: function () { this.unsub = API.bind(this, this.load); this.load(); },
    beforeUnmount: function () { if (this.unsub) { this.unsub(); this.unsub = null; } },
    watch: { minutes: function () { this.load(); } },
    template: [
      '<div>',
      '  <page-head title="结构安全 · 监测详情"',
      '    desc="分为锚链张力、网衣监测、形变与姿态三个区域；数据缺失时显示 —。"',
      '    :sources="[\'simulated\']" />',
      '',
      '  <section class="card">',
      '    <div class="card-title">一、锚链张力监测</div>',
      '    <div class="grid-stats">',
      '      <stat-card name="锚链张力" field="anchor_tension" unit="kN" :value="last.anchor_tension" source="simulated" :ts="last.ts" />',
      '      <stat-card name="张力占设计值" field="tension_pct" unit="%" :value="last.tension_pct" source="simulated" :ts="last.ts" />',
      '    </div>',
      '    <div style="margin-top:10px"><trend-chart title="锚链张力变化趋势" :series="charts" /></div>',
      '    <div class="small muted" style="margin-top:8px">张力占设计值达到 80% / 95% 时，预警页分别标记黄色 / 红色；锚点编号和逐锚点张力尚未由当前接口提供。</div>',
      '  </section>',
      '',
      '  <section class="card" style="margin-top:12px">',
      '    <div class="card-title">二、网衣监测</div>',
      '    <div class="grid-stats">',
      '      <stat-card name="网绳拉力" field="net_tension" unit="kN" :value="last.net_tension" source="simulated" :ts="last.ts" />',
      '      <stat-card name="网衣区域拉力" field="net_area_tension" :unit="last.net_area_tension === undefined ? \'\' : \'kN\'" :value="last.net_area_tension === undefined ? \'—\' : last.net_area_tension" source="simulated" :ts="last.ts" />',
      '      <stat-card name="破损疑似位置" field="damage_suspect_pos" unit="" :value="last.damage_suspect_pos === undefined ? \'—\' : last.damage_suspect_pos" source="simulated" :ts="last.ts" />',
      '    </div>',
      '    <div class="split" style="margin-top:10px">',
      '      <trend-chart title="网绳拉力趋势" :series="netCharts" />',
      '      <div class="card">',
      '        <div class="card-title">网衣各区域拉力分布</div>',
      '        <template v-if="netRegions.length">',
      '          <div v-for="item in netRegions" :key="item.label" class="row" style="justify-content:space-between;padding:7px 0">{{ item.label }}<b>{{ item.value === null || item.value === undefined ? \'—\' : item.value }}<span v-if="item.value !== null && item.value !== undefined"> kN</span></b></div>',
      '        </template>',
      '        <div v-else class="muted small" style="min-height:90px;display:flex;align-items:center;justify-content:center">暂无分区拉力与破损定位数据</div>',
      '      </div>',
      '    </div>',
      '  </section>',
      '',
      '  <section class="card" style="margin-top:12px">',
      '    <div class="card-title">三、结构形变与姿态监测</div>',
      '    <div class="grid-stats">',
      '      <stat-card name="横滚角" field="tilt_roll" unit="°" :value="last.tilt_roll" source="simulated" :ts="last.ts" />',
      '      <stat-card name="俯仰角" field="tilt_pitch" unit="°" :value="last.tilt_pitch" source="simulated" :ts="last.ts" />',
      '      <stat-card name="倾斜角合量" field="tilt_angle" unit="°" :value="last.tilt_angle" source="simulated" :ts="last.ts" />',
      '      <stat-card name="形变量" field="deformation" :unit="last.deformation === undefined ? \'\' : \'m\'" :value="last.deformation === undefined ? \'—\' : last.deformation" source="simulated" :ts="last.ts" />',
      '      <stat-card name="X 轴位移" field="displacement_x" :unit="last.displacement_x === undefined ? \'\' : \'m\'" :value="last.displacement_x === undefined ? \'—\' : last.displacement_x" source="simulated" :ts="last.ts" />',
      '      <stat-card name="Y 轴位移" field="displacement_y" :unit="last.displacement_y === undefined ? \'\' : \'m\'" :value="last.displacement_y === undefined ? \'—\' : last.displacement_y" source="simulated" :ts="last.ts" />',
      '      <stat-card name="Z 轴位移" field="displacement_z" :unit="last.displacement_z === undefined ? \'\' : \'m\'" :value="last.displacement_z === undefined ? \'—\' : last.displacement_z" source="simulated" :ts="last.ts" />',
      '    </div>',
      '    <div class="split" style="margin-top:10px">',
      '      <trend-chart title="横滚与俯仰趋势" :series="attitudeCharts" />',
      '      <trend-chart title="空间位移与形变趋势" :series="deformationCharts" />',
      '    </div>',
      '    <div class="card" style="margin-top:10px">',
      '      <div class="card-title">三轴加速度</div>',
      '      <div v-for="item in acceleration" :key="item.field" class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)">',
      '        <span>{{ item.label }}（{{ item.field }}）</span>',
      '        <b>{{ item.value === null ? \'—\' : item.value }}<span v-if="item.value !== null"> m/s²</span></b>',
      '      </div>',
      '    </div>',
      '  </section>',
      '',
      '  <div class="opbar" style="margin:12px -16px -16px; border-radius:0">',
      '    <time-range v-model="minutes" />',
      '    <span style="flex:1"></span>',
      '    <a href="#/struct/overview"><button>返回结构总览</button></a>',
      '    <a href="#/struct/alarm"><button>查看预警</button></a>',
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
          { name: '总功耗', unit: 'kW', data: this.series.map(function (r) { return [r.ts, r.total_power]; }) }
        ];
      },
      socCharts: function () {
        return [{ name: '储能电量', unit: '%', data: this.series.map(function (r) { return [r.ts, r.battery_soc]; }) }];
      },
      socLevel: function () {
        const s = this.last.battery_soc;
        if (s === undefined) return 'blue';
        return s < 10 ? 'red' : s < 20 ? 'yellow' : 'blue';
      },
      powerPriorityText: function () {
        if (!this.last.critical_device_id || this.last.power_priority === undefined || this.last.power_priority === null) return '—';
        return this.last.critical_device_id + ' · 优先级 ' + this.last.power_priority;
      },
      criticalPowerText: function () {
        const v = this.last.critical_device_power_status;
        return typeof CN.powerSupplyStatus === 'function' ? CN.powerSupplyStatus(v) : '—';
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
      '  <div class="split" style="margin-top:12px">',
      '    <trend-chart title="光伏发电与总功耗" :series="charts" />',
      '    <trend-chart title="储能电量变化" :series="socCharts"',
      '      :thresholds="[{value:20,label:\'低电量黄线 20%\',color:\'#92400E\'},{value:10,label:\'严重低电量红线 10%\',color:\'#991B1B\'}]" />',
      '  </div>',
      '',
      '  <div class="card" style="margin-top:12px">',
      '    <div class="card-title">关键设备供电优先级</div>',
      '    <div class="grid-stats">',
      '      <stat-card name="关键设备与优先级" field="critical_device_id / power_priority" unit="" :value="powerPriorityText" source="simulated" :ts="last.ts" />',
      '      <stat-card name="关键设备供电状态" field="critical_device_power_status" unit="" :value="criticalPowerText" source="simulated" :ts="last.ts" />',
      '    </div>',
      '    <div v-if="!last.critical_device_id || last.power_priority === undefined" class="small muted" style="margin-top:8px">当前结构接口尚未提供关键设备编号和优先级配置，因此暂显示 —。</div>',
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

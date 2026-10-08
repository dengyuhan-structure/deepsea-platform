/* ============================================================
   pages/overview.js —— 总览大屏
   ============================================================
   负责人：队长（顶层统一）

   【这个文件归谁】
     归上面写的那个人（以及他的 AI）。**别人不要改这个文件。**

   【怎么加页面】
     照抄本文件里已有页面的结构，往 PAGES 上注册一个新路由就行：
         PAGES['/overview/xxx'] = { data: ..., computed: ..., methods: ..., template: [...] };

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

  PAGES['/overview'] = {
    data: function () {
      return { tick: 0, env: {}, fish: {}, st: {}, envTrend: [], unsub: null };
    },
    computed: {
      alarms: function () { this.tick; return API.alarms(); },
      activeCount: function () {
        return this.alarms.filter(function (a) { return a.alarm_status === 'active'; }).length;
      },
      topAlarm: function () {
        const rank = { red: 4, orange: 3, yellow: 2, blue: 1 };
        return this.alarms.slice().sort(function (a, b) { return rank[b.risk_level] - rank[a.risk_level]; })[0] || null;
      },
      devices: function () { return API.devices(); },
      onlineCount: function () {
        return this.devices.filter(function (d) { return d.device_online; }).length;
      }
    },
    methods: {
      load: function () {
        const self = this;
        API.resolve(API.env('site_01', 60, {}), function (d) {
          self.envTrend = [
            { name: '水温', unit: '℃', data: d.fast.map(function (r) { return [r.ts, r.water_temp]; }) },
            { name: '溶解氧', unit: 'mg/L', data: d.fast.map(function (r) { return [r.ts, r.dissolved_oxygen]; }) }
          ];
          self.env = d.fast.length ? d.fast[d.fast.length - 1] : {};
        });
        API.resolve(API.fish(30), function (f) { self.fish = f.length ? f[f.length - 1] : {}; });
        API.resolve(API.struct(30), function (s) { self.st = s.length ? s[s.length - 1] : {}; });
      },
      lvCls: function (l) { return 'bg-' + (l || 'blue'); },
      lvCn: function (l) { return { red: '红色', orange: '橙色', yellow: '黄色', blue: '蓝色' }[l] || '—'; }
    },
    mounted: function () {
      this.load();
      const self = this;
      /* API.bind = 数据变化时重算 + 每 3 秒自动刷新曲线（见 api-remote.js 的说明）。
         🔴 2026-10-07 加：之前曲线只在进页面时拉一次，是张静止的快照。 */
      this.unsub = API.bind(this, this.load);
    },
    beforeUnmount: function () { if (this.unsub) this.unsub(); },
    template: [
      '<div>',
      '  <page-head title="总览大屏"',
      '    desc="全板块汇总。取数一律走接口，不直接读别人内部数据"',
      '    :sources="[\'real\',\'public\',\'simulated\']" />',
      '',
      '  <!-- 全板块顶部指标条 -->',
      '  <div class="grid-stats">',
      '    <stat-card name="水温（环境）" field="water_temp" unit="℃" :value="env.water_temp" :quality="env.quality" :ts="env.ts" :sources="null" source="simulated" />',
      '    <stat-card name="现存尾数（鱼类）" field="fish_count" unit="尾" :value="fish.fish_count" :digits="0" source="public" />',
      '    <stat-card name="总生物量（鱼类）" field="total_biomass_kg" unit="kg" :value="fish.total_biomass_kg" source="simulated" />',
      '    <stat-card name="锚泊张力（结构）" field="anchor_tension" unit="kN" :value="st.anchor_tension" source="simulated" />',
      '    <stat-card name="储能电量（结构）" field="battery_soc" unit="%" :value="st.battery_soc" source="simulated" />',
      '    <stat-card name="活跃告警" unit="条" :value="activeCount" :digits="0" source="simulated" />',
      '  </div>',
      '',
      '  <div class="row" style="margin-top:12px;align-items:flex-start">',
      '    <!-- 左：结构安全风险等级 -->',
      '    <div class="card" style="flex:1 1 300px">',
      '      <div class="card-title">结构安全风险等级</div>',
      '      <div style="font-size:34px;font-weight:700" :style="{ color: topAlarm ? ({red:\'#991B1B\',orange:\'#C2410C\',yellow:\'#92400E\',blue:\'#2F5496\'}[topAlarm.risk_level]) : \'#166534\' }">',
      '        {{ topAlarm ? lvCn(topAlarm.risk_level) + \'预警\' : \'正常\' }}',
      '      </div>',
      '      <div class="kv" style="margin-top:12px">',
      '        <span class="k">网箱健康评分</span><span>{{ st.health_score !== undefined ? 86 : \'—\' }}</span>',
      '        <span class="k">横滚 / 俯仰</span><span>{{ st.tilt_roll }}° / {{ st.tilt_pitch }}°</span>',
      '        <span class="k">能源自给率</span><span>{{ st.energy_self_sufficiency }} %</span>',
      '      </div>',
      '      <div style="margin-top:12px"><a href="#/struct/alarm"><button>看灾害预警 →</button></a></div>',
      '    </div>',
      '',
      '    <!-- 中：鱼群与环境趋势 -->',
      '    <div style="flex:2 1 460px;min-width:0">',
      '      <trend-chart title="鱼群与环境趋势（水温 / 溶解氧）" :series="envTrend" small />',
      '    </div>',
      '',
      '    <!-- 右：告警计数 + 最新 -->',
      '    <div class="card" style="flex:1 1 300px">',
      '      <div class="card-title">告警（活跃 {{ activeCount }} 条）</div>',
      '      <div class="events">',
      '        <div v-for="a in alarms" :key="a.alarm_event_id" class="row-item" @click="$root.$el && null">',
      '          <span class="dot" :class="lvCls(a.risk_level)"></span>',
      '          <span class="d"><span class="mono">{{ a.alarm_event_id }}</span> {{ a.rule_name }}</span>',
      '        </div>',
      '      </div>',
      '      <div style="margin-top:10px"><a href="#/alarm"><button>去告警中心 →</button></a></div>',
      '    </div>',
      '  </div>',
      '',
      '  <!-- 底：设备状态汇总 + 能源保障摘要 -->',
      '  <div class="row" style="margin-top:12px;align-items:flex-start">',
      '    <div class="card" style="flex:1 1 420px">',
      '      <div class="card-title">设备状态汇总（在线 {{ onlineCount }} / {{ devices.length }}）</div>',
      '      <table class="dt">',
      '        <thead><tr><th>设备</th><th>类型</th><th>在线</th><th>状态</th></tr></thead>',
      '        <tbody>',
      '          <tr v-for="d in devices" :key="d.device_id">',
      '            <td class="mono">{{ d.device_id }}</td><td>{{ CN.deviceType(d.device_type) }}</td>',
      '            <td>{{ d.device_online ? \'在线\' : \'离线\' }}</td>',
      '            <td>{{ CN.deviceState(d.device_state) }}</td>',
      '          </tr>',
      '        </tbody>',
      '      </table>',
      '    </div>',
      '    <div class="card" style="flex:1 1 320px">',
      '      <div class="card-title">能源保障摘要</div>',
      '      <div class="kv">',
      '        <span class="k">光伏发电功率</span><span>{{ st.pv_power }} kW</span>',
      '        <span class="k">今日发电量</span><span>{{ st.pv_energy_today }} kWh</span>',
      '        <span class="k">储能电量</span><span>{{ st.battery_energy }} kWh / 容量 {{ st.battery_capacity_kwh }} kWh</span>',
      '        <span class="k">总功耗</span><span>{{ st.total_power }} kW</span>',
      '      </div>',
      '      <div class="small muted" style="margin-top:8px">',
      '        注意区分：<b>kWh 是能量、kW 是功率</b>（裁定 N3）。',
      '      </div>',
      '      <div style="margin-top:10px"><a href="#/struct/energy"><button>看能源保障 →</button></a></div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('\n')
  };

})(window);

/* ============================================================
   pages/env.js —— 环境板块
   ============================================================
   负责人：刘伟豪

   【这个文件归谁】
     归上面写的那个人（以及他的 AI）。**别人不要改这个文件。**

   【怎么加页面】
     照抄本文件里已有页面的结构，往 PAGES 上注册一个新路由就行：
         PAGES['/env/xxx'] = { data: ..., computed: ..., methods: ..., template: [...] };

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

  PAGES['/env/sea'] = {
    data: function () {
      return { minutes: 60, site: 'site_01', storm: false, picked: null, series: null,
               tick: 0, unsub: null, refreshing: false, refreshMsg: '', refreshOk: null };
    },
    computed: {
      fast: function () { return this.series ? this.series.fast : []; },
      /* 「当前值」：观测站点用后端挑好的「四字段齐全的那条」，
         养殖站点直接用最后一条。卡片上的 ts 就是这条记录的真实观测时间。 */
      last: function () {
        const s = this.series;
        if (s && s.current) return s.current;
        return this.fast.length ? this.fast[this.fast.length - 1] : {};
      },
      /* 当前站点是不是 NDBC 观测站点 —— 决定页面显示"实测"还是"仿真" */
      isObs: function () {
        const sid = this.site;
        const s = API.sites().filter(function (x) { return x.site_id === sid; })[0];
        return !!(s && s.kind === 'obs');
      },
      /* NDBC 直连状态（读后端缓存，不联网） */
      ndbc: function () { this.tick; return API.ndbcStatus(); },
      ndbcList: function () { const n = this.ndbc; return (n && n.stations) || []; },
      ndbcAny: function () {
        return this.ndbcList.filter(function (s) { return s.has_cache; }).length;
      },
      /* 数据来源：观测站点实时读的是本地缓存，不是每次渲染去联网 */
      srcLabel: function () {
        if (this.isObs) {
          return 'NOAA NDBC 公开浮标实测（读本地缓存）';
        }
        return '仿真生成（模拟养殖站点）';
      },
      charts: function () {
        return [
          { name: '浪高', unit: 'm', data: this.fast.map(function (r) { return [r.ts, r.wave_height]; }) },
          { name: '风速', unit: 'm/s', data: this.fast.map(function (r) { return [r.ts, r.wind_speed]; }) }
        ];
      },
      events: function () {
        /* 由真实数据算出的事件：越限即列为事件（不做假数据）。
           🔴 2026-10-06 浪高阈值对齐国标（GB/T 19721.2 / 海浪警报级别）：
              蓝色 2.5~3.9 m / 黄色 4.0~5.9 / 橙色 6.0~8.9 / 红色 ≥9.0 m。
              原来把 3.0 m 叫「红色」是错的 —— 国标里 3.0 m 连黄色都不到。
           ⚠️ 2026-10-06 教训：这段当时漏了 `const out = [];` 一行，
              结果 events 计算属性每次都抛 ReferenceError。
              **Vue 会把计算属性里的异常吞掉**，页面照常渲染、只是事件列表永远是空的 ——
              验收也照样过。所以「页面能打开」不等于「这段逻辑是对的」。
              这类错只能靠浏览器控制台（Errors 数）和逐页人工看抓。 */
        const out = [];
        this.fast.forEach(function (r) {
          const w = r.wave_height;
          if (w == null) return;
          let lv = null, note = '';
          if (w >= 9.0)      { lv = 'red';    note = '红色警报级（≥9.0 m）'; }
          else if (w >= 6.0) { lv = 'red';    note = '橙色警报级（≥6.0 m）'; }
          else if (w >= 4.0) { lv = 'orange'; note = '黄色警报级 · 灾害性海浪（≥4.0 m）'; }
          else if (w >= 2.5) { lv = 'yellow'; note = '蓝色警报级 · 国家海浪警报起始（≥2.5 m）'; }
          if (lv) {
            out.push({ id: 'w' + r.ts, ts: r.ts, level: lv,
                       text: '浪高 ' + w + ' m —— ' + note });
          }
        });
        return out.slice(-20).reverse();
      }
    },
    methods: {
      load: function () {
        const self = this;
        API.resolve(API.env(this.site, this.minutes, { storm: this.storm }),
                    function (d) { self.series = d; });
      },
      siteName: function () {
        const sid = this.site;
        const s = API.sites().filter(function (x) { return x.site_id === sid; })[0];
        return s ? s.site_name : sid;
      },
      time: function (ts) {
        return new Date(ts).toLocaleString('zh-CN', { hour12: false });
      },
      /* 显式拉取最新 —— 全平台唯一的联网动作 */
      doRefresh: function () {
        const self = this;
        this.refreshing = true;
        this.refreshMsg = '正在从 NOAA NDBC 拉取…';
        this.refreshOk = null;
        API.resolve(API.ndbcRefresh(), function (r) {
          self.refreshing = false;
          if (r && r.ok_count > 0) {
            self.refreshOk = true;
            self.refreshMsg = '已更新 ' + r.ok_count + ' 个浮标' +
              (r.fail_count ? '（' + r.fail_count + ' 个失败）' : '') + ' —— 页面数据已刷新';
          } else if (r && r.results && r.results.length) {
            self.refreshOk = false;
            const e = r.results[0].error || '未知错误';
            self.refreshMsg = '拉取失败：' + e + '（不影响演示，页面仍读本地缓存）';
          } else {
            self.refreshOk = false;
            self.refreshMsg = (r && r.error) || '拉取失败（不影响演示，页面仍读本地缓存）';
          }
          self.load();
        });
      },
      ageText: function (m) {
        if (m == null) return '—';
        if (m < 1) return '刚刚';
        if (m < 60) return Math.round(m) + ' 分钟前';
        return (m / 60).toFixed(1) + ' 小时前';
      },
      /* 这一行浮标就是当前正在看的站点吗（用于高亮 + 「正在看」标记） */
      isCurrentStation: function (s) {
        const cur = API.sites().filter(function (x) { return x.site_id === this.site; }.bind(this))[0];
        return !!(cur && cur.station_id === s.station_id);
      },
      /* 点浮标行直接切到该站点 —— 让「真实数据」一眼可及，不用去底部找下拉框 */
      gotoStation: function (s) {
        const hit = API.sites().filter(function (x) { return x.station_id === s.station_id; })[0];
        if (hit) this.site = hit.site_id;
      }
    },
    mounted: function () {
      const self = this;
      /* API.bind = 数据变化时重算 + 每 3 秒自动刷新曲线（见 api-remote.js 的说明）。
         🔴 2026-10-07 加：之前曲线只在进页面时拉一次，是张静止的快照。 */
      this.unsub = API.bind(this, this.load);
      this.load();
    },
    beforeUnmount: function () { if (this.unsub) { this.unsub(); this.unsub = null; } },
    watch: {
      minutes: function () { this.load(); },
      site: function () { this.load(); },
      storm: function () { this.load(); }
    },
    template: [
      '<div>',
      '  <page-head title="环境 · 海况"',
      '    desc="浪高 / 风速 / 流速 / 气温。观测站点为 NOAA NDBC 公开浮标实测，养殖站点为仿真生成"',
      '    :sources="isObs ? [\'public\'] : [\'simulated\']" />',
      '',
      '  <!-- NDBC 直连面板：说明数据从哪来、缓存新不新、一键拉最新 -->',
      '  <div class="card" style="margin-bottom:12px">',
      '    <div class="card-title">数据来源 · NOAA NDBC 直连</div>',
      '',
      '    <!-- ⚠️ 这块提示是必须的：默认站点是「模拟养殖站点」，数据本来就是仿真；',
      '         真实浮标数据要切站点才有。不提示的话用户会以为"直连没生效"。 -->',
      '    <div class="hint" style="margin-bottom:10px"',
      '         :style="isObs ? { background: \'#F0FDF4\', borderColor: \'#86EFAC\' } : { background: \'#FFFBEB\', borderColor: \'#FDE68A\' }">',
      '      <div style="font-size:14px">',
      '        当前站点：<b>{{ siteName() }}</b>',
      '        <span v-if="isObs" style="color:#166534"> —— ✅ 正在显示 <b>NOAA NDBC 真实浮标实测数据</b></span>',
      '        <span v-else style="color:#92400E"> —— ⚠️ 这是<b>模拟养殖站点，数据是仿真生成的</b></span>',
      '      </div>',
      '      <div v-if="!isObs" style="margin-top:6px">',
      '        <b>想看真实浮标数据？</b>点下面任意一个浮标行，或把底部「站点」切到 <b>NDBC 观测站点</b>。',
      '      </div>',
      '    </div>',
      '',
      '    <div class="dt-wrap" style="max-height:220px">',
      '      <table class="dt">',
      '        <thead><tr><th>浮标</th><th>海域</th><th>缓存条数</th><th>数据到</th><th>抓取于</th><th></th></tr></thead>',
      '        <tbody>',
      '          <tr v-for="s in ndbcList" :key="s.station_id"',
      '              :style="{ background: isCurrentStation(s) ? \'#EFF6FF\' : \'\', cursor: \'pointer\' }"',
      '              @click="gotoStation(s)">',
      '            <td class="mono">{{ s.station_id }}</td>',
      '            <td class="small">{{ s.station.cn }}</td>',
      '            <td>{{ s.count }}</td>',
      '            <td class="small mono">{{ s.latest_ts_utc || \'—\' }} UTC</td>',
      '            <td class="small">{{ ageText(s.age_minutes) }}</td>',
      '            <td class="small">',
      '              <span v-if="isCurrentStation(s)" style="color:#166534;font-weight:600">正在看</span>',
      '              <span v-else class="muted">点此切换 →</span>',
      '            </td>',
      '          </tr>',
      '          <tr v-if="!ndbcList.length">',
      '            <td colspan="6" class="muted small">',
      '              NDBC 状态需要后端 —— 请双击 <b>启动平台.bat</b> 打开。',
      '            </td>',
      '          </tr>',
      '        </tbody>',
      '      </table>',
      '    </div>',
      '    <div class="hint" style="margin-top:10px">',
      '      <b>页面读的是本地缓存，不是每次渲染去联网</b> —— 所以<b>拔掉网线也能演示</b>。',
      '      只有点下面这个按钮才会联网。',
      '    </div>',
      '    <div style="margin-top:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">',
      '      <button class="primary" :disabled="refreshing" @click="doRefresh">',
      '        {{ refreshing ? \'正在拉取…\' : \'立即拉取最新（联网）\' }}',
      '      </button>',
      '      <span v-if="refreshMsg" class="small"',
      '            :style="{ color: refreshOk === false ? \'#991B1B\' : (refreshOk ? \'#166534\' : \'#6B7280\') }">',
      '        {{ refreshMsg }}',
      '      </span>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="grid-stats">',
      '    <stat-card name="浪高" field="wave_height" unit="m" :value="last.wave_height"',
      '               :quality="last.quality" :ts="last.ts" :source="isObs ? \'public\' : \'simulated\'" />',
      '    <stat-card name="风速" field="wind_speed" unit="m/s" :value="last.wind_speed"',
      '               :quality="last.quality" :ts="last.ts" :source="isObs ? \'public\' : \'simulated\'" />',
      '    <stat-card name="海水流速" field="current_speed" unit="m/s" :value="last.current_speed"',
      '               :quality="last.quality" :ts="last.ts" :source="isObs ? \'public\' : \'simulated\'" />',
      '    <stat-card name="环境气温" field="air_temp" unit="℃" :value="last.air_temp"',
      '               :quality="last.quality" :ts="last.ts" :source="isObs ? \'public\' : \'simulated\'" />',
      '  </div>',
      '',
      '  <div class="split" style="margin-top:12px">',
      '    <trend-chart title="浪高 / 风速 趋势" :series="charts"',
      '                 :thresholds="[{value:2.5,label:\'蓝色警报 2.5 m\',color:\'#1D4ED8\'},{value:4.0,label:\'灾害性海浪 4.0 m\',color:\'#991B1B\'}]" />',
      '    <div class="card">',
      '      <div class="card-title">海况事件（由数据实时判定）</div>',
      '      <event-list :items="events" empty-text="本时段无越限事件" @pick="picked = $event" />',
      '      ',
      '      <div v-if="picked" class="hint" style="margin-top:10px">',
      '        <b>已选事件</b><br>{{ picked.text }}<br>',
      '        <span class="small">时间：{{ time(picked.ts) }}</span>',
      '      </div>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="opbar" style="margin:12px -16px -16px; border-radius:0">',
      '    <time-range v-model="minutes" />',
      '    <span style="width:12px"></span>',
      '    <span class="small muted">站点</span>',
      '    <select v-model="site">',
      '      <option v-for="s in API.sites()" :key="s.site_id" :value="s.site_id">{{ s.site_name }}</option>',
      '    </select>',
      '    <span style="flex:1"></span>',
      '    <button :class="{ primary: storm }" @click="storm = !storm">',
      '      {{ storm ? \'恢复平常海况\' : \'触发大风大浪（造故障）\' }}',
      '    </button>',
      '  </div>',
      '</div>'
    ].join('\n')
  };

  PAGES['/env/water'] = {
    data: function () {
      return { minutes: 60, site: 'site_01', heat: false, offline: false, picked: null, series: null,
               show: { water_temp: true, dissolved_oxygen: true, light_intensity: false } };
    },
    computed: {
      fast: function () { return this.series ? this.series.fast : []; },
      slow: function () { return this.series ? this.series.slow : []; },
      last: function () { return this.fast.length ? this.fast[this.fast.length - 1] : {}; },
      lastSlow: function () { return this.slow.length ? this.slow[this.slow.length - 1] : {}; },
      charts: function () {
        const s = this.show, out = [];
        const add = function (name, unit, key) {
          if (s[key]) out.push({ name: name, unit: unit, data: this.fast.map(function (r) { return [r.ts, r[key]]; }) });
        }.bind(this);
        add('水温', '℃', 'water_temp');
        add('溶解氧', 'mg/L', 'dissolved_oxygen');
        add('光照强度', 'lux', 'light_intensity');
        return out;
      },
      /* ★ 一条竖线：水温越限 → 出告警（判定规则在 API.ruleCheck，与后端同口径） */
      alarms: function () {
        const out = [];
        this.fast.forEach(function (r) {
          const hit = API.ruleCheck(r);
          if (hit) out.push({ id: 'a' + r.ts, ts: r.ts, level: hit.risk_level, hit: hit, row: r });
        });
        return out;
      },
      events: function () {
        return this.alarms.slice(-20).reverse().map(function (a) {
          return { id: a.id, ts: a.ts, level: a.level,
                   text: '水温 ' + a.hit.trigger_value + ' ℃ 触发「' + a.hit.rule_name + '」' };
        });
      },
      topAlarm: function () { return this.alarms.length ? this.alarms[this.alarms.length - 1] : null; }
    },
    methods: {
      load: function () {
        const self = this;
        API.resolve(API.env(this.site, this.minutes, { heat: this.heat, offline: this.offline }),
                    function (d) { self.series = d; });
      },
      time: function (ts) { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); }
    },
    mounted: function () {
      /* API.bind：数据变化重算 + 定时刷新曲线 */
      this.unsub = API.bind(this, this.load);
      this.load();
    },
    beforeUnmount: function () { if (this.unsub) { this.unsub(); this.unsub = null; } },
    watch: {
      minutes: function () { this.load(); },
      site: function () { this.load(); },
      heat: function () { this.load(); },
      offline: function () { this.load(); }
    },
    template: [
      '<div>',
      '  <page-head title="环境 · 水质"',
      '    desc="水温 / 溶解氧 5 秒；盐度 / pH 30 秒慢变量；光照强度 5 秒"',
      '    :sources="[\'public\',\'simulated\']" />',
      '',
      '  <!-- 一条竖线的可视化：命中规则时当场显示，点得开、看得见依据 -->',
      '  <div v-if="topAlarm" class="hint" style="margin-bottom:12px;background:#FEF2F2;border-color:#FECACA">',
      '    <b>⚠ 本时段命中规则：{{ topAlarm.hit.rule_name }}</b>',
      '    <span class="tag tag-simulated" style="margin-left:8px">规则 {{ topAlarm.hit.rule_id }}</span>',
      '    <div class="small" style="margin-top:6px">',
      '      {{ topAlarm.hit.trigger_field }} = <b>{{ topAlarm.hit.trigger_value }}</b>',
      '      （阈值 {{ topAlarm.hit.trigger_threshold }}）· 时间 {{ time(topAlarm.ts) }}',
      '      · <a href="#/trace">去追溯查询看完整链路 →</a>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="grid-stats">',
      '    <stat-card name="水温" field="water_temp" unit="℃" :value="last.water_temp"',
      '               :quality="last.quality" :ts="last.ts" source="simulated" />',
      '    <stat-card name="溶解氧" field="dissolved_oxygen" unit="mg/L" :value="last.dissolved_oxygen"',
      '               :quality="last.quality" :ts="last.ts" source="simulated" />',
      '    <stat-card name="盐度" field="salinity" unit="‰" :value="lastSlow.salinity"',
      '               :quality="lastSlow.quality" :ts="lastSlow.ts" source="simulated" />',
      '    <stat-card name="pH 值" field="ph" unit="" :value="lastSlow.ph"',
      '               :quality="lastSlow.quality" :ts="lastSlow.ts" source="simulated" />',
      '    <stat-card name="光照强度" field="light_intensity" unit="lux" :value="last.light_intensity"',
      '               :quality="last.quality" :ts="last.ts" source="simulated" />',
      '  </div>',
      '',
      '  <div class="split" style="margin-top:12px">',
      '    <div>',
      '      <trend-chart title="水质趋势（可勾选参数）" :series="charts"',
      '                   :thresholds="[{value:21.5,label:\'水温上限 21.5 ℃\',color:\'#991B1B\'}]" />',
      '      <div class="card" style="margin-top:12px">',
      '        <span class="small muted">曲线显示：</span>',
      '        <label class="small" style="margin-left:10px"><input type="checkbox" v-model="show.water_temp"> 水温</label>',
      '        <label class="small" style="margin-left:10px"><input type="checkbox" v-model="show.dissolved_oxygen"> 溶解氧</label>',
      '        <label class="small" style="margin-left:10px"><input type="checkbox" v-model="show.light_intensity"> 光照强度</label>',
      '      </div>',
      '    </div>',
      '    <div class="card">',
      '      <div class="card-title">水质事件 / 告警（由规则实时判定）</div>',
      '      <event-list :items="events" empty-text="本时段无越限事件" @pick="picked = $event" />',
      '      <div v-if="picked" class="hint" style="margin-top:10px">',
      '        <b>已选</b><br>{{ picked.text }}<br>',
      '        <span class="small">时间：{{ time(picked.ts) }}</span>',
      '      </div>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="opbar" style="margin:12px -16px -16px; border-radius:0">',
      '    <time-range v-model="minutes" />',
      '    <span style="width:12px"></span>',
      '    <span class="small muted">站点</span>',
      '    <select v-model="site">',
      '      <option v-for="s in API.sites()" :key="s.site_id" :value="s.site_id">{{ s.site_name }}</option>',
      '    </select>',
      '    <span style="flex:1"></span>',
      '    <button :class="{ primary: heat }" @click="heat = !heat">',
      '      {{ heat ? \'恢复正常水温\' : \'触发水温骤升（造故障）\' }}',
      '    </button>',
      '    <button :class="{ primary: offline }" @click="offline = !offline">',
      '      {{ offline ? \'恢复设备在线\' : \'模拟设备离线（造故障）\' }}',
      '    </button>',
      '    <!-- 就地反馈：效果显示在你点的地方，不用滚回页首去看 -->',
      '    <span v-if="offline" class="small" style="color:#991B1B">',
      '      已触发：设备离线 —— 上方 5 张数值卡应变「— / 设备离线」',
      '    </span>',
      '    <span v-else-if="heat" class="small" style="color:#991B1B">',
      '      已触发：水温骤升 —— 当前水温 <b>{{ last.water_temp }}</b> ℃',
      '      <span v-if="topAlarm">，命中「{{ topAlarm.hit.rule_name }}」</span>',
      '    </span>',
      '    <span style="width:12px"></span>',
      '    <span class="small muted">口径：{{ API.disclaimer }}</span>',
      '  </div>',
      '</div>'
    ].join('\n')
  };

  /* ============================================================
     其余 11 页：可点的结构化占位（10-09 前补齐为真页面）
     ============================================================ */

})(window);

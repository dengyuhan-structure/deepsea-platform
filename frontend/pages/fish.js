/* ============================================================
   pages/fish.js —— 鱼类板块
   ============================================================
   负责人：王浩然

   【这个文件归谁】
     归上面写的那个人（以及他的 AI）。**别人不要改这个文件。**

   【怎么加页面】
     照抄本文件里已有页面的结构，往 PAGES 上注册一个新路由就行：
         PAGES['/fish/xxx'] = { data: ..., computed: ..., methods: ..., template: [...] };

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

  /* 本板块专用的 GET/POST（共享 API 模块没有导出通用 get/post，按"只改本板块文件"的规矩在这里就地实现）。
     走后端托管时 __API_BASE__ 为空字符串；无后端时调用失败，由调用方显示「—」。 */
  function fishGet(path, params) {
    let q = '';
    if (params) {
      q = '?' + Object.keys(params).map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      }).join('&');
    }
    return fetch((global.__API_BASE__ || '') + path + q).then(function (r) { return r.json(); });
  }
  function fishPost(path, body) {
    return fetch((global.__API_BASE__ || '') + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json(); });
  }

  PAGES['/fish/monitor'] = {
    data: function () { return { minutes: 60, series: [] }; },
    computed: {
      last: function () { return this.series.length ? this.series[this.series.length - 1] : {}; },
      charts: function () {
        return [
          { name: '现存尾数', unit: '尾', data: this.series.map(function (r) { return [r.ts, r.fish_count]; }) },
          { name: '平均体重', unit: 'g', data: this.series.map(function (r) { return [r.ts, r.avg_weight_g]; }) },
          { name: '预估总生物量', unit: 'kg', data: this.series.map(function (r) { return [r.ts, r.total_biomass_kg]; }) }
        ];
      },
      /* 摄食强度变化即"事件"——由数据实时判定，不造假事件 */
      events: function () {
        const out = [];
        let prev = null;
        this.series.forEach(function (r) {
          if (prev !== null && r.feeding_intensity !== prev) {
            out.push({ id: 'f' + r.ts, ts: r.ts,
                       level: r.feeding_intensity === 'strong' ? 'blue'
                            : r.feeding_intensity === 'none' ? 'yellow' : 'orange',
                       text: '摄食强度由「' + this.cn(prev) + '」变为「' + this.cn(r.feeding_intensity) + '」',
                       row: r });
          }
          prev = r.feeding_intensity;
        }, this);
        return out.slice(-15).reverse();
      }
    },
    methods: {
      load: function () {
        const self = this;
        API.resolve(API.fish(this.minutes), function (d) { self.series = d; });
      },
      cn: function (v) { return { none: '无', weak: '弱', mid: '中', strong: '强' }[v] || v; },
      time: function (ts) { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); }
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
      '  <page-head title="鱼类 · 鱼类监测总览"',
      '    desc="行为识别 + 生物量统计。数据来源：公开数据集（TFBID / DeepFish）+ 仿真"',
      '    :sources="[\'public\',\'simulated\']" />',
      '',
      '  <div class="grid-stats">',
      '    <stat-card name="现存总尾数" field="fish_count" unit="尾" :value="last.fish_count" :digits="0" source="public" />',
      '    <stat-card name="平均体重" field="avg_weight_g" unit="g" :value="last.avg_weight_g" source="simulated" />',
      '    <stat-card name="平均体长" field="avg_length_cm" unit="cm" :value="last.avg_length_cm" source="simulated" />',
      '    <stat-card name="预估总生物量" field="total_biomass_kg" unit="kg" :value="last.total_biomass_kg" source="simulated" />',
      '    <stat-card name="鱼群摄食强度" field="feeding_intensity" unit="" :value="cn(last.feeding_intensity)" source="public" />',
      '    <stat-card name="活动鱼群密度" field="fish_density" unit="尾/m³" :value="last.fish_density" source="simulated" />',
      '  </div>',
      '',
      '  <div class="split" style="margin-top:12px">',
      '    <trend-chart title="数量与生长趋势" :series="charts" />',
      '    <div class="card">',
      '      <div class="card-title">摄食行为变化（行为识别输出）</div>',
      '      <event-list :items="events" empty-text="本时段摄食强度无变化" />',
      '    </div>',
      '  </div>',
      '',
      '  <div class="hint" style="margin-top:12px">',
      '    <b>口径说明</b>：投喂量<b>不在这里算</b> —— 按裁定 1，投喂决策归智能板块，',
      '    鱼类只出观测类指标。鱼类不再提供 <code>suggest_feed_kg_h</code>。',
      '    生长参数用 <code>W = lw_a · L^lw_b</code>，公式参数 <code>lw_a</code> / <code>lw_b</code> 来源须标注公开文献。',
      '  </div>',
      '',
      '  <div class="opbar" style="margin:12px -16px -16px; border-radius:0">',
      '    <time-range v-model="minutes" />',
      '    <span style="flex:1"></span>',
      '    <span class="small muted">本期不做：FCR / 活跃度 / 体长离散度 / 死亡个体数（裁定 5）</span>',
      '  </div>',
      '</div>'
    ].join('\n')
  };

  PAGES['/fish/heatmap'] = {
    data: function () { return { grid: [], picked: null, offline: false }; },
    computed: {
      peak: function () {
        let best = { x: 0, y: 0, v: null }, sum = 0, n = 0;
        this.grid.forEach(function (row, y) {
          row.forEach(function (v, x) {
            if (v > best.v) best = { x: x, y: y, v: v };
            sum += v; n++;
          });
        });
        return { best: best, avg: n ? +(sum / n).toFixed(1) : null };
      }
    },
    methods: {
      load: function () {
        const self = this;
        fishGet('/api/heatmap').then(function (d) {
          self.grid = (d && d.grid) || [];
          self.offline = !!(d && d.offline);
        }).catch(function () { self.grid = []; self.offline = true; });
      }
    },
    mounted: function () {
      /* API.bind：数据变化重算 + 定时刷新曲线 */
      this.unsub = API.bind(this, this.load);
      this.load();
    },
    beforeUnmount: function () { if (this.unsub) { this.unsub(); this.unsub = null; } },
    template: [
      '<div>',
      '  <page-head title="鱼类 · 鱼群分布热力图"',
      '    desc="10 × 10 网格累加密度（拍板问题单 问题 5 建议 A）。接口字段 <code>grid[][]</code>"',
      '    :sources="[\'simulated\']" />',
      '',
      '  <div class="grid-stats">',
      '    <stat-card name="最高密度网格" unit="尾/m³" :value="peak.best.v" source="simulated" />',
      '    <stat-card name="最高密度位置" unit="" :value="\'X\' + (peak.best.x + 1) + \' / Y\' + (peak.best.y + 1)" source="simulated" />',
      '    <stat-card name="网格平均密度" unit="尾/m³" :value="peak.avg" source="simulated" />',
      '    <stat-card name="网格分辨率" unit="" value="10 × 10" source="simulated" />',
      '  </div>',
      '',
      '  <div v-if="offline" class="card" style="margin-top:12px">',
      '    <div class="muted small">视觉链路不可用（生成器已停止或摄像头离线）—— 密度数据显示「—」，不显示上一个值。</div>',
      '  </div>',
      '  <div v-else style="margin-top:12px">',
      '    <heat-grid title="鱼群密度分布（颜色越红越密）" :grid="grid" unit="尾/m³" :height="430" />',
      '  </div>',
      '',
      '  <div class="hint" style="margin-top:12px">',
      '    <b>为什么是 10 × 10</b>：热力图是给值班人<b>一眼看趋势</b>用的，不是科研分析。',
      '    10×10 已经能清楚显示鱼群集中在哪个区域；20×20 单格在网页上小于可读尺寸，收益不明显。',
      '  </div>',
      '',
      '  <div class="opbar" style="margin:12px -16px -16px; border-radius:0">',
      '    <button @click="load">重新采样</button>',
      '    <span style="flex:1"></span>',
      '    <span class="small muted">配色沿用状态色阶语义，未使用彩虹色</span>',
      '  </div>',
      '</div>'
    ].join('\n')
  };

  PAGES['/fish/growth'] = {
    data: function () {
      return { tick: 0, unsub: null, cageId: '', farm: null, live: [], gChart: null };
    },
    computed: {
      cages: function () {
        this.tick;
        const f = this.farm;
        return (f && f.cages) || [];
      },
      cage: function () {
        const self = this;
        return this.cages.filter(function (c) { return c.cage_id === self.cageId; })[0] || null;
      },
      liveLast: function () {
        this.tick;
        return this.live.length ? this.live[this.live.length - 1] : null;
      },
      /* 生长模型结果：全部由台账真实配置 + 当前观测推导，不编数字 */
      m: function () {
        const c = this.cage;
        const DAY = 86400000;
        const out = { ok: false };
        if (!c || !c.stocking) return out;
        const st = c.stocking;
        let t0, t1, w0, wT;
        t0 = Date.parse(st.date);
        t1 = Date.parse(st.plan_harvest);
        w0 = +st.init_size_g;
        wT = +st.target_size_g;
        if (!(t1 > t0) || !(wT > w0)) return out;
        const now = Date.now();
        const totalDays = (t1 - t0) / DAY;
        const elapsed = Math.max(0, (now - t0) / DAY);
        const planRate = (wT - w0) / totalDays;
        const planToday = w0 + planRate * elapsed;
        const hasObs = c.site_id === 'site_01' && this.liveLast && this.liveLast.avg_weight_g != null;
        const obs = hasObs ? this.liveLast.avg_weight_g : null;
        let etaTs = null, etaDays = null, obsRate = null;
        if (obs != null) {
          obsRate = elapsed > 0 ? (obs - w0) / elapsed : null;
          if (obsRate > 0) {
            etaDays = (wT - obs) / obsRate;
            etaTs = now + etaDays * DAY;
          }
        }
        /* 计划曲线：放养 → 计划起捕，约 80 个采样点 */
        const planPts = [];
        const step = Math.max(1, Math.round(totalDays / 80));
        for (let d = 0; d <= totalDays; d += step) {
          const t = t0 + d * DAY;
          planPts.push([t, Math.round((w0 + planRate * d) * 10) / 10]);
        }
        planPts.push([t1, wT]);
        /* 实测段：近 5 分钟数据，在全周期尺度上相当于今天的位置 */
        const obsPts = obs != null
          ? this.live.map(function (r) { return [r.ts, r.avg_weight_g]; })
          : [];
        return {
          ok: true,
          elapsedDays: Math.round(elapsed),
          planToday: Math.round(planToday * 10) / 10,
          planRate: Math.round(planRate * 100) / 100,
          daysToPlan: Math.max(0, Math.round((t1 - now) / DAY)),
          obs: obs,
          obsRate: obsRate != null ? Math.round(obsRate * 100) / 100 : null,
          dev: obs != null ? Math.round((obs - planToday) * 10) / 10 : null,
          etaDays: etaDays != null ? Math.round(etaDays) : null,
          etaTs: etaTs,
          planPts: planPts,
          obsPts: obsPts,
          t1: t1, wT: wT
        };
      },
      charts: function () {
        const x = this.m;
        if (!x.ok) return [];
        const list = [{ name: '计划体重', unit: 'g', data: x.planPts }];
        if (x.obsPts && x.obsPts.length) list.push({ name: '当前实测', unit: 'g', data: x.obsPts });
        return list;
      },
      thresholds: function () {
        const x = this.m;
        if (!x.ok) return [];
        return [{ value: x.wT, label: '上市规格 ' + x.wT + ' g', color: '#166534' }];
      },
      etaText: function () {
        const x = this.m;
        if (!x.ok || x.etaTs == null) return '';
        return new Date(x.etaTs).toLocaleDateString('zh-CN');
      }
    },
    methods: {
      load: function () {
        const self = this;
        API.resolve(API.farm(), function (f) { self.farm = f; });
        API.resolve(API.fish(5), function (d) { self.live = (d && d.slice) ? d.slice() : []; });
      },
      fmtDate: function (ts) { return ts ? new Date(ts).toLocaleDateString('zh-CN') : ''; },
      /* 生长曲线（跨数月，公共 TrendChart 的横轴只格式化为时分，故在此按日期轴渲染） */
      renderChart: function () {
        const self = this;
        const x = this.m;
        this.$nextTick(function () {
          const el = self.$refs.growthCanvas;
          if (!el || !x.ok) return;
          let inst = echarts.getInstanceByDom(el);
          if (!inst) inst = echarts.init(el);
          self.gChart = inst;
          const palette = ['#2F5496', '#C2410C'];
          const series = self.charts.map(function (s, i) {
            const color = palette[i % palette.length];
            const line = {
              name: s.name + (s.unit ? '（' + s.unit + '）' : ''),
              type: 'line', showSymbol: false, sampling: 'lttb',
              lineStyle: { width: 1.8, color: color },
              itemStyle: { color: color },
              data: s.data
            };
            if (i === 0) {
              line.markLine = {
                silent: true, symbol: 'none',
                label: { formatter: '{b}', fontSize: 11, position: 'insideEndTop' },
                data: [{ yAxis: x.wT, name: '上市规格 ' + x.wT + ' g',
                         lineStyle: { color: '#166534', type: 'dashed', width: 1 } }]
              };
            }
            return line;
          });
          inst.setOption({
            grid: { left: 56, right: 20, top: 36, bottom: 32 },
            tooltip: { trigger: 'axis' },
            legend: { top: 0, textStyle: { fontSize: 12 } },
            xAxis: {
              type: 'time',
              axisLabel: {
                fontSize: 11,
                formatter: function (v) {
                  const d = new Date(v);
                  return (d.getMonth() + 1) + '/' + d.getDate();
                }
              },
              splitLine: { show: false }
            },
            yAxis: { type: 'value', scale: true, axisLabel: { fontSize: 11 },
                     splitLine: { lineStyle: { color: '#EEF2F6' } } },
            series: series
          }, true);
          if (!inst.isDisposed()) inst.resize();
        });
      }
    },
    mounted: function () {
      this.unsub = API.bind(this, this.load);
      this.load();
    },
    beforeUnmount: function () {
      if (this.unsub) { this.unsub(); this.unsub = null; }
      if (this.gChart) { this.gChart.dispose(); this.gChart = null; }
    },
    watch: {
      cages: function () { if (!this.cageId && this.cages.length) this.cageId = this.cages[0].cage_id; },
      m: function () { this.renderChart(); }
    },
    template: [
      '<div>',
      '  <page-head title="鱼类 · 生长模型与预测"',
      '    desc="由放养台账与当前观测推导生长曲线，预测达到上市规格的时间"',
      '    :sources="[\'public\',\'simulated\']" />',
      '',
      '  <div v-if="!cages.length" class="card">',
      '    <div class="muted small">暂无数据 —— 生长模型需要养殖配置。请双击 <b>启动平台.bat</b>。</div>',
      '  </div>',
      '',
      '  <template v-else-if="m.ok">',
      '  <div class="grid-stats">',
      '    <stat-card name="当前实测体重" field="avg_weight_g" unit="g" :value="m.obs" source="public" />',
      '    <stat-card name="今日计划体重" unit="g" :value="m.planToday" source="simulated" />',
      '    <stat-card name="计划偏差" unit="g" :value="m.dev" source="simulated" />',
      '    <stat-card name="计划日均增重" unit="g/天" :value="m.planRate" source="simulated" />',
      '    <stat-card name="距计划起捕" unit="天" :value="m.daysToPlan" :digits="0" source="simulated" />',
      '    <stat-card name="计划起捕日期" :value="fmtDate(m.t1)" source="simulated" />',
      '  </div>',
      '',
      '  <div class="split" style="margin-top:12px">',
      '    <div class="card">',
      '      <div class="card-title">生长曲线（放养 → 计划起捕；虚线为上市规格）</div>',
      '      <div ref="growthCanvas" class="chart" style="height:330px"></div>',
      '    </div>',
      '    <div class="card">',
      '      <div class="card-title">预测结论</div>',
      '      <div v-if="m.obs == null" class="muted small">',
      '        该网箱暂无实时体重观测，<br>无法推算实际进度（不编数据）。<br><br>',
      '        按计划：<b>{{ m.daysToPlan }}</b> 天后起捕（{{ fmtDate(m.t1) }}）。',
      '      </div>',
      '      <div v-else-if="m.etaDays != null" class="small">',
      '        <b>{{ cage.cage_name }} · {{ cage.species }}</b><hr>',
      '        已养 <b>{{ m.elapsedDays }}</b> 天，实测 <b>{{ m.obs }} g</b>；<br>',
      '        按当前实测速率（<b>{{ m.obsRate }} g/天</b>），<br>',
      '        预计再 <b>{{ m.etaDays }}</b> 天达到上市规格 {{ m.wT }} g，<br>',
      '        即 <b>{{ etaText }}</b> 前后起捕。<br><br>',
      '        计划起捕日：{{ fmtDate(m.t1) }}',
      '      </div>',
      '      <div v-else class="muted small">实测体重未增长，暂无法预测。</div>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="hint" style="margin-top:12px">',
      '    <b>模型口径</b>：计划曲线为线性 W(t)=W0+r·t，W0 取放养台账的初始规格、',
      '    r 由「目标规格 − 初始规格」÷ 计划养殖天数得出；预测速率由「当前实测体重 − 初始规格」÷ 已养天数得出。',
      '    体长体重换算 W=lw_a·L^lw_b 的参数按鱼种自动取值，出处见「鱼种档案」页。',
      '  </div>',
      '  </template>',
      '',
      '  <div v-if="cages.length" class="opbar" style="margin:12px -16px -16px; border-radius:0">',
      '    <select v-model="cageId" style="min-width:230px">',
      '      <option v-for="c in cages" :key="c.cage_id" :value="c.cage_id">',
      '        {{ c.cage_name }} · {{ c.species }}</option>',
      '    </select>',
      '    <button @click="load">重新计算</button>',
      '    <span style="flex:1"></span>',
      '    <span class="small muted">本页只做生长模型与预测；不做 FCR / 体长离散度 / 死亡数</span>',
      '  </div>',
      '</div>'
    ].join('\n')
  };

  PAGES['/fish/records'] = {
    data: function () {
      return { tick: 0, unsub: null, minutes: 60, quality: 'all', rows: [] };
    },
    computed: {
      filtered: function () {
        const q = this.quality;
        if (q === 'all') return this.rows;
        return this.rows.filter(function (r) { return (r.quality || 'good') === q; });
      },
      /* 最新在前，最多渲染 500 行（24h 窗口有上万条，全画会卡死） */
      viewRows: function () {
        const list = this.filtered.slice().reverse();
        return list.length > 500 ? list.slice(0, 500) : list;
      },
      counts: function () {
        this.tick;
        const c = { total: this.rows.length, suspect: 0, stale: 0 };
        this.rows.forEach(function (r) {
          if (r.quality === 'suspect') c.suspect += 1;
          if (r.quality === 'stale') c.stale += 1;
        });
        return c;
      }
    },
    methods: {
      load: function () {
        const self = this;
        API.resolve(API.fish(this.minutes), function (d) {
          self.rows = (d && d.slice) ? d.slice() : [];
        });
      },
      fmtTs: function (ts) {
        return ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '';
      },
      feedCn: function (v) { return CN.feedingIntensity[v] || v; },
      srcCn: function (v) { return (API.sourceText && API.sourceText[v]) || v; },
      qualCn: function (v) { return CN.quality[v] || CN.quality.good; },
      dash: function (v) {
        return (v === null || v === undefined || v === '') ? '—' : v;
      }
    },
    mounted: function () {
      this.unsub = API.bind(this, this.load);
      this.load();
    },
    beforeUnmount: function () { if (this.unsub) { this.unsub(); this.unsub = null; } },
    template: [
      '<div>',
      '  <page-head title="鱼类 · 原始数据明细"',
      '    desc="鱼类视觉识别数据的逐条原始记录，供追溯查询与核验"',
      '    :sources="[\'public\',\'simulated\']" />',
      '',
      '  <div class="card" style="margin-bottom:12px">',
      '    <div class="row" style="gap:16px;flex-wrap:wrap;align-items:center">',
      '      <time-range-picker v-model="minutes" />',
      '      <span class="row" style="gap:6px;align-items:center">',
      '        <span class="small muted">质量</span>',
      '        <select v-model="quality" style="min-width:130px">',
      '          <option value="all">全部</option>',
      '          <option value="good">良好</option>',
      '          <option value="suspect">疑似异常</option>',
      '          <option value="stale">超时未更新</option>',
      '        </select>',
      '      </span>',
      '      <button @click="load">重新拉取</button>',
      '      <span style="flex:1"></span>',
      '      <span class="small muted">共 {{ counts.total }} 条；',
      '        <span style="color:#92400E">疑似异常 {{ counts.suspect }}</span>；',
      '        <span style="color:#6B7280">超时 {{ counts.stale }}</span>',
      '      </span>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="card">',
      '    <table class="dt">',
      '      <thead><tr>',
      '        <th>时间</th><th>站点</th><th>现存尾数</th><th>密度</th>',
      '        <th>平均体长</th><th>平均体重</th><th>总生物量</th>',
      '        <th>摄食强度</th><th>来源</th><th>质量</th>',
      '      </tr></thead>',
      '      <tbody>',
      '        <tr v-for="r in viewRows" :key="r.ts">',
      '          <td class="small">{{ fmtTs(r.ts) }}</td>',
      '          <td>{{ r.site_id }}</td>',
      '          <td>{{ dash(r.fish_count) }}</td>',
      '          <td>{{ dash(r.fish_density) }}<span class="unit">尾/m³</span></td>',
      '          <td>{{ dash(r.avg_length_cm) }}<span class="unit">cm</span></td>',
      '          <td>{{ dash(r.avg_weight_g) }}<span class="unit">g</span></td>',
      '          <td>{{ dash(r.total_biomass_kg) }}<span class="unit">kg</span></td>',
      '          <td>{{ r.feeding_intensity ? feedCn(r.feeding_intensity) : "—" }}</td>',
      '          <td><span class="small">{{ srcCn(r.source) }}</span></td>',
      '          <td><span class="small">{{ qualCn(r.quality) }}</span></td>',
      '        </tr>',
      '        <tr v-if="!viewRows.length">',
      '          <td colspan="10" class="muted small">当前条件下没有记录</td>',
      '        </tr>',
      '      </tbody>',
      '    </table>',
      '    <div v-if="filtered.length > 500" class="small muted" style="margin-top:8px">',
      '      符合条件 {{ filtered.length }} 条，为保持流畅仅显示最新 500 条；可缩小时间窗。',
      '    </div>',
      '  </div>',
      '',
      '  <div class="hint" style="margin-top:12px">',
      '    <b>口径</b>：本页为鱼类视觉识别接口的原始秒级记录；设备离线时对应字段为',
      '    <code>null</code>、显示「—」，不显示上一个值。公开数据集（TFBID / DeepFish）与文献参数',
      '    的引用见「数据来源说明」与「鱼种档案」页。',
      '  </div>',
      '</div>'
    ].join('\n')
  };

  PAGES['/fish/simulator'] = {
    data: function () {
      return { tick: 0, unsub: null, state: null, busy: false, feedback: '' };
    },
    computed: {
      scenarioList: function () {
        return [
          { mode: 'normal', cn: '正常', desc: '所有指标恢复常态' },
          { mode: 'feeding_abnormal', cn: '摄食异常', desc: '摄食强度长时间无、偶发骤增' },
          { mode: 'cluster', cn: '鱼群聚集', desc: '热力图出现局部高密度红区' },
          { mode: 'density_drop', cn: '密度骤降/分散', desc: '现存尾数与密度渐降约 35%' },
          { mode: 'camera_off', cn: '摄像头离线', desc: '视觉指标全部置空、显示「—」' },
        ];
      },
      genList: function () {
        return [
          { action: 'start', cn: '启动' },
          { action: 'pause', cn: '暂停' },
          { action: 'resume', cn: '恢复' },
          { action: 'stop', cn: '停止' },
        ];
      },
      logs: function () {
        this.tick;
        return (this.state && this.state.log) || [];
      }
    },
    methods: {
      load: function () {
        const self = this;
        fishGet('/api/fish/sim').then(function (s) { self.state = s; })
          .catch(function () { self.state = null; });
      },
      send: function (body, msg) {
        const self = this;
        if (this.busy) return;
        this.busy = true;
        fishPost('/api/fish/sim', body).then(function (s) {
          self.state = s;
          self.feedback = msg;
          self.busy = false;
        }).catch(function () { self.busy = false; });
      },
      gen: function (a) {
        const cn = { start: '启动', pause: '暂停', resume: '恢复', stop: '停止' }[a];
        this.send({ action: a }, '已' + cn + '生成器');
      },
      setMode: function (sc) {
        this.send({ mode: sc.mode }, '已切换场景：' + sc.cn);
      },
      resetAll: function () {
        this.send({ action: 'resume', mode: 'normal' },
                  '已一键恢复：生成器运行 + 正常场景');
      },
      fmtTs: function (ts) {
        return ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '';
      },
      genColor: function (g) {
        return { running: '#166534', paused: '#92400E', stopped: '#991B1B' }[g] || '#6B7280';
      }
    },
    mounted: function () {
      this.unsub = API.bind(this, this.load);
      this.load();
    },
    beforeUnmount: function () { if (this.unsub) { this.unsub(); this.unsub = null; } },
    template: [
      '<div>',
      '  <page-head title="鱼类 · 仿真控制"',
      '    desc="控制鱼类数据生成器与内容场景，用于演示与联调"',
      '    :sources="[\'simulated\']" />',
      '',
      '  <div v-if="feedback" class="card" style="margin-bottom:12px; border-color:#93C5FD">',
      '    <span class="small" style="color:#1D4ED8">{{ feedback }} —— 监测 / 热力图 / 生长 / 明细四页同步变化</span>',
      '  </div>',
      '',
      '  <div class="split" style="margin-bottom:12px">',
      '    <div class="card">',
      '      <div class="card-title">当前状态</div>',
      '      <div v-if="state" class="small">',
      '        运行状态：<span class="tag" :style="{ color: genColor(state.gen_status) }">{{ state.gen_status_cn }}</span>',
      '        <br><br>',
      '        内容模式：<span class="tag tag-simulated">{{ state.sim_mode_cn }}</span>',
      '        <br><br>',
      '        <span class="muted">更新于 {{ fmtTs(state.updated_ts) }}</span>',
      '      </div>',
      '      <div v-else class="muted small">读取状态中…</div>',
      '    </div>',
      '    <div class="card">',
      '      <div class="card-title">生成器控制（运行状态）</div>',
      '      <button v-for="g in genList" :key="g.action" @click="gen(g.action)"',
      '              :disabled="busy">{{ g.cn }}</button>',
      '      <div class="hint" style="margin-top:10px">',
      '        停止：视觉指标全部置空、显示「—」；暂停：数据冻结在计划值上。',
      '      </div>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="card" style="margin-bottom:12px">',
      '    <div class="card-title">内容场景（内容模式）</div>',
      '    <div class="grid-stats">',
      '      <button v-for="s in scenarioList" :key="s.mode"',
      '              :class="{ primary: state && state.sim_mode === s.mode }"',
      '              @click="setMode(s)" :disabled="busy"',
      '              style="text-align:left; padding:10px 12px">',
      '        <b>{{ s.cn }}</b><br>',
      '        <span class="small muted">{{ s.desc }}</span>',
      '      </button>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="split">',
      '    <div class="card">',
      '      <div class="card-title">操作日志（最近 30 条）</div>',
      '      <table class="dt">',
      '        <thead><tr><th>时间</th><th>操作</th><th>对象</th></tr></thead>',
      '        <tbody>',
      '          <tr v-for="(l, i) in logs" :key="i">',
      '            <td class="small">{{ fmtTs(l.ts) }}</td>',
      '            <td>{{ l.action_cn }}</td>',
      '            <td>{{ l.target }}</td>',
      '          </tr>',
      '          <tr v-if="!logs.length"><td colspan="3" class="muted small">暂无操作记录</td></tr>',
      '        </tbody>',
      '      </table>',
      '    </div>',
      '    <div class="card">',
      '      <div class="card-title">一键恢复</div>',
      '      <div class="small">演示结束后点这里：</div>',
      '      <button class="primary" @click="resetAll" :disabled="busy">恢复运行 + 正常场景</button>',
      '      <div class="hint" style="margin-top:10px">',
      '        只影响鱼类板块的仿真数据；不写回 farm.json，不影响其他板块。',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('\n')
  };

})(window);

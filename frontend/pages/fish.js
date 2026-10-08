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
    data: function () { return { grid: [], picked: null }; },
    computed: {
      peak: function () {
        let best = { x: 0, y: 0, v: -1 }, sum = 0, n = 0;
        this.grid.forEach(function (row, y) {
          row.forEach(function (v, x) {
            if (v > best.v) best = { x: x, y: y, v: v };
            sum += v; n++;
          });
        });
        return { best: best, avg: n ? +(sum / n).toFixed(1) : 0 };
      }
    },
    methods: {
      load: function () {
        const self = this;
        API.resolve(API.heatGrid(), function (g) { self.grid = g; });
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
      '  <div style="margin-top:12px">',
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

})(window);

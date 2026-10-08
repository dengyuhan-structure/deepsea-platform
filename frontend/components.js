/* ============================================================
   components.js —— 通用组件（前端骨架规范 第三节）
   ============================================================
   规范要求「我做，你不用重复做」。每个组件把 放什么字段 / 有哪些状态 /
   怎么交互 三件事写全 —— 状态没写全就会出现"数据断了页面白屏"。

   建立：2026-10-05
   ============================================================ */
(function (global) {
  'use strict';
  const C = {};

  /* ============================================================
     枚举中文标签（通用规范 第五节）
     ============================================================
     为什么集中放一处：枚举的中文说法在规范里定死了，界面**必须**显示中文。
     每页各写一份映射，迟早有人写歪（实测就漏了 5 处：设备状态、设备类型、
     预警类型、预警状态、处置状态直接把 tension / standby / pending 甩到界面上，
     而旁边的「预警等级」却显示中文 —— 自相矛盾）。

     用法：模板里写 {{ CN.deviceState(d.device_state) }}
     （已在 app.js 挂到 globalProperties，模板才够得着）
     ============================================================ */
  global.CN = {
    deviceState: function (v) {
      return { online: '在线', offline: '离线', running: '运行中', standby: '待机', fault: '故障' }[v] || v;
    },
    deviceType: function (v) {
      return { feeder: '投喂设备', light: '补光灯具', sensor: '传感器' }[v] || v;
    },
    commandType: function (v) { return { feed: '投喂', light: '补光' }[v] || v; },
    commandStatus: function (v) {
      return { created: '已创建', sent: '已发出', acknowledged: '已收到回执', success: '成功',
               timeout: '超时', retrying: '重试中', failed: '失败', escalated: '升级报警' }[v] || v;
    },
    taskStatus: function (v) {
      return { pending: '待执行', running: '正在执行', done: '已完成',
               paused: '已暂停', cancelled: '已取消', failed: '任务失败' }[v] || v;
    },
    riskLevel: function (v) {
      return { blue: '蓝色', yellow: '黄色', orange: '橙色', red: '红色' }[v] || v;
    },
    alarmType: function (v) {
      return { tension: '锚泊张力', tilt: '网箱倾斜', net_damage: '网衣破损',
               deformation: '结构形变', low_battery: '低电量', power_supply: '供电异常' }[v] || v;
    },
    alarmStatus: function (v) {
      return { active: '活跃', acknowledged: '已确认', recovered: '已恢复' }[v] || v;
    },
    handleStatus: function (v) {
      return { pending: '待处置', handling: '处置中', handled: '已处置', failed: '处置失败' }[v] || v;
    },
    confirmStatus: function (v) { return { unconfirmed: '未确认', confirmed: '已确认' }[v] || v; },
    quality: function (v) {
      return { good: '良好', stale: '超时未更新', suspect: '疑似异常' }[v] || v;
    },
    triggerBy: function (v) { return { auto: '自动', manual: '手动' }[v] || v; },
    feedingIntensity: function (v) {
      return { none: '无', weak: '弱', mid: '中', strong: '强' }[v] || v;
    }
  };

  /* ---------- 让 ECharts 跟着容器尺寸走 ----------
     ⚠️ 没有这个，图表会冻在「首次渲染那一刻」的宽度上。
        实测：视口 1920 时卡片宽 1688px，而图还是 1018px ——
        在答辩用的大屏上右边会空出一大片，很难看。
        ECharts 不会自己监听尺寸变化，必须显式 resize。

     用 ResizeObserver 监听容器（窗口变化、侧栏伸缩都能覆盖），
     再挂一个 window.resize 兜底（老浏览器没有 ResizeObserver）。 */
  function attachAutoResize(vm) {
    const el = vm.$refs.canvas;
    if (!el) return null;

    let raf = 0;
    const doResize = function () {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () {
        raf = 0;
        if (vm.alive && vm.chart && !vm.chart.isDisposed()) vm.chart.resize();
      });
    };

    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(doResize);
      ro.observe(el);
    }
    window.addEventListener('resize', doResize);

    return function () {
      if (raf) cancelAnimationFrame(raf);
      if (ro) { ro.disconnect(); ro = null; }
      window.removeEventListener('resize', doResize);
    };
  }

  /* ---------- 3.5 数据来源标签 SourceTag ---------- */
  C.SourceTag = {
    props: { source: { type: String, default: 'simulated' }, multi: { type: Array, default: null } },
    computed: {
      items: function () {
        const list = this.multi && this.multi.length ? this.multi : [this.source];
        return list.map(function (s) { return { key: s, text: API.sourceText[s] || s }; });
      }
    },
    template:
      '<span class="tagline">' +
      '  <span v-for="it in items" :key="it.key" class="tag" :class="\'tag-\' + it.key">{{ it.text }}</span>' +
      '</span>'
  };

  /* ---------- 3.1 数值卡 StatCard ----------
     状态：① 正常 ② 缺失（— + 设备离线）③ 可疑（黄）④ 过期（灰 + 最后更新）
     digits：小数位。默认 1 位 —— 通用规范 第十节规定
             温度/溶氧/盐度/pH/浪高/风速/张力/倾角/重量 都是 1 位小数。
             计数类（尾数、条数）传 :digits="0"；字符串值不受影响。 */
  C.StatCard = {
    props: {
      name: String, value: [Number, String], unit: { type: String, default: '' },
      source: { type: String, default: 'simulated' },
      quality: { type: String, default: 'good' },   // good | stale | suspect
      ts: { type: Number, default: 0 },
      field: { type: String, default: '' },         // 完整字段名，悬停显示
      digits: { type: Number, default: 1 }          // null = 原样显示
    },
    computed: {
      missing: function () { return this.value === null || this.value === undefined || this.value === ''; },
      cls: function () {
        if (this.missing) return 'is-missing';
        if (this.quality === 'stale') return 'is-stale';
        if (this.quality === 'suspect') return 'is-suspect';
        return '';
      },
      shown: function () {
        if (this.missing) return '—';
        if (typeof this.value !== 'number' || this.digits === null || this.digits === undefined) return this.value;
        return this.value.toFixed(this.digits);
      },
      tip: function () {
        const t = this.ts ? new Date(this.ts).toLocaleTimeString('zh-CN', { hour12: false }) : '—';
        return '字段：' + (this.field || '（未标注）') + '\n更新时间：' + t +
               '\n数据来源：' + (API.sourceText[this.source] || this.source);
      },
      foot: function () {
        if (this.missing) return '设备离线';
        if (this.quality === 'stale') return '最后更新 ' + new Date(this.ts).toLocaleTimeString('zh-CN', { hour12: false });
        if (this.quality === 'suspect') return '疑似异常';
        return '';
      }
    },
    template:
      '<div class="stat" :class="cls" :title="tip">' +
      '  <div class="name"><span>{{ name }}</span><source-tag :source="source" /></div>' +
      '  <div class="val"><span>{{ shown }}</span><span class="unit" v-if="!missing && unit">{{ unit }}</span></div>' +
      '  <div class="foot">{{ foot }}</div>' +
      '</div>'
  };

  /* ---------- 3.2 时序曲线卡 TimeSeriesChart ----------
     状态：① 正常 ② 无数据（"暂无数据"占位，不白屏）③ 单点（散点） */
  C.TrendChart = {
    props: {
      title: { type: String, default: '' },
      series: { type: Array, default: function () { return []; } }, // [{name, unit, data:[[ts,val]]}]
      small: { type: Boolean, default: false },
      thresholds: { type: Array, default: function () { return []; } } // [{value,label,color}]
    },
    data: function () { return { chart: null, alive: true }; },
    computed: { empty: function () { return !this.series.length || !this.series[0].data.length; } },
    mounted: function () {
      this.alive = true;
      this.render();
      this._detach = attachAutoResize(this);
    },
    beforeUnmount: function () {
      /* 卸载时把图表彻底收干净。
         曾经的做法是用 v-show 控制画布显隐 —— 容器在 display:none 下宽高为 0，
         ECharts 会以 0×0 初始化，之后在 Vue 触发的重绘里抛
         "Cannot read properties of undefined (reading 'type')"。
         现在画布始终渲染（不显隐），空数据用 graphic 文字表达。 */
      this.alive = false;
      if (this._detach) { this._detach(); this._detach = null; }
      if (this.chart) { this.chart.dispose(); this.chart = null; }
    },
    watch: {
      /* flush: 'post' —— 等 DOM 更新完再渲染 */
      series: { handler: function () { this.render(); }, deep: true, flush: 'post' }
    },
    methods: {
      render: function () {
        const el = this.$refs.canvas;
        if (!el || !this.alive) return;

        /* 同一 DOM 上只允许一个实例；已存在就先复用，避免重复 init */
        let inst = echarts.getInstanceByDom(el);
        if (!inst) inst = echarts.init(el);
        this.chart = inst;

        if (this.empty) {
          inst.clear();
          inst.setOption({
            graphic: {
              type: 'text', left: 'center', top: 'middle',
              style: { text: '暂无数据', fill: '#6B7280', fontSize: 14 }
            },
            xAxis: { show: false }, yAxis: { show: false }, series: []
          }, true);
          return;
        }

        const palette = ['#2F5496', '#C2410C', '#166534', '#92400E', '#6B7280', '#991B1B'];
        /* 双 Y 轴：序列上标 axis: 1 就走右轴。
           为什么必须支持：把「锚泊张力（0–100%）」和「俯仰角（0–3°）」画在同一个 Y 轴上，
           俯仰角会被压成贴底的一条直线，等于没画。骨架规范模板 A 也写明可用双 Y 轴。 */
        const needAxis2 = this.series.some(function (s) { return s.axis === 1; });

        const series = this.series.map(function (s, i) {
          const color = palette[i % palette.length];
          return {
            name: s.name + (s.unit ? '（' + s.unit + '）' : ''),
            type: 'line',
            yAxisIndex: (needAxis2 && s.axis === 1) ? 1 : 0,
            showSymbol: false,
            smooth: true,
            sampling: 'lttb',
            lineStyle: { width: 1.6, color: color },
            itemStyle: { color: color },
            data: s.data
          };
        });

        /* 阈值参考线：用 markLine 挂在第一条曲线上。
           ⚠️ 阈值线不是数据序列，不许 concat 成假 series 塞进去。 */
        if (this.thresholds.length && series.length) {
          series[0].markLine = {
            silent: true,
            symbol: 'none',
            label: { formatter: '{b}', fontSize: 11, position: 'insideEndTop' },
            data: this.thresholds.map(function (t) {
              return {
                yAxis: t.value,
                name: t.label,
                lineStyle: { color: t.color || '#991B1B', type: 'dashed', width: 1 }
              };
            })
          };
        }

        inst.setOption({
          grid: { left: 56, right: 20, top: 36, bottom: 32 },
          tooltip: { trigger: 'axis' },
          legend: { top: 0, textStyle: { fontSize: 12 } },
          xAxis: {
            type: 'time',
            axisLabel: {
              fontSize: 11,
              formatter: function (v) {
                return new Date(v).toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 8);
              }
            },
            splitLine: { show: false }
          },
          yAxis: needAxis2
            ? [
                { type: 'value', scale: true, axisLabel: { fontSize: 11 },
                  splitLine: { lineStyle: { color: '#EEF2F6' } } },
                { type: 'value', scale: true, position: 'right', axisLabel: { fontSize: 11 },
                  splitLine: { show: false } }
              ]
            : { type: 'value', scale: true, axisLabel: { fontSize: 11 },
                splitLine: { lineStyle: { color: '#EEF2F6' } } },
          series: series
        }, true);

        const self = this;
        this.$nextTick(function () {
          if (self.alive && self.chart && !self.chart.isDisposed()) self.chart.resize();
        });
      }
    },
    template:
      '<div class="card">' +
      '  <div class="card-title" v-if="title">{{ title }}</div>' +
      '  <div ref="canvas" class="chart" :class="{ \'chart-sm\': small }"></div>' +
      '</div>'
  };

  /* ---------- 3.3 事件列表 EventList ---------- */
  C.EventList = {
    props: { items: { type: Array, default: function () { return []; } }, emptyText: { type: String, default: '暂无事件' } },
    methods: {
      lvClass: function (lv) { return 'bg-' + (lv || 'blue'); },
      time: function (ts) { return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }); },
      click: function (it) { this.$emit('pick', it); }
    },
    template:
      '<div class="events">' +
      '  <div v-if="!items.length" class="empty">{{ emptyText }}</div>' +
      '  <div v-for="it in items" :key="it.id" class="row-item" @click="click(it)">' +
      '    <span class="t">{{ time(it.ts) }}</span>' +
      '    <span class="dot" :class="lvClass(it.level)"></span>' +
      '    <span class="d">{{ it.text }}</span>' +
      '  </div>' +
      '</div>'
  };

  /* ---------- 3.4 时间窗切换器 TimeRangePicker ---------- */
  C.TimeRangePicker = {
    props: { modelValue: { type: Number, default: 60 } },
    emits: ['update:modelValue'],
    data: function () { return { opts: [['当前', 1], ['1 小时', 60], ['6 小时', 360], ['24 小时', 1440]] }; },
    template:
      '<span class="row" style="gap:6px;align-items:center">' +
      '  <span class="small muted">时间窗</span>' +
      '  <button v-for="o in opts" :key="o[1]" :class="{ primary: modelValue === o[1] }"' +
      '          @click="$emit(\'update:modelValue\', o[1])">{{ o[0] }}</button>' +
      '</span>'
  };

  /* ---------- 3.7 指令状态机进度条 CommandFlow（答辩重点） ---------- */
  C.CommandFlow = {
    props: { status: { type: String, default: 'created' } },
    computed: {
      steps: function () {
        const order = ['created', 'sent', 'acknowledged', 'success'];
        const bad = ['timeout', 'retrying', 'failed', 'escalated'];
        const cn = { created: '已创建', sent: '已发出', acknowledged: '已收到回执', success: '成功',
                     timeout: '超时', retrying: '重试中', failed: '失败', escalated: '升级报警' };
        const cur = this.status;
        if (bad.indexOf(cur) >= 0) {
          return bad.map(function (s) {
            const i = bad.indexOf(s), j = bad.indexOf(cur);
            return { key: s, text: cn[s], cls: i < j ? 'done' : (i === j ? 'bad' : '') };
          });
        }
        return order.map(function (s) {
          const i = order.indexOf(s), j = order.indexOf(cur);
          return { key: s, text: cn[s], cls: i < j ? 'done' : (i === j ? 'now' : '') };
        });
      }
    },
    template:
      '<div class="flow">' +
      '  <template v-for="(s, i) in steps" :key="s.key">' +
      '    <span class="arrow" v-if="i">→</span>' +
      '    <span class="step" :class="s.cls">{{ s.text }}</span>' +
      '  </template>' +
      '</div>'
  };

  /* ---------- 网格热力图 HeatGrid（鱼群密度 / 网衣拉力分布） ---------- */
  C.HeatGrid = {
    props: {
      title: { type: String, default: '' },
      grid: { type: Array, default: function () { return []; } },   // [[v,...],...] 行优先
      unit: { type: String, default: '' },
      height: { type: Number, default: 420 }
    },
    data: function () { return { chart: null, alive: true }; },
    mounted: function () {
      this.alive = true;
      this.render();
      this._detach = attachAutoResize(this);
    },
    beforeUnmount: function () {
      this.alive = false;
      if (this._detach) { this._detach(); this._detach = null; }
      if (this.chart) { this.chart.dispose(); this.chart = null; }
    },
    watch: { grid: { handler: function () { this.render(); }, deep: true, flush: 'post' } },
    methods: {
      render: function () {
        const el = this.$refs.canvas;
        if (!el || !this.alive || !this.grid.length) return;
        let inst = echarts.getInstanceByDom(el);
        if (!inst) inst = echarts.init(el);
        this.chart = inst;

        const n = this.grid[0].length, m = this.grid.length, unit = this.unit;
        const data = [];
        let max = 0;
        for (let y = 0; y < m; y++) {
          for (let x = 0; x < n; x++) {
            const v = this.grid[y][x];
            data.push([x, y, v]);
            if (v > max) max = v;
          }
        }
        const cat = function (p, i) { return p + (i + 1); };
        const xs = [], ys = [];
        for (let i = 0; i < n; i++) xs.push(cat('X', i));
        for (let i = 0; i < m; i++) ys.push(cat('Y', i));

        inst.setOption({
          tooltip: {
            formatter: function (p) {
              return '网格 ' + xs[p.value[0]] + ' / ' + ys[p.value[1]] +
                     '<br>密度 <b>' + p.value[2] + '</b> ' + unit;
            }
          },
          grid: { left: 46, right: 20, top: 16, bottom: 62 },
          xAxis: { type: 'category', data: xs, splitArea: { show: true }, axisLabel: { fontSize: 11 } },
          yAxis: { type: 'category', data: ys, splitArea: { show: true }, axisLabel: { fontSize: 11 } },
          visualMap: {
            min: 0, max: max, calculable: true, orient: 'horizontal',
            left: 'center', bottom: 6, itemWidth: 12, itemHeight: 100,
            text: ['密', '疏'], textStyle: { fontSize: 11 },
            /* 配色沿用状态色阶语义，不用彩虹色（项目通用规范 第六节） */
            inRange: { color: ['#EFF6FF', '#BFDBFE', '#60A5FA', '#2F5496', '#C2410C'] }
          },
          series: [{
            type: 'heatmap', data: data,
            label: { show: false },
            emphasis: { itemStyle: { borderColor: '#111827', borderWidth: 1 } }
          }]
        }, true);

        const self = this;
        this.$nextTick(function () {
          if (self.alive && self.chart && !self.chart.isDisposed()) self.chart.resize();
        });
      }
    },
    template:
      '<div class="card">' +
      '  <div class="card-title" v-if="title">{{ title }}</div>' +
      '  <div ref="canvas" class="chart" :style="{ height: height + \'px\' }"></div>' +
      '</div>'
  };

  /* ---------- 页头：标题 + 来源标签（纪律 4：每页都要有） ---------- */
  C.PageHead = {
    props: { title: String, desc: { type: String, default: '' }, sources: { type: Array, default: null }, source: { type: String, default: 'simulated' } },
    template:
      '<div class="row" style="justify-content:space-between;align-items:flex-end;margin-bottom:12px">' +
      '  <div>' +
      '    <div style="font-size:18px;font-weight:700">{{ title }}</div>' +
      '    <div class="small muted" v-if="desc" v-html="desc"></div>' +
      '  </div>' +
      '  <source-tag :source="source" :multi="sources" />' +
      '</div>'
  };

  /* ============================================================
     阈值依据提示：数值旁边一个灰色问号，悬停显示解释与出处
     ============================================================
     为什么不用纯 CSS 的 :hover 弹层：
       阈值都放在表格里，而表格容器是 overflow:auto 的 ——
       CSS 绝对定位的弹层会被容器**裁掉**，鼠标一移过去就没了。
     所以弹层用 position:fixed（teleport 到 body）由 JS 按问号位置定位，能逃出任何 overflow。

     为什么必须做这个：
       任务书要求逐项说明「阈值从哪来（标准？文献？自己设的？）」。
       以前页面上只有一行小字「经验阈值，未经现场标定」，
       答辩时评委问「凭什么定 3°」答不出细节。现在悬停就能看到每一条的依据。
     ============================================================ */
  C.HelpDot = {
    name: 'help-dot',
    props: {
      /* { level, text, source, url } —— level 取值见下面 lvStyle */
      info: { type: Object, default: null },
      label: { type: String, default: '阈值依据' }
    },
    data: function () { return { open: false, top: 0, left: 0, placement: 'top' }; },
    beforeUnmount: function () { if (this._t) clearTimeout(this._t); },
    computed: {
      lv: function () { return (this.info && this.info.level) || '未标注'; },
      /* 证据强度配色：越硬越绿，找不到越红 —— 一眼看出哪几项底气不足 */
      lvStyle: function () {
        const m = {
          '直接支持': { bg: '#F0FDF4', br: '#86EFAC', fg: '#166534' },
          '间接支持': { bg: '#EFF6FF', br: '#BFDBFE', fg: '#1D4ED8' },
          '仅类比':   { bg: '#FFFBEB', br: '#FDE68A', fg: '#92400E' },
          '没找到':   { bg: '#FEF2F2', br: '#FECACA', fg: '#991B1B' }
        };
        return m[this.lv] || { bg: '#F3F4F6', br: '#E5E7EB', fg: '#6B7280' };
      }
    },
    methods: {
      show: function (e) {
        if (this._t) { clearTimeout(this._t); this._t = null; }
        if (!this.info) return;
        const r = e.currentTarget.getBoundingClientRect();
        const W = 380;
        this.left = Math.max(8, Math.min(r.left - W / 2 + 8, window.innerWidth - W - 8));
        this.top = r.top - 10;
        this.placement = r.top < 280 ? 'bottom' : 'top';
        this.open = true;
      },
      /* 延迟关闭：弹层被 teleport 到 body，不在 .hd-wrap 里，
         鼠标从问号移到弹层上会触发 mouseleave。给 260ms 宽限，
         期间移到弹层上就被 cancelHide 取消 —— 否则里面的链接根本点不到。 */
      hide: function () {
        const self = this;
        if (this._t) clearTimeout(this._t);
        this._t = setTimeout(function () { self.open = false; self._t = null; }, 260);
      },
      cancelHide: function () {
        if (this._t) { clearTimeout(this._t); this._t = null; }
      }
    },
    template: [
      '<span class="hd-wrap" @mouseenter="show" @mouseleave="hide" @focusin="show" @focusout="hide" tabindex="0">',
      '  <span class="hd-dot" :class="{ \'hd-open\': open }">?</span>',
      '  <teleport to="body">',
      '    <div v-if="open" class="hd-pop"',
      '         :class="placement === \'top\' ? \'hd-pop-top\' : \'hd-pop-bottom\'"',
      '         :style="{ top: top + \'px\', left: left + \'px\' }"',
      '         @mouseenter="cancelHide" @mouseleave="hide">',
      '      <div class="hd-head">',
      '        <span class="hd-badge"',
      '              :style="{ background: lvStyle.bg, borderColor: lvStyle.br, color: lvStyle.fg }">',
      '          证据强度：{{ lv }}',
      '        </span>',
      '        <span class="hd-title">{{ label }}</span>',
      '      </div>',
      '      <div v-if="info.text" class="hd-text">{{ info.text }}</div>',
      '      <div v-if="info.source" class="hd-src"><b>出处</b>：{{ info.source }}</div>',
      '      <div v-if="info.url" class="hd-src">',
      '        <a :href="info.url" target="_blank" rel="noopener">{{ info.url }} ↗</a>',
      '      </div>',
      '      <div v-if="!info.text && !info.source" class="hd-text muted">',
      '        这一项还没有找到依据 —— 页面上标注为「经验阈值，未经现场标定」。',
      '      </div>',
      '    </div>',
      '  </teleport>',
      '</span>'
    ].join('\n')
  };

  global.C = C;
})(window);

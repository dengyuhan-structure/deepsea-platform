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
   重构：2026-10-07（两页布局 = 站点切换 → 数值卡 → 时序 → 事件 → 异常界定指标 →
                   原始数据 → 调试面板；站点按站点独立，互不影响）
   ============================================================ */
(function (global) {
  'use strict';
  /* 自己初始化，不依赖文件加载顺序 —— 这样谁先谁后都不会出错 */
  const PAGES = global.PAGES || (global.PAGES = {});

  /* ============================================================
     共享纯函数（挂 global.__ENV_HELPERS__ 供页面与测试使用）
     ============================================================ */
  const pad = function (n) { return String(n).padStart(2, '0'); };

  /* 时间显示统一为「年/月/日 时:分:秒」，不带字母（用户要求：不可字母和汉字混用） */
  function fmtTs(ts) {
    if (ts == null) return '—';
    const d = new Date(ts);
    return d.getFullYear() + '年' + pad(d.getMonth() + 1) + '月' + pad(d.getDate()) + '日 ' +
           pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  /* 图表坐标轴短标签：MM-DD HH:mm（跨天也能看清日期） */
  function fmtShort(ts) {
    const d = new Date(ts);
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
           pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /* CSV 单元格转义：含逗号 / 引号 / 换行时加引号并转义内部引号 */
  function csvCell(v) {
    const s = (v == null) ? '' : String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /* 生成 CSV 文本（带 UTF-8 BOM，Excel 打开不乱码） */
  function toCsv(headers, rows) {
    return '\ufeff' + headers.map(csvCell).join(',') + '\n' +
           rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n');
  }

  /* 两个时间戳之间的分钟数（至少 1 分钟） */
  function minutesBetween(aTs, bTs) {
    return Math.max(1, Math.round(Math.abs((bTs || 0) - (aTs || 0)) / 60000));
  }

  /* 每个站点的独立状态（站点独立性：对一个站点的操作不影响其他站点）
     heatSince：水温骤升的触发时刻（问题一：触发后「接下来实时生成」的点才异常） */
  function defaultPer() {
    return { minutes: 60, paused: false, storm: false, heat: false, offline: false,
             stormType: 'all', heatSince: null };
  }
  function buildPer(sites) {
    const per = {};
    (sites || []).forEach(function (s) { per[s.site_id] = defaultPer(); });
    return per;
  }

  /* 已暂停站点聚合文本：site_01、site_03（共2个） */
  function pausedText(per) {
    const ids = Object.keys(per || {}).filter(function (k) { return per[k].paused; });
    return ids.length ? ids.join('、') + '（共' + ids.length + '个）' : '';
  }

  /* 站点是否应该继续取数/刷新：已暂停 → 不刷新（冻结）；未建状态默认视为运行 */
  function shouldRefresh(per, siteId) {
    const p = per && per[siteId];
    return !p || !p.paused;
  }

  /* datetime-local 输入框的本地时间格式 "YYYY-MM-DDTHH:mm"（显示为 年/月/日 时:分） */
  function localInput(d) {
    const p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
           'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  global.__ENV_HELPERS__ = {
    fmtTs: fmtTs, fmtShort: fmtShort, toCsv: toCsv, csvCell: csvCell,
    minutesBetween: minutesBetween, defaultPer: defaultPer,
    buildPer: buildPer, pausedText: pausedText, shouldRefresh: shouldRefresh,
    localInput: localInput
  };

  /* ============================================================
     模拟养殖站点：流式仿真数据生成器（问题一 ~ 问题三）
     ============================================================
     为什么不用 API.env（mock / server 整窗重生成）？
       整窗重生成 = 每次 load 都把「历史窗口」重新算一遍：
       触发大风大浪 / 水温骤升时，已生成的数据会被整体改写为异常，
       恢复后又全部变回正常 —— 事件记录也随之消失。
       用户要求：
         问题一：触发异常只影响「接下来实时生成」的点，已生成的点不变；
         问题二：异常期间生成的点永久保留（恢复后不重写），事件记录不消除；
         问题三：正常状态下也偶发「较异常」数据并计入事件。
       所以这里把生成改成「追加式」：每个点生成一次后永不再改；
       站点序列缓存在全局 __ENV_SERIES__（跨页面切换保留，配合问题六），
       生成器按真实时间轴逐步追加新点，新点的值由「当时」的仿真控制状态决定。
     数值口径与 mock.js envSeries 一致（同基线 / 同噪声幅度），仅把「整窗」换成「追加」。
     ============================================================ */
  (function (global) {
    'use strict';
    const STEP_FAST = 5 * 1000;       /* 快变量 5 秒一条（与 mock.js 同口径） */
    const STEP_SLOW = 30 * 1000;      /* 慢变量 30 秒一条 */
    const MAX_FAST = 50000;           /* ≈ 2.9 天 @5s（滚动上限，超出的最旧点移出，事件以窗口内为准） */
    const MAX_SLOW = 20000;
    /* 问题三：正常状态偶发异常概率 —— 每 140 个点 ≈ 11.7 分钟一次「较异常」（蓝/黄级） */
    const PROB_ABN = 1 / 140;
    const PROB_ABN_SLOW = 1 / 500;    /* 慢变量偶发（盐度跳变），≈ 每 4 小时一次 */
    const SERIES = global.__ENV_SERIES__ || (global.__ENV_SERIES__ = {});
    const rnd = function () { return global.Math.random(); };
    const rndn = function (mean, sd) { return mean + (rnd() + rnd() + rnd() - 1.5) * 2 * sd; };

    function genFast(siteId, ts, per) {
      const h = new Date(ts).getHours() + new Date(ts).getMinutes() / 60;
      const diurnal = Math.sin((h - 6) / 24 * 2 * Math.PI);      /* 昼夜变化 */
      const storm = !!per.storm, heat = !!per.heat, offline = !!per.offline;
      const stormType = per.stormType || 'all';
      /* 风暴细化（问题五）：all=风浪都异常；wind=仅风速；wave=仅浪高 */
      const waveStorm = storm && (stormType === 'all' || stormType === 'wave');
      const windStorm = storm && (stormType === 'all' || stormType === 'wind');
      /* 问题三：正常状态下偶发一次「较异常」（蓝/黄级，非灾难），并计入事件 */
      let abn = null;
      if (!storm && !heat && !offline && rnd() < PROB_ABN) {
        const k = Math.floor(rnd() * 3);
        abn = k === 0 ? 'wave' : (k === 1 ? 'wind' : 'water');
      }
      const baseWater = 18.6 + diurnal * 1.8;
      const wave = offline ? null : +(
        abn === 'wave' ? rndn(3.2, .4)       /* 蓝 2.5~4.0 / 黄 4.0+ 边缘 */
        : waveStorm ? rndn(4.6, .55)        /* 大风大浪：≥4.0 黄色警报级 */
        : rndn(1.4, .25)).toFixed(1);
      const wind = offline ? null : +(
        abn === 'wind' ? rndn(17.6, .5)     /* ≥17.2 → 8 级大风 */
        : windStorm ? rndn(19, 2.5)
        : rndn(8.3, 1.2)).toFixed(1);
      /* 问题一：触发水温骤升 → 接下来生成的点直接抬到目标 30.5℃（≥28.0 上限，事件可记录）；
         恢复正常 → 新点回昼夜基线。已生成的点永不被改写。 */
      const water = offline ? null : +(
        heat ? rndn(30.5, .3)
        : baseWater + (abn === 'water' ? rndn(2.1, .2) : 0) + rndn(0, .15)).toFixed(1);
      const air = offline ? null : +(
        22.4 + diurnal * 3.2 + rndn(0, .4) +
        (water == null ? 0 : (water - baseWater) * .6)).toFixed(1);
      const light = offline ? null : +Math.max(0,
        (storm ? 4000 : 12000) * Math.max(0, Math.sin((h - 6) / 12 * Math.PI)) + rndn(0, 400)).toFixed(0);
      const current = offline ? null : +rndn(storm ? 1.4 : .6, .12).toFixed(1);
      const doxy = offline ? null : +(
        9.2 - (water == null ? 0 : water - 18.6) * .45 + rndn(0, .12)).toFixed(1);
      const quality = offline ? 'stale' : (abn || storm || heat ? 'suspect' : 'good');
      return { ts: ts, site_id: siteId, source: 'simulated', quality: quality,
               wave_height: wave, wind_speed: wind, current_speed: current,
               air_temp: air, water_temp: water,
               dissolved_oxygen: doxy, light_intensity: light };
    }

    function genSlow(siteId, ts, per) {
      const offline = !!per.offline;
      const abn = !offline && rnd() < PROB_ABN_SLOW;
      return { ts: ts, site_id: siteId,
               quality: offline ? 'stale' : (abn ? 'suspect' : 'good'),
               salinity: offline ? null : +(abn ? rndn(33.0, .25) : rndn(32.1, .15)).toFixed(1),
               ph: offline ? null : +(abn ? rndn(8.5, .08) : rndn(8.1, .06)).toFixed(1) };
    }

    /* 首填：站点序列为空时，从当前时刻回填「minutes 分钟」窗口（正常值 + 偶发异常）。
       pageKey：'sea' / 'water' —— 序列按「站点 + 页面」双键隔离（问题一：两页仿真控制互不影响），
       海况页只生成快变量，水质页生成快+慢变量。 */
    function ensure(siteId, minutes, per, pageKey) {
      const key = siteId + '::' + (pageKey || 'sea');
      let st = SERIES[key];
      if (!st) st = SERIES[key] = { fast: [], slow: [] };
      if (st.fast.length) return st;
      const now = Math.floor(Date.now() / STEP_FAST) * STEP_FAST;
      const winF = Math.max(2, Math.round((minutes || 60) * 60 * 1000 / STEP_FAST));
      let ts = now - (winF - 1) * STEP_FAST;
      while (ts <= now) { st.fast.push(genFast(siteId, ts, per)); ts += STEP_FAST; }
      if (pageKey !== 'sea') {
        const winS = Math.max(2, Math.round((minutes || 60) * 60 * 1000 / STEP_SLOW));
        let sts = now - (winS - 1) * STEP_SLOW;
        while (sts <= now) { st.slow.push(genSlow(siteId, sts, per)); sts += STEP_SLOW; }
      }
      return st;
    }

    /* 追加：把序列推进到 nowTs。只生成「新」的点，已生成的点永远不改。
       大间隔（暂停恢复 / 长时间挂起）→ 跳过空洞，从当前时刻前一步继续，不补造中间数据。
       两页序列独立推进：海况页的风暴/暂停只追加自己的序列，水质页按自己的控制状态追加。 */
    function appendTo(siteId, nowTs, per, minutes, pageKey) {
      const st = ensure(siteId, minutes, per, pageKey);
      let last = st.fast[st.fast.length - 1];
      let ts = last.ts + STEP_FAST;
      if (nowTs - last.ts > 3 * STEP_FAST) ts = Math.floor((nowTs - STEP_FAST) / STEP_FAST) * STEP_FAST;
      while (ts <= nowTs) { st.fast.push(genFast(siteId, ts, per)); ts += STEP_FAST; }
      if (pageKey !== 'sea' && st.slow.length) {
        let sl = st.slow[st.slow.length - 1];
        let sts = sl.ts + STEP_SLOW;
        if (nowTs - sl.ts > 3 * STEP_SLOW) sts = Math.floor((nowTs - STEP_SLOW) / STEP_SLOW) * STEP_SLOW;
        while (sts <= nowTs) { st.slow.push(genSlow(siteId, sts, per)); sts += STEP_SLOW; }
      }
      if (st.fast.length > MAX_FAST) st.fast.splice(0, st.fast.length - MAX_FAST);
      if (st.slow.length > MAX_SLOW) st.slow.splice(0, st.slow.length - MAX_SLOW);
      return st;
    }

    /* 按分钟窗口截取展示序列（页面图表 / 原始数据区用；存储保留全量） */
    function windowSlice(st, minutes) {
      const winF = Math.max(2, Math.round((minutes || 60) * 60 * 1000 / STEP_FAST));
      const winS = Math.max(2, Math.round((minutes || 60) * 60 * 1000 / STEP_SLOW));
      return { fast: st.fast.slice(-winF), slow: st.slow.slice(-winS) };
    }

    global.__ENV_GEN__ = { STEP_FAST: STEP_FAST, STEP_SLOW: STEP_SLOW,
                           PROB_ABN: PROB_ABN,
                           series: SERIES,
                           ensure: ensure, appendTo: appendTo, windowSlice: windowSlice,
                           genFast: genFast, genSlow: genSlow };
  })(window);

  /* ============================================================
     海况页 /env/sea
     布局（自上而下）：
       站点切换（顶部） → 数据来源（NDBC 直连） → 数值卡 → 时序 + 事件 →
       异常界定指标 → 原始数据 → 调试面板（仿真控制）→ 底部操作条
     ============================================================ */
  PAGES['/env/sea'] = {
    data: function () {
      /* 问题六：站点选择存全局 __ENV_SESSION__，跨页切换后保留；
         仿真控制状态（per）两页各自独立（问题一：海况↔水质互不影响） */
      const S = global.__ENV_SESSION__ || (global.__ENV_SESSION__ = { seaPer: null, waterPer: null, site: 'site_01' });
      return { pageKey: 'sea', site: S.site || 'site_01', picked: null, series: null,
               tick: 0, unsub: null, timer: null,
               refreshing: false, refreshMsg: '', refreshOk: null,
               per: S.seaPer, loadSeq: 0, chart: null,
               evOpen: false,
               /* 问题二：历史区间（真实站点公开数据可自定义时间查看更长远历史） */
               rangeMode: false, rangeSeries: null, rangeMsg: '',
               rangeStart: '', rangeEnd: '', ranges: {} };
    },
    computed: {
      fast: function () { return this.series ? this.series.fast : []; },
      /* 问题二：事件数据源 —— 养殖站点用「全量生成序列」（异常记录不因窗口滑动而消失）；
         观测站点（公开数据）用后端返回窗口。读 this.fast 建立依赖，fast 更新时重算。 */
      allFast: function () {
        this.fast.length;
        const G = global.__ENV_GEN__;
        if (!this.isObs) {
          const st = G && G.series && G.series[this.site + '::' + (this.pageKey || 'sea')];
          if (st && st.fast && st.fast.length) return st.fast;
        }
        return this.fast;
      },
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
      /* 当前站点的独立状态（默认给一个，防止模板取到 undefined） */
      activePer: function () {
        return (this.per && this.per[this.site]) || global.__ENV_HELPERS__.defaultPer();
      },
      /* 已暂停站点聚合文本（调试面板顶部红字） */
      pauseText: function () { return global.__ENV_HELPERS__.pausedText(this.per); },
      /* 风暴细化（问题 5）：wind / wave 由前端流式生成器直接生效（问题一~三改造后），
         触发后「接下来实时生成」的点按细化模式模拟异常 */
      stormNote: function () {
        const p = this.per && this.per[this.site];
        if (!p || !p.stormType || p.stormType === 'all') return '';
        const mode = (p.stormType === 'wind') ? '仅风速异常' : '仅浪高异常';
        return '细化模式（' + mode + '）已生效：触发大风大浪后，后续实时生成的数据将模拟该异常；' +
               '恢复后新数据回正常，已生成数据不变。';
      },
      /* 问题三：原始数据表按「最新在最上面」显示（倒序）；历史区间模式显示查询结果 */
      rawRows: function () {
        const src = this.rangeMode ? (this.rangeSeries || []) : this.fast;
        return src.slice().reverse();
      },
      /* 原始数据标题：实时窗口 / 历史区间 动态标注 */
      rawTitle: function () {
        const n = this.rawRows.length;
        const tag = this.isObs ? 'NOAA NDBC 公开历史数据' : '仿真数据';
        if (this.rangeMode) return '原始数据（历史区间 · ' + n + ' 条 · ' + tag + '）';
        return '原始数据（最近 ' + this.activePer.minutes + ' 分钟 · ' + n + ' 条 · ' + tag + '）';
      },
      /* 数据来源：观测站点实时读的是本地缓存，不是每次渲染去联网 */
      srcLabel: function () {
        if (this.isObs) return 'NOAA NDBC 公开浮标实测（读本地缓存）';
        return '仿真生成（模拟养殖站点）';
      },
      events: function () {
        /* 由真实数据算出的事件：越限即列为事件（不做假数据）。
           ⚠️ 2026-10-06 教训：这段当时漏了 `const out = [];` 一行，
              结果 events 计算属性每次都抛 ReferenceError。
              **Vue 会把计算属性里的异常吞掉**，页面照常渲染、只是事件列表永远是空的 ——
              验收也照样过。所以「页面能打开」不等于「这段逻辑是对的」。
              这类错只能靠浏览器控制台（Errors 数）和逐页人工看抓。
           🔴 浪高阈值对齐国标（GB/T 19721.2 / 海浪警报级别）：
              蓝色 2.5~3.9 m / 黄色 4.0~5.9 / 橙色 6.0~8.9 / 红色 ≥9.0 m。
           ⚠️ 问题五：事件合并「浪高警报 + 风速 ≥17.2 m/s（8 级大风）」，
              每条含 时间 / 站点 / 数据；真实站点（公开数据）异常同样列入。 */
        const H = global.__ENV_HELPERS__;
        const siteName = this.siteName();
        const G = global.__ENV_GEN__;
        /* ⚠️ 依赖与数据源：显式读 this.fast.length（series 每次更新都触发重算），
           再取全量序列计算 —— 不能只经 allFast：computed 返回同一个数组引用时
           Vue 认为值未变，不会通知下游，事件列表就会停留在旧数据（2026-10-08 实测踩坑）。 */
        this.fast.length;
        let src = this.fast;
        if (!this.isObs) {
          const st = G && G.series && G.series[this.site + '::' + (this.pageKey || 'sea')];
          if (st && st.fast && st.fast.length) src = st.fast;
        }
        const out = [];
        /* 问题二：基于全量序列计算事件 —— 模拟异常期间生成的点保留在序列里，事件记录不消除 */
        src.forEach(function (r) {
          const t = siteName + ' · ' + H.fmtTs(r.ts);
          const w = r.wave_height;
          if (w != null) {
            let lv = null, note = '';
            if (w >= 9.0)      { lv = 'red';    note = '红色警报级（≥9.0 m）'; }
            else if (w >= 6.0) { lv = 'orange'; note = '橙色警报级（≥6.0 m）'; }
            else if (w >= 4.0) { lv = 'yellow'; note = '黄色警报级 · 灾害性海浪（≥4.0 m）'; }
            else if (w >= 2.5) { lv = 'blue';   note = '蓝色警报级 · 国家海浪警报起始（≥2.5 m）'; }
            if (lv) {
              out.push({ id: 'w' + r.ts, ts: r.ts, level: lv,
                         text: t + ' · 浪高 ' + w + ' m —— ' + note });
            }
          }
          const ws = r.wind_speed;
          if (ws != null && ws >= 17.2) {
            out.push({ id: 'wind' + r.ts, ts: r.ts, level: 'red',
                       text: t + ' · 风速 ' + ws + ' m/s —— 8 级及以上大风（≥17.2 m/s，蒲福风级）' });
          }
        });
        return out.sort(function (a, b) { return b.ts - a.ts; }).slice(0, 20);
      },
      /* 问题一：事件列表默认收起 —— 只展示前 5 条（与时序图上下长度相当），
         其余收起，点击「展开全部」查看；再次点击「收起」折叠。 */
      visibleEvents: function () {
        return this.evOpen ? this.events : this.events.slice(0, 5);
      },
      /* 浪高异常点（问题 2）：命中异常界定指标的点用圆点标记，颜色与指标表一致 */
      waveDots: function () {
        const out = [];
        this.fast.forEach(function (r) {
          const w = r.wave_height;
          if (w == null) return;
          let color = null;
          if (w >= 9.0)      { color = '#991B1B'; }
          else if (w >= 6.0) { color = '#EA580C'; }
          else if (w >= 4.0) { color = '#D97706'; }
          else if (w >= 2.5) { color = '#1D4ED8'; }
          if (color) out.push({ coord: [r.ts, w], value: w, itemStyle: { color: color } });
        });
        return out;
      },
      /* 风速异常点：≥17.2 m/s（8 级及以上大风） */
      windDots: function () {
        const out = [];
        this.fast.forEach(function (r) {
          const w = r.wind_speed;
          if (w == null) return;
          if (w >= 17.2) out.push({ coord: [r.ts, w], value: w, itemStyle: { color: '#991B1B' } });
        });
        return out;
      },
      waveLines: function () {
        return [
          { yAxis: 2.5, name: '蓝色警报 2.5m', lineStyle: { color: '#1D4ED8', type: 'dashed', width: 1 } },
          { yAxis: 4.0, name: '黄色警报 4.0m', lineStyle: { color: '#D97706', type: 'dashed', width: 1 } },
          { yAxis: 9.0, name: '红色警报 9.0m', lineStyle: { color: '#991B1B', type: 'dashed', width: 1 } }
        ];
      },
      windLines: function () {
        return [{ yAxis: 17.2, name: '8 级大风 17.2m/s', lineStyle: { color: '#991B1B', type: 'dashed', width: 1 } }];
      }
    },
    methods: {
      /* 站点独立状态兜底：API.sites() 可能晚于 data() 返回，这里补齐；
         问题一：仿真控制状态（per）按页面各自独立 —— 海况页用 seaPer，水质页用 waterPer，
         对海况页的操作不会影响水质页（暂停/大风大浪/骤升都互不影响）；
         站点选择（site）仍跨页共享，切换页面后保留 */
      ensurePer: function () {
        const S = global.__ENV_SESSION__ || (global.__ENV_SESSION__ = { seaPer: null, waterPer: null, site: 'site_01' });
        if (!S.seaPer) S.seaPer = {};
        this.per = S.seaPer;
        const H = global.__ENV_HELPERS__;
        API.sites().forEach(function (s) {
          if (!this.per[s.site_id]) this.per[s.site_id] = H.defaultPer();
        }.bind(this));
      },
      load: function () {
        const self = this;
        this.ensurePer();
        const p = this.activePer;
        const seq = ++this.loadSeq;
        if (this.isObsSite(this.site)) {
          /* 观测站点：公开实测数据，不可模拟（问题一），原取数路径保持 */
          API.resolve(API.env(this.site, p.minutes, {}),
                      function (d) { if (seq === self.loadSeq) self.series = d; });
        } else {
          /* 养殖站点：流式仿真生成（问题一~三）——
             触发大风大浪/水温骤升只影响「接下来实时生成」的点；已生成点永不变；
             序列按「站点 + 页面」双键隔离，海况页的风暴/暂停不影响水质页数据 */
          const G = global.__ENV_GEN__;
          const st = G.appendTo(this.site, Math.floor(Date.now() / 1000) * 1000, p, p.minutes, 'sea');
          if (seq === self.loadSeq) self.series = G.windowSlice(st, p.minutes);
        }
      },
      siteName: function () {
        const sid = this.site;
        const s = API.sites().filter(function (x) { return x.site_id === sid; })[0];
        return s ? s.site_name : sid;
      },
      /* 问题一：事件列表行内圆点颜色类（与公共 event-list 一致：bg-蓝/黄/橙/红） */
      lvClass: function (lv) { return 'bg-' + (lv || 'blue'); },
      /* 问题一：观测站点（真实公开数据）不参与任何仿真控制 */
      isObsSite: function (sid) {
        const s = API.sites().filter(function (x) { return x.site_id === sid; })[0];
        return !!(s && s.kind === 'obs');
      },
      time: function (ts) {
        return new Date(ts).toLocaleString('zh-CN', { hour12: false });
      },
      fmtTs: function (ts) { return global.__ENV_HELPERS__.fmtTs(ts); },
      /* 界面不许裸英文（硬规矩 3）：来源 / 质量统一转中文 */
      srcCn: function (src) { return global.__ENV_CN__.srcCn(src); },
      qCn: function (q) { return global.__ENV_CN__.qCn(q); },
      /* 顶部站点切换 */
      setSite: function (sid) { this.site = sid; },
      /* 时间窗（公共件 / 自定义分钟数）—— 只改当前站点自己的窗口 */
      onMinutes: function (v) {
        this.ensurePer();
        this.activePer.minutes = v;
        this.load();
      },
      onCustomMin: function (e) {
        this.ensurePer();
        const v = parseInt(e.target.value, 10);
        if (v >= 5 && v <= 1440) { this.activePer.minutes = v; this.load(); }
      },
      /* 调试面板：暂停 / 恢复 —— 只影响被操作的站点，其他站点不受任何影响；
         真实站点（公开数据）不可暂停（问题一） */
      togglePause: function (sid) {
        if (this.isObsSite(sid)) return;
        const per = this.per[sid];
        if (!per) return;
        per.paused = !per.paused;
        if (sid === this.site && !per.paused) this.load();
      },
      /* 真实站点不可模拟大风大浪（问题一） */
      toggleStorm: function (sid) {
        if (this.isObsSite(sid)) return;
        const per = this.per[sid];
        if (!per) return;
        per.storm = !per.storm;
        if (sid === this.site) this.load();
      },
      /* 风暴细化选项（仅当前站点自己的选项，per-site 存储） */
      setStormType: function (v) {
        this.ensurePer();
        this.activePer.stormType = v;
      },
      /* 原始数据导出 CSV（UTF-8 BOM，Excel 打开不乱码）；
         问题三：页面按「最新在上」显示，导出保持时间正序（历史区间则导出查询结果） */
      exportCsv: function () {
        const H = global.__ENV_HELPERS__;
        const src = this.rangeMode ? (this.rangeSeries || []) : this.fast;
        const rows = src.map(function (r) {
          return [H.fmtTs(r.ts), r.site_id, srcCn(r.source), qCn(r.quality),
                  r.wave_height, r.wind_speed, r.current_speed, r.air_temp];
        });
        const csv = H.toCsv(['时间', '站点', '来源', '质量', '浪高 (m)', '风速 (m/s)', '流速 (m/s)', '气温 (℃)'], rows);
        downloadCsv('海况原始数据_' + this.siteName() + '.csv', csv);
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
      /* 问题二：NDBC 数据时间范围（2026-10-09 队长已挂载 api/env.py，取的是精确值）。
         注意：不在 mount 时请求 ndbc-ranges（未挂载会 404 并产生浏览器 console error），
         改为「查询历史」成功（证明后端已挂载）后再请求精确范围。 */
      ndbcRangeText: function (s) {
        const r = this.ranges && this.ranges[s.station_id];
        if (r && r.first_ts_utc && r.latest_ts_utc) {
          return r.first_ts_utc + ' ~ ' + r.latest_ts_utc + ' UTC';
        }
        if (s.latest_ts && s.count) {
          const first = s.latest_ts - (s.count - 1) * 10 * 60 * 1000;
          const H = global.__ENV_HELPERS__;
          return H.fmtTs(first) + ' ~ ' + H.fmtTs(s.latest_ts) + ' UTC（实测覆盖范围）';
        }
        return s.latest_ts_utc || '—';
      },
      loadRanges: function () {
        const self = this;
        if (typeof fetch !== 'function') return;
        fetch('/api/env/ndbc-ranges')
          .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
          .then(function (d) {
            const map = {};
            (d.ranges || []).forEach(function (x) { map[x.station_id] = x; });
            self.ranges = map;
          })
          .catch(function () { /* 未挂载：ndbcRangeText 用估算并标注 */ });
      },
      /* 问题二：真实站点按自定义起止时间查询公开历史（后端 /api/env/historical，随 api/env.py 挂载） */
      queryRange: function () {
        const self = this;
        const st = Date.parse(this.rangeStart);
        const en = Date.parse(this.rangeEnd);
        if (!st || !en || en <= st) {
          this.rangeMsg = '请选择有效的起止时间（结束时间需晚于开始时间）';
          return;
        }
        if (typeof fetch !== 'function') {
          this.rangeMsg = '历史区间接口没有响应 —— 请确认后端已启动（双击 启动平台.bat）';
          return;
        }
        this.rangeMsg = '正在查询历史区间…';
        fetch('/api/env/historical?site_id=' + this.site + '&start_ts=' + st + '&end_ts=' + en)
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (d) {
            if (d.count > 0) {
              const recs = d.records;
              self.rangeSeries = recs;
              self.rangeMode = true;
              /* 后端已挂载（查询成功）→ 顺带取精确「数据时间范围」 */
              self.loadRanges();
              self.rangeMsg = '已加载 ' + d.count + ' 条公开历史数据（' +
                global.__ENV_HELPERS__.fmtTs(recs[0].ts) + ' ~ ' +
                global.__ENV_HELPERS__.fmtTs(recs[recs.length - 1].ts) + '）';
            } else {
              self.rangeMode = false;
              self.rangeSeries = null;
              self.rangeMsg = '该时间区间内无数据（真实站点数据范围有限，见「数据时间范围」列）';
            }
          })
          .catch(function (e) {
            self.rangeMode = false;
            self.rangeMsg = '历史区间接口不可用（' + e.message + '）；' +
                           '当前可按「自定义分钟数」查看尾部窗口。';
          });
      },
      /* 退出历史区间，回到实时尾部窗口 */
      exitRange: function () {
        this.rangeMode = false;
        this.rangeSeries = null;
        this.rangeMsg = '';
        this.load();
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
      },
      /* 可交互时序（问题 2）：缩放 / 框选 / 异常点标记。
         ⚠️ 公共 trend-chart 无 dataZoom / markPoint，这里在页面内自绘 ECharts 增强版；
            后续若公共件补上这两项，可换回公共件保持全平台一致。 */
      renderChart: function () {
        const el = this.$refs.chartEl;
        if (!el) return;
        const E = global.echarts;
        if (!E) return;
        let inst = E.getInstanceByDom(el);
        if (!inst) inst = E.init(el);
        this.chart = inst;
        const fast = this.fast;
        if (!fast.length) {
          inst.clear();
          inst.setOption({
            graphic: { type: 'text', left: 'center', top: 'middle',
                       style: { text: '暂无数据', fill: '#6B7280', fontSize: 14 } },
            xAxis: { show: false }, yAxis: { show: false }, series: []
          }, true);
          return;
        }
        const H = global.__ENV_HELPERS__;
        inst.setOption({
          grid: { left: 56, right: 20, top: 44, bottom: 44 },
          tooltip: { trigger: 'axis' },
          legend: { top: 0, textStyle: { fontSize: 12 } },
          xAxis: {
            type: 'time',
            axisLabel: { fontSize: 11, formatter: function (v) { return H.fmtShort(v); } },
            splitLine: { show: false }
          },
          yAxis: { type: 'value', scale: true, axisLabel: { fontSize: 11 },
                   splitLine: { lineStyle: { color: '#EEF2F6' } } },
          /* 缩放 / 框选：inside 滚轮缩放，slider 拖拽框选时间轴 */
          dataZoom: [
            { type: 'inside', start: 0, end: 100 },
            { type: 'slider', height: 16, bottom: 0, start: 0, end: 100 }
          ],
          series: [
            {
              name: '浪高（m）', type: 'line', showSymbol: false, smooth: true,
              lineStyle: { width: 1.6, color: '#2F5496' }, itemStyle: { color: '#2F5496' },
              data: fast.map(function (r) { return [r.ts, r.wave_height]; }),
              markLine: { silent: true, symbol: 'none',
                label: { formatter: '{b}', fontSize: 10, position: 'insideEndTop' },
                data: this.waveLines },
              /* 问题二：异常点只标圆点（颜色分级），不显示数字，图上保持干净 */
              markPoint: { symbol: 'circle', symbolSize: 7, label: { show: false }, data: this.waveDots }
            },
            {
              name: '风速（m/s）', type: 'line', showSymbol: false, smooth: true,
              lineStyle: { width: 1.6, color: '#C2410C' }, itemStyle: { color: '#C2410C' },
              data: fast.map(function (r) { return [r.ts, r.wind_speed]; }),
              markLine: { silent: true, symbol: 'none',
                label: { formatter: '{b}', fontSize: 10, position: 'insideEndTop' },
                data: this.windLines },
              /* 问题二：异常点只标圆点（红色），不显示数字 */
              markPoint: { symbol: 'circle', symbolSize: 7, label: { show: false }, data: this.windDots }
            }
          ]
        }, true);
        inst.resize();
      }
    },
    mounted: function () {
      const self = this;
      const H = global.__ENV_HELPERS__;
      this.ensurePer();
      /* 问题二：历史区间输入默认 最近 1 天（ndbc-ranges 不在此请求——未挂载会 404 产生 console error，
         改为查询历史成功后惰性请求，见 queryRange） */
      if (!this.rangeStart) {
        const en = new Date();
        const st = new Date(en.getTime() - 24 * 3600 * 1000);
        this.rangeStart = H.localInput(st);
        this.rangeEnd = H.localInput(en);
      }
      this.unsub = API.subscribe(function () { self.tick++; });
      this.load();
      this.$nextTick(function () { self.renderChart(); });
      /* 轮询：只刷新「未暂停」的当前站点；暂停站点冻结（站点独立）；
         历史区间模式下保持查询结果，不被实时窗口覆盖（问题二） */
      this.timer = setInterval(function () {
        if (self.rangeMode) return;
        if (global.__ENV_HELPERS__.shouldRefresh(self.per, self.site)) self.load();
      }, 5000);
    },
    beforeUnmount: function () {
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      if (this.unsub) { this.unsub(); this.unsub = null; }
      if (this.chart) { this.chart.dispose(); this.chart = null; }
    },
    watch: {
      site: function () {
        /* 问题六：站点选择写入全局，切换页面后保留 */
        const S = global.__ENV_SESSION__ || (global.__ENV_SESSION__ = {});
        S.site = this.site;
        /* 切站点：退出历史区间模式，回到该站点实时窗口（问题二） */
        this.rangeMode = false;
        this.rangeSeries = null;
        this.rangeMsg = '';
        /* 切到已暂停站点：不刷新，保留其冻结的最后数据（站点独立） */
        if (global.__ENV_HELPERS__.shouldRefresh(this.per, this.site)) this.load();
      },
      /* 数据一更新就重绘增强图（缩放 / 红点跟着最新数据走） */
      fast: { handler: function () { this.renderChart(); }, deep: true }
    },
    template: [
      '<div>',
      '  <page-head title="环境 · 海况"',
      '    desc="浪高 / 风速 / 流速 / 气温。观测站点为 NOAA NDBC 公开浮标实测，养殖站点为仿真生成"',
      '    :sources="isObs ? [\'public\'] : [\'simulated\']" />',
      '',
      '  <!-- 站点切换（顶部）：每个站点独立，切换互不影响 -->',
      '  <div class="card" style="margin-bottom:12px">',
      '    <div class="row" style="align-items:center;gap:8px">',
      '      <span class="small muted">站点：</span>',
      '      <button v-for="s in API.sites()" :key="s.site_id"',
      '              :class="{ primary: site === s.site_id }" style="padding:3px 10px"',
      '              @click="setSite(s.site_id)">{{ s.site_name }}</button>',
      '      <span style="flex:1"></span>',
      '      <span class="small" :style="{ color: isObs ? \'#166534\' : \'#92400E\' }">{{ srcLabel }}</span>',
      '    </div>',
      '  </div>',
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
      '        <b>想看真实浮标数据？</b>点下面任意一个浮标行，或点上方任意一个 <b>NDBC 观测站点</b>。',
      '      </div>',
      '    </div>',
      '',
      '    <div class="dt-wrap" style="max-height:220px">',
      '      <table class="dt">',
      '        <thead><tr><th>浮标</th><th>海域</th><th>缓存条数</th><th>数据时间范围</th><th>抓取于</th><th></th></tr></thead>',
      '        <tbody>',
      '          <tr v-for="s in ndbcList" :key="s.station_id"',
      '              :style="{ background: isCurrentStation(s) ? \'#EFF6FF\' : \'\', cursor: \'pointer\' }"',
      '              @click="gotoStation(s)">',
      '            <td class="mono">{{ s.station_id }}</td>',
      '            <td class="small">{{ s.station.cn }}</td>',
      '            <td>{{ s.count }}</td>',
      '            <td class="small mono">{{ ndbcRangeText(s) }}</td>',
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
      '    <div class="card">',
      '      <div class="card-title">海况时序（可缩放 / 框选 · 异常点标记）',
      '        <help-dot :info="{ level: \'间接支持\', text: \'滚轮缩放、拖拽底部滑条框选时间轴查看细节；曲线上圆点 = 命中「异常界定指标」的数据点，颜色与指标表一致。\' }" :label="\'操作说明\'" />',
      '      </div>',
      '      <div ref="chartEl" class="chart" style="height:340px"></div>',
      '    </div>',
      '    <div class="card">',
      '      <div class="card-title">海况事件（由数据实时判定）</div>',
      '      <div class="events">',
      '        <div v-if="!events.length" class="empty">本时段无越限事件</div>',
      '        <div v-for="it in visibleEvents" :key="it.id" class="row-item" @click="picked = it">',
      '          <span class="t">{{ time(it.ts) }}</span>',
      '          <span class="dot" :class="lvClass(it.level)"></span>',
      '          <span class="d">{{ it.text }}</span>',
      '        </div>',
      '        <button v-if="events.length > 5" class="small" style="margin-top:6px" @click="evOpen = !evOpen">',
      '          {{ evOpen ? \'收起\' : \'展开全部（\' + events.length + \' 条）\' }}',
      '        </button>',
      '      </div>',
      '      ',
      '      <div v-if="picked" class="hint" style="margin-top:10px">',
      '        <b>已选事件</b><br>{{ picked.text }}<br>',
      '        <span class="small">时间：{{ time(picked.ts) }}</span>',
      '      </div>',
      '    </div>',
      '  </div>',
      '',
      '  <!-- 异常界定指标：让人一眼看出「数据到什么程度会被标记/告警」（问题 3） -->',
      '  <div class="card" style="margin-top:12px">',
      '    <div class="card-title">异常界定指标（红点 / 事件标记依据）',
      '      <help-dot :info="{ level: \'间接支持\', text: \'浪高分级依据 GB/T 19721.2《海洋预报和警报发布 第 2 部分：海浪警报发布》的海浪警报级别；风速异常参考蒲福风级（≥17.2 m/s 为 8 级及以上大风）。触发「大风大浪」时，仿真将浪高抬至约 4.6 m、风速抬至约 19 m/s（风暴模式）。\', source: \'GB/T 19721.2 ／ 蒲福风级\' }" :label="\'界定依据说明\'" />',
      '    </div>',
      '    <div class="dt-wrap">',
      '      <table class="dt">',
      '        <thead><tr><th>指标</th><th>单位</th><th>正常参考</th><th>异常界定</th><th>依据</th></tr></thead>',
      '        <tbody>',
      '          <tr>',
      '            <td class="small"><b>浪高</b></td><td class="small">m</td><td class="small">＜2.5</td>',
      '            <td class="small"><span class="dot bg-blue"></span>≥2.5 蓝色 ／ <span class="dot bg-yellow"></span>≥4.0 黄色 ／ <span class="dot bg-orange"></span>≥6.0 橙色 ／ <span class="dot bg-red"></span>≥9.0 红色</td>',
      '            <td class="small">GB/T 19721.2 海浪警报级别</td>',
      '          </tr>',
      '          <tr>',
      '            <td class="small"><b>风速</b></td><td class="small">m/s</td><td class="small">＜17.2</td>',
      '            <td class="small"><span class="dot bg-red"></span>≥17.2（8 级及以上大风）</td>',
      '            <td class="small">蒲福风级</td>',
      '          </tr>',
      '          <tr>',
      '            <td class="small"><b>海水流速</b></td><td class="small">m/s</td><td class="small">—</td>',
      '            <td class="small muted">暂无界定规则</td><td class="small muted">—</td>',
      '          </tr>',
      '          <tr>',
      '            <td class="small"><b>环境气温</b></td><td class="small">℃</td><td class="small">—</td>',
      '            <td class="small muted">暂无界定规则</td><td class="small muted">—</td>',
      '          </tr>',
      '        </tbody>',
      '      </table>',
      '    </div>',
      '  </div>',
      '',
      '  <!-- 原始数据：放在海况时序下方；可自定义时间窗、可导出；切观测站点即见公开历史数据 -->',
      '  <div class="card" style="margin-top:12px">',
      '    <div class="card-title">{{ rawTitle }}</div>',
      '    <div class="row" style="align-items:center">',
      '      <time-range :model-value="activePer.minutes" @update:model-value="onMinutes" />',
      '      <input type="number" min="5" max="1440" :value="activePer.minutes" @change="onCustomMin"',
      '             class="mono" style="width:88px" />',
      '      <span class="small muted">自定义分钟数（5–1440）</span>',
      '      <span style="flex:1"></span>',
      '      <button class="primary" @click="exportCsv">导出 CSV</button>',
      '    </div>',
      '    <!-- 问题二：真实站点公开数据支持自定义起止时间（年/月/日 时:分）查看更长远历史 -->',
      '    <div v-if="isObs" class="row" style="align-items:center;margin-top:8px;flex-wrap:wrap">',
      '      <span class="small muted">历史区间（真实站点公开数据）：</span>',
      '      <input type="datetime-local" v-model="rangeStart" class="mono" style="padding:2px 6px" />',
      '      <span class="small muted"> ~ </span>',
      '      <input type="datetime-local" v-model="rangeEnd" class="mono" style="padding:2px 6px" />',
      '      <button class="primary" style="padding:3px 10px" @click="queryRange">查询历史</button>',
      '      <button style="padding:3px 10px" @click="exitRange">返回实时</button>',
      '    </div>',
      '    <div v-if="rangeMsg" class="hint" style="margin-top:8px">{{ rangeMsg }}</div>',
      '    <div class="hint" style="margin-top:8px">',
      '      时间显示为「年/月/日 时:分:秒」，原始数据表按<b>最新在上</b>排列（导出 CSV 保持时间正序）。',
      '      切换「观测站点」后，本表即为 NOAA NDBC 公开历史实测数据；养殖站点为仿真数据。',
      '      真实站点按日期区间（年/月/日 时:分）查询历史，数据来自 NOAA NDBC 公开浮标实测库；',
      '      未挂载时可按「自定义分钟数」查看最近窗口。',
      '    </div>',
      '    <div class="dt-wrap" style="margin-top:8px">',
      '      <table class="dt">',
      '        <thead><tr><th>时间</th><th>站点</th><th>来源</th><th>质量</th>',
      '                <th>浪高 (m)</th><th>风速 (m/s)</th><th>流速 (m/s)</th><th>气温 (℃)</th></tr></thead>',
      '        <tbody>',
      '          <tr v-for="r in rawRows" :key="r.ts">',
      '            <td class="mono small">{{ fmtTs(r.ts) }}</td>',
      '            <td class="small">{{ r.site_id }}</td>',
      '            <td class="small">{{ srcCn(r.source) }}</td>',
      '            <td class="small">{{ qCn(r.quality) }}</td>',
      '            <td class="mono">{{ r.wave_height == null ? \'—\' : r.wave_height }}</td>',
      '            <td class="mono">{{ r.wind_speed == null ? \'—\' : r.wind_speed }}</td>',
      '            <td class="mono">{{ r.current_speed == null ? \'—\' : r.current_speed }}</td>',
      '            <td class="mono">{{ r.air_temp == null ? \'—\' : r.air_temp }}</td>',
      '          </tr>',
      '          <tr v-if="!rawRows.length"><td colspan="8" class="muted small">暂无数据</td></tr>',
      '        </tbody>',
      '      </table>',
      '    </div>',
      '  </div>',
      '',
      '  <!-- 调试面板（仿真控制）：放在页面最下方 -->',
      '  <div class="card" style="margin-top:12px">',
      '    <div class="card-title">调试面板 · 仿真控制</div>',
      '    <div v-if="pauseText" class="hint" style="background:#FEF2F2;border-color:#FECACA">',
      '      <b>已暂停生成：</b>{{ pauseText }}',
      '    </div>',
      '    <div class="dt-wrap">',
      '      <table class="dt">',
      '        <thead><tr><th>站点</th><th>类型</th><th>状态</th><th>当前模式</th><th>操作</th></tr></thead>',
      '        <tbody>',
      '          <tr v-for="s in API.sites()" :key="s.site_id">',
      '            <td class="small"><b>{{ s.site_name }}</b> <span class="muted mono">{{ s.site_id }}</span></td>',
      '            <td class="small">{{ s.kind === \'obs\' ? \'观测\' : \'养殖\' }}</td>',
      '            <td class="small">',
      '              <!-- 问题一：真实站点是公开数据，不参与仿真，不存在暂停生成 -->',
      '              <span v-if="s.kind === \'obs\'" style="color:#166534">公开数据</span>',
      '              <span v-else :style="{ color: per && per[s.site_id] && per[s.site_id].paused ? \'#991B1B\' : \'#166534\' }">',
      '                {{ per && per[s.site_id] && per[s.site_id].paused ? \'已暂停\' : \'运行中\' }}',
      '              </span>',
      '            </td>',
      '            <td class="small">',
      '              <span v-if="s.kind === \'obs\'" class="muted">实时实测（不可模拟）</span>',
      '              <span v-else-if="per && per[s.site_id] && per[s.site_id].storm" style="color:#991B1B">大风大浪</span>',
      '              <span v-else class="muted">正常</span>',
      '            </td>',
      '            <td class="small">',
      '              <span v-if="s.kind === \'obs\'" class="muted small">—（公开数据不参与仿真控制）</span>',
      '              <template v-else>',
      '                <button class="primary" style="padding:2px 8px" @click="togglePause(s.site_id)">',
      '                  {{ per && per[s.site_id] && per[s.site_id].paused ? \'恢复生成\' : \'暂停生成\' }}',
      '                </button>',
      '                <button style="padding:2px 8px;margin-left:6px" @click="toggleStorm(s.site_id)">',
      '                  {{ per && per[s.site_id] && per[s.site_id].storm ? \'恢复平常\' : \'触发大风大浪\' }}',
      '                </button>',
      '              </template>',
      '            </td>',
      '          </tr>',
      '        </tbody>',
      '      </table>',
      '    </div>',
      '    <!-- 大风大浪细化：仅养殖站点（真实站点公开数据不可模拟，问题一） -->',
      '    <div v-if="!isObs" class="row" style="margin-top:10px;align-items:center;flex-wrap:wrap">',
      '      <span class="small muted">大风大浪细化（当前站点 {{ siteName() }}）：</span>',
      '      <label class="small"><input type="radio" name="stormType"',
      '             :checked="(per && per[site] && per[site].stormType) === \'all\'" @change="setStormType(\'all\')"> 整体大风大浪</label>',
      '      <label class="small"><input type="radio" name="stormType"',
      '             :checked="(per && per[site] && per[site].stormType) === \'wind\'" @change="setStormType(\'wind\')"> 仅风速异常</label>',
      '      <label class="small"><input type="radio" name="stormType"',
      '             :checked="(per && per[site] && per[site].stormType) === \'wave\'" @change="setStormType(\'wave\')"> 仅浪高异常</label>',
      '    </div>',
      '    <div v-if="stormNote" class="hint" style="margin-top:6px;background:#FFFBEB;border-color:#FDE68A">',
      '      {{ stormNote }}',
      '    </div>',
      '  </div>',
      '',
      '  <div class="opbar" style="margin:12px -16px -16px; border-radius:0">',
      '    <time-range :model-value="activePer.minutes" @update:model-value="onMinutes" />',
      '    <span style="width:12px"></span>',
      '    <span class="small muted">站点</span>',
      '    <select v-model="site">',
      '      <option v-for="s in API.sites()" :key="s.site_id" :value="s.site_id">{{ s.site_name }}</option>',
      '    </select>',
      '    <span style="flex:1"></span>',
      '    <span class="small muted">口径：{{ API.disclaimer }}</span>',
      '  </div>',
      '</div>'
    ].join('\n')
  };

  /* ============================================================
     水质页 /env/water
     布局（自上而下）：
       站点切换（顶部） → 告警横幅 → 数值卡（含光照强度） → 时序 + 事件 →
       异常界定指标 → 原始数据（快变量 + 慢变量） → 调试面板（仿真控制）→ 底部操作条
     ============================================================ */
  PAGES['/env/water'] = {
    data: function () {
      /* 问题六：站点选择存全局 __ENV_SESSION__，跨页切换后保留；
         仿真控制状态（per）两页各自独立（问题一：海况↔水质互不影响） */
      const S = global.__ENV_SESSION__ || (global.__ENV_SESSION__ = { seaPer: null, waterPer: null, site: 'site_01' });
      return { pageKey: 'water', site: S.site || 'site_01', picked: null, series: null,
               per: S.waterPer, loadSeq: 0, chart: null, timer: null,
               evOpen: false,
               show: { water_temp: true, dissolved_oxygen: true, light_intensity: false,
                       salinity: true },
               /* 问题二：历史区间（真实站点公开数据可自定义时间查看更长远历史） */
               rangeMode: false, rangeSeries: null, rangeMsg: '',
               rangeStart: '', rangeEnd: '', ranges: {} };
    },
    computed: {
      fast: function () { return this.series ? this.series.fast : []; },
      slow: function () { return this.series ? this.series.slow : []; },
      /* 问题二：事件数据源 —— 养殖站点用「全量生成序列」（异常记录不因窗口滑动而消失）；
         观测站点（公开数据）用后端返回窗口。读 this.fast 建立依赖，fast 更新时重算。 */
      allFast: function () {
        this.fast.length;
        const G = global.__ENV_GEN__;
        if (!this.isObs) {
          const st = G && G.series && G.series[this.site + '::' + (this.pageKey || 'sea')];
          if (st && st.fast && st.fast.length) return st.fast;
        }
        return this.fast;
      },
      last: function () { return this.fast.length ? this.fast[this.fast.length - 1] : {}; },
      lastSlow: function () { return this.slow.length ? this.slow[this.slow.length - 1] : {}; },
      activePer: function () {
        return (this.per && this.per[this.site]) || global.__ENV_HELPERS__.defaultPer();
      },
      pauseText: function () { return global.__ENV_HELPERS__.pausedText(this.per); },
      isObs: function () {
        const sid = this.site;
        const s = API.sites().filter(function (x) { return x.site_id === sid; })[0];
        return !!(s && s.kind === 'obs');
      },
      srcLabel: function () {
        if (this.isObs) return 'NOAA NDBC 公开浮标实测（读本地缓存）';
        return '仿真生成（模拟养殖站点）';
      },
      /* 水温异常点（问题 2）：黄 ≥25.5（R-TEMP-02 偏高提示），红 ≥28.0（R-TEMP-01 水温上限告警） */
      waterDots: function () {
        const out = [];
        this.fast.forEach(function (r) {
          const w = r.water_temp;
          if (w == null) return;
          let color = null;
          if (w >= 28.0)      { color = '#991B1B'; }
          else if (w >= 25.5) { color = '#D97706'; }
          if (color) out.push({ coord: [r.ts, w], value: w, itemStyle: { color: color } });
        });
        return out;
      },
      waterLines: function () {
        return [
          { yAxis: 28.0, name: '水温上限 28.0℃', lineStyle: { color: '#991B1B', type: 'dashed', width: 1 } },
          { yAxis: 25.5, name: '偏高提示 25.5℃', lineStyle: { color: '#D97706', type: 'dashed', width: 1 } }
        ];
      },
      /* ★ 一条竖线：水温越限 → 出告警（判定规则在 API.ruleCheck，与后端同口径）。
         问题二：基于全量序列判定 —— 模拟异常期间生成的点保留，告警记录不消除。
         ⚠️ 显式读 this.fast.length 建立响应式依赖（不能只经 allFast：computed 返回
         同一数组引用时 Vue 不通知下游，告警列表会停留在旧数据）。 */
      alarms: function () {
        this.fast.length;
        const G = global.__ENV_GEN__;
        let src = this.fast;
        if (!this.isObs) {
          const st = G && G.series && G.series[this.site + '::' + (this.pageKey || 'water')];
          if (st && st.fast && st.fast.length) src = st.fast;
        }
        const out = [];
        src.forEach(function (r) {
          const hit = API.ruleCheck(r);
          if (hit) out.push({ id: 'a' + r.ts, ts: r.ts, level: hit.risk_level, hit: hit, row: r });
        });
        return out;
      },
      events: function () {
        /* 问题五：每条事件含 时间 / 站点 / 数据；真实站点（公开数据）异常同样列入 */
        const H = global.__ENV_HELPERS__;
        const siteName = this.siteName();
        return this.alarms.slice(-20).reverse().map(function (a) {
          return { id: a.id, ts: a.ts, level: a.level,
                   text: siteName + ' · ' + H.fmtTs(a.ts) + ' · 水温 ' + a.hit.trigger_value +
                         ' ℃ 触发「' + a.hit.rule_name + '」' };
        });
      },
      /* 问题一：事件列表默认收起 —— 只展示前 5 条（与时序图上下长度相当），
         其余收起，点击「展开全部」查看；再次点击「收起」折叠。 */
      visibleEvents: function () {
        return this.evOpen ? this.events : this.events.slice(0, 5);
      },
      /* 问题三：原始数据表按「最新在最上面」显示（倒序）；历史区间模式显示查询结果 */
      rawRows: function () {
        const src = this.rangeMode ? (this.rangeSeries || []) : this.fast;
        return src.slice().reverse();
      },
      slowRows: function () { return this.slow.slice().reverse(); },
      rawTitle: function () {
        const n = this.rawRows.length;
        const tag = this.isObs ? 'NOAA NDBC 公开历史数据' : '仿真数据';
        if (this.rangeMode) return '原始数据（历史区间 · ' + n + ' 条 · ' + tag + '）';
        return '原始数据（最近 ' + this.activePer.minutes + ' 分钟 · ' + tag + '）';
      },
      topAlarm: function () { return this.alarms.length ? this.alarms[this.alarms.length - 1] : null; }
    },
    methods: {
      ensurePer: function () {
        /* 问题一：仿真控制状态（per）按页面各自独立 —— 水质页用 waterPer，
           海况页的大风大浪/暂停不影响水质页；站点选择（site）跨页共享 */
        const S = global.__ENV_SESSION__ || (global.__ENV_SESSION__ = { seaPer: null, waterPer: null, site: 'site_01' });
        if (!S.waterPer) S.waterPer = {};
        this.per = S.waterPer;
        const H = global.__ENV_HELPERS__;
        API.sites().forEach(function (s) {
          if (!this.per[s.site_id]) this.per[s.site_id] = H.defaultPer();
        }.bind(this));
      },
      load: function () {
        const self = this;
        this.ensurePer();
        const p = this.activePer;
        const seq = ++this.loadSeq;
        if (this.isObsSite(this.site)) {
          /* 观测站点：公开实测数据，不可模拟（问题一），原取数路径保持 */
          API.resolve(API.env(this.site, p.minutes, {}),
                      function (d) { if (seq === self.loadSeq) self.series = d; });
        } else {
          /* 养殖站点：流式仿真生成（问题一~三）——
             触发水温骤升/设备离线只影响「接下来实时生成」的点；已生成点永不变；
             序列按「站点 + 页面」双键隔离，水质页的骤升/暂停不影响海况页数据 */
          const G = global.__ENV_GEN__;
          const st = G.appendTo(this.site, Math.floor(Date.now() / 1000) * 1000, p, p.minutes, 'water');
          if (seq === self.loadSeq) self.series = G.windowSlice(st, p.minutes);
        }
      },
      setSite: function (sid) { this.site = sid; },
      siteName: function () {
        const sid = this.site;
        const s = API.sites().filter(function (x) { return x.site_id === sid; })[0];
        return s ? s.site_name : sid;
      },
      /* 问题一：事件列表行内圆点颜色类（与公共 event-list 一致：bg-蓝/黄/橙/红） */
      lvClass: function (lv) { return 'bg-' + (lv || 'blue'); },
      /* 问题一：观测站点（真实公开数据）不参与任何仿真控制 */
      isObsSite: function (sid) {
        const s = API.sites().filter(function (x) { return x.site_id === sid; })[0];
        return !!(s && s.kind === 'obs');
      },
      time: function (ts) { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); },
      fmtTs: function (ts) { return global.__ENV_HELPERS__.fmtTs(ts); },
      srcCn: function (src) { return global.__ENV_CN__.srcCn(src); },
      qCn: function (q) { return global.__ENV_CN__.qCn(q); },
      /* 问题一：真实站点不可暂停 / 不可模拟 */
      togglePause: function (sid) {
        if (this.isObsSite(sid)) return;
        const per = this.per[sid];
        per.paused = !per.paused;
        if (sid === this.site && !per.paused) this.load();
      },
      /* 问题一：触发水温骤升只影响「接下来实时生成」的点（记录触发时刻，恢复后新点回正常） */
      toggleHeat: function (sid) {
        if (this.isObsSite(sid)) return;
        const per = this.per[sid];
        per.heat = !per.heat;
        per.heatSince = per.heat ? Date.now() : null;
        if (sid === this.site) this.load();
      },
      toggleOffline: function (sid) {
        if (this.isObsSite(sid)) return;
        const per = this.per[sid];
        per.offline = !per.offline;
        if (sid === this.site) this.load();
      },
      onMinutes: function (v) {
        this.ensurePer();
        this.activePer.minutes = v;
        this.load();
      },
      onCustomMin: function (e) {
        this.ensurePer();
        const v = parseInt(e.target.value, 10);
        if (v >= 5 && v <= 1440) { this.activePer.minutes = v; this.load(); }
      },
      exportCsv: function () {
        const H = global.__ENV_HELPERS__;
        /* 问题三：页面按「最新在上」显示，导出保持时间正序（历史区间则导出查询结果） */
        const src = this.rangeMode ? (this.rangeSeries || []) : this.fast;
        const rows = src.map(function (r) {
          return [H.fmtTs(r.ts), r.site_id, srcCn(r.source), qCn(r.quality),
                  r.water_temp, r.dissolved_oxygen, r.light_intensity];
        });
        const csv = H.toCsv(['时间', '站点', '来源', '质量', '水温 (℃)', '溶解氧 (mg/L)', '光照 (lux)'], rows);
        downloadCsv('水质原始数据_' + this.siteName() + '.csv', csv);
      },
      /* 问题二：真实站点按自定义起止时间查询公开历史（后端 /api/env/historical，随 api/env.py 挂载） */
      loadRanges: function () {
        const self = this;
        if (typeof fetch !== 'function') return;
        fetch('/api/env/ndbc-ranges')
          .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
          .then(function (d) {
            const map = {};
            (d.ranges || []).forEach(function (x) { map[x.station_id] = x; });
            self.ranges = map;
          })
          .catch(function () { /* 未挂载：ndbcRangeText 用估算并标注 */ });
      },
      queryRange: function () {
        const self = this;
        const st = Date.parse(this.rangeStart);
        const en = Date.parse(this.rangeEnd);
        if (!st || !en || en <= st) {
          this.rangeMsg = '请选择有效的起止时间（结束时间需晚于开始时间）';
          return;
        }
        if (typeof fetch !== 'function') {
          this.rangeMsg = '历史区间接口没有响应 —— 请确认后端已启动（双击 启动平台.bat）';
          return;
        }
        this.rangeMsg = '正在查询历史区间…';
        fetch('/api/env/historical?site_id=' + this.site + '&start_ts=' + st + '&end_ts=' + en)
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (d) {
            if (d.count > 0) {
              const recs = d.records;
              self.rangeSeries = recs;
              self.rangeMode = true;
              self.rangeMsg = '已加载 ' + d.count + ' 条公开历史数据（' +
                global.__ENV_HELPERS__.fmtTs(recs[0].ts) + ' ~ ' +
                global.__ENV_HELPERS__.fmtTs(recs[recs.length - 1].ts) + '）';
            } else {
              self.rangeMode = false;
              self.rangeSeries = null;
              self.rangeMsg = '该时间区间内无数据（真实站点数据范围有限，见「数据时间范围」列）';
            }
          })
          .catch(function (e) {
            self.rangeMode = false;
            self.rangeMsg = '历史区间接口不可用（' + e.message + '）；' +
                           '当前可按「自定义分钟数」查看尾部窗口。';
          });
      },
      /* 退出历史区间，回到实时尾部窗口 */
      exitRange: function () {
        this.rangeMode = false;
        this.rangeSeries = null;
        this.rangeMsg = '';
        this.load();
      },
      /* 可交互时序（问题 2）：缩放 / 框选 / 异常点标记；光照强度走右轴（量级差太大）；
         问题四：盐度（慢变量）补入时序；光照右轴固定量程使纵轴刻度完整显示 */
      renderChart: function () {
        const el = this.$refs.chartEl;
        if (!el) return;
        const E = global.echarts;
        if (!E) return;
        let inst = E.getInstanceByDom(el);
        if (!inst) inst = E.init(el);
        this.chart = inst;
        const fast = this.fast;
        if (!fast.length) {
          inst.clear();
          inst.setOption({
            graphic: { type: 'text', left: 'center', top: 'middle',
                       style: { text: '暂无数据', fill: '#6B7280', fontSize: 14 } },
            xAxis: { show: false }, yAxis: { show: false }, series: []
          }, true);
          return;
        }
        const H = global.__ENV_HELPERS__;
        const s = this.show;
        const series = [];
        const pushS = function (name, unit, key, color, axis) {
          if (!s[key]) return;
          series.push({
            name: name + '（' + unit + '）', type: 'line', showSymbol: false, smooth: true,
            yAxisIndex: axis || 0,
            lineStyle: { width: 1.6, color: color }, itemStyle: { color: color },
            data: fast.map(function (r) { return [r.ts, r[key]]; })
          });
        };
        pushS('水温', '℃', 'water_temp', '#2F5496', 0);
        pushS('溶解氧', 'mg/L', 'dissolved_oxygen', '#166534', 0);
        pushS('光照强度', 'lux', 'light_intensity', '#C2410C', 1);
        /* 问题四：盐度（慢变量 30 秒一条）补入时序，与水温/溶解氧同轴（量级相近） */
        if (s.salinity) {
          series.push({
            name: '盐度（‰）', type: 'line', showSymbol: false, smooth: true, yAxisIndex: 0,
            lineStyle: { width: 1.6, color: '#7C3AED' }, itemStyle: { color: '#7C3AED' },
            data: this.slow.map(function (r) { return [r.ts, r.salinity]; })
          });
        }
        const needAxis2 = !!s.light_intensity;
        /* 阈值线 + 异常点只挂在水温曲线上（水温有界定规则） */
        let idx = -1;
        for (let i = 0; i < series.length; i++) {
          if (series[i].name.indexOf('水温') >= 0) { idx = i; break; }
        }
        if (idx >= 0) {
          series[idx].markLine = { silent: true, symbol: 'none',
            label: { formatter: '{b}', fontSize: 10, position: 'insideEndTop' },
            data: this.waterLines };
          /* 问题二：异常点只标圆点（黄/红分级），不显示数字，图上保持干净 */
          series[idx].markPoint = { symbol: 'circle', symbolSize: 7, label: { show: false }, data: this.waterDots };
        }
        inst.setOption({
          /* 问题四：右轴有标签/轴名时留足右侧空间，避免「纵轴显示不全」 */
          grid: needAxis2
            ? { left: 56, right: 58, top: 44, bottom: 44 }
            : { left: 56, right: 20, top: 44, bottom: 44 },
          tooltip: { trigger: 'axis' },
          legend: { top: 0, textStyle: { fontSize: 12 } },
          xAxis: {
            type: 'time',
            axisLabel: { fontSize: 11, formatter: function (v) { return H.fmtShort(v); } },
            splitLine: { show: false }
          },
          yAxis: needAxis2
            ? [
                { type: 'value', scale: true, axisLabel: { fontSize: 11 },
                  splitLine: { lineStyle: { color: '#EEF2F6' } } },
                /* 光照强度固定量程 0–14000 lux：白天峰值 ~12000，刻度 0/3500/7000/10500/14000 完整可见 */
                { type: 'value', position: 'right', min: 0, max: 14000, name: '光照(lux)',
                  nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 },
                  splitLine: { show: false } }
              ]
            : { type: 'value', scale: true, axisLabel: { fontSize: 11 },
                splitLine: { lineStyle: { color: '#EEF2F6' } } },
          dataZoom: [
            { type: 'inside', start: 0, end: 100 },
            { type: 'slider', height: 16, bottom: 0, start: 0, end: 100 }
          ],
          series: series
        }, true);
        inst.resize();
      }
    },
    mounted: function () {
      const self = this;
      const H = global.__ENV_HELPERS__;
      this.ensurePer();
      /* 问题二：历史区间输入默认 最近 1 天（ndbc-ranges 不在此请求——未挂载会 404 产生 console error，
         改为查询历史成功后惰性请求，见 queryRange） */
      if (!this.rangeStart) {
        const en = new Date();
        const st = new Date(en.getTime() - 24 * 3600 * 1000);
        this.rangeStart = H.localInput(st);
        this.rangeEnd = H.localInput(en);
      }
      this.load();
      this.$nextTick(function () { self.renderChart(); });
      /* 轮询：只刷新「未暂停」的当前站点；暂停站点冻结（站点独立）；
         历史区间模式下保持查询结果，不被实时窗口覆盖（问题二） */
      this.timer = setInterval(function () {
        if (self.rangeMode) return;
        if (global.__ENV_HELPERS__.shouldRefresh(self.per, self.site)) self.load();
      }, 5000);
    },
    beforeUnmount: function () {
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      if (this.chart) { this.chart.dispose(); this.chart = null; }
    },
    watch: {
      site: function () {
        /* 问题六：站点选择写入全局，切换页面后保留 */
        const S = global.__ENV_SESSION__ || (global.__ENV_SESSION__ = {});
        S.site = this.site;
        /* 切站点：退出历史区间模式，回到该站点实时窗口（问题二） */
        this.rangeMode = false;
        this.rangeSeries = null;
        this.rangeMsg = '';
        /* 切到已暂停站点：不刷新，保留其冻结的最后数据（站点独立） */
        if (global.__ENV_HELPERS__.shouldRefresh(this.per, this.site)) this.load();
      },
      /* 数据一更新就重绘增强图（缩放 / 红点跟着最新数据走） */
      fast: { handler: function () { this.renderChart(); }, deep: true },
      show: { handler: function () { this.renderChart(); }, deep: true }
    },
    template: [
      '<div>',
      '  <page-head title="环境 · 水质"',
      '    desc="水温 / 溶解氧 5 秒；盐度 / pH 30 秒慢变量；光照强度 5 秒"',
      '    :sources="[\'public\',\'simulated\']" />',
      '',
      '  <!-- 站点切换（顶部）：每个站点独立，切换互不影响 -->',
      '  <div class="card" style="margin-bottom:12px">',
      '    <div class="row" style="align-items:center;gap:8px">',
      '      <span class="small muted">站点：</span>',
      '      <button v-for="s in API.sites()" :key="s.site_id"',
      '              :class="{ primary: site === s.site_id }" style="padding:3px 10px"',
      '              @click="setSite(s.site_id)">{{ s.site_name }}</button>',
      '      <span style="flex:1"></span>',
      '      <span class="small" :style="{ color: isObs ? \'#166534\' : \'#92400E\' }">{{ srcLabel }}</span>',
      '    </div>',
      '  </div>',
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
      '      <div class="card">',
      '        <div class="card-title">水质时序（可缩放 / 框选 · 异常点标记）',
      '          <help-dot :info="{ level: \'间接支持\', text: \'滚轮缩放、拖拽底部滑条框选时间轴查看细节；水温曲线上圆点 = 命中「异常界定指标」的数据点（黄 ≥25.5 偏高提示，红 ≥28.0 水温上限告警）。\' }" :label="\'操作说明\'" />',
      '        </div>',
      '        <div ref="chartEl" class="chart" style="height:340px"></div>',
      '      </div>',
      '      <div class="card" style="margin-top:12px">',
      '        <span class="small muted">曲线显示：</span>',
      '        <label class="small" style="margin-left:10px"><input type="checkbox" v-model="show.water_temp"> 水温</label>',
      '        <label class="small" style="margin-left:10px"><input type="checkbox" v-model="show.dissolved_oxygen"> 溶解氧</label>',
      '        <label class="small" style="margin-left:10px"><input type="checkbox" v-model="show.light_intensity"> 光照强度</label>',
      '        <label class="small" style="margin-left:10px"><input type="checkbox" v-model="show.salinity"> 盐度</label>',
      '      </div>',
      '    </div>',
      '    <div class="card">',
      '      <div class="card-title">水质事件 / 告警（由规则实时判定）</div>',
      '      <div class="events">',
      '        <div v-if="!events.length" class="empty">本时段无越限事件</div>',
      '        <div v-for="it in visibleEvents" :key="it.id" class="row-item" @click="picked = it">',
      '          <span class="t">{{ time(it.ts) }}</span>',
      '          <span class="dot" :class="lvClass(it.level)"></span>',
      '          <span class="d">{{ it.text }}</span>',
      '        </div>',
      '        <button v-if="events.length > 5" class="small" style="margin-top:6px" @click="evOpen = !evOpen">',
      '          {{ evOpen ? \'收起\' : \'展开全部（\' + events.length + \' 条）\' }}',
      '        </button>',
      '      </div>',
      '      <div v-if="picked" class="hint" style="margin-top:10px">',
      '        <b>已选</b><br>{{ picked.text }}<br>',
      '        <span class="small">时间：{{ time(picked.ts) }}</span>',
      '      </div>',
      '    </div>',
      '  </div>',
      '',
      '  <!-- 异常界定指标（水质）：红点 / 告警标记依据 -->',
      '  <div class="card" style="margin-top:12px">',
      '    <div class="card-title">异常界定指标（红点 / 告警标记依据）',
      '      <help-dot :info="{ level: \'间接支持\', text: \'水温阈值与前端规则 R-TEMP-01 / R-TEMP-02 同口径（大黄鱼高告警线 28.0 ℃、高提示线 25.5 ℃）；不同网箱养不同鱼时，阈值按鱼种温度库自动取值（见管理板块）。溶解氧 / 盐度 / pH / 光照暂未配置界定规则，仅作监测展示。\', source: \'鱼种温度库 · 大黄鱼\' }" :label="\'界定依据说明\'" />',
      '    </div>',
      '    <div class="dt-wrap">',
      '      <table class="dt">',
      '        <thead><tr><th>指标</th><th>单位</th><th>正常参考</th><th>异常界定</th><th>依据</th></tr></thead>',
      '        <tbody>',
      '          <tr>',
      '            <td class="small"><b>水温</b></td><td class="small">℃</td><td class="small">＜25.5</td>',
      '            <td class="small"><span class="dot bg-yellow"></span>≥25.5 偏高提示（R-TEMP-02）／ <span class="dot bg-red"></span>≥28.0 水温上限告警（R-TEMP-01）</td>',
      '            <td class="small">鱼种温度库 · 大黄鱼</td>',
      '          </tr>',
      '          <tr>',
      '            <td class="small"><b>溶解氧</b></td><td class="small">mg/L</td><td class="small">—</td>',
      '            <td class="small muted">暂无界定规则</td><td class="small muted">—</td>',
      '          </tr>',
      '          <tr>',
      '            <td class="small"><b>盐度</b></td><td class="small">‰</td><td class="small">—</td>',
      '            <td class="small muted">暂无界定规则</td><td class="small muted">—</td>',
      '          </tr>',
      '          <tr>',
      '            <td class="small"><b>pH 值</b></td><td class="small">—</td><td class="small">—</td>',
      '            <td class="small muted">暂无界定规则</td><td class="small muted">—</td>',
      '          </tr>',
      '          <tr>',
      '            <td class="small"><b>光照强度</b></td><td class="small">lux</td><td class="small">—</td>',
      '            <td class="small muted">暂无界定规则</td><td class="small muted">—</td>',
      '          </tr>',
      '        </tbody>',
      '      </table>',
      '    </div>',
      '  </div>',
      '',
      '  <!-- 原始数据：快变量 + 慢变量两张表；可自定义时间窗、可导出 -->',
      '  <div class="card" style="margin-top:12px">',
      '    <div class="card-title">{{ rawTitle }}</div>',
      '    <div class="row" style="align-items:center">',
      '      <time-range :model-value="activePer.minutes" @update:model-value="onMinutes" />',
      '      <input type="number" min="5" max="1440" :value="activePer.minutes" @change="onCustomMin"',
      '             class="mono" style="width:88px" />',
      '      <span class="small muted">自定义分钟数（5–1440）</span>',
      '      <span style="flex:1"></span>',
      '      <button class="primary" @click="exportCsv">导出 CSV</button>',
      '    </div>',
      '    <!-- 问题二：真实站点公开数据支持自定义起止时间（年/月/日 时:分）查看更长远历史 -->',
      '    <div v-if="isObs" class="row" style="align-items:center;margin-top:8px;flex-wrap:wrap">',
      '      <span class="small muted">历史区间（真实站点公开数据）：</span>',
      '      <input type="datetime-local" v-model="rangeStart" class="mono" style="padding:2px 6px" />',
      '      <span class="small muted"> ~ </span>',
      '      <input type="datetime-local" v-model="rangeEnd" class="mono" style="padding:2px 6px" />',
      '      <button class="primary" style="padding:3px 10px" @click="queryRange">查询历史</button>',
      '      <button style="padding:3px 10px" @click="exitRange">返回实时</button>',
      '    </div>',
      '    <div v-if="rangeMsg" class="hint" style="margin-top:8px">{{ rangeMsg }}</div>',
      '    <div class="hint" style="margin-top:8px">',
      '      时间显示为「年/月/日 时:分:秒」，原始数据表按<b>最新在上</b>排列（导出 CSV 保持时间正序）。',
      '      快变量（水温 / 溶解氧 / 光照）5 秒一条，慢变量（盐度 / pH）30 秒一条。',
      '      切换「观测站点」后即为 NOAA NDBC 公开历史实测数据（NDBC 不测水质，故溶氧 / 光照等为「—」）。',
      '      真实站点按日期区间（年/月/日 时:分）查询历史，数据来自 NOAA NDBC 公开浮标实测库；',
      '      未挂载时可按「自定义分钟数」查看最近窗口。',
      '    </div>',
      '    <div class="card-title" style="margin-top:10px;font-size:13px">快变量</div>',
      '    <div class="dt-wrap">',
      '      <table class="dt">',
      '        <thead><tr><th>时间</th><th>站点</th><th>来源</th><th>质量</th>',
      '                <th>水温 (℃)</th><th>溶解氧 (mg/L)</th><th>光照 (lux)</th></tr></thead>',
      '        <tbody>',
      '          <tr v-for="r in rawRows" :key="r.ts">',
      '            <td class="mono small">{{ fmtTs(r.ts) }}</td>',
      '            <td class="small">{{ r.site_id }}</td>',
      '            <td class="small">{{ srcCn(r.source) }}</td>',
      '            <td class="small">{{ qCn(r.quality) }}</td>',
      '            <td class="mono">{{ r.water_temp == null ? \'—\' : r.water_temp }}</td>',
      '            <td class="mono">{{ r.dissolved_oxygen == null ? \'—\' : r.dissolved_oxygen }}</td>',
      '            <td class="mono">{{ r.light_intensity == null ? \'—\' : r.light_intensity }}</td>',
      '          </tr>',
      '          <tr v-if="!rawRows.length"><td colspan="7" class="muted small">暂无数据</td></tr>',
      '        </tbody>',
      '      </table>',
      '    </div>',
      '    <div class="card-title" style="margin-top:10px;font-size:13px">慢变量（盐度 / pH）</div>',
      '    <div class="dt-wrap">',
      '      <table class="dt">',
      '        <thead><tr><th>时间</th><th>站点</th><th>质量</th><th>盐度 (‰)</th><th>pH 值</th></tr></thead>',
      '        <tbody>',
      '          <tr v-for="r in slowRows" :key="r.ts">',
      '            <td class="mono small">{{ fmtTs(r.ts) }}</td>',
      '            <td class="small">{{ r.site_id }}</td>',
      '            <td class="small">{{ qCn(r.quality) }}</td>',
      '            <td class="mono">{{ r.salinity == null ? \'—\' : r.salinity }}</td>',
      '            <td class="mono">{{ r.ph == null ? \'—\' : r.ph }}</td>',
      '          </tr>',
      '          <tr v-if="!slowRows.length"><td colspan="5" class="muted small">暂无数据</td></tr>',
      '        </tbody>',
      '      </table>',
      '    </div>',
      '  </div>',
      '',
      '  <!-- 调试面板（仿真控制）：放在页面最下方 -->',
      '  <div class="card" style="margin-top:12px">',
      '    <div class="card-title">调试面板 · 仿真控制</div>',
      '    <div v-if="pauseText" class="hint" style="background:#FEF2F2;border-color:#FECACA">',
      '      <b>已暂停生成：</b>{{ pauseText }}',
      '    </div>',
      '    <div class="dt-wrap">',
      '      <table class="dt">',
      '        <thead><tr><th>站点</th><th>类型</th><th>状态</th><th>当前模式</th><th>操作</th></tr></thead>',
      '        <tbody>',
      '          <tr v-for="s in API.sites()" :key="s.site_id">',
      '            <td class="small"><b>{{ s.site_name }}</b> <span class="muted mono">{{ s.site_id }}</span></td>',
      '            <td class="small">{{ s.kind === \'obs\' ? \'观测\' : \'养殖\' }}</td>',
      '            <td class="small">',
      '              <!-- 问题一：真实站点是公开数据，不参与仿真，不存在暂停生成 -->',
      '              <span v-if="s.kind === \'obs\'" style="color:#166534">公开数据</span>',
      '              <span v-else :style="{ color: per && per[s.site_id] && per[s.site_id].paused ? \'#991B1B\' : \'#166534\' }">',
      '                {{ per && per[s.site_id] && per[s.site_id].paused ? \'已暂停\' : \'运行中\' }}',
      '              </span>',
      '            </td>',
      '            <td class="small">',
      '              <span v-if="s.kind === \'obs\'" class="muted">实时实测（不可模拟）</span>',
      '              <span v-else-if="per && per[s.site_id] && (per[s.site_id].heat || per[s.site_id].offline)" style="color:#991B1B">',
      '                {{ per[s.site_id].heat ? \'水温骤升\' : \'设备离线\' }}',
      '              </span>',
      '              <span v-else class="muted">正常</span>',
      '            </td>',
      '            <td class="small">',
      '              <span v-if="s.kind === \'obs\'" class="muted small">—（公开数据不参与仿真控制）</span>',
      '              <template v-else>',
      '                <button class="primary" style="padding:2px 8px" @click="togglePause(s.site_id)">',
      '                  {{ per && per[s.site_id] && per[s.site_id].paused ? \'恢复生成\' : \'暂停生成\' }}',
      '                </button>',
      '                <button style="padding:2px 8px;margin-left:6px" @click="toggleHeat(s.site_id)">',
      '                  {{ per && per[s.site_id] && per[s.site_id].heat ? \'恢复正常水温\' : \'触发水温骤升\' }}',
      '                </button>',
      '                <button style="padding:2px 8px;margin-left:6px" @click="toggleOffline(s.site_id)">',
      '                  {{ per && per[s.site_id] && per[s.site_id].offline ? \'恢复设备在线\' : \'模拟设备离线\' }}',
      '                </button>',
      '              </template>',
      '            </td>',
      '          </tr>',
      '        </tbody>',
      '      </table>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="opbar" style="margin:12px -16px -16px; border-radius:0">',
      '    <time-range :model-value="activePer.minutes" @update:model-value="onMinutes" />',
      '    <span style="width:12px"></span>',
      '    <span class="small muted">站点</span>',
      '    <select v-model="site">',
      '      <option v-for="s in API.sites()" :key="s.site_id" :value="s.site_id">{{ s.site_name }}</option>',
      '    </select>',
      '    <span style="flex:1"></span>',
      '    <span class="small muted">口径：{{ API.disclaimer }}</span>',
      '  </div>',
      '</div>'
    ].join('\n')
  };

  /* ============================================================
     两页共用的来源 / 质量中文映射（界面不许裸英文，硬规矩 3）
     ============================================================ */
  function srcCn(src) {
    return { simulated: '仿真数据', public: '公开数据', real: '真实数据', demo: '演示数据' }[src] || src || '—';
  }
  function qCn(q) {
    return { good: '良好', stale: '超时未更新', suspect: '疑似异常' }[q] || q || '—';
  }
  function downloadCsv(name, csv) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }
  /* 供模板与 methods 共用（页面作用域内可直接引用） */
  global.__ENV_CN__ = { srcCn: srcCn, qCn: qCn, downloadCsv: downloadCsv };

})(window);

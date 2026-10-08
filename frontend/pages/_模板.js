/* ============================================================
   _模板.js —— 新页面照着这个填
   ============================================================
   ⚠️ 这个文件**不用改**，是给大家抄的样板。
      文件名以 `_` 开头 = 不是真页面，平台不会加载它、验收也会跳过它。

   【怎么用】
     1. 复制这个文件，改名成你板块的名字：fish.js / env.js / struct.js / ai.js
        （文件已存在的话，直接在里面加，不要新建）
     2. 把下面的 PAGES['/xxx/yyy'] 改成你要做的那个路由
        （路由在《菜单结构与页面清单.md》里已经定好了，别自己发明）
     3. 照抄结构，把 TODO 的地方换成真东西
     4. 双击 验收检查.bat，8 项全过 → 发 PR

   【三条硬规矩】
     1. 用 components.js 里已有的公共件（stat-card / trend-chart / event-list …），
        不要自己重写一套 —— 全平台要长一个样
     2. 数据一律走 API.xxx()，不要写死数字，也不要直接读别的板块的数据；
        拿不到就显示「—」，**不许编**
     3. 界面上不许出现裸英文（比如 quality='good'），必须经 CN 表转成中文

   建立：2026-10-06
   ============================================================ */
(function (global) {
  'use strict';
  /* 这行照抄。每个页面文件都自己初始化一次，所以加载顺序无所谓。 */
  const PAGES = global.PAGES || (global.PAGES = {});

  /* ============================================================
     ↓↓↓ 复制从这里开始 ↓↓↓
     ============================================================ */

  PAGES['/fish/growth'] = {          /* ← 改成你的路由（必须和菜单里的路径一致） */

    /* ---------- data：这个页面自己的状态 ---------- */
    data: function () {
      return {
        minutes: 60,        /* 时间窗，配合 <time-range v-model="minutes"> 用 */
        tick: 0,            /* ⚠️ 下面会解释为什么必须有这个 */
        unsub: null,
        series: null
      };
    },

    /* ---------- computed：由状态算出来的东西 ---------- */
    computed: {
      /* ⚠️⚠️ 这个 `this.tick` 不是多余的，删了页面就会一直是空的。
         原因：数据是后端异步拉来的，而 Vue 对「没有响应式依赖的 computed」
         会永久缓存 —— 不读一次 tick，数据回来了它也不会重算。
         队长已经被这个坑绊过三次了，照抄就行。 */
      rows: function () {
        this.tick;
        const d = API.xxx();          /* ← 改成你要的接口 */
        return (d && d.items) || [];
      },
      last: function () {
        return this.rows.length ? this.rows[this.rows.length - 1] : {};
      },
      /* 图表数据：格式是 [[时间戳, 数值], ...] */
      charts: function () {
        return [
          { name: '平均体重', unit: 'g',
            data: this.rows.map(function (r) { return [r.ts, r.avg_weight_g]; }) }
        ];
      }
    },

    methods: {
      load: function () {
        const self = this;
        API.resolve(API.xxx(this.minutes), function (d) { self.series = d; });
      }
    },

    /* ---------- 生命周期 ---------- */
    mounted: function () {
      /* API.bind = 一行管两件事：
           ① 数据变化时让 tick++（触发 computed 重算）
           ② **每 3 秒自动重新拉一次曲线**，图表才会"动"
         🔴 2026-10-07 加的第 ②：原来曲线只在进页面时拉一次，是张静止的快照 ——
            组员发现「调了档位图不动，刷新一下才变」，根子就在这里。
         **有曲线图的页面都必须这么接。** */
      this.unsub = API.bind(this, this.load);
      this.load();
    },
    beforeUnmount: function () {
      /* 必须取消订阅，否则切来切去会越积越多、越跑越卡 */
      if (this.unsub) { this.unsub(); this.unsub = null; }
    },

    /* 时间窗一变就重新拉数据 */
    watch: {
      minutes: function () { this.load(); }
    },

    /* ---------- template：页面长什么样 ----------
       注意：这里是一个**字符串数组**，每行一个字符串，用 .join('\n') 拼起来。
       行尾不要漏逗号，字符串里的单引号要写成 \' —— 漏一个标点整个前端会白屏。 */
    template: [
      '<div>',
      '',
      '  <!-- ① 页头：标题 + 一句话说明 + 数据来源标签（必须有，不然验收不过） -->',
      '  <page-head title="鱼类 · 生长模型与预测"',
      '    desc="由体长体重参数估算生长曲线，预测到达上市规格的时间"',
      '    :sources="[\'public\',\'simulated\']" />',
      '',
      '  <!-- ② 数值卡区：用 stat-card 公共件，不要自己写 div -->',
      '  <div class="grid-stats">',
      '    <stat-card name="平均体重" field="avg_weight" unit="g"',
      '               :value="last.avg_weight_g" :quality="last.quality" :ts="last.ts"',
      '               source="simulated" />',
      '    <stat-card name="预估存箱量" field="count" unit="尾"',
      '               :value="last.count" source="simulated" />',
      '  </div>',
      '',
      '  <!-- ③ 主图区 -->',
      '  <div class="split" style="margin-top:12px">',
      '    <trend-chart title="生长曲线" :series="charts" />',
      '    <div class="card">',
      '      <div class="card-title">预测结论</div>',
      '      <div v-if="rows.length" class="small">',
      '        按当前生长速度，预计 <b>{{ last.eta_days }}</b> 天后达到上市规格。',
      '      </div>',
      '      <div v-else class="muted small">',
      '        暂无数据 —— 需要后端。请双击 <b>启动平台.bat</b>。',
      '      </div>',
      '    </div>',
      '  </div>',
      '',
      '  <!-- ④ 操作条：时间窗等控件放这里，固定在底部 -->',
      '  <div class="opbar" style="margin:12px -16px -16px; border-radius:0">',
      '    <time-range v-model="minutes" />',
      '  </div>',
      '',
      '</div>'
    ].join('\n')
  };

  /* ============================================================
     ↑↑↑ 复制到这里结束 ↑↑↑
     ============================================================ */

})(window);

/* ============================================================
   【提交前必须做的三件事】
     1. 双击 验收检查.bat —— 8 项必须全过。
        全过不了就别发 PR：**你的一个标点写错，会把所有 17 个页面一起弄白屏。**
     2. 用浏览器打开你的页面，按 F12 看 Console。
        **Errors 必须是 0。**
        ⚠️ 这一条特别重要：Vue 会把计算属性里的报错**吞掉**，
           页面看着正常、某个列表却永远是空的 —— 验收脚本查不出来，只有控制台能看到。
     3. 把时间窗、按钮都点一遍，看有没有反应。

   【常用件在哪查】
     打开 frontend/components.js，看开头的注释块，里面列了所有公共件和用法。
     要用的东西那里没有，先在群里问 —— 不要自己新写一个。

   【能用哪些接口】
     见《统一数据接口文档-v1.0.md》。要新接口就在 PR 里说明，
     后端文件在 backend/api/ 下，你的板块有自己那个文件。
   ============================================================ */

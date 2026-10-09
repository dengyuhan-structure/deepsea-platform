/* ============================================================
   app.js —— 平台骨架：四区域布局 + 菜单 + 路由
   ============================================================
   依据：
     前端骨架规范.md 2.1 四区域结构 / 2.2 区域归属 / 1.2 菜单树（终版 24 页）
     功能冻结清单-10-05.md 1.1 页面清单（10-09 交 13 页，终版 24 页）

   区域归属（骨架规范 2.2）：
     ① 顶部横条  —— 骨架维护，别人不要改
     ② 左侧菜单  —— 骨架维护
     ③ 主内容区  —— 各页面自己写
     ④ 操作条    —— 各页面自己写

   建立：2026-10-05
   ============================================================ */
(function () {
  'use strict';

  /* 菜单树：ready = 10-09 必交的 13 页；其余为 10-23 终版补齐 */
  const MENU = [
    { group: '平台', items: [
      { path: '/overview', label: '总览大屏', ready: true }
    ]},
    { group: '鱼类', owner: '王浩然', items: [
      { path: '/fish/monitor',  label: '鱼类监测总览', ready: true },
      { path: '/fish/heatmap',  label: '鱼群分布热力图', ready: true },
      { path: '/fish/growth',   label: '生长模型与预测', ready: false },
      { path: '/fish/records',  label: '原始数据明细', ready: false },
      { path: '/fish/simulator',label: '鱼类仿真控制', ready: false }
    ]},
    { group: '环境', owner: '刘伟豪', items: [
      { path: '/env/sea',    label: '海况', ready: true },
      { path: '/env/water',  label: '水质', ready: true },
      { path: '/env/records',label: '原始数据明细', ready: false },
      { path: '/env/simulator', label: '环境仿真控制', ready: false }
    ]},
    { group: '结构安全', owner: '邓宇涵', items: [
      { path: '/struct/overview', label: '结构安全总览', ready: false },
      { path: '/struct/alarm',  label: '灾害分级预警', ready: true },
      { path: '/struct/energy', label: '能源保障', ready: true },
      { path: '/struct/detail', label: '监测详情', ready: false },
      { path: '/struct/rules',  label: '规则配置', ready: false },
      { path: '/struct/fault',  label: '造故障工具', ready: false }
    ]},
    { group: '智能', owner: '李志成', items: [
      { path: '/ai/feed',  label: '自动投喂', ready: true },
      { path: '/ai/light', label: '智能补光', ready: true },
      { path: '/ai/devices', label: '设备状态', ready: false },
      { path: '/ai/commands',label: '指令日志', ready: false }
    ]},
    { group: '跨板块', owner: '顶层统一', items: [
      { path: '/alarm',  label: '告警中心', ready: true },
      { path: '/handle', label: '处置中心', ready: true },
      { path: '/trace',  label: '追溯查询', ready: true },
      { path: '/config', label: '参数配置', ready: true }
    ]},
    /* 管理板块 —— 养殖生产视角（场长用），与上面「参数配置」的技术参数视角区分开：
         参数配置 = 阈值/规则（工程师改，很少动）
         管理板块 = 哪个网箱养什么鱼、放了多少、设备标定到没到期（每批鱼都变）
       这是「配置驱动」的落点：这里改了鱼种，全平台阈值跟着变。 */
    { group: '管理', owner: '场长 / 运维', items: [
      { path: '/mgmt/cages',       label: '网箱与站点',   ready: true },
      { path: '/mgmt/species',     label: '鱼种档案',     ready: true },
      { path: '/mgmt/ledger',      label: '存箱量台账',   ready: true },
      { path: '/mgmt/calibration', label: '标定与维护',   ready: true }
    ]}
  ];

  /* ---------- 路由：hash 实现，免构建、无依赖 ---------- */
  const Router = {
    _path: '/overview',
    _subs: [],
    norm: function (h) {
      let p = (h || '').replace(/^#/, '');
      if (!p) p = '/overview';
      if (p.charAt(0) !== '/') p = '/' + p;
      return p.replace(/\/+$/, '') || '/overview';
    },
    get: function () { return this._path; },
    go: function (p) { window.location.hash = p; },
    onChange: function (f) { this._subs.push(f); },
    start: function () {
      const self = this;
      const apply = function () {
        self._path = self.norm(window.location.hash);
        self._subs.forEach(function (f) { f(self._path); });
      };
      window.addEventListener('hashchange', apply);
      if (!window.location.hash) window.location.hash = '/overview';
      apply();
    }
  };

  /* ---------- 顶部大板块切换 ---------- */
  const TABS = [
    { key: 'overview', label: '总览', first: '/overview' },
    { key: 'fish',     label: '鱼类', first: '/fish/monitor' },
    { key: 'env',      label: '环境', first: '/env/sea' },
    { key: 'struct',   label: '结构安全', first: '/struct/overview' },
    { key: 'ai',       label: '智能', first: '/ai/feed' },
    { key: 'global',   label: '跨板块', first: '/alarm' },
    /* 管理板块 —— 养殖生产视角（场长用）。
       放在最后：它是配置类不是监控类。 */
    { key: 'mgmt',     label: '管理', first: '/mgmt/cages' }
  ];

  const App = {
    data: function () {
      return { path: '/overview', menu: MENU, tabs: TABS, err: null };
    },
    computed: {
      /* 当前一级板块 */
      tabKey: function () {
        const p = this.path;
        if (p === '/overview') return 'overview';
        if (p.indexOf('/fish') === 0) return 'fish';
        if (p.indexOf('/env') === 0) return 'env';
        if (p.indexOf('/struct') === 0) return 'struct';
        if (p.indexOf('/ai') === 0) return 'ai';
        if (p.indexOf('/mgmt') === 0) return 'mgmt';
        return 'global';
      },
      /* 左侧菜单只显示当前板块。
         🔴 2026-10-06 改：`ready` 不再看菜单里的写死值，改成**按实际注册的路由自动判断** ——
            只要某个组员的页面文件里注册了 PAGES['/fish/growth']，这一项就自动亮起来。
            目的：组员加页面时**完全不用碰 app.js**（这是公共文件，多人改必冲突）。
            菜单里 ready:false 的项仍然留着，作为「计划要做但还没做」的占位。 */
      sideGroups: function () {
        const k = this.tabKey;
        const want = { overview: '平台', fish: '鱼类', env: '环境',
                       struct: '结构安全', ai: '智能', global: '跨板块',
                       mgmt: '管理' }[k];
        /* ready 按**实际注册的路由**判断，不看菜单里的写死值 ——
           这样组员只要注册了 PAGES['/fish/growth']，菜单项就自动从「·待建」变成可点。 */
        const reg = window.PAGES || {};
        return this.menu
          .filter(function (g) { return g.group === want; })
          .map(function (g) {
            return {
              group: g.group,
              owner: g.owner,
              items: g.items.map(function (it) {
                return { path: it.path, label: it.label, ready: !!reg[it.path] };
              })
            };
          });
      },
      /* 当前页面的组件 */
      page: function () {
        const def = (window.PAGES || {})[this.path];
        if (def) return def;
        return {
          template:
            '<div><page-head title="页面待建" desc="这一页排在 10-23 终版补齐（不在 10-09 的 13 页里）"></page-head>' +
            '<div class="todo">本页尚未实现。<br><span class="small">10-09 必交的 13 页见「功能冻结清单-10-05.md」1.1 节。</span></div></div>'
        };
      },
      pathLabel: function () { return this.path; }
    },
    methods: {
      pick: function (p) { Router.go(p); },
      tabPick: function (t) { Router.go(t.first); }
    },
    mounted: function () {
      const self = this;
      Router.onChange(function (p) { self.path = p; });
      Router.start();
      window.addEventListener('error', function (e) { self.err = e.message; });
    },
    template: [
      '<div class="shell">',
      '  <!-- ① 顶部横条 56px -->',
      '  <div class="topbar">',
      '    <div class="brand">深远海养殖与海洋牧场智能管控平台</div>',
      '    <div class="tabs">',
      '      <div v-for="t in tabs" :key="t.key" class="tab" :class="{ active: tabKey === t.key }"',
      '           @click="tabPick(t)">{{ t.label }}</div>',
      '    </div>',
      '    <div class="spacer"></div>',
      '    <source-tag :source="\'simulated\'" />',
      '  </div>',
      '',
      '  <div class="body">',
      '    <!-- ② 左侧菜单 200px -->',
      '    <div class="sidenav">',
      '      <template v-for="g in sideGroups" :key="g.group">',
      '        <div class="group">{{ g.group }}<span v-if="g.owner"> · {{ g.owner }}</span></div>',
      '        <div v-for="it in g.items" :key="it.path" class="item"',
      '             :class="{ active: path === it.path }" @click="pick(it.path)">',
      '          {{ it.label }}<span v-if="!it.ready" class="small muted"> ·待建</span>',
      '        </div>',
      '      </template>',
      '    </div>',
      '',
      '    <!-- ③ 主内容区 -->',
      '    <div class="main">',
      '      <div class="content">',
      '        <div v-if="err" class="hint" style="margin-bottom:12px">页面脚本报错：{{ err }}</div>',
      '        <component :is="page" :key="path"></component>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('\n')
  };

  const app = Vue.createApp(App);
  /* 模板里要用 API.sites() 之类 —— Vue 模板只能访问组件实例上的东西，
     访问不到 window 全局，所以必须挂到 globalProperties 上。 */
  app.config.globalProperties.API = window.API;
  /* 枚举中文标签（通用规范 第五节）—— 模板里写 {{ CN.deviceState(x) }} */
  app.config.globalProperties.CN = window.CN;
  /* 注册通用组件（骨架规范 第三节） */
  app.component('source-tag', C.SourceTag);
  app.component('stat-card', C.StatCard);
  app.component('trend-chart', C.TrendChart);
  app.component('heat-grid', C.HeatGrid);
  app.component('event-list', C.EventList);
  app.component('time-range', C.TimeRangePicker);
  app.component('command-flow', C.CommandFlow);
  app.component('page-head', C.PageHead);
  app.component('help-dot', C.HelpDot);   /* 阈值依据：灰色问号 + 悬停看解释与出处 */
  app.mount('#app');

  window.ROUTER = Router;
})();

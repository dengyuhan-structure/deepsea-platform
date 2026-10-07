/* ============================================================
   结构安全页面组件
   与 frontend/pages.js 保持一致：Vue 3 全局版 + Options API + 普通 JS。

   本文件先提供页面组件定义，不修改当前页面加载入口。
   接入时由入口代码把 window.STRUCT_PAGES 合并进 window.PAGES。
   没有接口数据时明确显示「等待数据接入」，不伪造仿真值。
   ============================================================ */
(function (global) {
  'use strict';

  const P = {};

  function header(title, desc) {
    return [
      '<div style="margin-bottom:12px">',
      '  <div style="font-size:18px;font-weight:700">' + title + '</div>',
      '  <div class="small muted">' + desc + '</div>',
      '</div>'
    ].join('\n');
  }

  function waiting(text) {
    return [
      '<div style="display:flex;align-items:center;gap:8px;padding:12px 2px;color:var(--c-muted)">',
      '  <b style="font-size:18px">—</b>',
      '  <span>' + text + '</span>',
      '</div>'
    ].join('\n');
  }

  function metric(name, field, unit, note) {
    return [
      '<div class="card">',
      '  <div class="small muted">' + name + '</div>',
      '  <div style="font-size:21px;font-weight:700;margin:5px 0">— <span class="small muted">' + unit + '</span></div>',
      '  <div class="small muted mono">' + field + '</div>',
      '  <div class="small muted">' + note + '</div>',
      '</div>'
    ].join('\n');
  }

  /* 网箱结构总览 */
  P['/struct/overview'] = {
    data: function () { return {}; },
    template: [
      '<div>',
      header('结构安全 · 网箱结构总览', '汇总锚泊、网衣、姿态和能源状态；数据接入后显示最新值。'),
      '  <div class="grid-stats">',
      metric('锚泊张力', 'anchor_tension', 'kN', '传感数据待接入'),
      metric('网衣区域拉力', 'net_area_tension', 'kN', '分区数据待确认'),
      metric('网箱倾斜角', 'tilt_angle', '°', '合成口径待确认'),
      metric('储能电量', 'battery_soc', '%', '传感数据待接入'),
      '  </div>',
      '  <div class="split" style="margin-top:12px">',
      '    <div class="card">',
      '      <div class="card-title">网箱监测示意</div>',
      '      <div style="max-width:420px;margin:8px auto;padding:14px;border:1px solid #D1D5DB;border-radius:8px;text-align:center" aria-label="网箱结构示意图">',
      '        <div class="small muted" style="margin-bottom:10px">锚点与网箱监测区域</div>',
      '        <div style="display:grid;grid-template-columns:1fr 1fr;border:1px solid #9CA3AF">',
      '          <span style="padding:18px;border:1px solid #D1D5DB">区域 A</span><span style="padding:18px;border:1px solid #D1D5DB">区域 B</span>',
      '          <span style="padding:18px;border:1px solid #D1D5DB">区域 C</span><span style="padding:18px;border:1px solid #D1D5DB">区域 D</span>',
      '        </div>',
      '        <div class="small muted">示意区域，不代表真实传感器位置或受力值</div>',
      '      </div>',
      '    </div>',
      '    <div class="card">',
      '      <div class="card-title">当前状态</div>',
      waiting('结构传感数据尚未接入，暂不计算整体风险。'),
      '      <div class="small muted" style="margin-top:10px">传感器未接入或离线时显示「—」，不沿用旧值。</div>',
      '    </div>',
      '  </div>',
      '  <div class="hint" style="margin-top:12px">阈值来源：经验阈值，未经现场标定。接入数据后需同时显示来源和质量状态。</div>',
      '</div>'
    ].join('\n')
  };

  /* 锚泊张力、网衣监测、形变与姿态 */
  P['/struct/detail'] = {
    data: function () { return {}; },
    template: [
      '<div>',
      header('结构安全 · 监测详情', '包含锚泊张力预警、网衣受力监测、形变与姿态监测。'),
      '  <div class="card" style="margin-bottom:12px">',
      '    <div class="card-title">锚泊张力预警</div>',
      '    <div class="grid-stats">',
      metric('锚链张力', 'anchor_tension', 'kN', '模拟器数据待接入'),
      metric('设计张力', 'design_tension', 'kN', '需由结构安全侧配置'),
      metric('占设计值比例', 'tension_pct', '%', '张力 ÷ 设计张力 × 100'),
      '    </div>',
      '    <div class="small muted" style="margin-top:10px">经验阈值：80% 黄色、95% 红色；未经现场标定。</div>',
      waiting('张力时序数据尚未接入。'),
      '  </div>',
      '  <div class="card" style="margin-bottom:12px">',
      '    <div class="card-title">网衣监测</div>',
      '    <div style="display:grid;grid-template-columns:repeat(4,minmax(90px,1fr));gap:8px;text-align:center">',
      '      <div class="card" style="background:#F5F7FA">区域 A<br><b>— kN</b></div>',
      '      <div class="card" style="background:#F5F7FA">区域 B<br><b>— kN</b></div>',
      '      <div class="card" style="background:#F5F7FA">区域 C<br><b>— kN</b></div>',
      '      <div class="card" style="background:#F5F7FA">区域 D<br><b>— kN</b></div>',
      '    </div>',
      '    <div class="small muted" style="margin-top:8px">分区示意；区域编号和分区拉力接口待确认。当前没有受力值或破损判定。</div>',
      '  </div>',
      '  <div class="card">',
      '    <div class="card-title">形变与姿态监测</div>',
      '    <div class="grid-stats">',
      metric('横滚角', 'tilt_roll', '°', '传感器数据待接入'),
      metric('俯仰角', 'tilt_pitch', '°', '传感器数据待接入'),
      metric('倾斜角合量', 'tilt_angle', '°', '合成算法需确认'),
      metric('形变量', 'deformation', 'm', '计算口径需确认'),
      '    </div>',
      '    <div class="small muted" style="margin-top:10px">三轴加速度：accel_x / accel_y / accel_z（m/s²）。倾角经验阈值为 2° / 3°，未经现场标定。</div>',
      waiting('姿态、位移和形变数据尚未接入。'),
      '  </div>',
      '</div>'
    ].join('\n')
  };

  /* 灾害分级预警 */
  P['/struct/alarm'] = {
    data: function () { return { selected: null }; },
    methods: {
      selectAlarm: function (name) { this.selected = name; }
    },
    template: [
      '<div>',
      header('结构安全 · 灾害分级预警', '结合海况和结构传感数据展示预警；每条预警应能追溯触发数据与规则。'),
      '  <div class="grid-stats">',
      metric('当前最高等级', 'risk_level', '—', '等待规则判断'),
      metric('浪高', 'wave_height', 'm', '环境接口待接入'),
      metric('风速', 'wind_speed', 'm/s', '环境接口：公开 / 仿真'),
      metric('海水流速', 'current_speed', 'm/s', '环境接口：公开 / 仿真'),
      '  </div>',
      '  <div class="split" style="margin-top:12px">',
      '    <div class="card">',
      '      <div class="card-title">预警列表</div>',
      waiting('环境接口和结构传感数据尚未接入，不生成预警记录。'),
      '    </div>',
      '    <div class="card">',
      '      <div class="card-title">触发依据</div>',
      '      <div v-if="selected" class="small">{{ selected }}</div>',
      '      <div v-else class="small muted">选择一条预警后显示触发指标、阈值、规则编号和数据快照。</div>',
      '    </div>',
      '  </div>',
      '  <div class="hint" style="margin-top:12px">已约定字段名 current_speed，单位 m/s。预警阈值为经验值，未经现场标定；灾害组合规则仍需确认。</div>',
      '</div>'
    ].join('\n')
  };

  /* 能源保障 */
  P['/struct/energy'] = {
    data: function () { return {}; },
    template: [
      '<div>',
      header('结构安全 · 能源保障', '查看光伏供电、储能余量和设备功耗；数据接入后再计算供电状态。'),
      '  <div class="grid-stats">',
      metric('光伏发电功率', 'pv_power', 'kW', '模拟器数据待接入'),
      metric('储能电量', 'battery_soc', '%', '模拟器数据待接入'),
      metric('储能剩余电量', 'battery_energy', 'kWh', '容量配置待确认'),
      metric('总功耗', 'total_power', 'kW', '单设备功耗汇总待确认'),
      '  </div>',
      '  <div class="split" style="margin-top:12px">',
      '    <div class="card">',
      '      <div class="card-title">供电关系</div>',
      '      <div style="display:flex;align-items:center;justify-content:space-around;gap:8px;flex-wrap:wrap;text-align:center">',
      '        <div class="card" style="background:#F5F7FA">光伏<br><span class="small muted">pv_power · kW</span></div>',
      '        <span class="muted">→</span>',
      '        <div class="card" style="background:#F5F7FA">储能<br><span class="small muted">battery_soc · %</span></div>',
      '        <span class="muted">→</span>',
      '        <div class="card" style="background:#F5F7FA">设备<br><span class="small muted">total_power · kW</span></div>',
      '      </div>',
      waiting('功率和储能数据尚未接入。'),
      '    </div>',
      '    <div class="card">',
      '      <div class="card-title">计算说明</div>',
      '      <div class="small">储能剩余电量 = 储能比例 ÷ 100 × 电池总容量</div>',
      '      <div class="small" style="margin-top:8px">能源自给率 = 光伏发电功率 ÷ 总功耗</div>',
      '      <div class="small muted" style="margin-top:10px">电池容量、功耗为零时的处理方式需确认。</div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('\n')
  };

  /* 接入时由页面入口合并到 PAGES；本文件目前不改写全局路由表。 */
  global.STRUCT_PAGES = P;
})(window);

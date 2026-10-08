# ============================================================
#  sync_docs.ps1 —— 把冻结文档的正本同步进仓库 docs/
#
#  为什么需要它：文档正本在比赛根目录（队长维护），仓库里只要快照。
#               两边都手改就会出现两份不一样的文档。
#
#  用法：  pwsh scripts/sync_docs.ps1
#          pwsh scripts/sync_docs.ps1 -WhatIfOnly    # 只看会同步什么，不复制
#
#  建立：2026-10-05，刘桐麟
# ============================================================
[CmdletBinding()]
param(
    [switch]$WhatIfOnly
)

$ErrorActionPreference = 'Stop'

# 仓库根 = 本脚本所在目录的上一级
$RepoRoot   = Split-Path -Parent $PSScriptRoot
$DocsDir    = Join-Path $RepoRoot 'docs'
# 正本目录 = 仓库的上一级
$SourceRoot = Split-Path -Parent $RepoRoot

# 要同步的文档（正本文件名 -> 保持同名）
#   .md   —— 正本直接复制
#   .docx —— 由 tools/build_frozen_docs.py 从 .md 生成，也给组员看；
#            GitHub上传教程 第七节明确说 .docx 文档要传
$DocNames = @(
    '统一数据接口文档-v1.0.md'
    '功能冻结清单-10-05.md'
    '项目通用规范.md'
    '前端骨架规范.md'
    '菜单结构与页面清单.md'
    '公共件清单.md'
    '设备与接口对接说明.md'
    '任务拆解-到10-16.md'
    '项目总体计划-发送版.md'
    '项目记录.md'
    '统一数据接口文档-v1.0.docx'
    '功能冻结清单-10-05.docx'
    # 2026-10-06 新增：协作类文档
    #   AI协作指南**必须**进仓库 —— 给组员 AI 的提示里写着「先读仓库里的《AI协作指南.md》」，
    #   不放进仓库，那句话就是空的。
    'AI协作指南.md'
    'GitHub提交教程-零基础.md'
    '任务单-1006到1009.md'
    'AI协作指南.docx'
    'GitHub提交教程-零基础.docx'
    '任务单-1006到1009.docx'
)

Write-Host ''
Write-Host '  正本目录：' -NoNewline -ForegroundColor DarkGray; Write-Host $SourceRoot
Write-Host '  快照目录：' -NoNewline -ForegroundColor DarkGray; Write-Host $DocsDir
Write-Host ''

if (-not (Test-Path $DocsDir)) {
    New-Item -ItemType Directory -Force -Path $DocsDir | Out-Null
}

$copied = 0
$missing = 0

foreach ($name in $DocNames) {
    $src = Join-Path $SourceRoot $name
    $dst = Join-Path $DocsDir    $name

    if (-not (Test-Path $src)) {
        Write-Host ('  [缺] ' + $name) -ForegroundColor Yellow
        Write-Host '        正本不存在，跳过。' -ForegroundColor DarkGray
        $missing++
        continue
    }

    if ($WhatIfOnly) {
        Write-Host ('  [看] ' + $name) -ForegroundColor Cyan
        $copied++
        continue
    }

    Copy-Item -LiteralPath $src -Destination $dst -Force

    $len = (Get-Item -LiteralPath $dst).Length
    Write-Host ('  [OK] ' + $name) -NoNewline -ForegroundColor Green
    Write-Host ("   $([math]::Round($len/1024,1)) KB") -ForegroundColor DarkGray
    $copied++
}

Write-Host ''
if ($WhatIfOnly) {
    Write-Host "  将同步 $copied 份（未复制）。" -ForegroundColor Cyan
} else {
    Write-Host "  已同步 $copied 份。" -NoNewline -ForegroundColor Green
    if ($missing -gt 0) {
        Write-Host "  缺失 $missing 份（见上）。" -ForegroundColor Yellow
    } else {
        Write-Host ''
    }
}
Write-Host ''
Write-Host '  提醒：docs/ 是快照，正本在比赛根目录。' -ForegroundColor DarkGray
Write-Host '        改内容请改正本，再跑一次本脚本。' -ForegroundColor DarkGray
Write-Host ''

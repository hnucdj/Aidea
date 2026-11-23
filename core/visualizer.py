"""
可视化方案：不依赖 matplotlib，使用 Plotly.js 生成 HTML
这样 CLI / Web 都能复用同一套前端模板，零额外二进制依赖
"""
import os
import json
import logging
from datetime import datetime
from typing import Dict, Any, List

from config import OUTPUT_DIR, PLATFORM_COLORS, PLATFORM_NAMES

logger = logging.getLogger(__name__)


# ---------------- 离线版数据：示例数据集 ----------------
# 用于首次打开 Web 时直接渲染演示
def build_demo_dataset(keyword: str = "iPhone 15 Pro") -> Dict[str, Any]:
    return {
        "keyword": keyword,
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "stats": [
            {"platform": "jd", "platform_name": "京东",
             "count": 12, "price_min": 6499.0, "price_max": 9999.0,
             "price_avg": 7620.5, "price_median": 7499.0,
             "sales_total": 158200, "rating_avg": 4.9},
            {"platform": "taobao", "platform_name": "淘宝",
             "count": 15, "price_min": 6299.0, "price_max": 9899.0,
             "price_avg": 7410.2, "price_median": 7299.0,
             "sales_total": 201300, "rating_avg": 4.8},
            {"platform": "pdd", "platform_name": "拼多多",
             "count": 10, "price_min": 5999.0, "price_max": 8999.0,
             "price_avg": 6890.7, "price_median": 6799.0,
             "sales_total": 312500, "rating_avg": 4.7},
            {"platform": "ALL", "platform_name": "全部平台",
             "count": 37, "price_min": 5999.0, "price_max": 9999.0,
             "price_avg": 7307.1, "price_median": 7299.0,
             "sales_total": 672000, "rating_avg": 4.8},
        ],
        "cross_compare": [
            {"platform": "jd", "platform_name": "京东",
             "lowest_price": 6499.0,
             "item_name": f"{keyword} 京东自营 128G",
             "item_url": "https://item.jd.com/100058809394.html",
             "shop_name": "京东自营", "rating": 4.9, "sales": 98000},
            {"platform": "taobao", "platform_name": "淘宝",
             "lowest_price": 6299.0,
             "item_name": f"{keyword} 天猫旗舰店 128G",
             "item_url": "https://detail.tmall.com/item.htm?id=768420912345",
             "shop_name": "Apple官方旗舰店", "rating": 4.9, "sales": 123400},
            {"platform": "pdd", "platform_name": "拼多多",
             "lowest_price": 5999.0,
             "item_name": f"{keyword} 百亿补贴 128G",
             "item_url": "https://mobile.yangkeduo.com/goods1.html?goods_id=789456123",
             "shop_name": "Apple产品店", "rating": 4.8, "sales": 156700},
        ],
        "distribution": [
            {"range_start": 5999, "range_end": 6299, "count": 3},
            {"range_start": 6299, "range_end": 6799, "count": 8},
            {"range_start": 6799, "range_end": 7499, "count": 12},
            {"range_start": 7499, "range_end": 7999, "count": 6},
            {"range_start": 7999, "range_end": 8599, "count": 4},
            {"range_start": 8599, "range_end": 9999, "count": 4},
        ],
        "items": [
            {"platform": "pdd", "keyword": keyword,
             "name": f"{keyword} 百亿补贴 128G 全新国行",
             "price": 5999.0, "original_price": 7999.0,
             "sales": 156700, "rating": 4.8, "shop_name": "Apple产品店",
             "url": "https://mobile.yangkeduo.com/goods1.html?goods_id=789456123",
             "crawled_at": "2026-11-23 10:00:00", "value_score": 0.92,
             "recommend": "性价比推荐"},
            {"platform": "pdd", "keyword": keyword,
             "name": f"{keyword} 百亿补贴 256G",
             "price": 6499.0, "original_price": 8999.0,
             "sales": 98400, "rating": 4.7, "shop_name": "Apple产品店",
             "url": "https://mobile.yangkeduo.com/goods1.html?goods_id=789456124",
             "crawled_at": "2026-11-23 10:00:00", "value_score": 0.85,
             "recommend": ""},
            {"platform": "jd", "keyword": keyword,
             "name": f"{keyword} 京东自营 128G 24期免息",
             "price": 6499.0, "original_price": 7999.0,
             "sales": 98000, "rating": 4.9, "shop_name": "京东自营",
             "url": "https://item.jd.com/100058809394.html",
             "crawled_at": "2026-11-23 10:00:00", "value_score": 0.81,
             "recommend": "性价比推荐"},
            {"platform": "taobao", "keyword": keyword,
             "name": f"{keyword} 天猫旗舰店 128G",
             "price": 6299.0, "original_price": 7999.0,
             "sales": 123400, "rating": 4.9, "shop_name": "Apple官方旗舰店",
             "url": "https://detail.tmall.com/item.htm?id=768420912345",
             "crawled_at": "2026-11-23 10:00:00", "value_score": 0.89,
             "recommend": "性价比推荐"},
            {"platform": "jd", "keyword": keyword,
             "name": f"{keyword} 京东自营 256G",
             "price": 6999.0, "original_price": 8999.0,
             "sales": 65200, "rating": 4.9, "shop_name": "京东自营",
             "url": "https://item.jd.com/100058809395.html",
             "crawled_at": "2026-11-23 10:00:00", "value_score": 0.72,
             "recommend": ""},
            {"platform": "taobao", "keyword": keyword,
             "name": f"{keyword} 天猫旗舰店 256G",
             "price": 6799.0, "original_price": 8999.0,
             "sales": 78100, "rating": 4.9, "shop_name": "Apple官方旗舰店",
             "url": "https://detail.tmall.com/item.htm?id=768420912346",
             "crawled_at": "2026-11-23 10:00:00", "value_score": 0.76,
             "recommend": ""},
            {"platform": "pdd", "keyword": keyword,
             "name": f"{keyword} 百亿补贴 512G",
             "price": 7499.0, "original_price": 10999.0,
             "sales": 28900, "rating": 4.7, "shop_name": "Apple产品店",
             "url": "https://mobile.yangkeduo.com/goods1.html?goods_id=789456125",
             "crawled_at": "2026-11-23 10:00:00", "value_score": 0.60,
             "recommend": ""},
            {"platform": "jd", "keyword": keyword,
             "name": f"{keyword} Pro Max 128G 京东自营",
             "price": 8499.0, "original_price": 9999.0,
             "sales": 42100, "rating": 4.9, "shop_name": "京东自营",
             "url": "https://item.jd.com/100058809396.html",
             "crawled_at": "2026-11-23 10:00:00", "value_score": 0.55,
             "recommend": ""},
        ],
        "total": 8,
    }


# ---------------- 生成独立 HTML 报告 ----------------
HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>电商价格对比报告 —— {{KEYWORD}}</title>
  <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    body { margin:0; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
           background:#f5f6fa; color:#2c3e50; }
    header { background: linear-gradient(135deg,#1e3c72,#2a5298); color:#fff; padding:28px 40px; }
    header h1 { margin:0; font-size:28px; }
    header .sub { opacity:.8; font-size:14px; margin-top:6px; }
    .container { max-width:1200px; margin:28px auto; padding:0 20px; }
    .card { background:#fff; border-radius:12px; padding:24px; box-shadow:0 2px 12px rgba(0,0,0,.06); margin-bottom:24px; }
    .card h2 { margin:0 0 16px; font-size:18px; color:#1e3c72; border-left:4px solid #1e3c72; padding-left:10px; }
    .grid3 { display:grid; grid-template-columns: repeat(3, 1fr); gap:16px; }
    .stat-box { background: linear-gradient(135deg,#f8f9fa,#e9ecef); padding:16px; border-radius:10px; text-align:center; }
    .stat-box .label { font-size:13px; color:#6c757d; }
    .stat-box .val { font-size:24px; font-weight:700; margin-top:6px; color:#1e3c72; }
    table { width:100%; border-collapse: collapse; font-size:14px; }
    th, td { padding:10px 12px; border-bottom:1px solid #eee; text-align:left; }
    th { background:#f8f9fa; font-weight:600; color:#495057; }
    tr:hover { background:#fafcff; }
    .badge { display:inline-block; padding:3px 10px; border-radius:12px; font-size:12px; font-weight:500; }
    .bj { background:#E1251B22; color:#E1251B; }
    .tb { background:#FF6A0022; color:#FF6A00; }
    .pdd { background:#E02E2422; color:#E02E24; }
    .rec { background:#28a745; color:#fff; }
    .cheap { background:#ffc107; color:#333; }
    .link { color:#2a5298; text-decoration:none; }
    .link:hover { text-decoration:underline; }
    #chart-price-box, #chart-cross-bar, #chart-scatter { width:100%; height:380px; }
  </style>
</head>
<body>
<header>
  <h1>🛒 电商商品价格对比报告</h1>
  <div class="sub">关键词：<b>{{KEYWORD}}</b> &nbsp;|&nbsp; 生成时间：{{GENERATED_AT}} &nbsp;|&nbsp; 商品总数：{{TOTAL}}</div>
</header>

<div class="container">

  <!-- 汇总统计 -->
  <div class="card">
    <h2>📊 各平台汇总</h2>
    <table>
      <thead><tr>
        <th>平台</th><th>商品数</th><th>最低价</th><th>最高价</th>
        <th>平均价</th><th>中位数</th><th>总销量</th><th>平均评分</th>
      </tr></thead>
      <tbody id="stats-tbody"></tbody>
    </table>
  </div>

  <!-- 横向对比 -->
  <div class="card">
    <h2>⚡ 跨平台最低价横向对比</h2>
    <div id="chart-cross-bar"></div>
    <table style="margin-top:16px">
      <thead><tr>
        <th>平台</th><th>最低价</th><th>商品</th><th>店铺</th><th>评分</th><th>销量</th>
      </tr></thead>
      <tbody id="cross-tbody"></tbody>
    </table>
  </div>

  <!-- 价格分布 -->
  <div class="card">
    <h2>📈 价格分布直方图</h2>
    <div id="chart-price-box"></div>
  </div>

  <!-- 性价比散点图 -->
  <div class="card">
    <h2>🎯 性价比散点图（价格 × 评分，气泡大小=销量）</h2>
    <div id="chart-scatter"></div>
  </div>

  <!-- 商品列表（价格升序） -->
  <div class="card">
    <h2>🏷️ 全部商品（按价格从低到高）</h2>
    <table>
      <thead><tr>
        <th>#</th><th>平台</th><th>商品名称</th><th>价格</th><th>原价</th>
        <th>店铺</th><th>评分</th><th>销量</th><th>性价比分</th><th>推荐</th>
      </tr></thead>
      <tbody id="items-tbody"></tbody>
    </table>
  </div>

</div>

<script>
const DATA = {{DATA_JSON}};

const PLATFORM_COLORS = { "jd":"#E1251B", "taobao":"#FF6A00", "pdd":"#E02E24" };
const PLATFORM_NAMES = { "jd":"京东", "taobao":"淘宝", "pdd":"拼多多" };

function platformBadge(p){
  const cls = p === 'jd' ? 'bj' : (p === 'taobao' ? 'tb' : 'pdd');
  return `<span class="badge ${cls}">${PLATFORM_NAMES[p] || p}</span>`;
}

function fmtPrice(v){ return '¥' + Number(v).toFixed(2); }
function fmtSales(v){
  v = Number(v);
  if (v >= 10000) return (v/10000).toFixed(1) + '万';
  return v.toString();
}

// 统计
const statsTbody = document.getElementById('stats-tbody');
DATA.stats.forEach(s => {
  statsTbody.innerHTML += `<tr>
    <td>${s.platform_name}</td>
    <td>${s.count}</td>
    <td><b>${fmtPrice(s.price_min)}</b></td>
    <td>${fmtPrice(s.price_max)}</td>
    <td>${fmtPrice(s.price_avg)}</td>
    <td>${fmtPrice(s.price_median)}</td>
    <td>${fmtSales(s.sales_total)}</td>
    <td>${s.rating_avg.toFixed(2)}</td>
  </tr>`;
});

// 横向对比 bar
const cross = DATA.cross_compare || [];
Plotly.newPlot('chart-cross-bar', [{
  type: 'bar',
  x: cross.map(c => c.platform_name),
  y: cross.map(c => c.lowest_price),
  text: cross.map(c => fmtPrice(c.lowest_price)),
  textposition: 'outside',
  marker: { color: cross.map(c => PLATFORM_COLORS[c.platform]) },
}], {
  title: { text: '各平台最低价对比', font:{size:16} },
  yaxis: { title: '价格 (¥)' },
  margin: { t: 50, b: 50, l: 60, r: 30 },
}, {responsive:true});

const crossTbody = document.getElementById('cross-tbody');
cross.forEach(c => {
  crossTbody.innerHTML += `<tr>
    <td>${platformBadge(c.platform)}</td>
    <td><b>${fmtPrice(c.lowest_price)}</b></td>
    <td><a class="link" href="${c.item_url}" target="_blank">${c.item_name}</a></td>
    <td>${c.shop_name || '-'}</td>
    <td>${c.rating}</td>
    <td>${fmtSales(c.sales)}</td>
  </tr>`;
});

// 价格分布
const dist = DATA.distribution || [];
Plotly.newPlot('chart-price-box', [{
  type: 'bar',
  x: dist.map(d => fmtPrice(d.range_start) + '-' + fmtPrice(d.range_end)),
  y: dist.map(d => d.count),
  marker: { color: '#2a5298' },
}], {
  title: { text: '全局价格区间分布', font:{size:16} },
  xaxis: { title: '价格区间' },
  yaxis: { title: '商品数' },
  margin: { t: 50, b: 80, l: 50, r: 30 },
}, {responsive:true});

// 性价比散点图
const items = DATA.items || [];
const groups = {};
items.forEach(it => {
  (groups[it.platform] = groups[it.platform] || []).push(it);
});
const traces = Object.entries(groups).map(([p, arr]) => ({
  name: PLATFORM_NAMES[p] || p,
  x: arr.map(i => i.price),
  y: arr.map(i => i.rating),
  mode: 'markers',
  marker: {
    color: PLATFORM_COLORS[p],
    size: arr.map(i => Math.max(6, Math.min(30, Math.log10(i.sales+1)*8))),
    opacity: .75,
    line: { width: 1, color: '#fff' },
  },
  hovertext: arr.map(i => `${i.name}<br>销量:${fmtSales(i.sales)}<br>性价比:${(i.value_score*100).toFixed(0)}`),
  hoverinfo: 'text+x+y',
}));
Plotly.newPlot('chart-scatter', traces, {
  title: { text: '性价比散点图（越靠左下越优）', font:{size:16} },
  xaxis: { title: '价格 (¥)' },
  yaxis: { title: '店铺评分', range: [3.5, 5.05] },
  margin: { t: 50, b: 50, l: 60, r: 30 },
  legend: { orientation: 'h' },
}, {responsive:true});

// 全部商品列表
const itemsTbody = document.getElementById('items-tbody');
items.forEach((it, idx) => {
  const recCls = it.recommend === '性价比推荐' ? 'rec' : (it.recommend === '低价好货' ? 'cheap' : '');
  itemsTbody.innerHTML += `<tr>
    <td>${idx+1}</td>
    <td>${platformBadge(it.platform)}</td>
    <td><a class="link" href="${it.url}" target="_blank">${it.name}</a></td>
    <td><b style="color:#E1251B">${fmtPrice(it.price)}</b></td>
    <td style="color:#999;text-decoration:line-through">${it.original_price ? fmtPrice(it.original_price) : '-'}</td>
    <td>${it.shop_name || '-'}</td>
    <td>${it.rating}</td>
    <td>${fmtSales(it.sales)}</td>
    <td>${(it.value_score*100).toFixed(1)}</td>
    <td>${it.recommend ? `<span class="badge ${recCls}">${it.recommend}</span>` : ''}</td>
  </tr>`;
});
</script>
</body>
</html>
"""


def render_html(keyword: str, data: Dict[str, Any], generated_at: str | None = None) -> str:
    """把分析结果套入模板，输出完整 HTML 字符串"""
    generated_at = generated_at or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    html = HTML_TEMPLATE.replace("{{KEYWORD}}", keyword) \
                        .replace("{{GENERATED_AT}}", generated_at) \
                        .replace("{{TOTAL}}", str(data.get("total", 0))) \
                        .replace("{{DATA_JSON}}", json.dumps(data, ensure_ascii=False))
    return html


def save_report(keyword: str, data: Dict[str, Any]) -> str:
    """保存为 HTML 报告，返回绝对路径"""
    fname = keyword.replace("/", "_").replace("\\", "_").strip() or "report"
    out_path = os.path.join(OUTPUT_DIR, f"{fname}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.html")
    html = render_html(keyword, data)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)
    logger.info("HTML 报告已生成: %s", out_path)
    return out_path

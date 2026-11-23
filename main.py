"""
CLI 命令行工具入口
用法示例：
  python main.py search "iPhone 15 Pro"
  python main.py search "联想拯救者" --platforms jd taobao --max-per-platform 15
  python main.py search "九阳破壁机" --json --out data/jiu.json
"""
import os
import sys
import json
import logging
import argparse
from datetime import datetime

from tabulate import tabulate

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import PLATFORMS, PLATFORM_NAMES, MAX_ITEMS_PER_PLATFORM, REQUEST_DELAY, OUTPUT_DIR
from core.scrapers import crawl_all
from core.data_cleaner import DataCleaner
from core.analyzer import PriceAnalyzer
from core.visualizer import save_report, build_demo_dataset

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("cli")


def do_search(args):
    keyword = args.keyword.strip()
    if not keyword:
        print("错误：关键词不能为空", file=sys.stderr)
        sys.exit(1)

    platforms = args.platforms or PLATFORMS
    invalid = [p for p in platforms if p not in PLATFORMS]
    if invalid:
        print(f"错误：不支持的平台 {invalid}，可选 {PLATFORMS}", file=sys.stderr)
        sys.exit(1)

    print(f"\n🔍 开始采集 —— 关键词: 【{keyword}】  平台: {[PLATFORM_NAMES[p] for p in platforms]}\n")

    # 1) 采集
    raw = crawl_all(
        keyword=keyword,
        platforms=platforms,
        max_per_platform=args.max_per_platform or MAX_ITEMS_PER_PLATFORM,
        delay=args.delay or REQUEST_DELAY,
    )
    print(f"✅ 采集完成，共 {len(raw)} 条原始数据\n")

    # 2) 清洗
    items = DataCleaner.clean(raw)
    print(f"🧹 清洗后剩余 {len(items)} 条\n")

    # 3) 分析
    analyzer = PriceAnalyzer(items)
    report = analyzer.to_report()

    # 4) 终端展示
    stats = report["stats"]
    print("\n📊 各平台汇总")
    print(tabulate(
        [[s["platform_name"], s["count"], s["price_min"], s["price_max"],
          s["price_avg"], s["price_median"], s["sales_total"], s["rating_avg"]]
         for s in stats],
        headers=["平台", "商品数", "最低价", "最高价", "平均价", "中位数", "总销量", "平均评分"],
        tablefmt="pretty",
    ))

    cross = report["cross_compare"]
    print("\n⚡ 跨平台最低价横向对比")
    print(tabulate(
        [[c["platform_name"], c["lowest_price"], c["item_name"][:30] + "...", c["rating"], c["sales"]]
         for c in cross],
        headers=["平台", "最低价", "商品", "评分", "销量"],
        tablefmt="pretty",
    ))

    # TOP 推荐
    top = sorted(report["items"], key=lambda x: x.get("value_score", 0), reverse=True)[:5]
    print("\n🏆 性价比 TOP5")
    print(tabulate(
        [[i+1, PLATFORM_NAMES.get(t["platform"], t["platform"]), t["name"][:40] + "...",
          t["price"], t.get("rating", 0), t.get("sales", 0), t.get("value_score", 0)]
         for i, t in enumerate(top)],
        headers=["#", "平台", "商品", "价格", "评分", "销量", "性价比分"],
        tablefmt="pretty",
    ))

    # 5) 输出
    generated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    report["keyword"] = keyword
    report["generated_at"] = generated_at

    if args.json:
        out_path = args.out or os.path.join(OUTPUT_DIR,
                                             f"{keyword}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"\n📄 JSON 已保存: {out_path}")

    html_path = save_report(keyword, report)
    print(f"🌐 HTML 报告已保存: {html_path}")


def do_demo(args):
    """生成演示数据"""
    keyword = args.keyword or "iPhone 15 Pro"
    print(f"生成演示数据 关键词={keyword}")
    data = build_demo_dataset(keyword)
    html_path = save_report(keyword, data)
    json_path = os.path.join(OUTPUT_DIR, f"demo_{keyword}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"HTML: {html_path}\nJSON: {json_path}")


def main():
    parser = argparse.ArgumentParser(
        prog="price-watcher",
        description="🛒 电商价格自动化采集与对比工具",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_search = sub.add_parser("search", help="搜索关键词并采集")
    p_search.add_argument("keyword", help="搜索关键词")
    p_search.add_argument("--platforms", nargs="+", choices=PLATFORMS,
                          help=f"要采集的平台，默认全部 {PLATFORMS}")
    p_search.add_argument("--max-per-platform", type=int, default=None,
                          help="每个平台最多抓取的商品数")
    p_search.add_argument("--delay", type=float, default=None,
                          help="请求节流秒数")
    p_search.add_argument("--json", action="store_true", help="同时输出 JSON")
    p_search.add_argument("--out", help="指定 JSON 输出路径")
    p_search.set_defaults(func=do_search)

    p_demo = sub.add_parser("demo", help="生成内置演示数据 + 报告（无需联网）")
    p_demo.add_argument("--keyword", default="iPhone 15 Pro")
    p_demo.set_defaults(func=do_demo)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

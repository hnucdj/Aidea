"""
演示 Web 页面 —— Flask
访问 / 得到带示例数据的页面，输入关键词点按钮即可现场运行采集脚本
"""
import os
import sys
import json
import logging
from datetime import datetime

from flask import Flask, render_template, request, jsonify, send_from_directory

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import PLATFORMS, PLATFORM_NAMES, OUTPUT_DIR, MAX_ITEMS_PER_PLATFORM
from core.scrapers import crawl_all
from core.data_cleaner import DataCleaner
from core.analyzer import PriceAnalyzer
from core.visualizer import build_demo_dataset

app = Flask(__name__, static_folder=None)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("web")


@app.route("/")
def index():
    # 首次渲染时把 demo 数据塞进页面
    demo = build_demo_dataset("iPhone 15 Pro")
    return render_template(
        "index.html",
        demo_json=json.dumps(demo, ensure_ascii=False),
        platforms=PLATFORM_NAMES,
    )


@app.route("/api/search", methods=["POST"])
def api_search():
    """现场采集接口"""
    body = request.get_json(force=True, silent=True) or request.form.to_dict()
    keyword = (body.get("keyword") or "").strip()
    if not keyword:
        return jsonify({"ok": False, "msg": "请输入搜索关键词"}), 400

    platforms = body.get("platforms") or PLATFORMS
    if isinstance(platforms, str):
        platforms = json.loads(platforms)
    max_per = int(body.get("max_per_platform") or MAX_ITEMS_PER_PLATFORM)

    logger.info("[API] 关键词=%s 平台=%s max=%d", keyword, platforms, max_per)

    try:
        raw = crawl_all(keyword=keyword, platforms=platforms,
                        max_per_platform=max_per, delay=0.6)
        items = DataCleaner.clean(raw)
        analyzer = PriceAnalyzer(items)
        report = analyzer.to_report()
        report["keyword"] = keyword
        report["generated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # 保存 HTML 和 JSON
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        fname = keyword.replace("/", "_").replace("\\", "_").strip() or "report"
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        json_path = os.path.join(OUTPUT_DIR, f"{fname}_{ts}.json")
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)

        return jsonify({"ok": True, "data": report, "saved": json_path})
    except Exception as e:
        logger.exception("[API] search failed")
        return jsonify({"ok": False, "msg": f"采集失败: {e}"}), 500


@app.route("/api/demo")
def api_demo():
    kw = request.args.get("keyword", "iPhone 15 Pro")
    data = build_demo_dataset(kw)
    return jsonify({"ok": True, "data": data})


@app.route("/data/<path:filename>")
def get_data(filename):
    return send_from_directory(OUTPUT_DIR, filename, as_attachment=False)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)

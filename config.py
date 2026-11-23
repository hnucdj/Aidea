"""
全局配置文件
"""
import os

# 输出目录
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 平台列表
PLATFORMS = ["jd", "taobao", "pdd"]
PLATFORM_NAMES = {
    "jd": "京东",
    "taobao": "淘宝",
    "pdd": "拼多多",
}
PLATFORM_COLORS = {
    "jd": "#E1251B",
    "taobao": "#FF6A00",
    "pdd": "#E02E24",
}

# 每个平台最大采集商品数
MAX_ITEMS_PER_PLATFORM = 20

# 请求超时（秒）
REQUEST_TIMEOUT = 15

# 请求间隔（秒），防止触发反爬
REQUEST_DELAY = 1.0

# 性价比评分权重
SCORE_WEIGHTS = {
    "price": 0.4,       # 价格越低分越高
    "rating": 0.3,      # 店铺评分越高分越高
    "sales": 0.3,       # 销量越高分越高
}

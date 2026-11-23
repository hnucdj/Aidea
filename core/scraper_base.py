"""
爬虫基类 —— 所有平台适配器都继承自此类
提供统一接口，方便扩展新平台
"""
import time
import random
import logging
from abc import ABC, abstractmethod
from typing import List, Dict, Any

logger = logging.getLogger(__name__)


class BaseScraper(ABC):
    """电商平台爬虫基类"""

    platform_key: str = ""       # 平台唯一标识
    platform_name: str = ""      # 中文名

    def __init__(self, delay: float = 1.0):
        self.delay = delay
        self.session = None

    @abstractmethod
    def search(self, keyword: str, max_items: int = 20) -> List[Dict[str, Any]]:
        """
        根据关键词搜索商品，返回商品列表
        每个商品 dict 应包含以下字段：
            - platform:     str   平台标识
            - keyword:      str   搜索关键词
            - name:         str   商品名称
            - price:        float 商品价格
            - original_price: float 原价（可选）
            - sales:        int   销量（可选）
            - rating:       float 店铺评分 0-5（可选）
            - shop_name:    str   店铺名称（可选）
            - url:          str   商品详情页 URL
            - image_url:    str   商品主图 URL（可选）
            - crawled_at:   str   采集时间戳
        """
        pass

    def _throttle(self):
        """请求节流"""
        time.sleep(self.delay + random.uniform(0, 0.5))

    def _safe_float(self, val, default=0.0) -> float:
        try:
            return float(val)
        except (TypeError, ValueError):
            return default

    def _safe_int(self, val, default=0) -> int:
        try:
            return int(val)
        except (TypeError, ValueError):
            return default

    def __repr__(self):
        return f"<{self.__class__.__name__} platform={self.platform_key}>"

"""
数据清洗 + 去重
"""
import re
import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)


def _normalize_name(name: str) -> str:
    """归一化商品名用于相似度/去重比较：去空格、小写、去除特殊符号"""
    if not name:
        return ""
    s = name.lower().strip()
    s = re.sub(r"[\s\-_·•/\\|()\[\]【】〔〕（）,，、.。！!?？#%&*+=\"'`~;；:：]+", "", s)
    # 规格参数统一：GB / g -> g
    s = re.sub(r"(\d+)gb", r"\1g", s)
    return s


class DataCleaner:
    """数据清洗与去重"""

    @staticmethod
    def clean(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        清洗入口：
          1. 移除关键字段缺失（无名称、价格<=0）
          2. 去除明显广告/空壳数据
          3. 去除重复
          4. 统一字段类型
        """
        if not items:
            return []

        # 1. 基础清洗
        cleaned = []
        for it in items:
            name = (it.get("name") or "").strip()
            price = float(it.get("price") or 0)
            if not name or price <= 0:
                continue
            if len(name) < 3:
                continue

            it.setdefault("original_price", 0.0)
            it.setdefault("sales", 0)
            it.setdefault("rating", 0.0)
            it.setdefault("shop_name", "")
            it.setdefault("url", "")
            it.setdefault("image_url", "")

            # 强制类型
            it["price"] = round(price, 2)
            it["original_price"] = round(float(it["original_price"] or 0), 2)
            it["sales"] = int(it["sales"] or 0)
            it["rating"] = round(float(it["rating"] or 0), 1)

            cleaned.append(it)

        before = len(items)
        after_dedup = DataCleaner.deduplicate(cleaned)
        logger.info("清洗完成: %d -> %d（去重后）", before, len(after_dedup))
        return after_dedup

    @staticmethod
    def deduplicate(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        去重：
          - 同平台：名称归一化相同视为同一件商品，保留价格更低的
          - 跨平台：允许同名（不同平台同一型号），不做跨平台去重
        """
        bucket: Dict[str, List[Dict[str, Any]]] = {}
        for it in items:
            key = (it.get("platform", ""), _normalize_name(it.get("name", "")))
            bucket.setdefault(key, []).append(it)

        out: List[Dict[str, Any]] = []
        for key, group in bucket.items():
            # 同一 key 下取价格最低的
            best = min(group, key=lambda x: x.get("price", 0))
            out.append(best)
        return out

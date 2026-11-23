"""
价格分析：
  - 跨平台横向对比
  - 价格分布/统计
  - 性价比评分
  - 推荐标注
"""
from typing import List, Dict, Any
from collections import defaultdict

import pandas as pd

from config import SCORE_WEIGHTS, PLATFORM_NAMES


class PriceAnalyzer:
    def __init__(self, items: List[Dict[str, Any]]):
        self.items = items
        self.df = pd.DataFrame(items) if items else pd.DataFrame()

    # ---------------- 基础统计 ----------------
    def platform_stats(self) -> List[Dict[str, Any]]:
        """按平台的价格统计"""
        if self.df.empty:
            return []
        out = []
        for platform, g in self.df.groupby("platform"):
            out.append({
                "platform": platform,
                "platform_name": PLATFORM_NAMES.get(platform, platform),
                "count": int(len(g)),
                "price_min": round(float(g["price"].min()), 2),
                "price_max": round(float(g["price"].max()), 2),
                "price_avg": round(float(g["price"].mean()), 2),
                "price_median": round(float(g["price"].median()), 2),
                "sales_total": int(g["sales"].sum()),
                "rating_avg": round(float(g["rating"].mean()), 2),
            })
        # 全局汇总
        out.append({
            "platform": "ALL",
            "platform_name": "全部平台",
            "count": int(len(self.df)),
            "price_min": round(float(self.df["price"].min()), 2),
            "price_max": round(float(self.df["price"].max()), 2),
            "price_avg": round(float(self.df["price"].mean()), 2),
            "price_median": round(float(self.df["price"].median()), 2),
            "sales_total": int(self.df["sales"].sum()),
            "rating_avg": round(float(self.df["rating"].mean()), 2),
        })
        return out

    # ---------------- 价格分布 ----------------
    def price_distribution(self, bins: int = 10) -> List[Dict[str, Any]]:
        """全局价格分布（直方图）"""
        if self.df.empty or "price" not in self.df.columns:
            return []
        df = self.df.sort_values("price")
        step = max(1, len(df) // bins)
        bucket: List[Dict[str, Any]] = []
        for i in range(bins):
            chunk = df.iloc[i * step:(i + 1) * step]
            if chunk.empty:
                continue
            bucket.append({
                "range_start": round(float(chunk["price"].min()), 2),
                "range_end": round(float(chunk["price"].max()), 2),
                "count": int(len(chunk)),
            })
        return bucket

    def price_distribution_by_platform(self) -> Dict[str, List[Dict[str, Any]]]:
        """各平台价格分布"""
        out: Dict[str, List[Dict[str, Any]]] = {}
        if self.df.empty:
            return out
        for platform, g in self.df.groupby("platform"):
            dist = []
            g = g.sort_values("price")
            # 分成 5 段
            n = len(g)
            if n < 5:
                for _, r in g.iterrows():
                    dist.append({
                        "range_start": float(r["price"]),
                        "range_end": float(r["price"]),
                        "count": 1,
                    })
            else:
                step = n // 5
                for i in range(5):
                    chunk = g.iloc[i * step:(i + 1) * step]
                    if chunk.empty:
                        continue
                    dist.append({
                        "range_start": round(float(chunk["price"].min()), 2),
                        "range_end": round(float(chunk["price"].max()), 2),
                        "count": int(len(chunk)),
                    })
            out[platform] = dist
        return out

    # ---------------- 性价比评分 ----------------
    def compute_value_scores(self) -> List[Dict[str, Any]]:
        """
        性价比评分：在全部商品中做归一化打分
          - 价格最低得分最高
          - 店铺评分越高得分越高
          - 销量越高得分越高
        """
        if self.df.empty:
            return []

        df = self.df.copy()

        def _normalize(series: pd.Series, reverse: bool = False) -> pd.Series:
            lo, hi = series.min(), series.max()
            if hi == lo:
                return pd.Series([0.5] * len(series), index=series.index)
            n = (series - lo) / (hi - lo)
            return 1 - n if reverse else n

        # 各指标 [0,1]
        price_norm = _normalize(df["price"], reverse=True)
        rating_norm = _normalize(df["rating"], reverse=False)
        sales_norm = _normalize(df["sales"], reverse=False)

        w = SCORE_WEIGHTS
        df["value_score"] = (
            price_norm * w["price"]
            + rating_norm * w["rating"]
            + sales_norm * w["sales"]
        )
        df["value_score"] = df["value_score"].round(3)

        # 排序（价格升序）
        df = df.sort_values(["price", "value_score"], ascending=[True, False])
        results = df.to_dict(orient="records")

        # 标注 TOP 推荐
        if results:
            top = sorted(results, key=lambda x: x["value_score"], reverse=True)
            top_ids = {r["url"]: r for r in top[:3]}
            for r in results:
                # 性价比 TOP1 且 价格低于均价 -> 强推荐
                if r["url"] in top_ids:
                    r["recommend"] = "性价比推荐"
                elif r["price"] <= df["price"].quantile(0.25):
                    r["recommend"] = "低价好货"
                else:
                    r["recommend"] = ""
        return results

    # ---------------- 横向对比视图 ----------------
    def cross_compare(self) -> List[Dict[str, Any]]:
        """
        同一关键词下按平台最低价格对比
        每个平台只返回最低价商品，便于横向对比
        """
        if self.df.empty:
            return []
        rows = []
        for platform, g in self.df.groupby("platform"):
            lowest = g.loc[g["price"].idxmin()].to_dict()
            rows.append({
                "platform": platform,
                "platform_name": PLATFORM_NAMES.get(platform, platform),
                "lowest_price": float(lowest["price"]),
                "item_name": lowest.get("name", ""),
                "item_url": lowest.get("url", ""),
                "shop_name": lowest.get("shop_name", ""),
                "rating": float(lowest.get("rating", 0)),
                "sales": int(lowest.get("sales", 0)),
            })
        return rows

    # ---------------- 导出 JSON ----------------
    def to_report(self) -> Dict[str, Any]:
        scored = self.compute_value_scores()
        return {
            "stats": self.platform_stats(),
            "distribution": self.price_distribution(),
            "distribution_by_platform": self.price_distribution_by_platform(),
            "cross_compare": self.cross_compare(),
            "items": scored,
            "total": len(scored),
        }

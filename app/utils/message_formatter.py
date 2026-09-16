from __future__ import annotations

from ..infrastructure.time_helper import now_text
from ..models.dto import DrawResult, HistoryRecord, PoolInfo, TodaySummary, UserStats


def _rarity_text(rarity: str) -> str:
    """把数字稀有度（1~6）显示成星级；非数字保持原样。"""
    value = str(rarity or "").strip()
    if value.isdigit():
        return f"{value}★"
    return value or "?"


def format_draw_result(qq_id: str, result: DrawResult, *, compact: bool = False) -> str:
    lines = [
        "【每日抽卡】",
        f"QQ：{qq_id}",
        f"卡池：{result.pool_name}",
        f"模式：{result.draw_mode.label}",
    ]

    if not compact:
        lines.append("结果：")
        for index, card in enumerate(result.cards, start=1):
            lines.append(f"{index}. {card.card_name} {_rarity_text(card.rarity)}")

    lines.extend(
        [
            f"本次积分：{result.total_score}",
            f"今日单抽：{result.quota.single_used}/{result.quota.single_limit}",
            f"今日十连：{result.quota.ten_used}/{result.quota.ten_limit}",
            f"记录号：{result.record_no}",
        ]
    )
    return "\n".join(lines)

def format_draw_reply_template(template: str, qq_id: str, result: DrawResult) -> str:
    """按配置模板生成抽卡结果前的文字。

    支持变量：
      {draw_label} 寻访 / 十连寻访
      {draw_mode}  单抽 / 十连
      {qq_id}
      {pool_name}
      {total_score}
      {record_no}
      {card_count}
      {card_list}
    """
    card_list = "\n".join(
        f"{index}. {card.card_name} {_rarity_text(card.rarity)}"
        for index, card in enumerate(result.cards, start=1)
    )
    values = {
        "draw_label": result.draw_mode.command_label,
        "draw_mode": result.draw_mode.label,
        "qq_id": qq_id,
        "pool_name": result.pool_name,
        "total_score": result.total_score,
        "record_no": result.record_no,
        "card_count": len(result.cards),
        "card_list": card_list,
        "image": "",
    }
    try:
        return template.format(**values)
    except (KeyError, IndexError, ValueError):
        # 模板里写了未知变量时不要阻塞抽卡，退化为原模板。
        return template



def format_today_summary(summary: TodaySummary) -> str:
    lines = [
        "【今日抽卡记录】",
        f"卡池：{summary.pool_name}",
        f"今日单抽：{summary.quota.single_used}/{summary.quota.single_limit}",
        f"今日十连：{summary.quota.ten_used}/{summary.quota.ten_limit}",
    ]
    if summary.latest_cards:
        lines.append("最近结果：")
        for index, card in enumerate(summary.latest_cards, start=1):
            lines.append(f"{index}. {card.card_name} {_rarity_text(card.rarity)}")
    else:
        lines.append("今天还没有抽卡记录。")
    return "\n".join(lines)


def format_history(records: list[HistoryRecord], page: int, page_size: int, total: int) -> str:
    lines = [
        "【抽卡历史】",
        f"页码：{page}",
        f"每页：{page_size}",
        f"总数：{total}",
    ]
    if not records:
        lines.append("暂无历史记录。")
        return "\n".join(lines)

    for record in records:
        lines.append(
            f"- {record.created_at} | {record.pool_name} | {record.draw_mode} | "
            f"{record.total_score} 分 | 最高 {_rarity_text(record.highest_rarity)}"
        )
    return "\n".join(lines)


def format_user_stats(stats: UserStats) -> str:
    return "\n".join(
        [
            "【累计统计】",
            f"QQ：{stats.qq_id}",
            f"昵称：{stats.nickname or '未记录'}",
            f"总抽卡次数：{stats.total_draw_count}",
            f"单抽次数：{stats.total_single_draw_count}",
            f"十连次数：{stats.total_ten_draw_count}",
            f"累计积分：{stats.total_score}",
            f"SSR 数量：{stats.total_ssr_count}",
            f"UR 数量：{stats.total_ur_count}",
        ]
    )


def format_pool_list(pools: list[PoolInfo]) -> str:
    lines = ["【卡池列表】", f"生成时间：{now_text()}"]
    if not pools:
        lines.append("暂无卡池数据。")
        return "\n".join(lines)

    for pool in pools:
        lines.append(
            f"- [{pool.pool_id}] {pool.pool_name} ({pool.pool_key}) | "
            f"启用：{'是' if pool.is_enabled else '否'} | "
            f"单抽：{'开' if pool.allow_single_draw else '关'} | "
            f"十连：{'开' if pool.allow_ten_draw else '关'}"
        )
    return "\n".join(lines)


def format_reset_quota(qq_id: str, pool_id: str) -> str:
    return "\n".join(
        [
            "【重置成功】",
            f"QQ：{qq_id}",
            f"卡池 ID：{pool_id}",
            "该用户今日次数已请求后端重置。",
        ]
    )

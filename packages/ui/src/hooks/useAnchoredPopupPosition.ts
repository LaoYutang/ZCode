import { useLayoutEffect, type RefObject } from "react";

/**
 * 选区浮层共用定位：优先放在选区上方，空间不足改放下方，并始终夹在视口内。
 * 动作菜单与评论输入框共用同一段测量，避免两处各自实现后尺寸与钳制规则分叉。
 */
export function useAnchoredPopupPosition(
  ref: RefObject<HTMLElement | null>,
  {
    center,
    top,
    bottom,
    remeasureKey,
  }: { center: number; top: number; bottom: number; remeasureKey?: unknown },
) {
  useLayoutEffect(() => {
    const popup = ref.current;
    if (!popup) return;
    const position = () => {
      const rect = popup.getBoundingClientRect();
      popup.style.left = `${Math.max(12, Math.min(window.innerWidth - rect.width - 12, center - rect.width / 2))}px`;
      const preferredTop = top - rect.height - 8 >= 12 ? top - rect.height - 8 : bottom + 8;
      popup.style.top = `${Math.max(12, Math.min(window.innerHeight - rect.height - 12, preferredTop))}px`;
    };
    position();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(position);
    observer?.observe(popup);
    return () => observer?.disconnect();
  }, [bottom, center, ref, remeasureKey, top]);
}

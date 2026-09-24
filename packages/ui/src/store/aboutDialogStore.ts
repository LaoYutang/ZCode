import type { AboutDialogPayload } from "@zcode/shared";
import { create } from "zustand";

interface AboutDialogState {
  /** 当前对话框要展示的事实；undefined 表示关闭。
   *  只用 payload 的存在性表达开合，避免再维护一份 isOpen 造成两份真相。 */
  payload?: AboutDialogPayload;
  openAbout: (payload: AboutDialogPayload) => void;
  closeAbout: () => void;
}

export const useAboutDialogStore = create<AboutDialogState>((set) => ({
  payload: undefined,
  // 「关于」是幂等展示：重复触发只刷新事实，不排队、不叠加多个对话框。
  openAbout: (payload) => set({ payload }),
  closeAbout: () => set({ payload: undefined }),
}));

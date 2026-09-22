/**
 * useCredentials —— 凭据服务 hooks
 */
import { useCallback } from "react";
import { useServices } from "./useServices.js";

/** 凭据管理的基础 hook（用户自建 provider 的 API Key 与第三方 MCP 授权都走这里） */
export function useCredentials() {
  const { credentialService } = useServices();

  const load = useCallback((key: string) => credentialService.load(key), [credentialService]);
  const save = useCallback(
    (key: string, value: string) => credentialService.save(key, value),
    [credentialService],
  );
  const del = useCallback((key: string) => credentialService.delete(key), [credentialService]);

  return { load, save, delete: del };
}

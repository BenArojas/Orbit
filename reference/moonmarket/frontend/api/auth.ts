import api, { authCheckApi } from "@/api/axios";
import { toast } from 'sonner'; 

export interface AuthDTO {
  authenticated: boolean;
  websocket_ready: boolean;
  message: string;
}

export const fetchAuthStatus = async () => {
  const { data } = await authCheckApi.get<AuthDTO>("/auth/status");
  // The toast call remains the same, just uses the sonner import now
  if (!data.authenticated) toast.error(data.message);
  return data;
};

export const disconnectWebSocket = async (): Promise<void> => {
  await api.post("/ws/disconnect");
};

export const logout = async () => {
  return await api.post("/auth/logout");
};
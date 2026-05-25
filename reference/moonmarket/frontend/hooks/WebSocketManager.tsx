// src/hooks/WebSocketManager.tsx (SIMPLIFIED AND FINAL)
import { useEffect } from 'react';
import { useStockStore } from '@/stores/stockStore';
import { useAuth } from '@/contexts/AuthContext';

export const WebSocketManager = () => {
  const { isAuth } = useAuth();
  
  const selectedAccountId = useStockStore(state => state.selectedAccountId);
  const connect = useStockStore(state => state.connect);
  const disconnect = useStockStore(state => state.disconnect);

  useEffect(() => {
    // This component's ONLY job is to connect when ready, and disconnect when not.
    if (isAuth && selectedAccountId) {
      connect();
    }

    // The cleanup function will run when isAuth or selectedAccountId changes, or on unmount.
    return () => {
      disconnect();
    };
  }, [isAuth, selectedAccountId, connect, disconnect]);

  return null;
};
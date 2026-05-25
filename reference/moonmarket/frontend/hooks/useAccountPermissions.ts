// In a new file, e.g., src/hooks/useAccountData.ts
import { useQuery } from '@tanstack/react-query';
import { useStockStore } from '@/stores/stockStore';
import { fetchAccountPermissions } from '@/api/user';

export function useAccountPermissions() {
  const selectedAccountId = useStockStore((state) => state.selectedAccountId);
  
  return useQuery({
    queryKey: ['accountPermissions', selectedAccountId],
    queryFn: () => fetchAccountPermissions(selectedAccountId),
    enabled: !!selectedAccountId,
    staleTime: 1000 * 60 * 15, // Cache for 15 minutes
  });
}
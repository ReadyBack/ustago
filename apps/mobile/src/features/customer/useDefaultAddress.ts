import type { Address } from '@ustago/types';

import { addressApi } from '../../api/services';
import { useApi } from '../../hooks/useApi';

/**
 * The customer's default (or first) saved address. Only its district and
 * province ids are ever sent for discovery: coarse, never coordinates.
 */
export function useDefaultAddress() {
  const addresses = useApi<Address[]>('addresses', addressApi.list);
  const list = addresses.data ?? [];
  const address = list.find((a) => a.isDefault) ?? list[0] ?? null;
  return {
    address,
    /** True once the list loaded or failed: callers may go on without a district. */
    settled: !addresses.loading,
  };
}

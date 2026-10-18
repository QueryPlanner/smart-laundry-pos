import type { CounterCatalogue } from '@/lib/localFirst/counter';

/** Wash is the shop's usual treatment; otherwise the first service, otherwise nothing yet. */
export const defaultServiceId = (catalogue: CounterCatalogue | null): string =>
  catalogue?.services.find(service => service.key === 'wash')?.id ?? catalogue?.services[0]?.id ?? '';

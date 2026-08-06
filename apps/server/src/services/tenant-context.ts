import { AsyncLocalStorage } from "node:async_hooks";

export const PLATFORM_TENANT_SLUG = "platform";

export type TenantStore = {
  tenantId: string;
  slug?: string;
  isPlatform?: boolean;
};

const als = new AsyncLocalStorage<TenantStore>();

export function getTenantStore(): TenantStore | undefined {
  return als.getStore();
}

export function requireTenantId(): string {
  const id = als.getStore()?.tenantId;
  if (!id) throw new Error("tenant context missing");
  return id;
}

export function tryTenantId(): string | null {
  return als.getStore()?.tenantId ?? null;
}

export function runWithTenant<T>(store: TenantStore, fn: () => T): T {
  return als.run(store, fn);
}

export async function runWithTenantAsync<T>(store: TenantStore, fn: () => Promise<T>): Promise<T> {
  return als.run(store, fn);
}

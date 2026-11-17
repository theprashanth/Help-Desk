import { AsyncLocalStorage } from 'async_hooks';

export const tenantStorage = new AsyncLocalStorage<string>();

export function getActiveWorkspaceId(): string {
  const store = tenantStorage.getStore();
  if (!store) {
    // Default fallback to ensure backwards compatibility with initial seeding/auth setup
    return 'default_workspace';
  }
  return store;
}

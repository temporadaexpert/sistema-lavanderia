import { getContainer } from '@/infrastructure/singleton';
import type { DashboardSnapshot } from '@/application/services/DashboardAdminService';

export async function dashboardSnapshot(): Promise<DashboardSnapshot> {
  const c = await getContainer();
  return c.dashboardAdmin.snapshot();
}

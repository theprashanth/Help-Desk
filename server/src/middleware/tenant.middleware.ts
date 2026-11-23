import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import { RepositoryFactory } from '../repositories/factory';
import { tenantStorage } from '../context/tenant.context';

export async function resolveTenant(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  let workspaceId = 'default_workspace';

  // 1. If request is already authenticated as an agent, use the agent's workspaceId
  if (req.user?.workspaceId) {
    workspaceId = req.user.workspaceId;
  } else {
    // 2. Otherwise, resolve from headers
    const apiKey = req.headers['x-api-key'] as string;
    const headerWorkspaceId = req.headers['x-workspace-id'] as string;

    if (headerWorkspaceId) {
      // The Messenger sends its App ID; older install codes sent the internal workspace id
      try {
        const byAppId = await RepositoryFactory.getWorkspaceRepository().findByAppId(headerWorkspaceId);
        workspaceId = byAppId ? byAppId.id : headerWorkspaceId;
      } catch {
        workspaceId = headerWorkspaceId;
      }
    } else if (apiKey) {
      try {
        const workspaceRepo = RepositoryFactory.getWorkspaceRepository();
        const workspace = await workspaceRepo.findByApiKey(apiKey);
        if (!workspace) {
          return res.status(401).json({ error: 'Invalid API Key' });
        }
        workspaceId = workspace.id;
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    }
  }

  req.workspaceId = workspaceId;
  tenantStorage.run(workspaceId, () => {
    next();
  });
}

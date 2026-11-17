import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { RepositoryFactory } from '../repositories/factory';
import { AgentSettings } from '../../../shared/src/types';

export async function login(req: AuthenticatedRequest, res: Response) {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const userRepo = RepositoryFactory.getUserRepository();
    const result = await userRepo.verifyPassword(email, password);
    
    if (!result) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Ensure settings exist for the agent
    const settingsRepo = RepositoryFactory.getSettingsRepository();
    const existingSettings = await settingsRepo.findByAgentId(result.agent.id);
    if (!existingSettings) {
      const defaultSettings: AgentSettings = {
        agentId: result.agent.id,
        theme: 'light',
        notifications: { desktop: true, sound: true, browser: true },
        timezone: 'America/New_York',
        language: 'en',
        autoAssign: false,
        businessHours: { enabled: false, start: '09:00', end: '17:00', timezone: 'America/New_York', days: [1, 2, 3, 4, 5] }
      };
      await settingsRepo.save(defaultSettings);
    }

    return res.json({
      agent: result.agent,
      token: result.token
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getProfile(req: AuthenticatedRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }

  try {
    const userRepo = RepositoryFactory.getUserRepository();
    const agent = await userRepo.findById(req.user.id);
    
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    return res.json(agent);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getSettings(req: AuthenticatedRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }

  try {
    const settingsRepo = RepositoryFactory.getSettingsRepository();
    let settings = await settingsRepo.findByAgentId(req.user.id);
    
    if (!settings) {
      settings = {
        agentId: req.user.id,
        theme: 'light',
        notifications: { desktop: true, sound: true, browser: true },
        timezone: 'America/New_York',
        language: 'en',
        autoAssign: false,
        businessHours: { enabled: false, start: '09:00', end: '17:00', timezone: 'America/New_York', days: [1, 2, 3, 4, 5] }
      };
      await settingsRepo.save(settings);
    }

    return res.json(settings);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateSettings(req: AuthenticatedRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }

  try {
    const settingsRepo = RepositoryFactory.getSettingsRepository();
    const updated = await settingsRepo.save({
      ...req.body,
      agentId: req.user.id
    });
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getAgents(req: AuthenticatedRequest, res: Response) {
  try {
    const userRepo = RepositoryFactory.getUserRepository();
    const agents = await userRepo.findAll();
    return res.json(agents);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateProfile(req: AuthenticatedRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }

  const { name } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    const userRepo = RepositoryFactory.getUserRepository();
    const updated = await userRepo.update(req.user.id, { name: name.trim() });
    if (!updated) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

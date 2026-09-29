export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface DependencyStatus {
  status: 'up' | 'down';
  latencyMs?: number;
  error?: string;
}

export interface HealthResponse {
  status: HealthStatus;
  version: string;
  uptimeSeconds: number;
  timestamp: string;
  checks: {
    database: DependencyStatus;
    redis: DependencyStatus;
  };
}

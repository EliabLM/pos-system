/**
 * @pos/dto-types — shared request/response DTOs for the POS system.
 *
 * Single source of truth for the wire contract between pos-system-server,
 * pos-system-client, and pos-system-app. Fase 2+ populates these per module.
 */

// ── Generic API envelope ──

export interface ApiError {
  code: string;
  message: string;
  correlationId?: string;
  details?: unknown;
}

// ── Health (Fase 0 wiring) ──

export interface HealthResponse {
  status: 'ok' | 'ready';
}

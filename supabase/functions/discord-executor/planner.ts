export type Resource = { id: string; name: string; type?: number; parent_id?: string | null; managed?: boolean; permissions?: string; position?: number; permission_overwrites?: unknown[] };
export type Snapshot = { guild: { id: string; name: string }; channels: Resource[]; roles: Resource[] };
export type Strategy = 'reuse' | 'missing' | 'reorganize' | 'rebuild';
export type Mapping = { logical_key: string; discord_id: string; resource_type: string };
export type Desired = { key: string; name: string; kind: 'category' | 'channel' | 'role'; parentKey?: string };
export const normalizeName = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// An ambiguous name is never resolved by taking the first match.
// Managed/integration roles and @everyone are never adopted.
export function planStructure(snapshot: Snapshot, desired: Desired[], mappings: Mapping[], strategy: Strategy) {
  const matched = new Map<string, string>();
  const operations: { key: string; kind: string; name: string; action: string; discord_id?: string; parentKey?: string; candidates?: string[] }[] = [];
  for (const item of desired) {
    const resources = item.kind === 'role' ? snapshot.roles.filter(r => !r.managed && r.id !== snapshot.guild.id) : snapshot.channels.filter(r => item.kind === 'category' ? r.type === 4 : r.type === 0);
    const existingMap = mappings.find(m => m.logical_key === item.key && m.resource_type === item.kind);
    let candidates = resources.filter(r => normalizeName(r.name) === normalizeName(item.name));
    if (item.parentKey && candidates.length > 1) {
      const parentId = matched.get(item.parentKey);
      if (parentId) candidates = candidates.filter(r => r.parent_id === parentId);
    }
    const mapped = existingMap && resources.find(r => r.id === existingMap.discord_id);
    const resource = mapped || (candidates.length === 1 ? candidates[0] : undefined);
    if (resource) {
      matched.set(item.key, resource.id);
      const parentId = item.parentKey && matched.get(item.parentKey);
      const move = strategy === 'reorganize' && item.kind === 'channel' && item.parentKey && (!parentId || resource.parent_id !== parentId);
      operations.push({ ...item, action: move ? 'move' : 'reuse', discord_id: resource.id });
    } else if (candidates.length > 1) {
      operations.push({ ...item, action: 'conflict', candidates: candidates.map(r => r.id) });
    } else {
      operations.push({ ...item, action: strategy === 'reuse' ? 'missing' : 'create' });
    }
  }
  return {
    strategy, operations, preserved_ids: [...snapshot.channels, ...snapshot.roles].map(r => r.id),
    executable: strategy !== 'rebuild' && !operations.some(o => o.action === 'conflict'),
    requires_confirmation: strategy === 'reorganize' || strategy === 'rebuild',
    // A structural snapshot cannot recover deleted messages, invites or original IDs.
    backup_scope: 'structure_only',
    rebuild_blocked: strategy === 'rebuild',
  };
}

export function templateStructure(config: Record<string, unknown>): Desired[] {
  const categories: Record<string, string[]> = {
    minimal: ['INFORMAÇÕES', 'LOJA', 'SUPORTE'],
    store_community: ['INFORMAÇÕES', 'LOJA', 'COMUNIDADE', 'SUPORTE', 'EQUIPE'],
    support_only: ['INFORMAÇÕES', 'SUPORTE', 'EQUIPE'],
    digital_store: ['INFORMAÇÕES', 'LOJA', 'PEDIDOS', 'SUPORTE', 'EQUIPE'],
  };
  const channels: Record<string, [string, string][]> = {
    minimal: [['boas-vindas', 'INFORMAÇÕES'], ['produtos', 'LOJA'], ['suporte', 'SUPORTE'], ['logs', 'SUPORTE']],
    store_community: [['boas-vindas', 'INFORMAÇÕES'], ['regras', 'INFORMAÇÕES'], ['produtos', 'LOJA'], ['novidades', 'LOJA'], ['chat-geral', 'COMUNIDADE'], ['avaliações', 'COMUNIDADE'], ['abrir-ticket', 'SUPORTE'], ['logs', 'EQUIPE']],
    support_only: [['regras', 'INFORMAÇÕES'], ['abrir-ticket', 'SUPORTE'], ['dúvidas', 'SUPORTE'], ['logs-suporte', 'EQUIPE']],
    digital_store: [['boas-vindas', 'INFORMAÇÕES'], ['regras', 'INFORMAÇÕES'], ['termos', 'INFORMAÇÕES'], ['produtos', 'LOJA'], ['pedidos', 'PEDIDOS'], ['avaliações', 'LOJA'], ['abrir-ticket', 'SUPORTE'], ['solicitar-produto', 'SUPORTE'], ['dúvidas', 'SUPORTE'], ['vendas', 'EQUIPE'], ['logs', 'EQUIPE']],
  };
  const template = String(config.template || 'digital_store');
  if (!categories[template]) throw new Error('INVALID_TEMPLATE');
  const result: Desired[] = [];
  // Logical channel keys are later used by the Nexium panel publisher. Reusing a uniquely named channel keeps its ID; only missing resources are created.
  if (config.create_channels) {
    for (const name of categories[template]) result.push({ key: `category:${normalizeName(name)}`, name, kind: 'category' });
    for (const [name, parent] of channels[template]) {
      if (!config.create_logs && name.startsWith('logs')) continue;
      result.push({ key: `channel:${normalizeName(name)}`, name, kind: 'channel', parentKey: `category:${normalizeName(parent)}` });
    }
  }
  if (config.create_roles) for (const name of ['Cliente', 'Suporte', 'Fornecedor', 'Gerente']) result.push({ key: `role:${normalizeName(name)}`, name, kind: 'role' });
  return result;
}

import type { Resource } from './planner.ts';
export function describeBotAccess(guildId: string, roles: Resource[], memberRoleIds: string[]) {
  const assigned = roles.filter(role => role.id === guildId || memberRoleIds.includes(role.id));
  const permissions = assigned.reduce((value, role) => value | BigInt(role.permissions || '0'), 0n);
  const administrator = !!(permissions & 8n);
  const highestPosition = Math.max(0, ...assigned.map(role => role.position || 0));
  const canManageRole = (role: Resource) => !role.managed && role.id !== guildId && (role.position || 0) < highestPosition;
  return {
    permissions: permissions.toString(), administrator, highest_role_position: highestPosition,
    manage_roles: administrator || !!(permissions & (1n << 28n)),
    manage_channels: administrator || !!(permissions & (1n << 4n)),
    protected_roles: roles.filter(role => !canManageRole(role)).map(role => ({ id: role.id, name: role.name, managed: !!role.managed, position: role.position || 0 })),
    customer_role_manageable: roles.some(role => role.name.toLowerCase() === 'cliente' && canManageRole(role)),
    support_role_manageable: roles.some(role => role.name.toLowerCase() === 'suporte' && canManageRole(role)),
  };
}

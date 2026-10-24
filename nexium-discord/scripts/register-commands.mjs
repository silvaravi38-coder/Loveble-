// Uso: node --env-file=.env.local scripts/register-commands.mjs
// Para registrar imediatamente em um servidor de teste, defina DISCORD_GUILD_ID.
const { DISCORD_APPLICATION_ID: app, DISCORD_BOT_TOKEN: token, DISCORD_GUILD_ID: guild } = process.env;
if (!app || !token) {
  console.error("Defina DISCORD_APPLICATION_ID e DISCORD_BOT_TOKEN nas variáveis de ambiente.");
  process.exit(1);
}
const endpoint = guild
  ? `https://discord.com/api/v10/applications/${app}/guilds/${guild}/commands`
  : `https://discord.com/api/v10/applications/${app}/commands`;
const r = await fetch(endpoint, {
  method: "PUT",
  headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify([{ name: "config", description: "Configurar tickets e vendas", default_member_permissions: "8", dm_permission: false }]),
});
if (!r.ok) {
  const detail = await r.text();
  console.error(`Falha ao registrar comandos (${r.status}). Confira se o token é atual e se pertence ao Application ID configurado.`);
  if (detail) console.error(detail.slice(0, 1200));
  process.exit(1);
}
console.log(guild ? "Comando /config registrado no servidor de teste." : "Comando /config registrado globalmente. A atualização pode levar alguns minutos.");

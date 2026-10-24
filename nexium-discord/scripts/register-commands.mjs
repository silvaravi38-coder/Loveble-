// Uso: node --env-file=.env.local scripts/register-commands.mjs
const { DISCORD_APPLICATION_ID: app, DISCORD_BOT_TOKEN: token } = process.env;
if (!app || !token) throw new Error("Defina DISCORD_APPLICATION_ID e DISCORD_BOT_TOKEN.");
const r = await fetch(`https://discord.com/api/v10/applications/${app}/commands`, {
  method: "PUT",
  headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify([{ name: "config", description: "Configurar tickets", default_member_permissions: "8", dm_permission: false }]),
});
console.log(r.ok ? "Comandos registrados." : `Erro ${r.status}`);

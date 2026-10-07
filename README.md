# NEXIUM STORE

Seu universo digital em um só lugar.

## Bot Discord

O organizador identifica e reutiliza os recursos do servidor, completa a estrutura,
publica os painéis e preenche os IDs automáticos do suporte. A reorganização mantém
os IDs e mensagens dos canais; áreas às quais o bot não tem acesso são preservadas.

Tickets abrem sem formulário inicial, têm botão para entrar no canal privado e
reutilizam o atendimento ativo para o mesmo assunto. Painéis existentes são
atualizados, mensagens apagadas são recuperadas após confirmação do Discord e
painéis de atendimento duplicados são desativados.

Validação: `npm test`, `npm run check:backend`, `npm run build` e as suites SQL
transacionais em `tests/`. Consulte [o estado e os limites do organizador](docs/discord-organizer.md).

<!-- Vercel deployment trigger: Nexium Store -->

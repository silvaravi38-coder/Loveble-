# NEXIUM Bot — estado verificado em 06/10/2026

## Conexão real

- Aplicação Discord: `1557132199227031552` (Nexus bot).
- Servidor: `1555045658636062770` (Nexium Store).
- Token configurado apenas nos secrets do Supabase. A identidade retornada pelo Discord corresponde à aplicação informada.
- Scan real concluído: **12 categorias, 55 canais e 16 cargos**; IDs, pais e permissões salvos sem duplicar registros.
- Bot com permissões para gerenciar canais/cargos, sem Administrador; cargo mais alto na posição 3. Cliente e Suporte estão abaixo dele. Cargos superiores, gerenciados por outros bots e @everyone são protegidos.

## Entregue

- Jobs registram responsável, status, erros, logs, tentativas, início/fim e chave de idempotência. Há bloqueio de concorrência por servidor.
- Handler implementa **scan, preview, backup e apply**. O schema também reserva rebuild, restore, publish, sync e unpublish, mas seus executores ainda não estão implementados.
- Scan lê metadados, categorias/canais, cargos, permissões e threads ativas. Salva snapshot com checksum SHA-256 e inventário de IDs de forma atômica.
- Preview oferece aproveitar, completar, reorganizar e refazer. Usa IDs já mapeados e comparação de nomes/tipos. Nomes ambíguos bloqueiam a adoção automática.
- Apply implementa **criação somente de recursos faltantes**, com cargos de permissão zero e canais/categorias privados para equipe/pedidos. Não altera permissões de recursos existentes.
- Apply exige preview concluído, configuração inalterada e snapshot recente. Consulta novamente o Discord e compara a estrutura; salva novo backup antes de qualquer criação.
- Operações têm journal individual, ID criado e motivo de auditoria. POSTs de criação com resultado incerto não são repetidos automaticamente; exigem novo scan e reconciliação.
- Reorganização, exclusão, rebuild e restore continuam bloqueados. Não existe exclusão indiscriminada.
- Admin permite consultar histórico/logs e aplicar um preview permitido. Apenas o botão de conexão Discord foi acrescentado à área de conta; o visual da loja pública foi preservado.
- Backend OAuth de vinculação de contas implementado e publicado. Utiliza autorização `identify`, state aleatório armazenado como hash, validade de cinco minutos e consumo único. A identidade vem de `/users/@me`, nunca de um ID fornecido pelo cliente.
- Não persiste access/refresh tokens do Discord. Uma conta Discord só pode estar vinculada a um perfil; não sobrescreve vínculos existentes.
- Botão “Conectar minha conta Discord” na conta do cliente. Vinculação real ainda depende da configuração abaixo.

## Autenticação e RLS

- Operações do Admin validam JWT com auth.getUser e consultam profiles.role no banco.
- Dispatch pelo conector usa capability aleatória de uso único, hash no banco, TTL curto e job previamente autorizado por administrador. Não permite alterar ação/configuração pelo corpo da requisição.
- Tabelas de jobs, snapshots, inventário, logs e operações: RLS, leitura de administradores e escrita somente backend.
- Estados OAuth e capabilities: sem acesso de clientes. Vínculos Discord: leitura do próprio usuário ou administrador; escrita somente backend.
- RPCs novos são SECURITY INVOKER, sem EXECUTE para anon/authenticated.
- Endpoints públicos de health revelam apenas versão, readiness e URL pública de callback. POST sem autenticação retorna 401.
- Advisor não apontou problemas nas tabelas/RPCs novas. Persistem alertas legados: 14 funções SECURITY DEFINER acessíveis por anon, 18 por authenticated e proteção de senhas vazadas desativada. Algumas funções consultadas verificam cargo/posse, mas **a auditoria completa do backend legado permanece pendente**. Nenhuma revogação ampla de políticas da loja foi feita.
- Referências de remediação: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable e https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection .

## Verificação realizada

- **20 testes automatizados passaram**: matching/IDs/tipos, conflitos, hierarquia, retries limitados, proteção de estratégias destrutivas, mudança de configuração/servidor, permissões mínimas, resultados incertos e troca OAuth simulada.
- Build Vite/TypeScript e check estrito dos dois backends passaram. O check local usa os tipos Supabase instalados; não equivale a uma integração Discord completa.
- Testes SQL com rollback validaram grants/RLS, lock por servidor, scan atômico, upsert de IDs, capabilities de uso único, expiração/replay e estados OAuth. Fixtures não foram persistidas.
- Migrações aplicadas e funções `discord-executor` (versão 7) e `discord-oauth` (versão 1) publicadas no Supabase.
- Health real: token do bot configurado; client secret OAuth **não configurado**. POST público bloqueado com 401 nos dois endpoints.
- Scan real job `8a796f77-6815-4bae-95bc-3648f50c654e`: sucesso; snapshot `84f852d9-b1e2-48a4-bc46-2496a322e83f`.
- Preview real para aproveitar recursos job `907a3f84-330f-4708-8d86-9664185b2b21`: sucesso; reutiliza Cliente, Suporte e um canal com nome pedidos.
- Apply sem criação job `6ea96aee-f953-4491-9aec-8962e7686efc`: **bloqueado por SERVER_CHANGED_RESCAN_REQUIRED**. A proteção detectou diferença entre preview e consulta atual; nenhuma mutação foi executada.
- Criação real de recursos, autorização OAuth de cliente e fluxo de Admin em navegador autenticado **não foram verificados**. Testes automatizados de POST não equivalem a criação no Discord.

## Configuração que depende do proprietário

1. Discord Developer Portal → aplicação `1557132199227031552` → OAuth2 → Redirects: adicionar exatamente:
   `https://flcqndjlzuhmxxahjudj.supabase.co/functions/v1/discord-oauth`
2. Na mesma aplicação, obter o **Client Secret OAuth2** e salvá-lo no Supabase, projeto `flcqndjlzuhmxxahjudj`, Edge Functions → Secrets, nome **DISCORD_CLIENT_SECRET**.
3. Não trocar o bot token nem enviar o secret no chat/GitHub/frontend. Depois da configuração, testar a autorização de uma conta e o vínculo real.

Client Secret OAuth2 é diferente de DISCORD_BOT_TOKEN, que já está configurado. O callback precisa constar no Developer Portal para a autorização funcionar. Isso bloqueia somente a validação OAuth; o restante do bot ainda exige desenvolvimento.

## Limites e próximos estágios

- Snapshots são **backups estruturais**, não backups de mensagens, anexos, convites, threads arquivadas ou atribuições de cargos a membros. IDs originais e mensagens não podem ser recuperados recriando canais apagados. Restore não está implementado.
- Worker atual executa no request Edge; não há consumidor durável, heartbeat, retomada após queda nem agendamento. GETs têm até três tentativas; criação não tem retry cego. Jobs de criação interrompidos não são expirados automaticamente.
- Matching por nome não resolve equivalência semântica: o template sugere categorias como LOJA, mas já existem categorias de produtos com outros nomes. Ainda precisa de overrides manuais revisáveis para aproveitar melhor a estrutura.
- Há dois canais chamados suporte e um canal pedidos sob Referências. Esse canal **não deve receber informação privada de pedidos** sem revisão explícita de finalidade/permissões.
- Ainda implementar atualização/permissões em recursos existentes, aprovação destrutiva vinculada ao plano, rebuild/restore seletivo e reconciliação de operações incertas.
- Ainda implementar mensagens/embeds, botões/selects e publish/sync/unpublish dos painéis com IDs persistidos.
- Ainda implementar endpoint assinado de interações ou Gateway; não há processo Gateway conectado. Estar instalado no servidor não significa que o bot já responde comandos ou fica online.
- Ainda implementar compra Discord com catálogo real e origem painel/canal/produto, PIX TurbofyPay, webhook idempotente, cargo Cliente e entrega. Funções PIX legadas não foram alteradas ou revalidadas nesta entrega.
- Ainda implementar/revalidar pedidos, estoque/reserva/restock, cupons e indicadores financeiros Hoje/Mês/Total com origem Site/Discord.
- Ainda implementar ciclo completo dos tickets Discord, transcript, avaliação, histórico permanente e remuneração somente por resolvidos. Métricas legadas usam 30 resolvidos = R$10; integração Discord não entregue.
- Ainda implementar IA autorizada para dados do cliente, takeover de staff, resumo e sugestões/respostas automáticas.
- Ainda implementar mensagens agendadas, boas-vindas, notificações, anti-raid/fake, lock/pânico e auditoria completa.

Não foi declarado o projeto completo nem o sistema de vendas/tickets funcionando.

## Atualização posterior: OAuth e comandos

Client Secret configurado, callback cadastrado e vínculo real da conta Ariel confirmado em 06/10/2026. Comandos registrados. Consulte [DISCORD_INTERACTIONS_STATUS.md](./DISCORD_INTERACTIONS_STATUS.md). Os demais limites e pendências acima continuam aplicáveis.

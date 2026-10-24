# Bot e painel da Nexium Store (fases 1 e 2)

Roda dentro do projeto Next.js na Vercel, usando o endpoint de interações do Discord (sem processo permanente).
Copie `app`, `lib`, `scripts`, `supabase` e `vercel.json` para a raiz do projeto.

## Pronto
**Tickets:** `/config` (cargo da equipe, canal de logs, categoria, setores por formulário, publicar painel), tickets em canais privados, assumir (só um atendente), encerrar com resumo, exclusão automática, bloqueio de duplicados, cooldown de 3 min em "Solicitar Produtos para Estoque", aviso fora do horário, logs.

**Vendas:** `/config` → "Painel de vendas" publica um menu com os produtos escolhidos. O cliente escolhe produto e plano e recebe uma fatura (embed). O pedido vai para o canal de pedidos da equipe, com botões para confirmar pagamento, marcar como entregue ou cancelar. Um pedido pendente por cliente e plano (cliques repetidos não duplicam). Pedidos pendentes expiram pelo cron. Preço e disponibilidade são lidos do banco na hora.

**Painel web (`/admin`):** login com Supabase, visão geral, produtos e planos (criar, preço, disponibilidade, arquivar), pedidos com filtro e confirmação, mensagem de entrega e chave Pix manual. Toda página e toda ação checa o administrador no servidor.

## Mensagens padronizadas
- `lib/embeds.ts` concentra o padrão: azul #5865F2 (padrão), verde #00FF7F (sucesso), vermelho #FF4B4B (erro) e amarelo #FFB900 (aviso). Respostas privadas, logs e mensagens ao cliente usam as mesmas funções.
- **Ticket:** uma embed só (cliente, setor, status, responsável, aberto). Ao assumir, ela é atualizada, sem mensagem extra. Ao encerrar, mostra quem encerrou, duração e resumo.
- **Transcrição:** ao encerrar, o histórico da conversa vai como arquivo `.txt` junto do log de encerramento no canal de logs. Liga e desliga em `/admin/hours`. Lê até 1000 mensagens; links de anexos podem deixar de abrir depois que o canal for apagado.
- **Pedido:** fatura com número, produto, plano, valor, forma de pagamento e status. A mensagem da equipe mostra só as ações válidas e é atualizada quando o status muda no Discord, no painel web ou por expiração (o cliente também é avisado por DM).
- **Logs:** uma embed compacta por evento, com registro, cliente, atendente, resultado e horário.

## Horários e painéis de venda no painel web
- **`/admin/hours` (Atendimento):** edita os horários por dia (até dois períodos, fuso de São Paulo), bloqueio de ticket duplicado, tempo para apagar o canal do ticket e tempo para expirar pedido pendente.
- **`/admin/panels`:** cria painéis de venda escolhendo canal e produtos, altera título e produtos, ativa ou desativa e exclui. Ao salvar, a mensagem no Discord é atualizada; ao excluir, ela é apagada. Painel desativado responde "desativado" mesmo em mensagens antigas.
- Painéis publicados antes da migração `005` não têm mensagem registrada: o painel web edita o banco, mas não consegue atualizar a mensagem antiga. Exclua e crie de novo.
- Assume um único servidor do Discord (o primeiro em `discord_settings`).

## Builder de servidores (`/admin/builder`)
Escolha o servidor onde o bot está, o modo e o modelo; veja a **prévia** (criar, ajustar, remover, já existe) e confirme no próprio painel.
- **Configuração automática:** só adiciona o essencial que falta (informações, loja, atendimentos, equipe). Não altera nem remove nada.
- **Criar servidor completo:** monta o modelo inteiro (catálogo vindo dos seus produtos, comunidade opcional). Só cria o que falta. O Discord não deixa o bot criar e entrar num servidor novo: crie o servidor, adicione o bot e rode isto.
- **Refazer a estrutura:** ajusta canais e categorias existentes ao modelo. Remover o que sobra só acontece se você marcar a opção e digitar `REFAZER`. Canais de tickets abertos e canais exigidos pelo Discord (regras, atualizações, sistema) nunca são removidos. Cargos nunca são removidos.
- Cria cargos Administração, Atendimento e Cliente **sem permissões especiais** (o bot só concede o que ele mesmo tem). Dê as permissões reais em Configurações do servidor.
- Liga sozinho o canal de logs, o canal de pedidos, a categoria de tickets e o cargo da equipe (em modos que não refazem, só preenche o que estiver vazio) e publica os painéis, se marcado.
- Canais do catálogo saem dos produtos cadastrados (ex.: `📼・netflix`). Se algo demorar, aplique de novo: ele continua de onde parou.

## Pagamento Pix
A integração com a TurboFyPay está isolada em `lib/pix.ts` e `app/api/pix/webhook`, mas **não implementada**: faltam a documentação da API (endpoints, autenticação, formato da cobrança e do webhook, assinatura). Enquanto isso, o pedido só vira "pago" quando alguém autorizado confirma (Discord ou painel). Se houver chave Pix manual cadastrada, ela aparece na fatura.

## Ainda não incluído
IA nos tickets (exige processo permanente) e integração Pix com a TurboFyPay: as duas ficam para depois.

## Instalação
1. `npm i @supabase/supabase-js @supabase/ssr tweetnacl`
2. No Supabase, rode `002_discord_tickets.sql`, `003_sales_admin.sql`, `004_builder.sql`, `005_panels_message.sql` e `006_embeds_transcripts.sql`.
3. Crie seu usuário em Authentication > Users e libere o acesso ao painel: `insert into admin_users (user_id) values ('ID_DO_SEU_USUARIO');`
4. Discord Developer Portal: crie o app e o bot; copie Application ID, Public Key e Token.
5. Preencha as variáveis (`.env.example`) na Vercel e local. `CRON_SECRET` é um texto aleatório longo.
6. Publique e cole `https://SEU-DOMINIO/api/discord/interactions` em "Interactions Endpoint URL".
7. `node --env-file=.env.local scripts/register-commands.mjs`
8. Convite: `https://discord.com/oauth2/authorize?client_id=SEU_APPLICATION_ID&scope=bot%20applications.commands&permissions=268553232`
9. No servidor: `/config`, escolha cargo, canal de logs, categoria e **canal de pedidos**. Cadastre produtos em `/admin/products` e use "Painel de vendas".

## Projeto base e teste
- **Projeto novo:** a pasta `base-projeto/` tem `package.json`, `tsconfig.json`, `next.config.ts`, Tailwind, layout raiz e página inicial. Copie o conteúdo dela para a raiz junto com as outras pastas, rode `npm install` e `npm run build`.
- **Integrar na loja existente:** não copie `base-projeto/`. Confirme só duas coisas: o alias `@/*` aponta para a raiz e o `target` do TypeScript é `ES2020` ou maior (o código usa literais BigInt, como `8n`).
- Se o `npm run build` apontar erros de TypeScript, são ajustes pequenos: mande a mensagem de erro.

### Roteiro de teste (servidor de teste do Discord)
1. `/config`: escolha cargo da equipe, canal de logs, categoria e canal de pedidos; publique o painel de tickets.
2. Abra um ticket com uma conta comum: o canal deve ser privado, com a embed de abertura. Tente abrir de novo no mesmo setor (deve avisar).
3. Com a conta da equipe, clique em Assumir: a mesma embed muda de responsável. Uma segunda pessoa não consegue assumir.
4. Encerre: resumo na embed, log com o arquivo da transcrição e canal apagado depois do prazo (cron).
5. Setor de estoque: abra dois tickets seguidos e veja o aviso de espera de 3 minutos.
6. Cadastre um produto com planos em `/admin/products`, use "Painel de vendas" e faça um pedido: fatura para o cliente, mensagem na equipe.
7. Confirme o pagamento pelo Discord e depois outro pedido pelo painel web: a mensagem da equipe e o aviso ao cliente devem atualizar nos dois casos.
8. `/admin/builder`: rode a prévia em um servidor vazio antes de aplicar; teste "Refazer a estrutura" só em servidor de teste.

## Observações
- **Permissões do bot mudaram:** além de Gerenciar canais, o bot precisa de Gerenciar cargos e Anexar arquivos (o Discord exige isso para criar canais com permissões). Use o novo link de convite ou ajuste o cargo do bot. Se o bot já estava no servidor, suba o cargo dele acima dos cargos que o Builder cria.
- **Cron:** o `vercel.json` vem com execução diária (06:00 UTC), que funciona em qualquer plano da Vercel. Cron a cada minuto (`* * * * *`) faz o deploy falhar no plano gratuito. Nesse intervalo diário, canais de tickets encerrados e pedidos pendentes vencidos só são limpos uma vez por dia. Para limpar a cada minuto, use o plano Pro e troque o agendamento, ou chame `GET /api/cron/tickets` com `Authorization: Bearer SEU_CRON_SECRET` por um agendador externo (ex.: a cada 1 minuto).
- Usa `after` do Next.js 15. Ajuste o alias `@/` se o projeto usar outro.
- Código não testado contra um servidor real: teste em um servidor de teste antes de usar com clientes.

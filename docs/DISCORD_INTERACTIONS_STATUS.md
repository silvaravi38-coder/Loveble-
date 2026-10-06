# NEXIUM BOT — comandos, comércio e atendimento

Atualizado em 06/10/2026. Aplicação 1557132199227031552, servidor 1555045658636062770.

## Publicação e evidências

- `/nexium teste`, botão Meus pedidos e `/nexium pedidos` foram executados pelo usuário no Discord e mostraram os pedidos reais em resposta privada; screenshot e eventos do banco confirmaram o fluxo original.
- 48 subcomandos em três grupos registrados somente no servidor Nexium Store. A ativação 39293d9e-22e0-4138-957c-f088b2bdbdcf terminou `succeeded`; a API do Discord foi consultada novamente para conferir os IDs e o endpoint assinado.
- Supabase: discord-executor, discord-interactions, discord-payment-webhook e discord-scheduler publicados; OAuth existente preservado. Os registros das versões finais estão no histórico das Functions.
- Scan real eb098f77-970b-4ef3-96bb-73ca008c3d68: 12 categorias, 55 canais, 16 cargos. Snapshot 91ed6c79-ebb2-4bb3-b033-dfc15a7a6c0b. Nenhum canal/cargo existente foi apagado, movido ou reconfigurado durante essa verificação.
- Cliente e Suporte existentes são reutilizados; o scan confirmou que estão abaixo do cargo mais alto do bot. PIX Discord e concessão do cargo Cliente configurados no backend.
- Worker com capability própria guardada criptografada no Vault. Invocação HTTP autenticada respondeu 200, sem mensagens/pagamentos pendentes. Cron `nexium-discord-worker` ativo a cada minuto; heartbeat confirmado. A fila vazia não comprova uma entrega real de mensagem agendada.
- Credenciais TurbofyPay presentes; isso não comprova sua validade no provedor nem um pagamento real. A chave AI_GATEWAY_API_KEY está ausente: IA desligada.

## Comandos disponíveis

| Grupo | Subcomandos |
|---|---|
| /nexium | teste, ajuda, vincular, pedidos, catalogo, produto, comprar, pagamento, entrega, suporte |
| /ticket | abrir, cancelar, listar, ver, mensagem, assumir, transferir, prioridade, finalizar, avaliar, ia, resumo, transcript, adicionar, remover |
| /nexium-admin | painel, painel-tickets, custos, reconciliar, scan, backup, preview, aplicar, paineis, sincronizar, despublicar, agendar, mensagens, cancelar-mensagem, ia, lock, unlock, restock, estoque, financeiro, suportes, configurar, cupom |

Staff/admin precisam de conta Discord vinculada ao perfil autorizado na loja. A permissão do Discord não substitui essa autorização. O grupo admin exige também Gerenciar servidor para visibilidade padrão no Discord.

## Catálogo, painéis, estoque e PIX

- Catálogo vem dos produtos ativos da loja, até 25 opções por painel. Detalhes, variantes, preços e disponibilidade consultados no servidor.
- `/nexium-admin painel nome:Loja` publica no canal escolhido pelo administrador; `painel-tickets` publica botão para abrir atendimento privado. Suporta vários registros e mensagens. Sincronização edita apenas mensagens do próprio bot; despublicação desativa componentes preservando a mensagem. Republicação usa sincronizar.
- Cada compra guarda origem Discord, produto, canal e painel quando iniciada pelo painel. Consulta de pedidos/entregas verifica o perfil vinculado ao autor; não aceita user_id arbitrário.
- Checkout transacional: preço do catálogo, validação de variante/cupom, limite de pendências, reserva de estoque real, contagem de usos e idempotência da interação. Histórico das reservas permite revender uma unidade liberada após expiração sem alterar a reserva do pedido anterior.
- Todos os 14 produtos ativos estavam em entrega automática e sem unidades disponíveis. Nenhum estoque fictício foi criado. **Repor unidades reais com `/nexium-admin restock produto:...` antes de testar uma compra.** Formulário privado, rejeição de unidades duplicadas e gravação atômica de estoque/auditoria; chaves não entram nos logs.
- PIX TurbofyPay criado no backend, com idempotency-key do pedido e valor do banco. Cliente recebe copia-e-cola e QR Code HTTPS ou anexo PNG privado. Nenhuma service role, client-secret ou token do bot no frontend.
- Callback protegido por capability derivada por pedido. O corpo do webhook nunca confirma pagamento: o backend consulta o provedor com credenciais da loja e compara ID, valor e externalRef quando presente. Não se declara validação do header de assinatura nativo do TurbofyPay: o formato criptográfico não foi documentado na referência consultada.
- Confirmação e entrega automática atômicas; replay não duplica a entrega e expiração posterior não regride um pagamento confirmado. Cargo Cliente respeita hierarquia. DMs e logs genéricos passam por outbox com chave única; falha de DM não desfaz pagamento. Nunca enviam chaves de entrega.
- `/nexium-admin reconciliar pedido:UUID` recupera cobrança incerta por GET/externalRef sem criar uma segunda cobrança. Worker reconcilia cobranças registradas expiradas e tenta recuperar concessão de cargo/notificações pendentes.
- O toggle PIX é respeitado. Desligar PIX impede novas compras pelo Discord; cobranças anteriores continuam sendo conciliadas.

## Financeiro e atendimento

- `/nexium-admin financeiro periodo:today|month|total`: receita de pedidos pagos, quantidade, ticket médio, origem Site/Discord e mais vendidos; agregação SQL sem truncamento de 1000 registros. Limites de período usam America/Fortaleza.
- `/nexium-admin custos`: cadastra custos/taxas reais por pedido pago, com motivo e responsável. Lucro refere-se aos pedidos conciliados; pedidos sem custos/taxas continuam destacados. Não se inventam custos nem taxas do provedor.
- Tickets privados novos sem substituir canais antigos; podem relacionar pedido do próprio cliente. Motivo, prioridade, assumir, transferir, adicionar/remover membro, mensagens registradas e histórico permanente.
- Finalização exige motivo e resultado resolvido/cancelado/duplicado. Só resolvidos com atendente entram na remuneração: 30 resolvidos no mês = R$10. Cancelamento pelo cliente não remunera suporte.
- Transcript até 1000 mensagens por fechamento, com marca de captura parcial quando atingir o limite. Exportação JSON privada com dados do ticket e motivo da finalização; anexos são referências, não cópias dos arquivos. Avaliação única do cliente, 1–5 estrelas e comentário; duração exibida.
- Mensagens comuns digitadas no canal entram na captura de fechamento; sincronização em tempo real com o site depende de Gateway. `/ticket mensagem` registra imediatamente no suporte da loja.
- Tickets Discord devem ser finalizados/cancelados com comandos Discord para capturar transcript e motivo. RPCs legadas do site orientam esse fluxo. Filtros do Admin/atendimento foram ajustados para não tratar `closed` como aberto ou resolvido; visual público preservado.

## IA e automação

- `/nexium-admin ia`: liga/desliga, Gateway/modelo, instruções, temperatura, tokens, limite por hora, delay e modo sugerir/automático. SDK 7.0.129; modelo inicial confirmado na lista atual do Gateway.
- `/ticket ia` e `/ticket resumo`: saída privada para staff autorizado. Assumir tenta gerar resumo sem impedir atendimento se a IA estiver indisponível.
- Automático responde a `/ticket mensagem`, apenas enquanto não houver atendente. Reserva e conclusão transacionais bloqueiam resposta quando staff assumir; há nova verificação antes de enviar ao Discord. Uma requisição de envio já em trânsito não pode ser retirada pelo Discord.
- Contexto usa somente o pedido associado ao ticket e confere que pertence ao cliente. Não inclui pagamento bruto, email, chave/arquivo de entrega ou segredos. Instruções limitam respostas aos dados disponíveis; geração ainda requer revisão humana para sugestões.
- **Para ativar, configurar AI_GATEWAY_API_KEY nos secrets das Edge Functions do Supabase. Não enviar a chave pelo chat.** Sem chave, modo automático não é habilitado. Nenhuma chamada real de modelo foi feita.
- `/nexium-admin agendar texto:... quando:2026-10-07T12:00:00-03:00`: exige data com fuso e antecedência mínima de um minuto. Lista e cancela registros ainda na fila. Worker valida canal/servidor e se o solicitante continua admin; suprime menções.
- Resultados incertos de POST não são repetidos automaticamente. Fila marca `uncertain`; IDs de mensagens conhecidos são guardados para revisão.
- `/nexium-admin lock` e `unlock`: preview privado, backup de permissões e botão de confirmação do solicitante, válido cinco minutos. Compara estado atual com snapshot; preserva canais/cargos/mensagens. Unlock restaura somente o backup Nexium e recusa permissões alteradas externamente. Não protege contra uma alteração externa que ocorra entre a última leitura e o PATCH; backup permite revisão.

## Testes e segurança

- 34 testes Node passaram: assinaturas/replay, identidade, limites da API, hierarquia, preservação de permissões, manifest dos comandos, estoque vazio sem chamada ao provedor, modal privado, QR multipart, acesso administrativo e envio incerto sem retry.
- Check TypeScript estrito dos cinco backends e build do frontend passaram. SDK da IA importado exclusivamente no backend; bundle público não inclui a credencial.
- Testes SQL reais com rollback: reserva/idempotência/origem, valor divergente, entrega única, monotonicidade do pagamento, estoque liberado e revendido, autorização do staff, cancelamento sem remuneração, avaliação, financeiro autorizado e pausa da IA após assumir.
- Teste RLS com papel authenticated e fixture real: cliente não leu dados protegidos nem executou RPCs backend; Vault inacessível. Papel anon manteve acesso ao catálogo público e perdeu acesso a RPCs de staff.
- Revisão legada retirou 13 grants anônimos de RPCs de staff/fornecedor/triggers; corrigiu checagem de papel nulo em pagamento de suporte. `is_admin()` continua disponível para políticas públicas e retorna somente booleano da sessão.
- Advisors: um alerta anon remanescente (`is_admin`, necessário às políticas), 15 SECURITY DEFINER autenticados legados que exigem revisão por função, proteção de senhas vazadas desativada. Tabela da capability tem RLS e nenhum grant ao cliente: ausência de policy é intencional. Nenhuma nova RPC de negócio foi exposta a anon/authenticated.
- Referências de correção: [grants SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [proteção de senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Limites e próximos testes reais

Não se declara que todos os fluxos novos foram executados no aplicativo Discord. Registro/PING, testes unitários e SQL não substituem uma compra real, publicação de painel, fechamento de ticket, envio agendado ou chamada de IA.

Ainda pendentes: Gateway permanente para eventos de entrada/boas-vindas, anti-fake/anti-raid, mensagens comuns e presença online; modo pânico global; reorganização/rebuild/restore completos com preview, snapshot e confirmação; comando para criar pedido manual por staff e melhorias da interface Admin para todas as novas tabelas.

Backups do Builder são estruturais: não recuperam IDs originais, histórico de mensagens, arquivos ou integrações. Rebuild/restore continuam bloqueados; nunca apagam indiscriminadamente recursos existentes.

Falhas definitivas de criação de cobrança antes de registrar payment podem reter reserva para revisão; respostas incertas devem ser conciliadas, não repetidas. Pagamento tardio após estoque já liberado exige entrega manual/revisão. Outbox com resultado incerto requer revisão administrativa; não existe botão para forçar resend inseguro. Filas processam lotes limitados e não prometem envio exato no segundo agendado.

Para conferir agora: `/nexium ajuda`, `/nexium catalogo`, `/nexium-admin estoque`, publicar painéis nos canais escolhidos, abrir/assumir/finalizar ticket de teste e avaliar. Para teste de PIX, cadastrar estoque verdadeiro e usar pagamento real autorizado. IA depende da chave do Gateway; Gateway Discord depende de um processo hospedado e intents adequados.

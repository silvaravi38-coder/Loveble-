# NEXIUM — conexão e comandos Discord, 06/10/2026

## Resultado confirmado

- Client Secret OAuth configurado no Supabase, sem exposição no cliente.
- Autorização real vinculou o perfil Ariel à conta Discord rara._ra; confirmado no banco.
- Endpoint HTTP discord-interactions publicado e registrado na aplicação 1557132199227031552.
- Discord validou assinatura/PING durante o registro; consulta posterior da API confirmou o endpoint registrado.
- Comando /nexium registrado somente no servidor 1555045658636062770, ID 1557149869393584278, subcomandos teste e pedidos.
- Job de ativação 5353ea2f-09d7-4d89-b3cb-1336946de08a: succeeded; endpoint e comando consultados novamente na API.
- Nenhum canal/cargo criado, apagado, movido ou reconfigurado nesta etapa.

## Comportamento implementado

- /nexium teste: resposta privada e botão Meus pedidos.
- /nexium pedidos e botão: consulta os cinco pedidos mais recentes somente do perfil vinculado ao autor da interação.
- Sem vínculo: orienta conectar a conta pelo site. Sem pedidos: informa que não foram encontrados. Status desconhecido: informa indisponibilidade, sem inventar dados.
- Respostas usam defer ephemeral (flags=64) e atualização privada do original. Não incluem entregas/keys, credenciais, valores nem dados de outros clientes.
- Menções desativadas; ID do autor vem da interação assinada. Nenhum botão aceita user_id arbitrário.
- Não envia DMs nem mensagens espontâneas. Endpoint HTTP atende comandos/componentes, sem Gateway conectado. Presença online não implementada.

## Segurança e testes

- Assinatura Ed25519 sobre timestamp + corpo bruto antes de confiar no JSON.
- Janela temporal de cinco minutos, aplicação/servidor esperados, ações permitidas e IDs únicos bloqueiam adulteração/replay.
- Tokens de interação somente na memória, sem banco/logs.
- RLS nas duas tabelas novas, leitura administrativa e escrita backend. SQL com rollback verificou grants e unicidade de eventos.
- Ativação usa dispatch administrativo de uso único. Action publish permitida somente para target runtime_connection pelo conector; não publica painéis de venda ainda.
- 23 testes passaram; check estrito dos três backends passou. Assinaturas testadas com corpo adulterado, chave incorreta e timestamp antigo.
- Execução real de comando pelo aplicativo Discord ainda não foi observada. Registro/PING não substituem esse teste.

## Validação do usuário

No servidor Nexium Store, executar /nexium teste e conferir resposta privada. Clicar Meus pedidos e executar /nexium pedidos. Conferir eventos em discord_interaction_events.

## Limites

Ainda faltam painéis persistentes do catálogo, compras/PIX Discord, tickets, IA, jobs duráveis, atualização de recursos existentes, rebuild/restore e moderação. Nenhum comando cria pedido ou altera pagamento nesta entrega.

Runtime atual atende uma aplicação/servidor. Eventos são permanentes e sem retenção automática. Erros de resposta são registrados; não existe worker de retry após queda do runtime. Backups e alertas legados de segurança documentados em DISCORD_EXECUTOR_STATUS.md.

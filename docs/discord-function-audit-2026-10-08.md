# Auditoria funcional do bot — 8 de outubro de 2026

Resultado: 76 verificações ao vivo aprovadas, 93 testes Node aprovados,
13 suítes SQL aprovadas com rollback, compilação estrita do backend e build do site aprovados.

## Correções publicadas

- Finalizar/cancelar ticket e confirmar exclusão enviam a confirmação antes de apagar o canal.
  A exclusão só acontece se o Discord aceitar a resposta; falha de limpeza tem código separado.
  O transcript e as verificações de autoria, servidor e estado encerrado permanecem obrigatórios.
- A IA administrativa usa GROQ_API_KEY quando disponível, mantendo a alternativa Gateway.
  A geração prepara uma proposta validada; executar exige o botão Aplicar proposta,
  autorização administrativa, escopo do servidor e proposta não expirada.
- Diagnóstico reconhece credenciais Pix salvas pelo Discord, além das variáveis legadas.
- Tela de IA e health reconhecem a Groq; erro de chave informa as duas opções suportadas.
- Fixture SQL de comércio aceita contas já vinculadas e restaura tudo com rollback.

## Verificações ao vivo

Executadas pelo diagnóstico privado do scheduler, autenticado por capacidade existente,
usando somente ticket aberto, íntegro e não assumido pertencente a administrador vinculado.
Não é uma rota pública para simular interações de clientes.

| Grupo | Verificação |
| --- | --- |
| Botconfig | 17 telas pela mesma rota usada pelos botões |
| Loja | teste, ajuda, vincular, perfil, pedidos, catálogo |
| Administração | checklist, diagnóstico, dashboard, painéis, estoque, suportes, agendamentos |
| Financeiro | hoje, mês, total, 7 dias, 30 dias |
| Ranking | os cinco períodos |
| Produtos | detalhes dos 14 produtos ativos |
| Publicação | existência, autoria e payload dos 12 painéis sincronizados |
| Tickets | listar, consultar, ACL do proprietário e botões Staff/Membro/Pagamento/Ver |
| Comandos | presença dos comandos e opções do manifesto no Discord |
| IA | chamada real à Groq com contrato JSON e sugestão no ticket; sem publicação no chat |

O diagnóstico valida também limites de mensagens, embeds, menus e identificadores.
Resultado HTTP 200: total 76, passed 76, nenhuma falha.

## Fluxos com alteração de dados

As 13 suítes SQL executam no banco real com fixtures e rollback: capacidades de execução,
organizador/anti-duplicação, solicitar estoque/cooldown, recuperar tickets inexistentes,
executor/locks, configurar pagamentos/Vault, criar produto e entregar cargo/arquivo,
OAuth, quantidade manual, leitura de chat/pausa ao assumir, RLS, comércio e interações.
Incluem checkout repetido, estoque vazio, valor de pagamento divergente, entrega somente
após confirmação, isolamento de pedidos, atendimento/equipe, avaliações e permissões.

Os 93 testes Node incluem assinatura/replay, componentes e modais, limites do Discord,
autorização, rotação de credenciais, recuperação de acesso, erros de provedores,
reposição, moderação, agendamento e confirmação antes da exclusão.
A nova regressão da IA administrativa confirma que gerar uma proposta não cria produto
nem altera configuração operacional.

## Limites da validação

Não foi feita cobrança real, liquidação bancária nem entrega de um pedido real.
As ações de alteração são verificadas com fixtures de banco e requisições simuladas;
não foram enviados anúncios, removidos canais reais ou modificadas permissões de
clientes como teste. Uma compra real continua necessária para provar o fluxo do
provedor de pagamento de ponta a ponta. O diagnóstico de configuração sozinho
não comprova validade das credenciais ou saldo disponível.

Versões publicadas: discord-interactions 39 e discord-scheduler 18.

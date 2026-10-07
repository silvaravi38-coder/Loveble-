# Organizador e tickets Discord

## Fluxo

1. Salvar a configuração do Builder.
2. Executar scan e revisar o preview.
3. Aplicar o preview: o executor salva um backup estrutural, reutiliza IDs,
   cria recursos faltantes e move canais para as categorias escolhidas.
4. Sincronizar catálogo, atendimento e mensagens informativas.

As permissões de canais movidos para PEDIDOS/EQUIPE são restritas ao bot,
Suporte e Gerente, conforme indicado no preview. Movimentos públicos mantêm
as permissões existentes. IDs manuais não são sobrescritos. Os switches de
painéis e os produtos selecionados na configuração são respeitados.

## Proteções

- Autenticação de admin ou capacidade de dispatch descartável no executor.
- Assinatura Ed25519, verificação de servidor e receipt de interação nos tickets.
- Lock por servidor, idempotência de request e backup anterior às mutações.
- Comparação canônica de recursos, pais, permissões e hierarquia de cargos.
- A ordem visual dos canais não bloqueia um plano que não escreve `position`.
- Nomes ambíguos bloqueiam a criação automática. IDs persistidos têm prioridade.
- Áreas inacessíveis são preservadas; uma área NEXIUM separada permite completar
  a instalação sem alterar permissões de categorias externas.
- Mensagens informativas usam mapping, recuperação por autor/título e nonce.
  Histórico incompleto ou múltiplas mensagens correspondentes exigem revisão.
- Um 404 confirmado permite recuperar um painel apagado. Timeout/5xx de escrita
  retêm o lock e exigem conciliação; não geram tentativas cegas de POST.
- Cliques repetidos no mesmo assunto/pedido reutilizam o ticket ativo, com lock
  transacional no cliente. Tickets diferentes continuam limitados a três abertos.
- RPC de binding é SECURITY INVOKER e executável somente por service_role.

## Validação em 2026-10-07 UTC

- 54 testes Node passaram, além da verificação estrita do backend e build web.
- Suites SQL de comércio, interações, executor, RLS e organizador passaram,
  com fixtures revertidas por rollback.
- Executor e interações publicados e ACTIVE no projeto Nexium Store.
- Aplicação real concluída e repetida: zero criações ou movimentos na repetição,
  mesmos IDs dos dois painéis e das cinco mensagens informativas.
- Referências a mensagens antigas apagadas foram recuperadas; painéis de
  atendimento duplicados ficaram inativos.

O backup é estrutural: não recupera mensagens apagadas, convites nem IDs
originais após exclusão. Reconstrução destrutiva e restauração completa
continuam bloqueadas. O fluxo de clique do cliente deve ser conferido em uma
conta vinculada no Discord; não se falsificam interações assinadas para esse teste.

const string=(name:string,description:string,required=false)=>({type:3,name,description,required});
const user=(name:string,description:string,required=true)=>({type:6,name,description,required});
const ticket=()=>string('ticket','ID completo; omitido usa o canal do ticket');
const sub=(name:string,description:string,options:unknown[]=[])=>({type:1,name,description,options});
export const nexiumCommands=[
 {name:'nexium',type:1,description:'Catálogo, conta, compras e suporte Nexium',options:[
  sub('teste','Verificar a conexão'),sub('ajuda','Ver comandos disponíveis'),sub('vincular','Conectar sua conta Nexium'),sub('pedidos','Consultar seus pedidos'),sub('catalogo','Ver produtos ativos'),
  sub('produto','Ver detalhes e opções',[string('produto','Nome, slug ou ID do produto',true)]),
  sub('comprar','Comprar um produto com PIX',[string('produto','Nome, slug ou ID do produto',true),string('variante','ID da opção'),string('cupom','Código do cupom')]),
  sub('pagamento','Consultar o pagamento de seu pedido',[string('pedido','ID completo do pedido',true)]),
  sub('entrega','Consultar a entrega de seu pedido',[string('pedido','ID completo do pedido',true)]),
  sub('suporte','Abrir um atendimento privado',[string('motivo','Motivo do atendimento',true),string('pedido','ID completo de seu pedido')])]},
 {name:'ticket',type:1,description:'Atendimentos Nexium com histórico permanente',options:[
  sub('abrir','Abrir ticket privado',[string('motivo','Motivo do atendimento',true),string('pedido','ID completo de seu pedido')]),sub('cancelar','Cancelar seu atendimento com motivo',[string('motivo','Motivo do cancelamento',true),ticket()]),sub('listar','Listar seus tickets'),
  sub('ver','Ver atendimento',[ticket()]),sub('mensagem','Enviar mensagem registrada',[string('texto','Mensagem para o atendimento',true),ticket()]),
  sub('assumir','Assumir atendimento (staff)',[ticket()]),
  sub('transferir','Transferir atendimento (staff)',[user('atendente','Staff com conta vinculada'),ticket()]),
  sub('prioridade','Alterar prioridade (staff)',[{...string('nivel','Prioridade',true),choices:[{name:'Baixa',value:'low'},{name:'Normal',value:'normal'},{name:'Alta',value:'high'},{name:'Urgente',value:'urgent'}]},ticket()]),
  sub('finalizar','Finalizar com motivo e resultado (staff)',[string('motivo','Motivo da finalização',true),{...string('resultado','Resultado real',true),choices:[{name:'Resolvido',value:'resolved'},{name:'Cancelado',value:'cancelled'},{name:'Duplicado',value:'duplicate'}]},ticket()]),
  sub('avaliar','Avaliar seu atendimento encerrado',[{type:4,name:'estrelas',description:'Nota de 1 a 5',required:true,min_value:1,max_value:5},string('comentario','Seu comentário'),ticket()]),
  sub('ia','Sugerir resposta privada para o staff',[ticket()]),sub('resumo','Resumir a conversa para o staff',[ticket()]),sub('transcript','Consultar histórico registrado',[ticket()]),sub('adicionar','Adicionar membro ao ticket (staff)',[user('membro','Membro do servidor'),ticket()]),sub('remover','Remover membro do ticket (staff)',[user('membro','Membro do servidor'),ticket()])]},
 {name:'nexium-admin',type:1,description:'Administração Nexium; exige cargo autorizado no site',default_member_permissions:'32',options:[
  sub('painel','Publicar painel do catálogo neste canal',[string('nome','Nome do painel',true),string('produtos','IDs separados por vírgula; vazio usa ativos')]),
  sub('painel-tickets','Publicar painel de atendimento neste canal',[string('nome','Título do painel',true)]),
  sub('custos','Conciliar custos e taxas reais de um pedido',[string('pedido','ID completo do pedido',true),{type:10,name:'custo',description:'Custo real em reais',required:true,min_value:0},{type:10,name:'taxa',description:'Taxa real em reais',required:true,min_value:0},string('motivo','Origem da conciliação',true)]),
  sub('reconciliar','Recuperar cobrança incerta pelo ID do pedido',[string('pedido','ID completo do pedido',true)]),
  sub('scan','Escanear servidor sem alterar estrutura'),sub('backup','Salvar backup estrutural'),sub('preview','Comparar servidor ao template',[{...string('estrategia','Estratégia'),choices:[{name:'Aproveitar',value:'reuse'},{name:'Completar faltantes',value:'missing'},{name:'Reorganizar (preview)',value:'reorganize'}]}]),sub('aplicar','Aplicar criação de um preview revisado',[string('preview','ID completo do job preview',true)]),sub('paineis','Listar painéis'),sub('sincronizar','Atualizar painel com o catálogo',[string('painel','ID completo do painel',true)]),sub('despublicar','Desativar botões sem apagar mensagem',[string('painel','ID completo do painel',true)]),
  sub('agendar','Programar mensagem',[string('texto','Texto sem menções automáticas',true),string('quando','ISO: 2026-10-07T12:00:00-03:00',true),{type:7,name:'canal',description:'Canal; vazio usa atual',channel_types:[0,5]}]),sub('mensagens','Listar mensagens programadas'),sub('cancelar-mensagem','Cancelar mensagem ainda na fila',[string('mensagem','ID completo do agendamento',true)]),
  sub('ia','Configurar atendimento por IA',[{type:5,name:'ligada',description:'Ativar/desativar IA'},string('modelo','provider/model do Gateway'),string('instrucoes','Instruções da loja'),{type:10,name:'temperatura',description:'Temperatura',min_value:0,max_value:2},{type:4,name:'limite',description:'Chamadas máximas por hora',min_value:1,max_value:100},{type:4,name:'tokens',description:'Tokens máximos por resposta',min_value:100,max_value:2000},{type:4,name:'delay',description:'Delay em segundos',min_value:0,max_value:10},{...string('modo','Modo de atendimento'),choices:[{name:'Somente sugerir',value:'suggest'},{name:'Responder a /ticket mensagem',value:'automatic'}]}]),
  sub('lock','Preview e confirmação para bloquear este canal'),sub('unlock','Preview e confirmação para restaurar este canal'),
  sub('restock','Adicionar unidades reais em formulário privado',[string('produto','Nome, slug ou ID do produto',true)]),
  sub('estoque','Consultar quantidades; não mostra chaves',[string('produto','Nome, slug ou ID')]),
  sub('financeiro','Receita e ticket médio',[{...string('periodo','Período'),choices:[{name:'Hoje',value:'today'},{name:'Mês',value:'month'},{name:'Total',value:'total'}]}]),
  sub('suportes','Tickets assumidos/resolvidos e remuneração do mês'),
  sub('configurar','Configurar IDs usados pelo bot',[{type:5,name:'pix',description:'Ativar/desativar PIX Discord'},{type:5,name:'cargo_cliente_apos_pago',description:'Conceder cargo Cliente após pagamento'},{type:5,name:'dm_pagamento',description:'Notificar cliente por DM após pagamento'},{type:5,name:'dm_entrega',description:'Notificar cliente por DM após entrega'},{type:7,name:'logs',description:'Canal de logs'},{type:8,name:'cliente',description:'Cargo Cliente'},{type:8,name:'suporte',description:'Cargo Suporte'},{type:7,name:'categoria_tickets',description:'Categoria para tickets',channel_types:[4]}]),
  sub('cupom','Criar cupom',[string('codigo','Código',true),{type:10,name:'desconto',description:'Percentual de desconto',required:true,min_value:1,max_value:99},{type:4,name:'limite',description:'Máximo de usos',required:true,min_value:1,max_value:10000}])]},
];

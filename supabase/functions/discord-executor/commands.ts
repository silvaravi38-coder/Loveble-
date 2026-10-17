const string=(name:string,description:string,required=false)=>({type:3,name,description,required});
const user=(name:string,description:string,required=true)=>({type:6,name,description,required});
const ticket=()=>string('ticket','ID completo; omitido usa o canal do ticket');
const sub=(name:string,description:string,options:unknown[]=[])=>({type:1,name,description,options});
const groupedCommands=[
 {name:'nexium',type:1,description:'Catálogo, conta, compras e suporte Nexium',options:[
  sub('teste','Verificar a conexão'),sub('ajuda','Ver comandos disponíveis'),sub('vincular','Conectar sua conta Nexium'),sub('pedidos','Consultar seus pedidos'),sub('catalogo','Ver produtos ativos'),
  sub('produto','Abrir o catálogo e escolher um produto'),
  sub('comprar','Abrir o catálogo para escolher um produto e comprar com PIX'),
  sub('pagamento','Escolher um pedido e consultar o pagamento'),
  sub('entrega','Escolher um pedido e consultar a entrega'),
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
  sub('painel','Publicar painel do catálogo com os produtos ativos',[string('nome','Nome do painel',true)]),
  sub('painel-tickets','Publicar painel de atendimento neste canal',[string('nome','Título do painel',true)]),
  sub('custos','Escolher um pedido e registrar custos e taxas reais'),
  sub('reconciliar','Escolher um pedido pendente e recuperar a cobrança'),
  sub('scan','Escanear servidor sem alterar estrutura'),sub('backup','Salvar backup estrutural'),sub('preview','Comparar servidor ao template',[{...string('estrategia','Estratégia'),choices:[{name:'Aproveitar',value:'reuse'},{name:'Completar faltantes',value:'missing'},{name:'Reorganizar (preview)',value:'reorganize'}]}]),sub('aplicar','Escolher, revisar e aplicar um preview concluído'),sub('paineis','Listar painéis'),sub('sincronizar','Escolher um painel e atualizar o catálogo'),sub('despublicar','Escolher um painel e desativar os botões'),
  sub('agendar','Programar mensagem',[string('texto','Mensagem a enviar (máximo de 1.800 caracteres)',true),string('quando','Data/hora com fuso: AAAA-MM-DDTHH:MM:SS-03:00',true),{type:7,name:'canal',description:'Canal de texto; vazio usa este canal',channel_types:[0,5]}]),sub('mensagens','Ver mensagens programadas e horários'),sub('cancelar-mensagem','Escolher e cancelar uma mensagem da fila'),
  sub('ia','Configurar atendimento por IA',[{type:5,name:'ligada',description:'Ativar/desativar IA'},string('modelo','provider/model do Gateway'),string('instrucoes','Instruções da loja'),{type:10,name:'temperatura',description:'Temperatura',min_value:0,max_value:2},{type:4,name:'limite',description:'Chamadas máximas por hora',min_value:1,max_value:100},{type:4,name:'tokens',description:'Tokens máximos por resposta',min_value:100,max_value:2000},{type:4,name:'delay',description:'Delay em segundos',min_value:0,max_value:10},{...string('modo','Modo de atendimento'),choices:[{name:'Somente sugerir',value:'suggest'},{name:'Responder a /ticket mensagem',value:'automatic'}]}]),
  sub('lock','Preview e confirmação para bloquear este canal'),sub('unlock','Preview e confirmação para restaurar este canal'),
  sub('restock','Abrir o painel para selecionar um produto e repor unidades'),
  sub('estoque','Abrir painel para escolher e consultar produtos'),
  sub('financeiro','Receita e ticket médio',[{...string('periodo','Período'),choices:[{name:'Hoje',value:'today'},{name:'Mês',value:'month'},{name:'Total',value:'total'},{name:'Últimos 7 dias',value:'7days'},{name:'Últimos 30 dias',value:'30days'}]}]),
  sub('suportes','Tickets assumidos/resolvidos e remuneração do mês'),
  sub('configurar','Configurar IDs usados pelo bot',[{type:5,name:'pix',description:'Ativar/desativar PIX Discord'},{type:5,name:'cargo_cliente_apos_pago',description:'Conceder cargo Cliente após pagamento'},{type:5,name:'dm_pagamento',description:'Notificar cliente por DM após pagamento'},{type:5,name:'dm_entrega',description:'Notificar cliente por DM após entrega'},{type:7,name:'logs',description:'Canal de logs'},{type:8,name:'cliente',description:'Cargo Cliente'},{type:8,name:'suporte',description:'Cargo Suporte'},{type:7,name:'categoria_tickets',description:'Categoria para tickets',channel_types:[4]}]),
  sub('cupom','Criar cupom',[string('codigo','Código',true),{type:10,name:'desconto',description:'Percentual de desconto',required:true,min_value:1,max_value:99},{type:4,name:'limite',description:'Máximo de usos',required:true,min_value:1,max_value:10000}])]},
];

// Familiar shortcuts reuse the same handlers, authorization and checkout protections.
export const commandAliases:Record<string,{command:string;sub:string}>={
 configurar:{command:'nexium-admin',sub:'checklist'},'loja-ia':{command:'nexium-admin',sub:'store-ai'},'produto-entrega':{command:'nexium-admin',sub:'product-delivery'},
 admin:{command:'nexium-admin',sub:'dashboard'},botconfig:{command:'nexium-admin',sub:'configurar'},
 cupom:{command:'nexium-admin',sub:'cupom'},lock:{command:'nexium-admin',sub:'lock'},unlock:{command:'nexium-admin',sub:'unlock'},
 'meus-pedidos':{command:'nexium',sub:'pedidos'},meu_perfil:{command:'nexium',sub:'perfil'},
 payment:{command:'nexium',sub:'comprar'},payments:{command:'nexium',sub:'pagamento'},
 gerenciar_stock:{command:'nexium-admin',sub:'estoque'},gerenciar_produto:{command:'nexium-admin',sub:'produto'},gerenciar_item:{command:'nexium-admin',sub:'produto'},
 anunciar:{command:'nexium-admin',sub:'anunciar'},'painel-estoque':{command:'nexium-admin',sub:'painel-estoque'},
 rank:{command:'nexium-admin',sub:'suportes'},'rank-produtos':{command:'nexium-admin',sub:'ranking-produtos'},
};
function shortcut(name:string,description:string,options:any[]=[]){
 const target=commandAliases[name];
 return {name,type:1,description,options,...(target.command==='nexium-admin'?{default_member_permissions:'32'}:{})};
}
function existingOptions(command:string,subName:string):any[]{return groupedCommands.find(c=>c.name===command)!.options.find(s=>s.name===subName)!.options;}
export const nexiumCommands=[...groupedCommands,
 {name:'criar',type:1,description:'Cadastrar produtos da Nexium',default_member_permissions:'32',options:[sub('produto','Abrir formulário de cadastro e publicar produto')]},
 shortcut('configurar','Abrir checklist guiado da loja'),
 shortcut('loja-ia','Gerenciar produtos e configurações por IA',[string('texto','Pedido para a IA administrativa',true)]),
 shortcut('produto-entrega','Configurar entrega automática de produto',[string('produto','Nome ou slug do produto',true),{...string('tipo','Forma de entrega',true),choices:[{name:'Manual',value:'manual'},{name:'Key do estoque',value:'key'},{name:'Cargo Discord',value:'role'},{name:'Arquivo privado',value:'file'}]},{type:8,name:'cargo',description:'Cargo a entregar (tipo Cargo)'},{type:11,name:'arquivo',description:'Arquivo a entregar, até 10 MB (tipo Arquivo)'}]),
 shortcut('admin','Abrir a central administrativa privada'),
 shortcut('botconfig','Configurar o bot Nexium',existingOptions('nexium-admin','configurar')),
 shortcut('cupom','Criar cupom de desconto',existingOptions('nexium-admin','cupom')),
 shortcut('lock','Bloquear este canal após preview'),shortcut('unlock','Restaurar o bloqueio deste canal após preview'),
 shortcut('meus-pedidos','Consultar seu histórico de compras'),shortcut('meu_perfil','Ver sua conta Nexium vinculada'),
 shortcut('payment','Comprar um produto com Pix',existingOptions('nexium','comprar')),
 shortcut('payments','Consultar o Pix de seu pedido',existingOptions('nexium','pagamento')),
 shortcut('gerenciar_stock','Abrir painel para consultar e selecionar produtos'),
 shortcut('gerenciar_produto','Abrir painel para escolher e gerenciar produtos'),
 shortcut('gerenciar_item','Abrir painel para escolher um item e suas opções'),
 shortcut('anunciar','Publicar anúncio neste canal ou em um canal escolhido',[
  string('texto','Texto do anúncio (sem menções automáticas)',true),{type:7,name:'canal',description:'Canal de texto; vazio usa atual',channel_types:[0,5]}]),
 shortcut('painel-estoque','Atualizar o painel existente de solicitação de produtos'),
 shortcut('rank','Consultar atendimentos da equipe neste mês'),
 shortcut('rank-produtos','Ver os produtos mais vendidos',existingOptions('nexium-admin','financeiro')),
];
export function commandLabels(){return nexiumCommands.map(c=>`/${c.name}${c.options.some(o=>o.type===1)?': '+c.options.map(o=>o.name).join(' • '):''}`);}

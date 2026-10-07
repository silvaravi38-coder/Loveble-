import {row,button,safeText} from './api.ts';
import {privateMessage} from './security.ts';
const names:Record<string,string>={today:'Hoje',month:'Este mês',total:'Total', '7days':'Últimos 7 dias','30days':'Últimos 30 dias'};
export function financeMessage(report:any){
 const format=(value:number)=>Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const period=names[report.period]||'Total';
 const control=(label:string,value:string)=>button(label,`nexium:botconfig:run:financeiro:${value}`,report.period===value?1:2);
 return {...privateMessage(''),embeds:[{title:`Central de Rendimento — ${period}`,color:0xe3e5e8,description:`**Receita:** ${format(report.revenue)}\n**Vendas realizadas:** ${report.orders} pedidos\n**Ticket médio:** ${format(report.average)}`,fields:[{name:'Origem das compras',value:`Site: ${report.site_orders} • Discord: ${report.discord_orders}`},{name:'Conciliação financeira',value:`Custos registrados: ${format(report.recorded_costs)}\nTaxas registradas: ${format(report.recorded_fees)}\nLucro dos pedidos conciliados: ${format(report.net_reconciled)}\nPedidos sem custos/taxas conciliados: ${report.unreconciled_orders}`},{name:'Produtos mais vendidos',value:report.top_products.length?report.top_products.map((p:any)=>`• ${safeText(p.product_name,70)}: ${p.quantity}`).join('\n'):'Nenhuma venda confirmada no período.'}],footer:{text:'Nexium Store • Data de criação do pedido • Pagamentos confirmados • Fuso de Brasília'}}],components:[row([control('Hoje','today'),control('Últimos 7 dias','7days'),control('Últimos 30 dias','30days')]),row([control('Este mês','month'),control('Rendimento total','total')])]};
}

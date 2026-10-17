import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {actorFor,BotError,checked,uuid,safeText,row,button} from './api.ts';
import {privateEmbed,privateMessage} from './security.ts';
import {paymentStatus,reconcilePayment} from './payments.ts';
import {panelJob,executorJob} from './jobs.ts';
import {publishPanel} from './catalog.ts';
import {manageSchedules} from './schedules.ts';

const money=(value:unknown)=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
async function guildOrders(db:SupabaseClient,guild:string){
 const reqs=checked(await db.from('discord_checkout_requests').select('order_id').eq('guild_id',guild).limit(100)) as any[];
 const ids=[...new Set(reqs.map(r=>r.order_id).filter(Boolean))];
 if(!ids.length)return [];
 return checked(await db.from('orders').select('id,status,total,created_at').in('id',ids).order('created_at',{ascending:false}).limit(25)) as any[];
}
async function orderChoices(db:SupabaseClient,orders:any[]){
 if(!orders.length)return [];
 const items=checked(await db.from('order_items').select('order_id,product_name').in('order_id',orders.map(o=>o.id))) as any[];
 return orders.map(o=>{
  const name=items.find(i=>i.order_id===o.id)?.product_name||'Pedido Nexium';
  const date=new Date(o.created_at).toLocaleDateString('pt-BR');
  return {label:safeText(name+' • '+date,100),value:o.id,description:safeText(o.status+' • '+money(o.total),100)};
 });
}
export async function orderPicker(db:SupabaseClient,input:any,user:string,mode:'payment'|'delivery'|'reconcile'|'costs'){
 let orders:any[]=[];
 if(mode==='payment'||mode==='delivery'){
  const actor=await actorFor(db,user);
  orders=checked(await db.from('orders').select('id,status,total,created_at').eq('user_id',actor.id).order('created_at',{ascending:false}).limit(25)) as any[];
 }else{
  const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
  orders=mode==='reconcile'?await guildOrders(db,input.guild_id):checked(await db.from('orders').select('id,status,total,created_at').in('status',['paid','processing','delivered']).order('created_at',{ascending:false}).limit(25)) as any[];
  orders=orders.filter(o=>mode==='reconcile'?o.status==='pending':['paid','processing','delivered'].includes(o.status));
 }
 const options=await orderChoices(db,orders);
 if(!options.length)return privateEmbed(mode==='reconcile'?'🔎 Reconciliar pagamento':mode==='costs'?'🧾 Registrar custos':'📦 Seus pedidos',mode==='reconcile'?'Não há pedidos pendentes do Discord para reconciliar.':mode==='costs'?'Não há pedidos pagos para selecionar.':'Você ainda não tem pedidos.');
 const label=mode==='payment'?'Consultar pagamento':mode==='delivery'?'Consultar entrega':mode==='reconcile'?'Reconciliar pagamento':'Registrar custos';
 const description=mode==='payment'||mode==='delivery'?'Escolha um pedido. Não é necessário copiar o ID.':'Escolha um pedido na lista. O identificador fica preenchido automaticamente.';
 return {...privateEmbed(label,description),components:[row([{type:3,custom_id:'nexium:order-picker:'+mode,placeholder:'Escolha um pedido',min_values:1,max_values:1,options}])]};
}
export async function orderPickerAction(db:SupabaseClient,input:any,user:string,mode:string){
 if(!['payment','delivery','reconcile','costs'].includes(mode))throw new BotError('UNSUPPORTED_ACTION');
 const id=input.data.values?.[0];if(!uuid(id))throw new BotError('INVALID_ID');
 if(mode==='payment')return paymentStatus(db,user,id);
 if(mode==='delivery'){
  const actor=await actorFor(db,user);
  const order=checked(await db.from('orders').select('id,status').eq('id',id).eq('user_id',actor.id).maybeSingle());
  if(!order)throw new BotError('ORDER_NOT_OWNED');
  const delivered=await db.from('order_deliveries').select('id',{count:'exact',head:true}).eq('order_id',order.id);if(delivered.error)throw new BotError('DATABASE_ERROR');
  return privateMessage('📦 Pedido #'+order.id.slice(0,8).toUpperCase()+' • '+order.status+'\n'+(delivered.count?'Entrega disponível em Minha conta no site. As chaves e anexos ficam na área protegida da loja.':'Nenhuma entrega registrada até agora.'));
 }
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 if(mode==='reconcile')return reconcilePayment(db,id,input.guild_id,actor.id);
 const order=checked(await db.from('orders').select('id,status,total').eq('id',id).maybeSingle());
 if(!order||!['paid','processing','delivered'].includes(order.status))throw new BotError('ORDER_NOT_PAID');
 return {type:9,data:{custom_id:'nexium:cost-submit:'+id,title:'Registrar custos reais',components:[
  {type:1,components:[{type:4,custom_id:'cost',label:'Custo real em reais',style:1,required:true,max_length:16,placeholder:'0,00'}]},
  {type:1,components:[{type:4,custom_id:'fee',label:'Taxa real em reais',style:1,required:true,max_length:16,placeholder:'0,00'}]},
  {type:1,components:[{type:4,custom_id:'reason',label:'Origem da conciliação',style:2,required:true,min_length:3,max_length:300}]}
 ]}};
}
export async function saveOrderCosts(db:SupabaseClient,input:any,user:string){
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 const id=String(input.data.custom_id).split(':')[2];if(!uuid(id))throw new BotError('INVALID_ID');
 const values:Record<string,string>={};
 for(const r of input.data.components||[])for(const c of r.components||[])values[c.custom_id]=String(c.value||'').trim();
 const parse=(raw:string)=>Number(raw.replace(/\s/g,'').replace(/\./g,'').replace(',','.'));
 const cost=parse(values.cost||''),fee=parse(values.fee||'');
 if(!Number.isFinite(cost)||!Number.isFinite(fee)||cost<0||fee<0||!values.reason||values.reason.length<3)throw new BotError('INVALID_FINANCE_DATA');
 const order=checked(await db.from('orders').select('id,status').eq('id',id).maybeSingle());
 if(!order||!['paid','processing','delivered'].includes(order.status))throw new BotError('ORDER_NOT_PAID');
 checked(await db.from('discord_order_finance').upsert({order_id:id,cost,fee,note:safeText(values.reason,300),updated_by:actor.id,updated_at:new Date().toISOString()}));
 await checked(await db.from('discord_audit_events').insert({guild_id:input.guild_id,actor_id:actor.id,action:'order_finance_reconciled',entity_id:id,details:{cost,fee,note:safeText(values.reason,300)}}));
 return privateEmbed('✅ Custos registrados','Os valores reais foram associados ao pedido. O relatório financeiro já pode considerar custo e taxa.');
}
export async function panelPicker(db:SupabaseClient,input:any,user:string,action:'sync'|'unpublish'){
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 const panels=checked(await db.from('discord_sales_panels').select('id,name,channel_id,sync_status,active').eq('guild_id',input.guild_id).eq('active',true).order('name').limit(25)) as any[];
 if(!panels.length)return privateEmbed('🗂️ Painéis de venda','Não há painéis ativos para selecionar.');
 const label=action==='sync'?'sincronizar':'despublicar';
 return {...privateEmbed('🗂️ Escolher painel para '+label,'Selecione pelo nome. Nenhum ID precisa ser informado.'),components:[row([{type:3,custom_id:'nexium:panel-picker:'+action,placeholder:'Escolha um painel',min_values:1,max_values:1,options:panels.map(p=>({label:safeText(p.name,100),value:p.id,description:'Canal '+p.channel_id+' • '+safeText(p.sync_status,30)}))}])]};
}
export async function panelPickerAction(db:SupabaseClient,input:any,user:string,action:string){
 if(!['sync','unpublish'].includes(action))throw new BotError('UNSUPPORTED_ACTION');
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 const id=input.data.values?.[0];if(!uuid(id))throw new BotError('INVALID_ID');
 const p=checked(await db.from('discord_sales_panels').select('id,name,channel_id,active').eq('id',id).eq('guild_id',input.guild_id).eq('active',true).maybeSingle());
 if(!p)throw new BotError('PANEL_PRODUCT_MISMATCH');
 const label=action==='sync'?'Sincronizar painel':'Despublicar painel';
 return {...privateEmbed('⚙️ '+label,safeText(p.name,100)+' • <#'+p.channel_id+'>\nConfirme para aplicar a ação ao painel selecionado.'),components:[row([button(label+' agora','nexium:panel-action:'+action+':'+id,action==='sync'?1:4)])]};
}
export async function applyPanelAction(db:SupabaseClient,input:any,user:string,action:string,id:string){
 if(!['sync','unpublish'].includes(action)||!uuid(id))throw new BotError('INVALID_ID');
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 const p=checked(await db.from('discord_sales_panels').select('id,channel_id').eq('id',id).eq('guild_id',input.guild_id).eq('active',true).maybeSingle());
 if(!p)throw new BotError('PANEL_PRODUCT_MISMATCH');
 return panelJob(db,input.guild_id,actor.id,action==='sync'?'sync':'unpublish',id,()=>publishPanel(db,input.guild_id,p.channel_id,actor.id,id,action==='unpublish'));
}
export async function previewPicker(db:SupabaseClient,input:any,user:string){
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 const jobs=checked(await db.from('discord_jobs').select('id,created_at,result,input').eq('guild_id',input.guild_id).eq('action','preview').eq('status','succeeded').order('created_at',{ascending:false}).limit(25)) as any[];
 if(!jobs.length)return privateEmbed('🧩 Aplicar preview','Não há previews concluídos para aplicar. Gere um novo em /nexium-admin preview.');
 const options=jobs.map(j=>({label:'Preview • '+new Date(j.created_at).toLocaleString('pt-BR'),value:j.id,description:(j.result?.operations?.length||0)+' operações • selecione para revisar'}));
 return {...privateEmbed('🧩 Escolher preview','Selecione uma execução concluída para revisar antes de aplicar.'),components:[row([{type:3,custom_id:'nexium:preview-picker',placeholder:'Escolha um preview',min_values:1,max_values:1,options}])]};
}
export async function previewPickerAction(db:SupabaseClient,input:any,user:string){
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 const id=input.data.values?.[0];if(!uuid(id))throw new BotError('INVALID_ID');
 const job=checked(await db.from('discord_jobs').select('id,created_at,result,input').eq('id',id).eq('guild_id',input.guild_id).eq('action','preview').eq('status','succeeded').maybeSingle());
 if(!job)throw new BotError('CONTROL_PREVIEW_EXPIRED');
 const ops=(job.result?.operations||[]).slice(0,8).map((o:any)=>'• '+safeText(o.name,80)+' — '+safeText(o.action,30)).join('\n')||'Nenhuma operação pendente.';
 return {...privateEmbed('🔎 Revisar preview',ops+'\n\nConfirme apenas se o plano estiver correto.'),components:[row([button('Aplicar este preview','nexium:preview-apply:'+id,4)])]};
}
export async function applySelectedPreview(db:SupabaseClient,input:any,user:string,id:string){
 if(!uuid(id))throw new BotError('INVALID_ID');
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 const job=checked(await db.from('discord_jobs').select('input').eq('id',id).eq('guild_id',input.guild_id).eq('action','preview').eq('status','succeeded').maybeSingle());
 if(!job)throw new BotError('CONTROL_PREVIEW_EXPIRED');
 return executorJob(db,input.guild_id,actor.id,'apply',job.input?.strategy||'missing',id);
}
export async function schedulePicker(db:SupabaseClient,input:any,user:string){
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 const rows=checked(await db.from('discord_scheduled_messages').select('id,channel_id,content,scheduled_at').eq('guild_id',input.guild_id).eq('status','queued').order('scheduled_at').limit(25)) as any[];
 if(!rows.length)return privateEmbed('🗓️ Mensagens programadas','Não há mensagens na fila para cancelar.');
 return {...privateEmbed('🗓️ Escolher mensagem','Selecione pelo texto e horário para revisar o cancelamento.'),components:[row([{type:3,custom_id:'nexium:schedule-picker',placeholder:'Escolha uma mensagem',min_values:1,max_values:1,options:rows.map(m=>({label:safeText(m.content,100)||'Mensagem sem texto',value:m.id,description:new Date(m.scheduled_at).toLocaleString('pt-BR')+' • #'+safeText(m.channel_id,30)}))}])]};
}
export async function schedulePickerAction(db:SupabaseClient,input:any,user:string){
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 const id=input.data.values?.[0];if(!uuid(id))throw new BotError('INVALID_ID');
 const m=checked(await db.from('discord_scheduled_messages').select('id,content,channel_id,scheduled_at').eq('id',id).eq('guild_id',input.guild_id).eq('status','queued').maybeSingle());
 if(!m)throw new BotError('SCHEDULE_NOT_QUEUED');
 return {...privateEmbed('🗓️ Confirmar cancelamento',safeText(m.content,800)+'\n**Horário:** '+new Date(m.scheduled_at).toLocaleString('pt-BR')+'\n**Canal:** <#'+m.channel_id+'>'),components:[row([button('Cancelar esta mensagem','nexium:schedule-cancel:'+id,4)])]};
}
export async function cancelSelectedSchedule(db:SupabaseClient,input:any,user:string,id:string){
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 if(!uuid(id))throw new BotError('INVALID_ID');
 return manageSchedules(db,input,user,'cancelar-mensagem',{mensagem:id});
}

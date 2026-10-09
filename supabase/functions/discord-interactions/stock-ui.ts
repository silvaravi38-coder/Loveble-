import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.57.4';
import {actorFor,BotError,checked,productFor,safeText,row,button,uuid} from './api.ts';
import {nexiumBrand} from './brand.ts';
import {privateMessage} from './security.ts';
export function stockCard(products:any[],page=0,total=products.length,selected=false,notice=''){
 const pages=Math.max(1,Math.ceil(total/6));
 const fields=products.map(p=>({name:safeText(p.name,90),value:p.automatic_delivery?`**${p.available||0}** unidade(s) • Automática`:`**${p.manual_display_quantity==null?'Não definida':p.manual_display_quantity}** • Quantidade exibida\nEntrega manual`,inline:false}));
 const controls:any[]=[];
 if(products.length&&!selected)controls.push(row([{type:3,custom_id:'nexium:stock:select',placeholder:'Escolha um produto para gerenciar',min_values:1,max_values:1,options:products.map(p=>({label:safeText(p.name,100),value:p.id,description:p.automatic_delivery?'Consultar e repor unidades':'Editar a quantidade exibida'}))}]));
 if(selected&&products.length)controls.push(row([button(products[0].automatic_delivery?'Repor unidades':'Editar quantidade',`nexium:stock:edit:${products[0].id}`,1)]));
 if(!selected&&pages>1)controls.push(row([{...button('Anterior',`nexium:stock:page:${Math.max(0,page-1)}`,2),disabled:page===0},{...button('Próxima',`nexium:stock:page:${Math.min(pages-1,page+1)}`,2),disabled:page===pages-1}]));
 controls.push(row([button(selected?'Voltar ao estoque':'Atualizar','nexium:stock:page:0',2)]));
 return {...privateMessage(''),embeds:[{author:{name:'NEXIUM STORE • GESTÃO DE PRODUTOS'},title:'📦 Gerenciar estoque',description:notice?`✅ **${safeText(notice,300)}**`:selected?'Gerencie este produto pelo botão abaixo.':total?`**${total} produtos** no catálogo.\nEscolha um item no menu para gerenciar.`:'Nenhum produto ativo no catálogo.',color:notice?nexiumBrand.success:nexiumBrand.accent,fields,footer:{text:selected?'Nexium Store • A quantidade manual é informativa':`Nexium Store • Página ${page+1} de ${pages}`}}],components:controls};
}
export async function stockPanel(db:SupabaseClient,user:string,term?:string,page=0,notice=''){
 const actor=await actorFor(db,user);if(actor.role!=='admin')throw new BotError('FORBIDDEN');
 const all=term?[await productFor(db,term)]:checked(await db.from('products').select('id,name,automatic_delivery,manual_display_quantity').eq('active',true).order('name')) as any[];
 page=Math.min(Math.max(0,page),Math.max(0,Math.ceil(all.length/6)-1));
 const products=await Promise.all((term?all:all.slice(page*6,page*6+6)).map(async(p:any)=>{if(!p.automatic_delivery)return p;const count=await db.from('supplier_stock_items').select('id',{count:'exact',head:true}).eq('product_id',p.id).eq('status','available');if(count.error)throw new BotError('DATABASE_ERROR');return {...p,available:count.count||0};}));
 return stockCard(products,page,all.length,!!term,notice);
}
export async function stockAction(db:SupabaseClient,input:any,user:string){
 const [,scope,action,arg,extra]=String(input.data.custom_id).split(':');if(scope!=='stock'||extra)throw new BotError('UNSUPPORTED_ACTION');
 if(action==='page'&&/^\d{1,5}$/.test(arg))return stockPanel(db,user,undefined,Number(arg));
 if(action==='select'&&input.data.values?.length===1&&uuid(input.data.values[0]))return stockPanel(db,user,input.data.values[0]);
 throw new BotError('UNSUPPORTED_ACTION');
}

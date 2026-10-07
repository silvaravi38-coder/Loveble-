// Only IDs resolved from the reviewed organizer plan are written in automatic mode.
export function automaticSettings(ids:Map<string,string>):Record<string,string> {
 const fields:Record<string,string>={
  category_store_id:'category:loja',category_support_id:'category:suporte',category_team_id:'category:equipe',
  channel_sales_id:'channel:produtos',channel_tickets_id:ids.has('channel:abrirticket')?'channel:abrirticket':'channel:suporte',
  channel_logs_id:ids.has('channel:logs')?'channel:logs':'channel:logssuporte',channel_payments_id:'channel:pedidos',
  channel_notifications_id:'channel:novidades',role_customer_id:'role:cliente',role_support_id:'role:suporte',
  role_supplier_id:'role:fornecedor',role_manager_id:'role:gerente'
 };
 return Object.fromEntries(Object.entries(fields).flatMap(([field,key])=>ids.has(key)?[[field,ids.get(key)!]]:[]));
}

import {BotError} from './api.ts';
const normal=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function customerReply(text:string){
 // Defensive cleanup for old response templates echoed by a model.
 const sent=/^[ \t]*(?:#{1,3}\s*)?(?:\*\*)?Resposta enviada(?:\*\*)?\s*:(?:\*\*)?[ \t]*/gim;
 const labels=[...text.matchAll(sent)];
 if(labels.length){const last=labels.at(-1)!;text=text.slice(last.index!+last[0].length);}
 text=text.replace(/^\s*(?:\*\*)?Resposta sugerida(?:\*\*)?\s*:(?:\*\*)?\s*/i,'');
 text=text.split(/\n[ \t]*(?:#{1,3}\s*)?(?:\*\*)?(?:Encaminhamento|Nota interna|Instruções para (?:a equipe|o atendente))(?:\*\*)?\s*:/i)[0];
 return text.replace(/\n\s*---\s*$/,'').trim();
}
export function basicSupportReply(messages:any[],catalog:any[],kind:string){
 if(kind==='summary')return 'Resumo automático básico: a equipe precisa revisar as mensagens deste ticket. Nenhum pagamento ou entrega foi confirmado por este atendimento automático.';
 const question=normal(String([...messages].reverse().find(m=>m.sender_role==='customer')?.message||''));
 if(/comprar.*site|site.*comprar|link.*loja/.test(question))return 'Você pode comprar em https://nexium-store.vercel.app. Escolha o produto e siga as etapas do checkout.';
 if(/pagamento|paguei|pix|comprovante|reembolso|pedido/.test(question))return 'Para consultar pagamento, entrega ou reembolso, informe o número do pedido e aguarde a equipe. Comprovantes enviados no chat não confirmam pagamento.';
 if(/entrega|receber|prazo/.test(question))return 'A entrega manual é feita pela equipe após a confirmação do pagamento. Informe o número do pedido para o atendente consultar o prazo e o andamento.';
 const products=catalog.filter(p=>{const name=normal(String(p.name)).replace(/[^a-z0-9]+/g,' ').trim();return name.length>=3&&question.includes(name);});
 if(products.length===1){const p=products[0];return [String(p.name),String(p.description||'A equipe pode explicar os detalhes deste produto.').replace(/<[^>]*>/g,'').slice(0,900),p.requirements?'Requisitos: '+String(p.requirements).slice(0,350):'',p.delivery_time?'Prazo informado no catálogo: '+String(p.delivery_time).slice(0,100):'','Se precisar de mais detalhes, aguarde a equipe.'].filter(Boolean).join('\n');}
 if(/^(oi|ola|bom dia|boa tarde|boa noite|isis)[!.\s]*$/.test(question))return 'Olá! Sou o atendimento automático da Nexium Store. Diga o nome do produto e sua dúvida. Para tratar de uma compra, informe o número do pedido. A equipe assume os assuntos que precisam de análise.';
 return 'Estou no atendimento automático básico. Diga o nome completo do produto e sua dúvida ou informe o número do pedido. Se o catálogo não esclarecer sua pergunta, aguarde um atendente.';
}
export async function groqReply(key:string,system:string,prompt:string,maxTokens:number,send=fetch){
 const response=await send('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:'openai/gpt-oss-20b',messages:[{role:'system',content:system},{role:'user',content:prompt}],max_completion_tokens:maxTokens,reasoning_effort:'low'}),signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new BotError(response.status===401?'AI_PROVIDER_UNAUTHORIZED':response.status===429?'AI_RATE_LIMIT':'AI_PROVIDER_ERROR');
 const data=await response.json();return {text:String(data.choices?.[0]?.message?.content||''),totalUsage:{totalTokens:typeof data.usage?.total_tokens==='number'?data.usage.total_tokens:null}};
}

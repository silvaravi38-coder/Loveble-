import {useEffect,useState} from 'react';
import {supabase} from './lib/supabase';

export default function DiscordAccountLink({userId}:{userId:string}) {
  const [name,setName]=useState<string|null>(null);
  const [busy,setBusy]=useState(true);
  const [message,setMessage]=useState('');
  useEffect(()=>{
    let active=true;
    setBusy(true);setName(null);setMessage('');
    const load=async()=>{
      if(!supabase){if(active)setBusy(false);return;}
      const {data,error}=await supabase.from('discord_account_links').select('discord_username').eq('profile_id',userId).maybeSingle();
      if(active){setName(data?.discord_username||null);setBusy(false);if(error)setMessage('Não foi possível consultar sua conexão.');}
    };
    void load();return()=>{active=false;};
  },[userId]);
  const connect=async()=>{
    if(!supabase || busy)return;
    setBusy(true);setMessage('');
    try{
      const {data:session}=await supabase.auth.getSession();
      if(!session.session)throw new Error('Entre na sua conta para conectar o Discord.');
      const response=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/discord-oauth`,{method:'POST',headers:{Authorization:`Bearer ${session.session.access_token}`,'Content-Type':'application/json'},body:'{}'});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error==='DISCORD_CLIENT_SECRET_MISSING'?'A conexão com o Discord aguarda configuração da Nexium.':'Não foi possível conectar. Tente novamente.');
      const target=new URL(data.authorization_url);
      if(target.origin!=='https://discord.com' || target.pathname!=='/oauth2/authorize')throw new Error('Endereço de autorização inválido.');
      window.location.assign(target.toString());
    }catch(error){setMessage(error instanceof Error?error.message:'Não foi possível conectar.');setBusy(false);}
  };
  return <div><button type="button" disabled={busy||!!name} onClick={connect}>{name?`Discord: ${name}`:busy?'Consultando Discord…':'Conectar minha conta Discord'}</button>{message&&<p role="status">{message}</p>}</div>;
}

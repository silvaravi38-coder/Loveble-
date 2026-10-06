import { useCallback, useEffect, useState } from 'react';
import { supabase } from './lib/supabase';

type Config = { id: string; guild_id: string | null; guild_name: string | null; [key: string]: unknown };
type Job = { id: string; action: string; status: string; attempts: number; created_at: string; error_code?: string; result?: { executable?: boolean; bot_access?: { customer_role_manageable: boolean; support_role_manageable: boolean }; operations?: { key: string; name: string; kind: string; action: string; discord_id?: string; candidates?: string[] }[]; snapshot_id?: string; categories?: number; channels?: number; roles?: number } };
const messages: Record<string, string> = {
  DISCORD_TOKEN_MISSING: 'Configure DISCORD_BOT_TOKEN nos secrets das Edge Functions do Supabase.',
  DISCORD_TOKEN_INVALID: 'O token do bot é inválido. Atualize o secret DISCORD_BOT_TOKEN.',
  DISCORD_PERMISSION_DENIED: 'O bot não possui acesso suficiente ao servidor. Verifique sua autorização e permissões.',
  DISCORD_GUILD_OR_RESOURCE_NOT_FOUND: 'Servidor não encontrado. Confira o ID e se o bot está no servidor.',
  FRESH_SCAN_REQUIRED: 'Faça um scan do servidor. O preview exige um snapshot com menos de 10 minutos.',
  GUILD_ID_REQUIRED: 'Salve um ID válido do servidor na configuração do Builder.',
  GUILD_BUSY_OR_DUPLICATE_REQUEST: 'Já existe uma execução nesse servidor. Atualize o histórico.',
  ACTION_NOT_IMPLEMENTED: 'Esta etapa do executor ainda não está disponível.',
  CONFIG_CHANGED_REVIEW_PREVIEW: 'A configuração mudou. Faça um novo preview antes de aplicar.',
  SERVER_CHANGED_RESCAN_REQUIRED: 'O servidor mudou. Faça um novo scan e preview antes de aplicar.',
  CONFIRMED_REORGANIZATION_NOT_IMPLEMENTED: 'Reorganização e reconstrução ainda estão bloqueadas nesta etapa.',
  MUTATION_RESULT_UNCERTAIN_RESCAN: 'O Discord não confirmou o resultado. Faça um novo scan antes de tentar criar novamente.',
};
const statuses: Record<string, string> = { queued: 'Na fila', running: 'Executando', succeeded: 'Concluído', failed: 'Falhou', blocked: 'Bloqueado', cancelled: 'Cancelado' };
const actions: Record<string, string> = { reuse: 'Aproveitar', create: 'Criar', move: 'Mover', missing: 'Faltando', conflict: 'Conflito — escolha manual necessária' };

export default function DiscordExecutor({ configId, onSelectConfig }: { configId?: string; onSelectConfig: (config: Config) => void }) {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [strategy, setStrategy] = useState('missing');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<Job['result']>();
  const [previewJobId, setPreviewJobId] = useState<string>();
  const [logs, setLogs] = useState<{ id: number; code: string; level: string; created_at: string }[]>([]);
  const refresh = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from('discord_builder_configs').select('*').order('created_at', { ascending: false });
    if (error) { setMessage(error.message); return; }
    setConfigs((data || []) as Config[]);
    if (configId) {
      const { data: history, error: historyError } = await supabase.from('discord_jobs').select('*').eq('config_id', configId).order('created_at', { ascending: false }).limit(20);
      if (historyError) setMessage(historyError.message);
      setJobs((history || []) as Job[]);
    } else setJobs([]);
  }, [configId]);
  useEffect(() => { setPreview(undefined); setPreviewJobId(undefined); setLogs([]); void refresh(); }, [refresh]);
  const run = async (action: 'scan' | 'preview' | 'backup' | 'apply') => {
    if (!supabase || !configId) { setMessage('Salve ou selecione uma configuração do Builder primeiro.'); return; }
    setBusy(true); setMessage('');
    try {
      const { data, error } = await supabase.functions.invoke('discord-executor', { body: { action, config_id: configId, strategy, preview_job_id: action==='apply' ? previewJobId : undefined, idempotency_key: crypto.randomUUID() } });
      if (error) {
        const body = await error.context?.json?.().catch(() => null);
        setMessage(messages[body?.error] || body?.error || error.message);
      } else if (data?.job) {
        if (action === 'preview') { setPreview(data.job.result); setPreviewJobId(data.job.id); }
        if (action === 'apply') { setPreview(undefined); setPreviewJobId(undefined); }
        setMessage(action === 'preview' ? 'Preview comparado com o servidor. Nenhuma alteração aplicada.' : action==='apply' ? 'Aplicação concluída. Veja os recursos criados no histórico. Gere um novo scan para continuar.' : 'Snapshot da estrutura salvo.');
      }
    } catch { setMessage('Não foi possível contactar o executor. Atualize o histórico antes de tentar novamente.'); }
    finally { await refresh(); setBusy(false); }
  };
  return <div className="builderCard discordExecutor">
    <h3>Executor Discord — scan e planejamento</h3>
    <p>Leia a estrutura real e revise o que existe antes de criar ou reorganizar o servidor.</p>
    <label>Configuração salva<select value={configId || ''} onChange={e => { const config = configs.find(c => c.id === e.target.value); if (config) onSelectConfig(config); }}><option value="">Selecione ou salve uma configuração</option>{configs.map(c => <option key={c.id} value={c.id}>{c.guild_name || c.guild_id || 'Servidor sem ID'}</option>)}</select></label>
    <label>Estratégia para o preview<select value={strategy} onChange={e => { setStrategy(e.target.value); setPreview(undefined); setPreviewJobId(undefined); }}>
      <option value="reuse">Aproveitar estrutura existente</option><option value="missing">Criar somente o que estiver faltando</option><option value="reorganize">Reorganizar usando template Nexium</option><option value="rebuild">Refazer completamente — execução bloqueada</option>
    </select></label>
    <div className="builderActions"><button disabled={busy || !configId} onClick={() => run('scan')}>Escanear servidor</button><button disabled={busy || !configId} onClick={() => run('preview')}>Preview do servidor real</button><button disabled={busy || !configId} onClick={() => run('backup')}>Salvar snapshot</button><button disabled={busy} onClick={() => void refresh()}>Atualizar histórico</button></div>
    <small>Snapshot inclui categorias, canais, cargos e permissões. Não inclui mensagens nem threads arquivadas. A aplicação cria somente os recursos indicados no preview. Reorganização, reconstrução e restauração estão bloqueadas.</small>
    {message && <span role="status" className="adminMsg">{message}</span>}
    {preview?.operations && <div className="salesPanelList"><b>Preview da estrutura real</b>{preview.operations.map(o => <div className="salesPanelRow" key={o.key}><div><b>{o.name}</b><span>{o.kind} • {actions[o.action] || o.action}{o.discord_id ? ` • ID ${o.discord_id}` : ''}{o.candidates ? ` • ${o.candidates.length} candidatos` : ''}</span></div></div>)}{preview.executable && <button disabled={busy || !previewJobId} onClick={()=>run('apply')}>Aplicar este preview — preservar recursos existentes</button>}</div>}
    <div className="salesPanelList"><b>Últimas execuções</b>{jobs.length === 0 && <small>Nenhum job registrado para esta configuração.</small>}{jobs.map(j => <div className="salesPanelRow" key={j.id}><div><b>{j.action} • {statuses[j.status] || j.status}</b><span>{new Date(j.created_at).toLocaleString('pt-BR')} • tentativas {j.attempts}{j.error_code ? ` • ${messages[j.error_code] || j.error_code}` : ''}</span>{j.result?.snapshot_id && <small>Snapshot: {j.result.snapshot_id}</small>}</div><button onClick={async () => { if (!supabase) return; const { data, error } = await supabase.from('discord_job_logs').select('id,code,level,created_at').eq('job_id', j.id).order('id'); if (error) setMessage(error.message); else setLogs(data || []); }}>Logs</button></div>)}</div>
    {logs.length > 0 && <div aria-label="Logs da execução">{logs.map(l => <p key={l.id}><small>{new Date(l.created_at).toLocaleString('pt-BR')} • {l.level} • {l.code}</small></p>)}</div>}
  </div>;
}

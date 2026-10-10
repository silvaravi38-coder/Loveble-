const recoveryMessages:Record<string,string>={
  DISCORD_RESOURCE_NOT_FOUND:'Não encontrei um dos canais ou cargos salvos. Abra /nexium-admin configurar, selecione os canais e cargos atuais do servidor e salve de novo.',
  CONTROL_VERIFICATION_FAILED:'O Discord mudou as permissões antes da confirmação. Nenhuma alteração foi aplicada; gere um novo preview e confirme novamente.',
};

export function recoveryMessageFor(code:string):string|undefined {
  return recoveryMessages[code];
}

/** estado do atualizador mostrado na barra de status (o download é silencioso: segue 'idle' até ficar pronto) */
export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'ready'; version: string; notes: string }
  /** .deb/.rpm: só avisa e abre a página da release */
  | { kind: 'notify-only'; version: string; notes: string; url: string }
  /** a pasta do app não aceita escrita (dentro do .dmg, translocado) */
  | { kind: 'blocked'; version: string; reason: 'not-writable' }
  /** a última tentativa voltou para a versão anterior */
  | { kind: 'failed-last'; to: string; current: string }

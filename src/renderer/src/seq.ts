/** dado de terminal vale se veio do attach em vigor; sem seq = daemon da fase 1, aceito */
export function acceptData(entrySeq: number, msgSeq: number | undefined): boolean {
  return msgSeq === undefined || msgSeq === entrySeq
}

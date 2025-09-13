// web/src/constants/mtp.ts
export const MTP_OPTIONS = [
  'Dinheiro',
  'Cartão de Credito',
  'Cartão de Debito',
  'Pix',
  'Ticket',
  'Outros',
] as const;

export type MTP = typeof MTP_OPTIONS[number];

export interface KeepsakeImageSummary {
  id: string;
  originalName: string;
  contentType: string;
  size: number;
  uploadedAt: string;
}

export interface KeepsakeBetEntry {
  id: string;
  stakeAmount: number;
  wonAmount: number;
  note: string | null;
  betDate: string;
  createdAt: string;
}

export interface KeepsakeBetSummary {
  totalStaked: number;
  totalWon: number;
  netAmount: number;
  entryCount: number;
}

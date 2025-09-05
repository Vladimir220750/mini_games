export enum RpsChoice {
  Rock = 'rock',
  Paper = 'paper',
  Scissors = 'scissors',
}

export enum MatchStatus {
  WaitingForPlayers = 'waiting_for_players',
  CommitPhase = 'commit_phase',
  RevealPhase = 'reveal_phase',
  Completed = 'completed',
  Cancelled = 'cancelled',
}

export interface Match {
  id: string;
  status: MatchStatus;
  wager: string;
  playerAId: string;
  playerBId?: string;
  winnerId?: string;
  createdAt: string;
  updatedAt: string;
}

export const WsEvents = {
  MatchCreated: 'match:created',
  MatchJoined: 'match:joined',
  MatchUpdated: 'match:updated',
  MatchCommitted: 'match:committed',
  MatchRevealed: 'match:revealed',
  MatchCompleted: 'match:completed',
  MatchCancelled: 'match:cancelled',
} as const;

export type WsEvent = (typeof WsEvents)[keyof typeof WsEvents];

export type MatchStatus = "CREATED" | "READY" | "IN_GAME" | "REVEAL" | "PAYOUT" | "DONE" | "ABORTED";
export type RpsChoice = "rock" | "paper" | "scissors";
export interface WsEvents {
  status: (payload: any) => void;
  player_joined: (payload: any) => void;
  both_deposited: (payload: any) => void;
  committed: (payload: any) => void;
  revealed: (payload: any) => void;
  payout_sent: (payload: any) => void;
  error: (payload: any) => void;
}

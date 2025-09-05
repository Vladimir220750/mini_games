"use client";

import { useEffect } from "react";
import { io } from "socket.io-client";
import { MatchStatus, WsEvents } from "@packages/shared";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { useRpsStore } from "../lib/store";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || API_URL;

export default function Home() {
  const { publicKey } = useWallet();
  const {
    wallet,
    setWallet,
    matchId,
    setMatchId,
    status,
    setStatus,
    log,
    addLog,
  } = useRpsStore();

  useEffect(() => {
    setWallet(publicKey ? publicKey.toBase58() : null);
  }, [publicKey, setWallet]);

  useEffect(() => {
    if (!matchId) return;
    const s = io(SOCKET_URL, { transports: ["websocket"] });

    s.on("connect", () => s.emit("match:subscribe", matchId));
    s.on(WsEvents.MatchJoined, (p: { id: string; status: MatchStatus }) => {
      setStatus(p.status);
      addLog(`player joined: ${JSON.stringify(p)}`);
    });
    s.on(WsEvents.MatchCommitted, (p: unknown) =>
      addLog(`commit: ${JSON.stringify(p)}`)
    );
    s.on(WsEvents.MatchRevealed, (p: unknown) =>
      addLog(`reveal: ${JSON.stringify(p)}`)
    );

    return () => {
      s.disconnect();
    };
  }, [matchId, addLog, setStatus]);

  const createMatch = async () => {
    if (!wallet) return;
    const res = await fetch(`${API_URL}/api/matches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, wager: "1" }),
    });
    const data: { id: string } = await res.json();
    setMatchId(data.id);
    setStatus(MatchStatus.WaitingForPlayers);
    addLog(`match created: ${data.id}`);
  };

  const joinMatch = async () => {
    if (!wallet || !matchId) return;
    await fetch(`${API_URL}/api/matches/${matchId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet }),
    });
  };

  return (
    <main style={{ maxWidth: 760, margin: "40px auto", padding: "0 16px" }}>
      <h1>RPS on Solana (skeleton)</h1>

      <WalletMultiButton />

      {wallet && (
        <p style={{ marginTop: 16 }}>
          Wallet: <code>{wallet}</code>
        </p>
      )}

      {!matchId && (
        <button onClick={createMatch} style={{ padding: "8px 12px", marginTop: 16 }}>
          Create match
        </button>
      )}

      {matchId && (
        <>
          <p>
            Match ID: <code>{matchId}</code>
          </p>
          <p>
            Status: <code>{status}</code>
          </p>
          <button onClick={joinMatch} style={{ padding: "8px 12px" }}>
            Join match
          </button>
        </>
      )}

      {log.length > 0 && (
        <pre
          style={{
            background: "#111",
            color: "#0f0",
            padding: 12,
            minHeight: 120,
            marginTop: 16,
          }}
        >
          {log.join("\n")}
        </pre>
      )}

      <p style={{ opacity: 0.7, marginTop: 24 }}>
        Commit/reveal UI — coming next.
      </p>
    </main>
  );
}

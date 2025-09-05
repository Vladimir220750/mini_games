"use client";

import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { MatchStatus, WsEvents } from "@packages/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || API_URL;

export default function Home() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [status, setStatus] = useState<MatchStatus | null>(null);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    if (!matchId) return;
    const s = io(SOCKET_URL, { transports: ["websocket"] });
    setSocket(s);

    s.on("connect", () => s.emit("match:subscribe", matchId));
    s.on(WsEvents.MatchJoined, (p: { id: string; status: MatchStatus }) => {
      setStatus(p.status);
      setLog((l) => [...l, `player joined: ${JSON.stringify(p)}`]);
    });
    s.on(WsEvents.MatchCommitted, (p: unknown) =>
      setLog((l) => [...l, `commit: ${JSON.stringify(p)}`])
    );
    s.on(WsEvents.MatchRevealed, (p: unknown) =>
      setLog((l) => [...l, `reveal: ${JSON.stringify(p)}`])
    );

    return () => {
      s.disconnect();
    };
  }, [matchId]);

  const createMatch = async () => {
    const res = await fetch(`${API_URL}/api/matches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: "playerA", wager: "1" }),
    });
    const data: { id: string } = await res.json();
    setMatchId(data.id);
    setStatus(MatchStatus.WaitingForPlayers);
    setLog((l) => [...l, `match created: ${data.id}`]);
  };

  const joinMatch = async () => {
    if (!matchId) return;
    await fetch(`${API_URL}/api/matches/${matchId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: "playerB" }),
    });
  };

  return (
    <main style={{ maxWidth: 760, margin: "40px auto", padding: "0 16px" }}>
      <h1>RPS on Solana (skeleton)</h1>

      {!matchId && (
        <button onClick={createMatch} style={{ padding: "8px 12px" }}>
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
          Wallet connect + commit/reveal UI — coming next.
      </p>
    </main>
  );
}

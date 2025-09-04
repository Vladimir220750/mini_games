"use client";
import { io } from "socket.io-client";
import { useEffect, useState } from "react";

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000";

export default function Home() {
  const [matchId, setMatchId] = useState<string>("");
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    if (!matchId) return;
    const s = io(SOCKET_URL, { transports: ["websocket"] });
    s.on("connect", () => s.emit("subscribe", { matchId }));
    s.on("status", (p: any) => setStatus(JSON.stringify(p)));
    s.on("player_joined", (p: any) => setStatus("player_joined " + JSON.stringify(p)));
    s.on("both_deposited", (p: any) => setStatus("both_deposited " + JSON.stringify(p)));
    return () => { s.disconnect(); };
  }, [matchId]);

  const create = async () => {
    const now = Math.floor(Date.now()/1000);
    const r = await fetch("http://localhost:4000/api/matches", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({
        creatorWallet: "CREATOR_WALLET_PUBKEY",
        stakeLamports: 1000000,
        feeBps: 300,
        feeWallet: "FEE_WALLET_PUBLIC_KEY_HERE",
        commitDeadline: now + 300,
        revealDeadline: now + 600
      })
    });
    const j = await r.json();
    setMatchId(j.id);
  };

  return (
    <main style={{maxWidth:760, margin:"40px auto", padding:"0 16px"}}>
      <h1>RPS on Solana (skeleton)</h1>
      <button onClick={create} style={{padding:"8px 12px"}}>Create match</button>
      {matchId && <p>Match ID: <code>{matchId}</code></p>}
      <pre style={{background:"#111", color:"#0f0", padding:12, minHeight:120}}>{status}</pre>
      <p style={{opacity:.7, marginTop:24}}>Connect Phantom + deposit/commit/reveal UI — TODO (каркас готов).</p>
    </main>
  );
}

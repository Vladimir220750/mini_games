import 'dotenv/config';
import Fastify from 'fastify';
import helmet from 'fastify-helmet';
import cors from 'fastify-cors';
import { Server as SocketIOServer } from 'socket.io';
import { PrismaClient, MatchStatus as DbMatchStatus } from '@prisma/client';
import { z } from 'zod';
import { MatchStatus, RpsChoice, WsEvents } from '@packages/shared';

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

await app.register(helmet);
await app.register(cors, { origin: process.env.SOCKET_IO_CORS_ORIGIN || '*' });

const io = new SocketIOServer(app.server, {
  cors: { origin: process.env.SOCKET_IO_CORS_ORIGIN || '*' },
});
const room = (id: string) => `match:${id}`;

const toSharedStatus = (status: DbMatchStatus): MatchStatus => ({
  [DbMatchStatus.WAITING_FOR_PLAYERS]: MatchStatus.WaitingForPlayers,
  [DbMatchStatus.COMMIT_PHASE]: MatchStatus.CommitPhase,
  [DbMatchStatus.REVEAL_PHASE]: MatchStatus.RevealPhase,
  [DbMatchStatus.COMPLETED]: MatchStatus.Completed,
  [DbMatchStatus.CANCELLED]: MatchStatus.Cancelled,
})[status];

app.get('/health', async () => ({ ok: true }));
app.get('/metrics', async () => '');

const CreateMatchSchema = z.object({
  wallet: z.string().min(1),
  wager: z.string().regex(/^\d+$/),
});
type CreateMatchBody = z.infer<typeof CreateMatchSchema>;

app.post<{ Body: CreateMatchBody }>('/api/matches', async (req, reply) => {
  const body = CreateMatchSchema.parse(req.body);
  const player = await prisma.user.upsert({
    where: { wallet: body.wallet },
    update: {},
    create: { wallet: body.wallet },
  });

  const match = await prisma.match.create({
    data: { playerAId: player.id, wager: BigInt(body.wager) },
  });

  io.emit(WsEvents.MatchCreated, { id: match.id, status: toSharedStatus(match.status) });
  return reply.send({ id: match.id });
});

const JoinMatchSchema = z.object({ wallet: z.string().min(1) });
type JoinMatchBody = z.infer<typeof JoinMatchSchema>;

app.post<{ Params: { id: string }; Body: JoinMatchBody }>(
  '/api/matches/:id/join',
  async (req, reply) => {
    const { id } = req.params;
    const body = JoinMatchSchema.parse(req.body);

    const match = await prisma.match.findUnique({ where: { id } });
    if (!match) return reply.code(404).send({ error: 'not_found' });
    if (match.playerBId) return reply.code(400).send({ error: 'already_joined' });

    const player = await prisma.user.upsert({
      where: { wallet: body.wallet },
      update: {},
      create: { wallet: body.wallet },
    });

    const updated = await prisma.match.update({
      where: { id },
      data: { playerBId: player.id, status: DbMatchStatus.COMMIT_PHASE },
    });

    io.to(room(id)).emit(WsEvents.MatchJoined, { id, status: toSharedStatus(updated.status) });
    return reply.send({ ok: true });
  }
);

const CommitSchema = z.object({
  wallet: z.string().min(1),
  commit: z.string().min(1),
});
type CommitBody = z.infer<typeof CommitSchema>;

app.post<{ Params: { id: string }; Body: CommitBody }>(
  '/api/matches/:id/commit',
  async (req, reply) => {
    const { id } = req.params;
    const body = CommitSchema.parse(req.body);
    io.to(room(id)).emit(WsEvents.MatchCommitted, { matchId: id, wallet: body.wallet });
    return reply.send({ ok: true });
  }
);

const RevealSchema = z.object({
  wallet: z.string().min(1),
  choice: z.nativeEnum(RpsChoice),
  salt: z.string().min(1),
});
type RevealBody = z.infer<typeof RevealSchema>;

app.post<{ Params: { id: string }; Body: RevealBody }>(
  '/api/matches/:id/reveal',
  async (req, reply) => {
    const { id } = req.params;
    const body = RevealSchema.parse(req.body);
    io.to(room(id)).emit(WsEvents.MatchRevealed, {
      matchId: id,
      wallet: body.wallet,
      choice: body.choice,
    });
    return reply.send({ ok: true });
  }
);

io.on('connection', (socket) => {
  socket.on('match:subscribe', (matchId: string) => {
    socket.join(room(matchId));
  });
});

const port = Number(process.env.PORT || 4000);
await app.listen({ port, host: '0.0.0.0' });
console.log(`[api] listening on :${port}`);

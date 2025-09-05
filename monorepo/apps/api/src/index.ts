import 'dotenv/config';
import Fastify from 'fastify';
import helmet from 'fastify-helmet';
import cors from 'fastify-cors';
import { Server as SocketIOServer } from 'socket.io';
import {
  PrismaClient,
  MatchStatus as DbMatchStatus,
  RpsChoice as DbRpsChoice,
  Prisma,
} from '@prisma/client';
import { z } from 'zod';
import { MatchStatus, RpsChoice, WsEvents } from '@packages/shared';
import { createHash } from 'crypto';

const COMMIT_WINDOW_MS = 60_000;
const REVEAL_WINDOW_MS = 60_000;

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

const toDbChoice = (c: RpsChoice): DbRpsChoice =>
  ({
    [RpsChoice.Rock]: DbRpsChoice.ROCK,
    [RpsChoice.Paper]: DbRpsChoice.PAPER,
    [RpsChoice.Scissors]: DbRpsChoice.SCISSORS,
  }[c]);

const toSharedChoice = (c: DbRpsChoice): RpsChoice =>
  ({
    [DbRpsChoice.ROCK]: RpsChoice.Rock,
    [DbRpsChoice.PAPER]: RpsChoice.Paper,
    [DbRpsChoice.SCISSORS]: RpsChoice.Scissors,
  }[c]);

const hashReveal = (choice: RpsChoice, salt: string) =>
  createHash('sha256').update(`${choice}-${salt}`).digest('hex');

const beats: Record<RpsChoice, RpsChoice> = {
  [RpsChoice.Rock]: RpsChoice.Scissors,
  [RpsChoice.Paper]: RpsChoice.Rock,
  [RpsChoice.Scissors]: RpsChoice.Paper,
};

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

  await prisma.auditLog.create({
    data: { matchId: match.id, type: 'create', payload: { wallet: body.wallet, wager: body.wager } },
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

    const match = await prisma.match.findUnique({ where: { id }, include: { playerA: true } });
    if (!match) return reply.code(404).send({ error: 'not_found' });
    if (match.playerBId) return reply.code(400).send({ error: 'already_joined' });

    const player = await prisma.user.upsert({
      where: { wallet: body.wallet },
      update: {},
      create: { wallet: body.wallet },
    });

    const commitDeadline = new Date(Date.now() + COMMIT_WINDOW_MS);

    const updated = await prisma.match.update({
      where: { id },
      data: { playerBId: player.id, status: DbMatchStatus.COMMIT_PHASE, commitDeadline },
    });

    await prisma.auditLog.create({
      data: { matchId: id, type: 'join', payload: { wallet: body.wallet } },
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

    const match = await prisma.match.findUnique({
      where: { id },
      include: { playerA: true, playerB: true },
    });
    if (!match) return reply.code(404).send({ error: 'not_found' });
    if (match.status !== DbMatchStatus.COMMIT_PHASE)
      return reply.code(400).send({ error: 'wrong_phase' });
    if (match.commitDeadline && match.commitDeadline.getTime() < Date.now()) {
      await prisma.match.update({ where: { id }, data: { status: DbMatchStatus.CANCELLED } });
      io.to(room(id)).emit(WsEvents.MatchCancelled, { id });
      return reply.code(400).send({ error: 'commit_deadline_passed' });
    }

    const isA = match.playerA.wallet === body.wallet;
    const isB = match.playerB?.wallet === body.wallet;
    if (!isA && !isB) return reply.code(400).send({ error: 'not_a_player' });
    if ((isA && match.commitA) || (isB && match.commitB))
      return reply.code(400).send({ error: 'already_committed' });

    const updateData: Prisma.MatchUpdateInput = isA
      ? { commitA: body.commit }
      : { commitB: body.commit };

    let newStatus = match.status;
    if ((isA && match.commitB) || (isB && match.commitA)) {
      newStatus = DbMatchStatus.REVEAL_PHASE;
      updateData.status = newStatus;
      updateData.revealDeadline = new Date(Date.now() + REVEAL_WINDOW_MS);
    }

    await prisma.match.update({ where: { id }, data: updateData });
    await prisma.auditLog.create({
      data: { matchId: id, type: 'commit', payload: { wallet: body.wallet } },
    });

    io.to(room(id)).emit(WsEvents.MatchCommitted, { matchId: id, wallet: body.wallet });
    if (newStatus !== match.status) {
      io.to(room(id)).emit(WsEvents.MatchUpdated, { id, status: toSharedStatus(newStatus) });
    }
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

    const match = await prisma.match.findUnique({
      where: { id },
      include: { playerA: true, playerB: true },
    });
    if (!match) return reply.code(404).send({ error: 'not_found' });
    if (match.status !== DbMatchStatus.REVEAL_PHASE)
      return reply.code(400).send({ error: 'wrong_phase' });
    if (match.revealDeadline && match.revealDeadline.getTime() < Date.now()) {
      await prisma.match.update({ where: { id }, data: { status: DbMatchStatus.CANCELLED } });
      io.to(room(id)).emit(WsEvents.MatchCancelled, { id });
      return reply.code(400).send({ error: 'reveal_deadline_passed' });
    }

    const isA = match.playerA.wallet === body.wallet;
    const isB = match.playerB?.wallet === body.wallet;
    if (!isA && !isB) return reply.code(400).send({ error: 'not_a_player' });

    const expectedCommit = isA ? match.commitA : match.commitB;
    if (!expectedCommit) return reply.code(400).send({ error: 'no_commit' });
    if ((isA && match.revealA) || (isB && match.revealB))
      return reply.code(400).send({ error: 'already_revealed' });

    const digest = hashReveal(body.choice, body.salt);
    if (digest !== expectedCommit) return reply.code(400).send({ error: 'invalid_reveal' });

    const updateData: Prisma.MatchUpdateInput = isA
      ? { revealA: toDbChoice(body.choice) }
      : { revealB: toDbChoice(body.choice) };

    let newStatus = match.status;
    let winnerId: string | null = null;

    const otherChoiceDb = isA ? match.revealB : match.revealA;
    if (otherChoiceDb) {
      const choiceA = isA ? body.choice : toSharedChoice(match.revealA!);
      const choiceB = isB ? body.choice : toSharedChoice(match.revealB!);
      if (choiceA !== choiceB) {
        winnerId = beats[choiceA] === choiceB ? match.playerAId : match.playerBId!;
      }
      newStatus = DbMatchStatus.COMPLETED;
      updateData.status = newStatus;
      updateData.winnerId = winnerId;
    }

    await prisma.match.update({ where: { id }, data: updateData });
    await prisma.auditLog.create({
      data: { matchId: id, type: 'reveal', payload: { wallet: body.wallet, choice: body.choice } },
    });

    io.to(room(id)).emit(WsEvents.MatchRevealed, {
      matchId: id,
      wallet: body.wallet,
      choice: body.choice,
    });

    if (newStatus === DbMatchStatus.COMPLETED) {
      io.to(room(id)).emit(WsEvents.MatchCompleted, {
        id,
        status: toSharedStatus(newStatus),
        winnerId,
      });
    } else if (newStatus !== match.status) {
      io.to(room(id)).emit(WsEvents.MatchUpdated, { id, status: toSharedStatus(newStatus) });
    }
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

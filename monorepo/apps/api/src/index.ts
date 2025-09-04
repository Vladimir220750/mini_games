import 'dotenv/config';
import Fastify from 'fastify';
import helmet from 'fastify-helmet';
import cors from 'fastify-cors';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { PublicKey } from '@solana/web3.js';

const prisma = new PrismaClient();
const app = Fastify({ logger: true });
await app.register(helmet);
await app.register(cors, { origin: process.env.SOCKET_IO_CORS_ORIGIN || '*' });

const httpServer = createServer(app as any);
const io = new Server(httpServer, { cors: { origin: process.env.SOCKET_IO_CORS_ORIGIN || '*' } });
const room = (id:string) => `match:${id}`;

app.get('/healthz', async () => ({ ok: true }));
app.get('/metrics', async () => ''); // TODO

const CreateMatch = z.object({
  creatorWallet: z.string().min(20),
  stakeLamports: z.number().int().positive(),
  feeBps: z.number().int().min(0).max(2000).default(300),
  feeWallet: z.string().min(20),
  commitDeadline: z.number().int().positive(),
  revealDeadline: z.number().int().positive()
});

app.post('/api/matches', async (req, reply) => {
  const body = CreateMatch.parse((req as any).body);
  new PublicKey(body.creatorWallet);
  new PublicKey(body.feeWallet);

  const creator = await prisma.user.upsert({
    where: { wallet: body.creatorWallet }, update: {}, create: { wallet: body.creatorWallet }
  });

  const match = await prisma.match.create({
    data: {
      creatorId: creator.id,
      stakeLamports: BigInt(body.stakeLamports),
      feeBps: body.feeBps,
      feeWallet: body.feeWallet,
      commitDeadline: body.commitDeadline,
      revealDeadline: body.revealDeadline
    }
  });

  io.to(room(match.id)).emit('status', { status: 'CREATED', matchId: match.id });
  return reply.send({ id: match.id });
});

app.post('/api/matches/:id/join', async (req, reply) => {
  const id = (req.params as any).id as string;
  const { opponentWallet } = z.object({ opponentWallet: z.string().min(20) }).parse((req as any).body);
  new PublicKey(opponentWallet);

  const match = await prisma.match.findUnique({ where: { id } });
  if (!match) return reply.code(404).send({ error: 'not_found' });
  if (match.opponentId) return reply.code(400).send({ error: 'already_joined' });

  const opponent = await prisma.user.upsert({ where: { wallet: opponentWallet }, update: {}, create: { wallet: opponentWallet } });
  await prisma.match.update({ where: { id }, data: { opponentId: opponent.id, status: 'READY' } });

  io.to(room(id)).emit('player_joined', { matchId: id, opponentWallet });
  io.to(room(id)).emit('status', { status: 'READY', matchId: id });
  return reply.send({ ok: true });
});

app.post('/api/matches/:id/commit', async (req, reply) => {
  const id = (req.params as any).id as string;
  const { wallet, commitHash } = z.object({ wallet: z.string(), commitHash: z.string().length(64) }).parse((req as any).body);
  await prisma.auditLog.create({ data: { matchId: id, type: 'commit', payload: { wallet, commitHash } } });
  io.to(room(id)).emit('committed', { wallet });
  return reply.send({ ok: true });
});

app.post('/api/matches/:id/reveal', async (req, reply) => {
  const id = (req.params as any).id as string;
  const { wallet, choice, salt } = z.object({ wallet: z.string(), choice: z.enum(['rock','paper','scissors']), salt: z.string().min(8) }).parse((req as any).body);
  await prisma.auditLog.create({ data: { matchId: id, type: 'reveal', payload: { wallet, choice, salt } } });
  io.to(room(id)).emit('revealed', { wallet, choice });
  return reply.send({ ok: true });
});

app.get('/api/matches/:id', async (req, reply) => {
  const id = (req.params as any).id as string;
  const match = await prisma.match.findUnique({ where: { id } });
  if (!match) return reply.code(404).send({ error: 'not_found' });
  return reply.send(match);
});

io.on('connection', (socket) => {
  socket.on('subscribe', ({ matchId }) => {
    socket.join(room(matchId));
    socket.emit('status', { status: 'SUBSCRIBED', matchId });
  });
});

const port = Number(process.env.PORT || 4000);
httpServer.listen(port, () => console.log(`[api] listening on :${port}`));

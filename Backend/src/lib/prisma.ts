import { PrismaClient } from '@prisma/client';

// Pay rates never ride along on an ordinary employee read — plenty of routes
// hand Employee rows (or includes of them) straight to the client, workers
// included. The few places that need pay ask for it by name (lib/pay.ts).
const prisma = new PrismaClient({ omit: { employee: { payRateCents: true } } });

export default prisma;

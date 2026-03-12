import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { registry } from '../openapi';
import { prisma } from '../db';

export const syncRouter = Router();

const PullQuery = z.object({
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const SyncEventSchema = z.object({
  cursor: z.number(),
  entityType: z.string(),
  entityId: z.string(),
  action: z.string(),
  payload: z.record(z.string(), z.any()).nullable(),
  createdAt: z.string(),
});

registry.registerPath({
  method: 'get',
  path: '/sync/pull',
  tags: ['Sync'],
  summary: '按游标拉取增量变更',
  request: {
    query: PullQuery,
  },
  responses: {
    200: {
      description: '增量事件列表',
      content: {
        'application/json': {
          schema: z.object({
            events: z.array(SyncEventSchema),
            nextCursor: z.number(),
            hasMore: z.boolean(),
          }),
        },
      },
    },
  },
});

syncRouter.get('/pull', async (req: Request, res: Response) => {
  const { since, limit } = PullQuery.parse(req.query);
  const rows = await (prisma as any).syncEvent.findMany({
    where: { id: { gt: since } },
    orderBy: { id: 'asc' },
    take: limit,
  });

  const events = rows.map((row: any) => ({
    cursor: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    payload: row.payload ? JSON.parse(row.payload) : null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  }));

  const nextCursor = events.length > 0 ? events[events.length - 1].cursor : since;
  const hasMore = events.length === limit;

  res.json({ events, nextCursor, hasMore });
});

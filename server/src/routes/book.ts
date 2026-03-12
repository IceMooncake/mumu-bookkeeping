import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { registry } from '../openapi';
import { prisma } from '../db';
import { appendSyncEvent } from '../services/syncEvent';

export const bookRouter = Router();

export const BookSchema = registry.register(
  'Book',
  z.object({
    id: z.string().openapi({ example: 'book-123' }),
    name: z.string().openapi({ example: '默认账本' }),
    balance: z.number().openapi({ example: 12500.5 }),
    isDefault: z.boolean().openapi({ example: true }),
    createdAt: z.string().or(z.date()),
    updatedAt: z.string().or(z.date()),
  })
);

export const CreateBookDto = z.object({
  name: z.string().openapi({ example: '旅游基金' }),
  balance: z.number().optional().openapi({ example: 0 }),
});

registry.registerPath({
  method: 'get',
  path: '/books',
  tags: ['Books'],
  summary: '获取所有账本列表',
  responses: {
    200: {
      description: '账本列表',
      content: { 'application/json': { schema: z.array(BookSchema) } },
    },
  },
});

bookRouter.get('/', async (req: Request, res: Response) => {
  const books = await prisma.book.findMany({
    orderBy: { createdAt: 'desc' }
  });
  res.json(books);
});

registry.registerPath({
  method: 'post',
  path: '/books',
  tags: ['Books'],
  summary: '创建新账本',
  request: {
    body: {
      content: { 'application/json': { schema: CreateBookDto } }
    }
  },
  responses: {
    200: {
      description: '创建成功',
      content: { 'application/json': { schema: BookSchema } },
    },
  },
});

bookRouter.post('/', async (req: Request, res: Response) => {
  try {
    const data = CreateBookDto.parse(req.body);
    const book = await prisma.$transaction(async tx => {
      const existingDefault = await tx.book.findFirst({ where: { isDefault: true } });
      const created = await tx.book.create({
        data: {
          name: data.name,
          balance: data.balance || 0,
          isDefault: !existingDefault,
        },
      });
      await appendSyncEvent(tx as any, {
        entityType: 'book',
        entityId: created.id,
        action: 'create',
        payload: created,
      });
      return created;
    });
    res.json(book);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Params validate failed' });
  }
});

export const UpdateBookDto = z.object({
  name: z.string().optional().openapi({ example: '修改后的账本' }),
  isDefault: z.boolean().optional().openapi({ example: true }),
});

registry.registerPath({
  method: 'put',
  path: '/books/{id}',
  tags: ['Books'],
  summary: '更新账本',
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: UpdateBookDto } }
    }
  },
  responses: {
    200: {
      description: '更新成功',
      content: { 'application/json': { schema: BookSchema } },
    },
  },
});

bookRouter.put('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const data = UpdateBookDto.parse(req.body);

    let updatedBook;
    if (data.isDefault) {
      updatedBook = await prisma.$transaction(async tx => {
        await tx.book.updateMany({
          where: { isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
        const updated = await tx.book.update({
          where: { id },
          data,
        });
        await appendSyncEvent(tx as any, {
          entityType: 'book',
          entityId: updated.id,
          action: 'update',
          payload: updated,
        });
        return updated;
      });
    } else {
      updatedBook = await prisma.$transaction(async tx => {
        const updated = await tx.book.update({
          where: { id },
          data,
        });
        await appendSyncEvent(tx as any, {
          entityType: 'book',
          entityId: updated.id,
          action: 'update',
          payload: updated,
        });
        return updated;
      });
    }

    res.json(updatedBook);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Params validate failed' });
  }
});

registry.registerPath({
  method: 'delete',
  path: '/books/{id}',
  tags: ['Books'],
  summary: '删除账本',
  request: {
    params: z.object({ id: z.string() })
  },
  responses: {
    200: {
      description: '删除成功'
    },
  },
});

bookRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const deleted = await prisma.$transaction(async tx => {
      const totalBooks = await tx.book.count();
      const existing = await tx.book.findUnique({ where: { id } });
      if (!existing) return { kind: 'not_found' as const };
      if (totalBooks <= 1) return { kind: 'last_book' as const };

      await tx.book.delete({ where: { id } });
      await appendSyncEvent(tx as any, {
        entityType: 'book',
        entityId: id,
        action: 'delete',
        payload: { id },
      });
      return { kind: 'deleted' as const };
    });

    if (deleted.kind === 'not_found') {
      res.json({ success: true, notFound: true });
      return;
    }

    if (deleted.kind === 'last_book') {
      res.status(400).json({ error: '至少保留一个账本，无法删除' });
      return;
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Delete failed' });
  }
});


import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { registry } from '../openapi';
import { prisma } from '../db';

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
    const existingDefault = await prisma.book.findFirst({ where: { isDefault: true } });
    const book = await prisma.book.create({
      data: {
        name: data.name,
        balance: data.balance || 0,
        isDefault: !existingDefault
      }
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
      await prisma.$transaction([
        prisma.book.updateMany({
          where: { isDefault: true, id: { not: id } },
          data: { isDefault: false }
        }),
        prisma.book.update({
          where: { id },
          data
        })
      ]);
      updatedBook = await prisma.book.findUnique({ where: { id } });
    } else {
      updatedBook = await prisma.book.update({
        where: { id },
        data
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
    await prisma.book.delete({ where: { id } });
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Delete failed' });
  }
});


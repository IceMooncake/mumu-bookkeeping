import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { registry } from '../openapi';
import { prisma } from '../db';

export const transactionRouter = Router();

export const TransactionSchema = registry.register(
  'Transaction',
  z.object({
    id: z.string().openapi({ example: 'abc-123' }),
    amount: z.number().openapi({ example: 12.5 }),
    type: z.string().openapi({ example: 'EXPENSE' }),
    category: z.string().openapi({ example: '餐饮' }),
    merchant: z.string().nullable().openapi({ example: '麦当劳' }),
    remark: z.string().nullable().openapi({ example: '午餐' }),
    payMethod: z.string().nullable().openapi({ example: 'WECHAT' }),
    bookId: z.string().nullable().optional().openapi({ example: 'book-123' }),
    date: z.string().or(z.date()).openapi({ example: '2023-01-01T12:00:00.000Z' }),
    createdAt: z.string().or(z.date()),
    updatedAt: z.string().or(z.date()),
  })
);

export const CreateTransactionDto = TransactionSchema.omit({ id: true, createdAt: true, updatedAt: true, date: true }).extend({
  date: z.string().datetime().optional()
});

registry.registerPath({
  method: 'get',
  path: '/transactions',
  tags: ['Transactions'],
  summary: '获取最近的账单流水',
  request: {
    query: z.object({
      bookId: z.string().optional().openapi({ example: 'book-123' })
    })
  },
  responses: {
    200: {
      description: '流水列表',
      content: { 'application/json': { schema: z.array(TransactionSchema) } },
    },
  },
});

transactionRouter.get('/', async (req: Request, res: Response) => {
  const { bookId } = req.query;
  const where = bookId && typeof bookId === 'string' ? { bookId } : {};
  const txs = await prisma.transaction.findMany({
    where,
    orderBy: { date: 'desc' },
    take: 50
  });
  res.json(txs);
});

registry.registerPath({
  method: 'post',
  path: '/transactions',
  tags: ['Transactions'],
  summary: '记录一笔新账单 (含无障碍识屏直接调用)',
  request: {
    body: {
      content: { 'application/json': { schema: CreateTransactionDto } }
    }
  },
  responses: {
    200: {
      description: '记录成功',
      content: { 'application/json': { schema: TransactionSchema } },
    },
  },
});

transactionRouter.post('/', async (req: Request, res: Response) => {
  try {
    const data = CreateTransactionDto.parse(req.body);
    let targetBookId = data.bookId;

    if (!targetBookId) {
      let defaultBook = await prisma.book.findFirst({ where: { isDefault: true } });
      if (!defaultBook) {
        defaultBook = await prisma.book.create({
          data: { name: '默认账本', balance: 0, isDefault: true }
        });
      }
      targetBookId = defaultBook.id;
    }

    const tx = await prisma.$transaction(async (txPrisma) => {
      const newTx = await txPrisma.transaction.create({
        data: {
          ...data,
          bookId: targetBookId,
          date: data.date ? new Date(data.date) : new Date()
        }
      });

      const amountDiff = data.type === 'EXPENSE' ? -data.amount : (data.type === 'INCOME' ? data.amount : 0);
      
      if (amountDiff !== 0) {
        await txPrisma.book.update({
          where: { id: targetBookId! },
          data: { balance: { increment: amountDiff } }
        });
      }

      return newTx;
    });

    res.json(tx);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Params validate failed' }); 
  }
});

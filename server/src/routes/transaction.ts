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
  responses: {
    200: {
      description: '流水列表',
      content: { 'application/json': { schema: z.array(TransactionSchema) } },
    },
  },
});

transactionRouter.get('/', async (req: Request, res: Response) => {
  const txs = await prisma.transaction.findMany({
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
    const tx = await prisma.transaction.create({ 
      data: {
        ...data,
        date: data.date ? new Date(data.date) : new Date()
      } 
    });
    res.json(tx);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Params validate failed' });
  }
});

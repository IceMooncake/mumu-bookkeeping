import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { registry } from '../openapi';
import { prisma } from '../db';

export const categoryRouter = Router();

const CategoryTypeSchema = z.enum(['EXPENSE', 'INCOME']);

export const CategorySchema = registry.register(
  'Category',
  z.object({
    id: z.string().openapi({ example: 'cat-123' }),
    name: z.string().openapi({ example: '餐饮' }),
    type: CategoryTypeSchema.openapi({ example: 'EXPENSE' }),
    color: z.string().openapi({ example: '#FFD8A8' }),
    bgColor: z.string().openapi({ example: '#FFD8A8' }),
    textColor: z.string().openapi({ example: '#7C2D12' }),
    createdAt: z.string().or(z.date()),
    updatedAt: z.string().or(z.date()),
  })
);

const CreateCategoryDto = z.object({
  name: z.string().trim().min(1).openapi({ example: '奶茶' }),
  type: CategoryTypeSchema.openapi({ example: 'EXPENSE' }),
  color: z.string().optional().openapi({ example: '#FFD8A8' }),
  bgColor: z.string().optional().openapi({ example: '#FFD8A8' }),
  textColor: z.string().optional().openapi({ example: '#7C2D12' }),
});

registry.registerPath({
  method: 'get',
  path: '/categories',
  tags: ['Categories'],
  summary: '获取所有类别标签',
  responses: {
    200: {
      description: '标签列表',
      content: { 'application/json': { schema: z.array(CategorySchema) } },
    },
  },
});

categoryRouter.get('/', async (_req: Request, res: Response) => {
  const data = await (prisma as any).category.findMany({
    orderBy: [{ type: 'asc' }, { updatedAt: 'desc' }],
  });
  res.json(data);
});

registry.registerPath({
  method: 'post',
  path: '/categories',
  tags: ['Categories'],
  summary: '创建分类标签',
  request: {
    body: {
      content: { 'application/json': { schema: CreateCategoryDto } },
    },
  },
  responses: {
    200: {
      description: '创建成功',
      content: { 'application/json': { schema: CategorySchema } },
    },
  },
});

categoryRouter.post('/', async (req: Request, res: Response) => {
  try {
    const data = CreateCategoryDto.parse(req.body);
    const bgColor = data.bgColor || data.color || '#E5E7EB';
    const textColor = data.textColor || '#111827';

    const found = await (prisma as any).category.findFirst({
      where: {
        name: data.name,
        type: data.type,
      },
    });

    const category = found
      ? await (prisma as any).category.update({
          where: { id: found.id },
          data: {
            color: bgColor,
            bgColor,
            textColor,
          },
        })
      : await (prisma as any).category.create({
          data: {
            name: data.name,
            type: data.type,
            color: bgColor,
            bgColor,
            textColor,
          },
        });

    res.json(category);
  } catch (error: any) {
    res.status(400).json({ error: error?.message || 'Params validate failed' });
  }
});

registry.registerPath({
  method: 'delete',
  path: '/categories/{id}',
  tags: ['Categories'],
  summary: '删除分类标签',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: '删除成功',
    },
  },
});

categoryRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    await (prisma as any).category.delete({ where: { id } });
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || 'Delete failed' });
  }
});

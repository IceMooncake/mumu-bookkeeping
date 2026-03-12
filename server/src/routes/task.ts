import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { registry } from '../openapi';
import { prisma } from '../db';
import { runTaskScript } from '../sandbox/runner';
import { appendSyncEvent } from '../services/syncEvent';

export const taskRouter = Router();

// 定义 Task 数据结构及校验
export const TaskSchema = registry.register(
  'Task',
  z.object({
    id: z.string().openapi({ example: '123e4567-e89b-12d3... ' }),
    name: z.string().openapi({ example: '每日外卖记账' }),
    description: z.string().nullable().openapi({ example: '每天中午12点自动记一笔外卖开销' }),
    cronExpression: z.string().nullable().openapi({ example: '0 12 * * *' }),
    script: z.string().openapi({ example: 'await db.addTransaction({ amount: -25, type: "EXPENSE", category: "餐饮", merchant: "美团外卖" }); console.log("已记录外卖!");' }),
    isActive: z.boolean().openapi({ example: true }),
    createdAt: z.string().openapi({ example: '2023-01-01T00:00:00.000Z' }),
    updatedAt: z.string().openapi({ example: '2023-01-01T00:00:00.000Z' }),
  })
);

export const CreateTaskDto = TaskSchema.omit({ id: true, createdAt: true, updatedAt: true });

registry.registerPath({
  method: 'post',
  path: '/tasks',
  tags: ['Tasks'],
  summary: '创建自定义脚本任务',
  request: {
    body: {
      content: {
        'application/json': { schema: CreateTaskDto },
      },
    },
  },
  responses: {
    200: {
      description: '任务创建成功',
      content: { 'application/json': { schema: TaskSchema } },
    },
  },
});

taskRouter.post('/', async (req: Request, res: Response) => {
  const data = CreateTaskDto.parse(req.body);
  const task = await prisma.$transaction(async tx => {
    const created = await tx.jsTask.create({ data });
    await appendSyncEvent(tx as any, {
      entityType: 'task',
      entityId: created.id,
      action: 'create',
      payload: created,
    });
    return created;
  });
  res.json(task);
});

registry.registerPath({
  method: 'post',
  path: '/tasks/{id}/run',
  tags: ['Tasks'],
  summary: '手动执行一次任务脚本 (沙箱环境)',
  request: {
    params: z.object({ id: z.string() })
  },
  responses: {
    200: {
      description: '执行完成',
      content: {
        'application/json': {
          schema: z.object({ output: z.string() })
        }
      },
    },
  },
});

taskRouter.post('/:id/run', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const task = await prisma.jsTask.findUnique({ where: { id } });
  
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const output = await runTaskScript(task.script);
  res.json({ output });
});

registry.registerPath({
  method: 'get',
  path: '/tasks',
  tags: ['Tasks'],
  summary: '获取所有任务',
  responses: {
    200: {
      description: '成功',
      content: { 'application/json': { schema: z.array(TaskSchema) } },
    },
  },
});

taskRouter.get('/', async (req: Request, res: Response) => {
  const tasks = await prisma.jsTask.findMany();
  res.json(tasks);
});

export const UpdateTaskDto = CreateTaskDto.partial();

registry.registerPath({
  method: 'put',
  path: '/tasks/{id}',
  tags: ['Tasks'],
  summary: '更新自定义脚本任务',
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': { schema: UpdateTaskDto },
      },
    },
  },
  responses: {
    200: {
      description: '任务更新成功',
      content: { 'application/json': { schema: TaskSchema } },
    },
  },
});

taskRouter.put('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const data = UpdateTaskDto.parse(req.body);
    const updated = await prisma.$transaction(async tx => {
      const row = await tx.jsTask.update({
        where: { id },
        data,
      });
      await appendSyncEvent(tx as any, {
        entityType: 'task',
        entityId: row.id,
        action: 'update',
        payload: row,
      });
      return row;
    });
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Params validate failed' });
  }
});

registry.registerPath({
  method: 'delete',
  path: '/tasks/{id}',
  tags: ['Tasks'],
  summary: '删除任务',
  request: {
    params: z.object({ id: z.string() })
  },
  responses: {
    204: {
      description: '删除成功',
    },
  },
});

taskRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    await prisma.$transaction(async tx => {
      await tx.jsTask.delete({
        where: { id },
      });
      await appendSyncEvent(tx as any, {
        entityType: 'task',
        entityId: id,
        action: 'delete',
        payload: { id },
      });
    });
    res.status(204).send();
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Delete failed' });
  }
});

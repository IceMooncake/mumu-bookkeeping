import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { generateOpenAPI } from './openapi';
import { taskRouter } from './routes/task';
import { transactionRouter } from './routes/transaction';
import { bookRouter } from './routes/book';
import { categoryRouter } from './routes/category';
import * as dotenv from 'dotenv';
import cron from 'node-cron';
import { prisma } from './db';
import { runTaskScript } from './sandbox/runner';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const app = express();
app.use(express.json());

// 挂载路由
app.use('/api/tasks', taskRouter);
app.use('/api/transactions', transactionRouter);
app.use('/api/books', bookRouter);
app.use('/api/categories', categoryRouter);

// 心跳接口，用于客户端进行网络探活
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 初始化 Swagger UI
const openapiDocument = generateOpenAPI();

// 自动将最新的 OpenAPI 文档写入到根目录的 docs 文件夹中，供前端随时使用
const docsPath = path.resolve(process.cwd(), '../docs/openapi.json');
if (!fs.existsSync(path.dirname(docsPath))) {
  fs.mkdirSync(path.dirname(docsPath), { recursive: true });
}
fs.writeFileSync(docsPath, JSON.stringify(openapiDocument, null, 2), 'utf-8');

app.get('/api-docs-json', (req, res) => res.json(openapiDocument));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiDocument));

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`Server is running at http://localhost:${PORT}`);
  console.log(`Swagger UI is active at http://localhost:${PORT}/api-docs`);
  
  if (await prisma.book.count() === 0) {
    await prisma.book.create({
      data: {
        name: '默认账本',
        isDefault: true,
      }
    });
    console.log('[Init] Default book created.');
  }

  // 简易启动全局调度器
  startCronScheduler();
});

/**
 * 查询所有启用了 cron 的脚本并挂载 node-cron 执行计划
 */
async function startCronScheduler() {
  const tasks = await prisma.jsTask.findMany({
    where: { isActive: true, cronExpression: { not: null } }
  });

  console.log(`[Scheduler] Loaded ${tasks.length} active scheduled scripts...`);

  for (const task of tasks) {
    if (task.cronExpression) {
      cron.schedule(task.cronExpression, async () => {
        console.log(`[Scheduler] Executing Task [${task.name}]`);
        const result = await runTaskScript(task.script);
        console.log(`[Scheduler] Result [${task.name}]:\\n${result}`);
      });
    }
  }
}

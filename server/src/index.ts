import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { generateOpenAPI } from './openapi';
import { taskRouter } from './routes/task';
import { transactionRouter } from './routes/transaction';
import * as dotenv from 'dotenv';
import cron from 'node-cron';
import { prisma } from './db';
import { runTaskScript } from './sandbox/runner';

dotenv.config();

const app = express();
app.use(express.json());

// 挂载路由
app.use('/api/tasks', taskRouter);
app.use('/api/transactions', transactionRouter);

// 初始化 Swagger UI
const openapiDocument = generateOpenAPI();
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiDocument));

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
  console.log(`Swagger UI is active at http://localhost:${PORT}/api-docs`);
  
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

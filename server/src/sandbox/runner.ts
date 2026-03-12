import ivm from 'isolated-vm';
import { createTransactionWithBookBalance } from '../services/transactionService';

/**
 * 在受限的 V8 沙箱中运行用户的 JS 代码
 * @param scriptCode 用户的 JS 脚本代码
 */
export async function runTaskScript(scriptCode: string): Promise<string> {
  // 分配最大 128MB 内存给这个沙箱
  const isolate = new ivm.Isolate({ memoryLimit: 128 });
  const context = await isolate.createContext();
  const jail = context.global;

  // 将全局对象设为自身，以便有些脚本正常运行
  await jail.set('global', jail.derefInto());

  // 1. 注入一个简易的日志系统（方便调试输出）
  const logs: string[] = [];
  const logCallback = function (...args: any[]) {
    logs.push(args.join(' '));
  };
  await jail.set('log', new ivm.Reference(logCallback));
  await isolate.compileScriptSync(`
    global.console = {
      log: (...args) => log.applyIgnored(null, args)
    };
  `).run(context);

  // 2. 注入安全的受限 API，例如允许向数据库中写入一笔账单
  // 使用 ivm.Reference 封装宿主的异步函数
  const createTransactionRef = new ivm.Reference(async (data: any) => {
    // 这里需注意实际应用中我们要对 data 做进一步的安全性/字段校验
    const transaction = await createTransactionWithBookBalance({
      amount: Number(data.amount) || 0,
      type: String(data.type),
      category: String(data.category),
      merchant: data.merchant ? String(data.merchant) : null,
      remark: data.remark ? String(data.remark) : null,
      payMethod: data.payMethod ? String(data.payMethod) : null,
    });
    return transaction.id;
  });

  // 在沙箱里暴露出 db.addTransaction 这个方法
  await isolate.compileScriptSync(`
    global.db = {
      addTransaction: async (data) => {
        return await $createTransactionRef.apply(undefined, [data], { arguments: { copy: true }, result: { promise: true, copy: true } });
      }
    };
  `).run(context);
  await jail.set('$createTransactionRef', createTransactionRef);

  try {
    // 编译并执行用户脚本
    // 我们将用户代码包裹在一个 async IIFE 中，以支持顶层的 async/await 操作
    const wrappedCode = `(async () => { ${scriptCode} })()`;
    const script = await isolate.compileScript(wrappedCode);
    
    // 设置 5 秒执行超时，防止死循环
    await script.run(context, { promise: true, timeout: 5000 });
    return logs.join('\\n') + '\\n[执行成功]';
  } catch (err: any) {
    return logs.join('\\n') + '\\n[安全拦截/执行错误]: ' + err.message;
  } finally {
    // 非常重要：执行完毕后销毁沙箱和上下文，防止内存泄露
    createTransactionRef.release();
    context.release();
    isolate.dispose();
  }
}

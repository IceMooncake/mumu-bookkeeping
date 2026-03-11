import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const expenseCategories = ['餐饮', '交通', '购物', '娱乐', '居住', '医疗', '其他'];
const incomeCategories = ['工资', '兼职', '理财', '其他'];

function getRandomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomAmount(min: number, max: number): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(2));
}

async function main() {
  console.log('开始初始化测试数据...');

  // 1. 获取或创建默认账本
  let book = await prisma.book.findFirst({
    where: { isDefault: true },
  });

  if (!book) {
    book = await prisma.book.create({
      data: {
        name: '默认测试账本',
        isDefault: true,
      },
    });
    console.log(`创建了新账本: ${book.name}`);
  } else {
    console.log(`使用现有默认账本: ${book.name}`);
  }

  // 可选：为了保证数据整洁，你可以在这里把当前账本旧的流水清理掉
  // 但为了保留已有数据，这里我们选择清空旧数据，以便于多次运行测试脚本能刷新数据
  await prisma.transaction.deleteMany({
    where: { bookId: book.id }
  });
  console.log('已清理当前账本下的旧流水记录...');

  const today = new Date();
  const transactions = [];

  for (let i = 0; i < 30; i++) {
    // 过去30天内的每一天生成 1 到 5 笔交易
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() - i);
    
    const dailyCount = Math.floor(Math.random() * 5) + 1;
    
    for (let j = 0; j < dailyCount; j++) {
      const isExpense = Math.random() > 0.3; // 70% 概率是支出
      const type = isExpense ? 'EXPENSE' : 'INCOME';
      const category = isExpense ? getRandomItem(expenseCategories) : getRandomItem(incomeCategories);
      const amount = isExpense ? getRandomAmount(5, 200) : getRandomAmount(5, 200);
      
      const txDate = new Date(targetDate);
      txDate.setHours(Math.floor(Math.random() * 24));
      txDate.setMinutes(Math.floor(Math.random() * 60));

      transactions.push({
        amount,
        type,
        category,
        merchant: isExpense ? '模拟商户' : '模拟发薪',
        date: txDate,
        bookId: book.id,
      });
    }
  }

  console.log(`向该账本随机生成了 ${transactions.length} 笔近30天的流水数据...`);

  await prisma.$transaction(async (tx) => {
    // 批量插入
    await tx.transaction.createMany({
      data: transactions,
    });

    // 计算总余额
    const allTxs = await tx.transaction.findMany({
      where: { bookId: book.id }
    });

    const newBalance = allTxs.reduce((acc, curr) => {
      return curr.type === 'INCOME' ? acc + curr.amount : acc - curr.amount;
    }, 0);

    // 更新账本余额
    await tx.book.update({
      where: { id: book.id },
      data: { balance: parseFloat(newBalance.toFixed(2)) }
    });
    
    console.log(`账本余额已校准并更新为: ¥${newBalance.toFixed(2)}`);
  });

  console.log('✅ 测试用数据初始化完成！');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

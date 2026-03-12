import { prisma } from '../db';
import { appendSyncEvent } from './syncEvent';

export interface CreateTransactionInput {
  clientOpId?: string;
  amount: number;
  type: string;
  category: string;
  merchant?: string | null;
  remark?: string | null;
  payMethod?: string | null;
  bookId?: string | null;
  date?: string;
}

export async function createTransactionWithBookBalance(input: CreateTransactionInput) {
  return prisma.$transaction(async tx => {
    let targetBookId = input.bookId ?? null;

    if (!targetBookId) {
      let defaultBook = await tx.book.findFirst({ where: { isDefault: true } });
      if (!defaultBook) {
        defaultBook = await tx.book.create({
          data: { name: '默认账本', balance: 0, isDefault: true },
        });
        await appendSyncEvent(tx as any, {
          entityType: 'book',
          entityId: defaultBook.id,
          action: 'create',
          payload: defaultBook,
        });
      }
      targetBookId = defaultBook.id;
    }

    if (input.clientOpId) {
      const dup = await (tx as any).transaction.findUnique({ where: { clientOpId: input.clientOpId } });
      if (dup) return dup;
    }

    const created = await (tx as any).transaction.create({
      data: {
        clientOpId: input.clientOpId,
        amount: input.amount,
        type: input.type,
        category: input.category,
        merchant: input.merchant ?? null,
        remark: input.remark ?? null,
        payMethod: input.payMethod ?? null,
        bookId: targetBookId,
        date: input.date ? new Date(input.date) : new Date(),
      },
    });

    const amountDiff =
      input.type === 'EXPENSE' ? -input.amount : input.type === 'INCOME' ? input.amount : 0;

    if (amountDiff !== 0 && targetBookId) {
      const updatedBook = await tx.book.update({
        where: { id: targetBookId },
        data: { balance: { increment: amountDiff } },
      });
      await appendSyncEvent(tx as any, {
        entityType: 'book',
        entityId: updatedBook.id,
        action: 'update',
        payload: updatedBook,
      });
    }

    await appendSyncEvent(tx as any, {
      entityType: 'transaction',
      entityId: created.id,
      action: 'create',
      payload: created,
    });

    return created;
  });
}

export async function deleteTransactionWithBookBalance(id: string) {
  return prisma.$transaction(async tx => {
    const target = await (tx as any).transaction.findUnique({ where: { id } });
    if (!target) return null;

    const deleted = await (tx as any).transaction.delete({ where: { id } });

    const amountDiff =
      target.type === 'EXPENSE' ? target.amount : target.type === 'INCOME' ? -target.amount : 0;

    if (target.bookId && amountDiff !== 0) {
      const updatedBook = await tx.book.update({
        where: { id: target.bookId },
        data: { balance: { increment: amountDiff } },
      });
      await appendSyncEvent(tx as any, {
        entityType: 'book',
        entityId: updatedBook.id,
        action: 'update',
        payload: updatedBook,
      });
    }

    await appendSyncEvent(tx as any, {
      entityType: 'transaction',
      entityId: deleted.id,
      action: 'delete',
      payload: {
        id: deleted.id,
        bookId: deleted.bookId,
      },
    });

    return deleted;
  });
}

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

export interface UpdateTransactionInput {
  amount?: number;
  type?: string;
  category?: string;
  merchant?: string | null;
  remark?: string | null;
  payMethod?: string | null;
  date?: string;
}

const signedAmount = (type: string, amount: number) => {
  if (type === 'EXPENSE') return -Math.abs(amount);
  if (type === 'INCOME') return Math.abs(amount);
  return 0;
};

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

export async function updateTransactionWithBookBalance(id: string, input: UpdateTransactionInput) {
  return prisma.$transaction(async tx => {
    const original = await (tx as any).transaction.findUnique({ where: { id } });
    if (!original) return null;

    const nextAmount = input.amount ?? original.amount;
    const nextType = input.type ?? original.type;

    const updated = await (tx as any).transaction.update({
      where: { id },
      data: {
        amount: nextAmount,
        type: nextType,
        category: input.category ?? original.category,
        merchant: input.merchant !== undefined ? input.merchant : original.merchant,
        remark: input.remark !== undefined ? input.remark : original.remark,
        payMethod: input.payMethod !== undefined ? input.payMethod : original.payMethod,
        date: input.date ? new Date(input.date) : original.date,
      },
    });

    if (original.bookId) {
      const before = signedAmount(original.type, original.amount);
      const after = signedAmount(nextType, nextAmount);
      const delta = after - before;

      if (delta !== 0) {
        const updatedBook = await tx.book.update({
          where: { id: original.bookId },
          data: { balance: { increment: delta } },
        });
        await appendSyncEvent(tx as any, {
          entityType: 'book',
          entityId: updatedBook.id,
          action: 'update',
          payload: updatedBook,
        });
      }
    }

    await appendSyncEvent(tx as any, {
      entityType: 'transaction',
      entityId: updated.id,
      action: 'update',
      payload: updated,
    });

    return updated;
  });
}

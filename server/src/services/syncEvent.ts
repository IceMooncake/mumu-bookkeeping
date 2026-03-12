import { prisma } from '../db';

export type SyncEntityType = 'transaction' | 'book' | 'task' | 'category';
export type SyncAction = 'create' | 'update' | 'delete' | 'upsert';

export async function appendSyncEvent(
  tx: typeof prisma,
  input: {
    entityType: SyncEntityType;
    entityId: string;
    action: SyncAction;
    payload?: unknown;
  }
) {
  await (tx as any).syncEvent.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      payload: input.payload ? JSON.stringify(input.payload) : null,
    },
  });
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { TransactionsService, OpenAPI, TasksService, BooksService } from './generated';
import Toast from 'react-native-toast-message';
import {
  deleteCategoryTagFromRemote,
  pullRemoteCategoriesToLocal,
  syncPendingCategoryOps,
  upsertCategoryTagFromRemote,
} from './categoryTags';
import { CACHE_KEYS } from './queries';

const OFFLINE_TX_QUEUE = '@offline_tx_queue';
const OFFLINE_TX_OPS = '@offline_tx_ops_v1';
const OFFLINE_TASK_OPS = '@offline_task_ops_v1';
const OFFLINE_BOOK_OPS = '@offline_book_ops_v1';
const IS_OFFLINE_KEY = '@app_is_offline';
const LAST_SYNC_CURSOR_KEY = '@sync_last_cursor_v1';

let isOnlineInternal = true;
let heartbeatInterval: any = null;

type SyncEvent = {
  cursor: number;
  entityType: 'transaction' | 'book' | 'task' | 'category' | string;
  entityId: string;
  action: 'create' | 'update' | 'delete' | 'upsert' | string;
  payload: any;
  createdAt: string;
};

type TxOpAction = 'update' | 'delete';
type TxOp = {
  opId: string;
  action: TxOpAction;
  targetId: string;
  data?: any;
  createdAt: string;
};

const getApiBase = () => {
  if (OpenAPI.BASE && OpenAPI.BASE.startsWith('http')) {
    return OpenAPI.BASE;
  }
  return 'http://localhost:3000/api';
};

const readJsonArray = async <T>(key: string): Promise<T[]> => {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
};

const writeJsonArray = async <T>(key: string, items: T[]) => {
  await AsyncStorage.setItem(key, JSON.stringify(items));
};

const applyUpsertById = (rows: any[], payload: any) => {
  const next = [...rows];
  const idx = next.findIndex(x => x?.id === payload?.id);
  if (idx >= 0) {
    next[idx] = { ...next[idx], ...payload };
  } else {
    next.unshift(payload);
  }
  return next;
};

const applyDeleteById = (rows: any[], id: string) => rows.filter(x => x?.id !== id);

const sortTxByDateDesc = (rows: any[]) => {
  return [...rows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

const applyTransactionEventToCaches = async (event: SyncEvent) => {
  const allKeys = await AsyncStorage.getAllKeys();
  const txCacheKeys = allKeys.filter(k => k.startsWith(`${CACHE_KEYS.TRANSACTIONS}_`));
  const targetKeys = txCacheKeys.length > 0 ? txCacheKeys : [`${CACHE_KEYS.TRANSACTIONS}_all`];

  for (const key of targetKeys) {
    const rows = await readJsonArray<any>(key);
    const suffix = key.slice((`${CACHE_KEYS.TRANSACTIONS}_`).length);
    const isAll = suffix === 'all';
    const eventBookId = event.payload?.bookId || null;
    const matchBook = !isAll && suffix === eventBookId;

    if (event.action === 'delete') {
      const next = applyDeleteById(rows, event.entityId);
      await writeJsonArray(key, next);
      continue;
    }

    if (isAll || matchBook) {
      const next = sortTxByDateDesc(applyUpsertById(rows, event.payload));
      await writeJsonArray(key, next);
    }
  }
};

const applyEntityEvent = async (event: SyncEvent) => {
  if (event.entityType === 'transaction') {
    await applyTransactionEventToCaches(event);
    return;
  }

  if (event.entityType === 'book') {
    const rows = await readJsonArray<any>(CACHE_KEYS.BOOKS);
    const next = event.action === 'delete'
      ? applyDeleteById(rows, event.entityId)
      : applyUpsertById(rows, event.payload);
    await writeJsonArray(CACHE_KEYS.BOOKS, next);
    return;
  }

  if (event.entityType === 'task') {
    const rows = await readJsonArray<any>(CACHE_KEYS.TASKS);
    const next = event.action === 'delete'
      ? applyDeleteById(rows, event.entityId)
      : applyUpsertById(rows, event.payload);
    await writeJsonArray(CACHE_KEYS.TASKS, next);
    return;
  }

  if (event.entityType === 'category') {
    if (event.action === 'delete') {
      await deleteCategoryTagFromRemote(event.entityId);
    } else if (event.payload) {
      await upsertCategoryTagFromRemote(event.payload);
    }
  }
};

const pullIncrementalChanges = async (): Promise<number> => {
  const cursorRaw = await AsyncStorage.getItem(LAST_SYNC_CURSOR_KEY);
  let cursor = Number(cursorRaw || 0);
  let changedCount = 0;

  while (true) {
    const response = await fetch(`${getApiBase()}/sync/pull?since=${cursor}&limit=200`);
    if (!response.ok) {
      throw new Error('拉取增量同步失败');
    }

    const data = (await response.json()) as {
      events: SyncEvent[];
      nextCursor: number;
      hasMore: boolean;
    };

    for (const event of data.events || []) {
      await applyEntityEvent(event);
    }

    changedCount += (data.events || []).length;
    cursor = data.nextCursor || cursor;
    await AsyncStorage.setItem(LAST_SYNC_CURSOR_KEY, String(cursor));

    if (!data.hasMore) break;
  }

  return changedCount;
};

export const setOnlineStatus = (status: boolean) => {
  isOnlineInternal = status;
};

export const getOnlineStatus = () => isOnlineInternal;

/**
 * Starts a heartbeat check to ping the server.
 */
export function startHeartbeat(
  onStatusChange: (isOnline: boolean) => void,
  onSyncComplete?: (count: number) => void,
  onCategorySyncComplete?: (count: number) => void,
  onDeltaPullComplete?: (count: number) => void,
) {
  const checkHeartbeat = async () => {
    try {
      // Very basic endpoint to test server reachable.
      // Use health check endpoint so we don't rely on openapi.json
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 2000); // 2 seconds timeout for heartbeat
      const response = await fetch(`${getApiBase()}/health`, {
        signal: controller.signal,
      }).catch(() => null);
      clearTimeout(id);
      
      const newStatus = !!response && response.ok;
      if (newStatus !== isOnlineInternal) {
        isOnlineInternal = newStatus;
        onStatusChange(newStatus);
      }
      
      // 每次心跳（只要是在线状态），都尝试清空缓存队列并与后端进行同步
      if (newStatus) {
        const syncedTxCount = await syncOfflineTransactions();
        const syncedTxOpsCount = await syncOfflineTransactionOps();
        const syncedCategoryCount = await syncPendingCategoryOps();
        const syncedTaskCount = await syncOfflineTaskOps();
        const syncedBookCount = await syncOfflineBookOps();
        let pulledChangeCount = 0;

        try {
          pulledChangeCount = await pullIncrementalChanges();
        } catch {
          // 向后兼容：旧后端没有 sync/pull 时，分类至少走原有拉取逻辑。
          await pullRemoteCategoriesToLocal();
        }

        if ((syncedTxCount + syncedTxOpsCount) > 0 && onSyncComplete) {
          onSyncComplete(syncedTxCount + syncedTxOpsCount);
        }
        if ((syncedTaskCount + syncedBookCount) > 0 && onSyncComplete) {
          onSyncComplete(syncedTaskCount + syncedBookCount);
        }
        if (pulledChangeCount > 0 && onDeltaPullComplete) {
          onDeltaPullComplete(pulledChangeCount);
        }
        if (onCategorySyncComplete) {
          onCategorySyncComplete(syncedCategoryCount);
        }
      }
    } catch (e) {
      if (isOnlineInternal) {
        isOnlineInternal = false;
        onStatusChange(false);
      }
    }
  };

  // Run immediately then poll
  checkHeartbeat();
  heartbeatInterval = setInterval(checkHeartbeat, 5000); // 5 sec heartbeat
}

export function stopHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
}

/**
 * Save mutation directly to a local queue. Returns a temporary mock object to use for optimistic UI updates.
 */
export async function addTransactionToOfflineQueue(txData: any) {
  try {
    const queueStr = await AsyncStorage.getItem(OFFLINE_TX_QUEUE);
    const queue = queueStr ? JSON.parse(queueStr) : [];
    
    const offlineItem = {
      ...txData,
      _offlineId: 'temp_' + Date.now().toString(),
      clientOpId: txData?.clientOpId || `tx_op_${Date.now()}`,
      _syncStatus: 'pending' // pending, syncing, error
    };
    
    queue.push(offlineItem);
    await AsyncStorage.setItem(OFFLINE_TX_QUEUE, JSON.stringify(queue));
    return offlineItem;
  } catch (e) {
    console.error('Failed to save offline tx', e);
    return null;
  }
}

export async function getOfflineQueue() {
  try {
    const queueStr = await AsyncStorage.getItem(OFFLINE_TX_QUEUE);
    return queueStr ? JSON.parse(queueStr) : [];
  } catch {
    return [];
  }
}

const getTxOps = async (): Promise<TxOp[]> => {
  const raw = await AsyncStorage.getItem(OFFLINE_TX_OPS);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as TxOp[];
  } catch {
    return [];
  }
};

const saveTxOps = async (ops: TxOp[]) => {
  await AsyncStorage.setItem(OFFLINE_TX_OPS, JSON.stringify(ops));
};

export async function queueTransactionUpdateLocal(targetId: string, data: any) {
  const queue = await getOfflineQueue();
  const offlineIdx = queue.findIndex((tx: any) => (tx._offlineId || tx.id) === targetId);
  if (offlineIdx >= 0) {
    queue[offlineIdx] = { ...queue[offlineIdx], ...data, _syncStatus: 'pending' };
    await AsyncStorage.setItem(OFFLINE_TX_QUEUE, JSON.stringify(queue));
    return;
  }

  const ops = await getTxOps();
  const idx = ops.findIndex(op => op.action === 'update' && op.targetId === targetId);
  if (idx >= 0) {
    ops[idx] = { ...ops[idx], data: { ...(ops[idx].data || {}), ...(data || {}) } };
  } else {
    ops.push({
      opId: `tx_op_${Date.now()}`,
      action: 'update',
      targetId,
      data,
      createdAt: new Date().toISOString(),
    });
  }
  await saveTxOps(ops);
}

export async function queueTransactionDeleteLocal(targetId: string) {
  const queue = await getOfflineQueue();
  const offlineIdx = queue.findIndex((tx: any) => (tx._offlineId || tx.id) === targetId);
  if (offlineIdx >= 0) {
    queue.splice(offlineIdx, 1);
    await AsyncStorage.setItem(OFFLINE_TX_QUEUE, JSON.stringify(queue));
    return;
  }

  const ops = await getTxOps();
  const next = ops
    .filter(op => !(op.action === 'update' && op.targetId === targetId))
    .filter(op => !(op.action === 'delete' && op.targetId === targetId));

  next.push({
    opId: `tx_op_${Date.now()}`,
    action: 'delete',
    targetId,
    createdAt: new Date().toISOString(),
  });

  await saveTxOps(next);
}

type TaskOpAction = 'create' | 'update' | 'delete';
type BookOpAction = 'create' | 'update' | 'delete';

type TaskOp = {
  opId: string;
  action: TaskOpAction;
  targetId: string;
  data?: any;
  createdAt: string;
};

type BookOp = {
  opId: string;
  action: BookOpAction;
  targetId: string;
  data?: any;
  createdAt: string;
};

const getTaskOps = async (): Promise<TaskOp[]> => {
  const raw = await AsyncStorage.getItem(OFFLINE_TASK_OPS);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as TaskOp[];
  } catch {
    return [];
  }
};

const saveTaskOps = async (ops: TaskOp[]) => {
  await AsyncStorage.setItem(OFFLINE_TASK_OPS, JSON.stringify(ops));
};

const getBookOps = async (): Promise<BookOp[]> => {
  const raw = await AsyncStorage.getItem(OFFLINE_BOOK_OPS);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as BookOp[];
  } catch {
    return [];
  }
};

const saveBookOps = async (ops: BookOp[]) => {
  await AsyncStorage.setItem(OFFLINE_BOOK_OPS, JSON.stringify(ops));
};

export async function queueTaskOperation(input: {
  action: TaskOpAction;
  targetId: string;
  data?: any;
}) {
  const ops = await getTaskOps();

  if (input.action === 'update') {
    const createIdx = ops.findIndex(op => op.action === 'create' && op.targetId === input.targetId);
    if (createIdx >= 0) {
      ops[createIdx] = {
        ...ops[createIdx],
        data: { ...(ops[createIdx].data || {}), ...(input.data || {}) },
      };
      await saveTaskOps(ops);
      return;
    }
  }

  if (input.action === 'delete') {
    const createIdx = ops.findIndex(op => op.action === 'create' && op.targetId === input.targetId);
    if (createIdx >= 0) {
      const next = ops.filter(op => op.targetId !== input.targetId);
      await saveTaskOps(next);
      return;
    }
  }

  ops.push({
    opId: `task_op_${Date.now()}`,
    action: input.action,
    targetId: input.targetId,
    data: input.data,
    createdAt: new Date().toISOString(),
  });
  await saveTaskOps(ops);
}

export async function queueBookOperation(input: {
  action: BookOpAction;
  targetId: string;
  data?: any;
}) {
  const ops = await getBookOps();

  if (input.action === 'update') {
    const createIdx = ops.findIndex(op => op.action === 'create' && op.targetId === input.targetId);
    if (createIdx >= 0) {
      ops[createIdx] = {
        ...ops[createIdx],
        data: { ...(ops[createIdx].data || {}), ...(input.data || {}) },
      };
      await saveBookOps(ops);
      return;
    }
  }

  if (input.action === 'delete') {
    const createIdx = ops.findIndex(op => op.action === 'create' && op.targetId === input.targetId);
    if (createIdx >= 0) {
      const next = ops.filter(op => op.targetId !== input.targetId);
      await saveBookOps(next);
      return;
    }
  }

  ops.push({
    opId: `book_op_${Date.now()}`,
    action: input.action,
    targetId: input.targetId,
    data: input.data,
    createdAt: new Date().toISOString(),
  });
  await saveBookOps(ops);
}

let isSyncing = false;
let isSyncingTxOps = false;

let isSyncingTaskOps = false;
let isSyncingBookOps = false;

export async function syncOfflineTransactions() {
  if (!getOnlineStatus() || isSyncing) return 0;
  
  isSyncing = true;
  try {
    const queue = await getOfflineQueue();
    if (queue.length === 0) return 0;

    console.log(`[Sync] Found ${queue.length} offline transactions, syncing...`);

    let successCount = 0;
    let remainingQueue = [];

    for (const tx of queue) {
      try {
        const payload = { ...tx };
        delete payload._offlineId;
        delete payload._syncStatus;
        await TransactionsService.postTransactions(payload);
        successCount++;
      } catch (e) {
        console.error(`[Sync] Failed to sync transaction: ${tx._offlineId}`, e);
        remainingQueue.push(tx);
      }
    }

    await AsyncStorage.setItem(OFFLINE_TX_QUEUE, JSON.stringify(remainingQueue));
    return successCount;
  } finally {
    isSyncing = false;
  }
}

export async function syncOfflineTransactionOps() {
  if (!getOnlineStatus() || isSyncingTxOps) return 0;
  isSyncingTxOps = true;
  try {
    const ops = await getTxOps();
    if (ops.length === 0) return 0;

    const base = getApiBase();
    let successCount = 0;
    const remaining: TxOp[] = [];

    for (const op of ops) {
      try {
        if (op.action === 'update') {
          const response = await fetch(`${base}/transactions/${op.targetId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(op.data || {}),
          });
          if (!response.ok) {
            throw new Error('Update transaction failed');
          }
        } else {
          const response = await fetch(`${base}/transactions/${op.targetId}`, {
            method: 'DELETE',
          });
          if (!response.ok && response.status !== 404) {
            throw new Error('Delete transaction failed');
          }
        }
        successCount += 1;
      } catch {
        remaining.push(op);
      }
    }

    await saveTxOps(remaining);
    return successCount;
  } finally {
    isSyncingTxOps = false;
  }
}

export async function syncOfflineTaskOps() {
  if (!getOnlineStatus() || isSyncingTaskOps) return 0;
  isSyncingTaskOps = true;
  try {
    const ops = await getTaskOps();
    if (ops.length === 0) return 0;

    let successCount = 0;
    const remaining: TaskOp[] = [];
    const idMap: Record<string, string> = {};

    for (const op of ops) {
      const resolvedId = idMap[op.targetId] || op.targetId;
      try {
        if (op.action === 'create') {
          const created = await TasksService.postTasks(op.data);
          if (created?.id) {
            idMap[op.targetId] = created.id;
          }
        } else if (op.action === 'update') {
          await TasksService.putTasks(resolvedId, op.data);
        } else {
          await TasksService.deleteTasks(resolvedId);
        }
        successCount += 1;
      } catch {
        remaining.push({ ...op, targetId: resolvedId });
      }
    }

    await saveTaskOps(remaining);
    return successCount;
  } finally {
    isSyncingTaskOps = false;
  }
}

export async function syncOfflineBookOps() {
  if (!getOnlineStatus() || isSyncingBookOps) return 0;
  isSyncingBookOps = true;
  try {
    const ops = await getBookOps();
    if (ops.length === 0) return 0;

    let successCount = 0;
    const remaining: BookOp[] = [];
    const idMap: Record<string, string> = {};

    for (const op of ops) {
      const resolvedId = idMap[op.targetId] || op.targetId;
      try {
        if (op.action === 'create') {
          const created = await BooksService.postBooks(op.data);
          if (created?.id) {
            idMap[op.targetId] = created.id;
          }
        } else if (op.action === 'update') {
          await BooksService.putBooks(resolvedId, op.data);
        } else {
          await BooksService.deleteBooks(resolvedId);
        }
        successCount += 1;
      } catch {
        remaining.push({ ...op, targetId: resolvedId });
      }
    }

    await saveBookOps(remaining);
    return successCount;
  } finally {
    isSyncingBookOps = false;
  }
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TransactionsService, TasksService, BooksService } from './generated';
import type { Transaction } from './generated/models/Transaction';
import type { Task } from './generated/models/Task';
import type { Book } from './generated/models/Book';
import {
  getOnlineStatus,
  getOfflineQueue,
  addTransactionToOfflineQueue,
  queueTaskOperation,
  queueTransactionUpdateLocal,
  queueTransactionDeleteLocal,
  getPendingTransactionDeleteIds,
  getPendingTransactionUpdateMap,
} from './offlineSync';

// We export the generated interfaces for components
export type { Transaction, Task, Book };

export const CACHE_KEYS = {
  TRANSACTIONS: '@cache_transactions',
  TASKS: '@cache_tasks',
  BOOKS: '@cache_books',
};

// 带有AbortSignal请求控制，替换无限等待加载图的方法
const withTimeout = async <T>(promise: Promise<T>, ms: number = 3000): Promise<T> => {
  let timeoutId: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('请求超时，降级至离线缓存模式'));
    }, ms);
  });
  
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
};

const signedAmount = (type?: string, amount?: number) => {
  const n = Number(amount || 0);
  if (type === 'EXPENSE') return -Math.abs(n);
  if (type === 'INCOME') return Math.abs(n);
  return 0;
};

const persistBooksCache = async (books: any[]) => {
  try {
    await AsyncStorage.setItem(CACHE_KEYS.BOOKS, JSON.stringify(books || []));
  } catch {
    // ignore cache persist error
  }
};

const adjustBooksBalance = async (queryClient: ReturnType<typeof useQueryClient>, bookId: string | undefined, delta: number) => {
  if (!bookId || !delta) return;
  let nextBooks: any[] = [];
  queryClient.setQueryData(['books'], (old: any) => {
    nextBooks = (old || []).map((book: any) =>
      book.id === bookId ? { ...book, balance: Number(book.balance || 0) + delta, isPending: true } : book
    );
    return nextBooks;
  });
  await persistBooksCache(nextBooks);
};

export const useBooks = () => {
  return useQuery({
    queryKey: ['books'],
    queryFn: async () => {
      const cached = await AsyncStorage.getItem(CACHE_KEYS.BOOKS);
      if (cached) {
        return JSON.parse(cached) as Book[];
      }

      try {
        if (!getOnlineStatus()) throw new Error('Offline mode active');
        const data = await withTimeout(BooksService.getBooks(), 3000);
        await AsyncStorage.setItem(CACHE_KEYS.BOOKS, JSON.stringify(data));
        return data;
      } catch {
        return [];
      }
    },
    networkMode: 'offlineFirst',
  });
};

export const useTransactions = (bookId?: string) => {
  return useQuery({
    queryKey: ['transactions', bookId],
    queryFn: async () => {
      const cacheId = `${CACHE_KEYS.TRANSACTIONS}_${bookId || 'all'}`;
      let serverData: Transaction[] = [];
      const cached = await AsyncStorage.getItem(cacheId);
      if (cached) {
        serverData = JSON.parse(cached) as Transaction[];
      } else {
        try {
          if (!getOnlineStatus()) throw new Error('Offline mode active');
          serverData = await withTimeout(TransactionsService.getTransactions(bookId), 5000);
          await AsyncStorage.setItem(cacheId, JSON.stringify(serverData));
        } catch {
          serverData = [];
        }
      }
      
      const offlineQueue = await getOfflineQueue();
      const pendingDeleteIds = new Set(await getPendingTransactionDeleteIds());
      const pendingUpdateMap = await getPendingTransactionUpdateMap();
      const relevantOffline = bookId 
        ? offlineQueue.filter((t: any) => t.bookId === bookId) 
        : offlineQueue;

      const filteredServerData = serverData.filter((tx: any) => !pendingDeleteIds.has(tx.id));
      const filteredOffline = relevantOffline.filter((tx: any) => {
        const localKey = (tx as any)._offlineId || (tx as any).id;
        return !pendingDeleteIds.has(localKey);
      });

      const applyPendingUpdate = (tx: any) => {
        const key = tx.id || tx._offlineId;
        const patch = pendingUpdateMap[key];
        return patch ? { ...tx, ...patch, isPending: true } : tx;
      };

      const localFirstData = [
        ...filteredOffline.map(applyPendingUpdate),
        ...filteredServerData.map(applyPendingUpdate),
      ] as Transaction[];
      // sort by date descending
      return localFirstData.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    },
    networkMode: 'offlineFirst',
  });
};

export const useCreateTransaction = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (txData: Parameters<typeof TransactionsService.postTransactions>[0]) => {
      // 本地优先策略：所有的流水请求直接进入本地队列缓存，而不是先尝试网络请求
      const offlineRes = await addTransactionToOfflineQueue({ ...txData, date: txData?.date || new Date().toISOString() });
      return { offline: true, ...offlineRes };
    },
    onMutate: async (newTx: any) => {
      await queryClient.cancelQueries({ queryKey: ['transactions'] });
      
      const queryKeyAll = ['transactions', undefined];
      const queryKeyBook = ['transactions', newTx.bookId];
      
      const previousTxsAll = queryClient.getQueryData(queryKeyAll);
      const previousTxsBook = queryClient.getQueryData(queryKeyBook);

      const updater = (old: any) => {
        return [
          { ...newTx, id: 'temp_' + Date.now(), isPending: true },
          ...(old || [])
        ];
      };

      if (previousTxsAll) queryClient.setQueryData(queryKeyAll, updater);
      queryClient.setQueryData(queryKeyBook, updater);

      const previousBooks = queryClient.getQueryData(['books']);
      await adjustBooksBalance(
        queryClient,
        newTx.bookId,
        signedAmount(newTx.type, newTx.amount)
      );

      return { previousTxsAll, previousTxsBook, queryKeyAll, queryKeyBook, previousBooks };
    },
    onError: (_err, _newTx, context: any) => {
      if (context?.previousTxsAll) queryClient.setQueryData(context.queryKeyAll, context.previousTxsAll);
      if (context?.previousTxsBook) queryClient.setQueryData(context.queryKeyBook, context.previousTxsBook);
      if (context?.previousBooks) {
        queryClient.setQueryData(['books'], context.previousBooks);
        persistBooksCache(context.previousBooks);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['books'] });
    },
  });
};

export const useUpdateTransaction = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Transaction> }) => {
      await queueTransactionUpdateLocal(id, data);
      return { id, ...data } as any;
    },
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ['transactions'] });
      const previousAll = queryClient.getQueryData(['transactions', undefined]);
      const previousBook = queryClient.getQueryData(['transactions', (data as any)?.bookId]);
      const previousBooks = queryClient.getQueryData(['books']);

      const txSnapshots = queryClient.getQueriesData({ queryKey: ['transactions'] });
      let targetTx: any = null;
      for (const [, value] of txSnapshots) {
        const found = (value as any[] | undefined)?.find((tx: any) => tx.id === id || tx._offlineId === id);
        if (found) {
          targetTx = found;
          break;
        }
      }

      const before = targetTx ? signedAmount(targetTx.type, targetTx.amount) : 0;
      const after = signedAmount(
        (data as any)?.type ?? targetTx?.type,
        (data as any)?.amount ?? targetTx?.amount,
      );
      const bookIdForDelta = (data as any)?.bookId ?? targetTx?.bookId;
      const balanceDelta = after - before;
      const allStorageKeys = await AsyncStorage.getAllKeys();
      const txCacheKeys = allStorageKeys.filter(k => k.startsWith(`${CACHE_KEYS.TRANSACTIONS}_`));
      const previousTxCaches: Array<{ key: string; raw: string | null }> = [];

      for (const key of txCacheKeys) {
        const raw = await AsyncStorage.getItem(key);
        previousTxCaches.push({ key, raw });
        if (!raw) continue;
        try {
          const rows = JSON.parse(raw) as any[];
          const nextRows = (rows || []).map((tx: any) =>
            tx.id === id || tx._offlineId === id ? { ...tx, ...data, isPending: true } : tx
          );
          await AsyncStorage.setItem(key, JSON.stringify(nextRows));
        } catch {
          // ignore malformed cache
        }
      }

      const updater = (old: any) =>
        (old || []).map((tx: any) =>
          tx.id === id || tx._offlineId === id ? { ...tx, ...data, isPending: true } : tx
        );

      queryClient.setQueryData(['transactions', undefined], updater);
      if ((data as any)?.bookId) {
        queryClient.setQueryData(['transactions', (data as any).bookId], updater);
      }

      await adjustBooksBalance(queryClient, bookIdForDelta, balanceDelta);

      return { previousAll, previousBook, bookId: (data as any)?.bookId, previousTxCaches, previousBooks };
    },
    onError: (_err, _vars, context: any) => {
      queryClient.setQueryData(['transactions', undefined], context?.previousAll);
      if (context?.bookId) {
        queryClient.setQueryData(['transactions', context.bookId], context?.previousBook);
      }
      if (context?.previousBooks) {
        queryClient.setQueryData(['books'], context.previousBooks);
        persistBooksCache(context.previousBooks);
      }
      Promise.all(
        (context?.previousTxCaches || []).map(async (item: any) => {
          try {
            if (item.raw === null) {
              await AsyncStorage.removeItem(item.key);
            } else {
              await AsyncStorage.setItem(item.key, item.raw);
            }
          } catch {
            // ignore cache rollback failure
          }
        })
      ).catch(() => {
        // ignore cache rollback batch failure
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['books'] });
    },
  });
};

export const useDeleteTransaction = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      await queueTransactionDeleteLocal(id);
      return { success: true };
    },
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ['transactions'] });
      const previous = queryClient.getQueriesData({ queryKey: ['transactions'] });
      const previousBooks = queryClient.getQueryData(['books']);

      let targetTx: any = null;
      for (const [, value] of previous) {
        const found = (value as any[] | undefined)?.find((tx: any) => tx.id === id || tx._offlineId === id);
        if (found) {
          targetTx = found;
          break;
        }
      }
      const balanceDelta = targetTx ? -signedAmount(targetTx.type, targetTx.amount) : 0;
      const targetBookId = targetTx?.bookId;

      const allStorageKeys = await AsyncStorage.getAllKeys();
      const txCacheKeys = allStorageKeys.filter(k => k.startsWith(`${CACHE_KEYS.TRANSACTIONS}_`));
      const previousTxCaches: Array<{ key: string; raw: string | null }> = [];

      for (const key of txCacheKeys) {
        const raw = await AsyncStorage.getItem(key);
        previousTxCaches.push({ key, raw });
        if (!raw) continue;
        try {
          const rows = JSON.parse(raw) as any[];
          const nextRows = (rows || []).filter((tx: any) => tx.id !== id && tx._offlineId !== id);
          await AsyncStorage.setItem(key, JSON.stringify(nextRows));
        } catch {
          // ignore malformed cache
        }
      }

      queryClient.setQueriesData({ queryKey: ['transactions'] }, (old: any) =>
        (old || []).filter((tx: any) => tx.id !== id && tx._offlineId !== id)
      );
      await adjustBooksBalance(queryClient, targetBookId, balanceDelta);

      return { previous, previousTxCaches, previousBooks };
    },
    onError: (_err, _vars, context: any) => {
      (context?.previous || []).forEach(([key, value]: any[]) => {
        queryClient.setQueryData(key, value);
      });
      if (context?.previousBooks) {
        queryClient.setQueryData(['books'], context.previousBooks);
        persistBooksCache(context.previousBooks);
      }
      Promise.all(
        (context?.previousTxCaches || []).map(async (item: any) => {
          try {
            if (item.raw === null) {
              await AsyncStorage.removeItem(item.key);
            } else {
              await AsyncStorage.setItem(item.key, item.raw);
            }
          } catch {
            // ignore cache rollback failure
          }
        })
      ).catch(() => {
        // ignore cache rollback batch failure
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['books'] });
    },
  });
};

export const useTasks = () => {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: async () => {
      const cached = await AsyncStorage.getItem(CACHE_KEYS.TASKS);
      if (cached) {
        return JSON.parse(cached) as Task[];
      }

      try {
        if (!getOnlineStatus()) throw new Error('Offline mode active');
        const data = await withTimeout(TasksService.getTasks(), 4000);
        await AsyncStorage.setItem(CACHE_KEYS.TASKS, JSON.stringify(data));
        return data;
      } catch {
        return [];
      }
    },
    networkMode: 'offlineFirst',
  });
};

export const useCreateTask = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (taskData: Parameters<typeof TasksService.postTasks>[0]) => {
      const tempId = 'temp_' + Date.now();
      await queueTaskOperation({
        action: 'create',
        targetId: tempId,
        data: taskData,
      });
      return { ...taskData, id: tempId } as any;
    },
    onMutate: async (newTask) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      const previousTasks = queryClient.getQueryData(['tasks']);
      const optimisticId = (newTask as any)?.id || ('temp_' + Date.now());
      let nextTasks: any[] = [];
      queryClient.setQueryData(['tasks'], (old: any) => {
        nextTasks = [
          { ...newTask, id: optimisticId, isPending: true },
          ...(old || []),
        ];
        return nextTasks;
      });
      await AsyncStorage.setItem(CACHE_KEYS.TASKS, JSON.stringify(nextTasks));
      return { previousTasks };
    },
    onError: async (_err, _newTask, context: any) => {
      queryClient.setQueryData(['tasks'], context?.previousTasks);
      try {
        await AsyncStorage.setItem(CACHE_KEYS.TASKS, JSON.stringify(context?.previousTasks || []));
      } catch {
        // ignore cache rollback write failure
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
};

export const useUpdateTask = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Parameters<typeof TasksService.putTasks>[1] }) => {
      await queueTaskOperation({
        action: 'update',
        targetId: id,
        data,
      });
      return { ...data, id } as any;
    },
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      const previousTasks = queryClient.getQueryData(['tasks']);
      let nextTasks: any[] = [];
      queryClient.setQueryData(['tasks'], (old: any) => {
        nextTasks = (old || []).map((t: any) => t.id === id ? { ...t, ...data, isPending: true } : t);
        return nextTasks;
      });
      await AsyncStorage.setItem(CACHE_KEYS.TASKS, JSON.stringify(nextTasks));
      return { previousTasks };
    },
    onError: async (_err, _newTodo, context: any) => {
      queryClient.setQueryData(['tasks'], context?.previousTasks);
      try {
        await AsyncStorage.setItem(CACHE_KEYS.TASKS, JSON.stringify(context?.previousTasks || []));
      } catch {
        // ignore cache rollback write failure
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
};

export const useDeleteTask = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await queueTaskOperation({
        action: 'delete',
        targetId: id,
      });
      return { success: true };
    },
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      const previousTasks = queryClient.getQueryData(['tasks']);
      let nextTasks: any[] = [];
      queryClient.setQueryData(['tasks'], (old: any) => {
        nextTasks = (old || []).filter((t: any) => t.id !== id);
        return nextTasks;
      });
      await AsyncStorage.setItem(CACHE_KEYS.TASKS, JSON.stringify(nextTasks));
      return { previousTasks };
    },
    onError: (_err, _id, context: any) => {
      queryClient.setQueryData(['tasks'], context?.previousTasks);
      AsyncStorage.setItem(CACHE_KEYS.TASKS, JSON.stringify(context?.previousTasks || []));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
};

export const useRunTask = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      return TasksService.postTasksRun(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] }); // It might add txs
    },
  });
};

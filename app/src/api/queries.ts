import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TransactionsService, TasksService, BooksService } from './generated';
import type { Transaction } from './generated/models/Transaction';
import type { Task } from './generated/models/Task';
import type { Book } from './generated/models/Book';
import { getOnlineStatus, getOfflineQueue, addTransactionToOfflineQueue, queueTaskOperation } from './offlineSync';

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
      const relevantOffline = bookId 
        ? offlineQueue.filter((t: any) => t.bookId === bookId) 
        : offlineQueue;
        
      const localFirstData = [...relevantOffline, ...serverData] as Transaction[];
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

      return { previousTxsAll, previousTxsBook, queryKeyAll, queryKeyBook };
    },
    onError: (_err, _newTx, context: any) => {
      if (context?.previousTxsAll) queryClient.setQueryData(context.queryKeyAll, context.previousTxsAll);
      if (context?.previousTxsBook) queryClient.setQueryData(context.queryKeyBook, context.previousTxsBook);
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

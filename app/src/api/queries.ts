import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TransactionsService, TasksService, BooksService } from './generated';
import type { Transaction } from './generated/models/Transaction';
import type { Task } from './generated/models/Task';
import type { Book } from './generated/models/Book';
import { getOnlineStatus, getOfflineQueue, addTransactionToOfflineQueue } from './offlineSync';

// We export the generated interfaces for components
export type { Transaction, Task, Book };

const CACHE_KEYS = {
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
      try {
        if (!getOnlineStatus()) throw new Error('Offline mode active');
        const data = await withTimeout(BooksService.getBooks(), 3000);
        await AsyncStorage.setItem(CACHE_KEYS.BOOKS, JSON.stringify(data));
        return data;
      } catch (error) {
        const cached = await AsyncStorage.getItem(CACHE_KEYS.BOOKS);
        if (cached) {
          return JSON.parse(cached) as Book[];
        }
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
      try {
        if (!getOnlineStatus()) throw new Error('Offline mode active');
        serverData = await withTimeout(TransactionsService.getTransactions(bookId), 5000);
        await AsyncStorage.setItem(cacheId, JSON.stringify(serverData));
      } catch (error) {
        const cached = await AsyncStorage.getItem(cacheId);
        if (cached) {
          serverData = JSON.parse(cached) as Transaction[];
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
      const previousTxs = queryClient.getQueryData(['transactions']);
      queryClient.setQueryData(['transactions'], (old: any) => {
        // Because cache key could be ['transactions', undefined] or ['transactions', bookId]
        // The invalidation handles it, but optimistic update is tricky. We'll update the 'all' key or the one matching newTx.bookId
        return [
          { ...newTx, id: 'temp_' + Date.now(), isPending: true },
          ...(old || [])
        ];
      });
      return { previousTxs };
    },
    onError: (err, newTx, context: any) => {
      // In case of error revert
      queryClient.setQueryData(['transactions'], context?.previousTxs);
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
      try {
        if (!getOnlineStatus()) throw new Error('Offline mode active');
        const data = await withTimeout(TasksService.getTasks(), 4000);
        await AsyncStorage.setItem(CACHE_KEYS.TASKS, JSON.stringify(data));
        return data;
      } catch (error) {
        const cached = await AsyncStorage.getItem(CACHE_KEYS.TASKS);
        if (cached) {
          return JSON.parse(cached) as Task[];
        }
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
      if (!getOnlineStatus()) {
        const fakeData = { ...taskData, id: 'temp_' + Date.now() };
        return fakeData as any;
      }
      return TasksService.postTasks(taskData);
    },
    onMutate: async (newTask) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      const previousTasks = queryClient.getQueryData(['tasks']);
      queryClient.setQueryData(['tasks'], (old: any) => [
        { ...newTask, id: 'temp_' + Date.now(), isPending: true },
        ...(old || [])
      ]);
      return { previousTasks };
    },
    onError: (err, newTask, context: any) => {
      queryClient.setQueryData(['tasks'], context?.previousTasks);
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
      if (!getOnlineStatus()) {
        return { ...data, id } as any;
      }
      return TasksService.putTasks(id, data);
    },
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      const previousTasks = queryClient.getQueryData(['tasks']);
      queryClient.setQueryData(['tasks'], (old: any) => 
        (old || []).map((t: any) => t.id === id ? { ...t, ...data, isPending: true } : t)
      );
      return { previousTasks };
    },
    onError: (err, newTodo, context: any) => {
      queryClient.setQueryData(['tasks'], context?.previousTasks);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
};

export const useDeleteTask = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      return TasksService.deleteTasks(id);
    },
    onSuccess: () => {
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

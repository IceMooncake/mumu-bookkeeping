import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TransactionsService, TasksService, BooksService } from './generated';
import type { Transaction } from './generated/models/Transaction';
import type { Task } from './generated/models/Task';
import type { Book } from './generated/models/Book';

// We export the generated interfaces for components
export type { Transaction, Task, Book };

const CACHE_KEYS = {
  TRANSACTIONS: '@cache_transactions',
  TASKS: '@cache_tasks',
  BOOKS: '@cache_books',
};

export const useBooks = () => {
  return useQuery({
    queryKey: ['books'],
    queryFn: async () => {
      try {
        const data = await BooksService.getBooks();
        await AsyncStorage.setItem(CACHE_KEYS.BOOKS, JSON.stringify(data));
        return data;
      } catch (error) {
        const cached = await AsyncStorage.getItem(CACHE_KEYS.BOOKS);
        if (cached) {
          return JSON.parse(cached) as Book[];
        }
        throw error;
      }
    },
    networkMode: 'always',
  });
};

export const useTransactions = (bookId?: string) => {
  return useQuery({
    queryKey: ['transactions', bookId],
    queryFn: async () => {
      try {
        const data = await TransactionsService.getTransactions(bookId);
        await AsyncStorage.setItem(`${CACHE_KEYS.TRANSACTIONS}_${bookId || 'all'}`, JSON.stringify(data));
        return data;
      } catch (error) {
        const cached = await AsyncStorage.getItem(`${CACHE_KEYS.TRANSACTIONS}_${bookId || 'all'}`);
        if (cached) {
          return JSON.parse(cached) as Transaction[];
        }
        throw error;
      }
    },
    networkMode: 'always',
  });
};

export const useTasks = () => {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: async () => {
      try {
        const data = await TasksService.getTasks();
        // 联网成功，同步数据到本地进行缓存
        await AsyncStorage.setItem(CACHE_KEYS.TASKS, JSON.stringify(data));
        return data;
      } catch (error) {
        // 请求失败时使用本地缓存
        const cached = await AsyncStorage.getItem(CACHE_KEYS.TASKS);
        if (cached) {
          return JSON.parse(cached) as Task[];
        }
        throw error;
      }
    },
    networkMode: 'always',
  });
};

export const useCreateTask = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskData: Parameters<typeof TasksService.postTasks>[0]) => {
      return TasksService.postTasks(taskData);
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

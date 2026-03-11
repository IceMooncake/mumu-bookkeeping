import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TransactionsService, TasksService } from './generated';
import type { Transaction } from './generated/models/Transaction';
import type { Task } from './generated/models/Task';

// We export the generated interfaces for components
export type { Transaction, Task };

const CACHE_KEYS = {
  TRANSACTIONS: '@cache_transactions',
  TASKS: '@cache_tasks',
};

export const useTransactions = () => {
  return useQuery({
    queryKey: ['transactions'],
    queryFn: async () => {
      try {
        const data = await TransactionsService.getTransactions();
        // 联网成功，同步数据到本地进行缓存
        await AsyncStorage.setItem(CACHE_KEYS.TRANSACTIONS, JSON.stringify(data));
        return data;
      } catch (error) {
        // 请求失败（断网或服务器异常）时，尝试使用本地缓存数据
        const cached = await AsyncStorage.getItem(CACHE_KEYS.TRANSACTIONS);
        if (cached) {
          return JSON.parse(cached) as Transaction[];
        }
        throw error;
      }
    },
    // 将 networkMode 设置为 always，确保断网时 queryFn 依然执行进入 catch 逻辑读取缓存
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

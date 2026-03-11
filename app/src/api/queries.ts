import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TransactionsService, TasksService } from './generated';
// We export the generated interfaces for components
export type { Transaction } from './generated/models/Transaction';
export type { Task } from './generated/models/Task';

export const useTransactions = () => {
  return useQuery({
    queryKey: ['transactions'],
    queryFn: async () => {
      const data = await TransactionsService.getTransactions();
      return data;
    },
  });
};

export const useTasks = () => {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: async () => {
      const data = await TasksService.getTasks();
      return data;
    },
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

import { useQuery } from '@tanstack/react-query';
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

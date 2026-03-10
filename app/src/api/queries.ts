import { useQuery } from '@tanstack/react-query';
import { apiClient } from './client';

export interface Transaction {
  id: string;
  amount: number;
  type: 'EXPENSE' | 'INCOME';
  category: string;
  merchant?: string;
  remark?: string;
  date: string;
}

export interface Task {
  id: string;
  name: string;
  description?: string;
  cronExpression?: string;
  isActive: boolean;
}

export const useTransactions = () => {
  return useQuery({
    queryKey: ['transactions'],
    queryFn: async () => {
      const { data } = await apiClient.get<Transaction[]>('/transactions');
      return data;
    },
  });
};

export const useTasks = () => {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: async () => {
      const { data } = await apiClient.get<Task[]>('/tasks');
      return data;
    },
  });
};

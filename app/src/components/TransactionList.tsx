import React from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { useTransactions, Transaction } from '../api/queries';

export const TransactionList = () => {
  const { data, isLoading, isError } = useTransactions();

  if (isLoading) return <ActivityIndicator style={styles.center} color="#3b82f6" />;
  if (isError) return <Text style={styles.error}>加载账单失败</Text>;
  if (!data || data.length === 0) return <Text style={styles.empty}>暂无账单数据</Text>;

  const renderItem = ({ item }: { item: Transaction }) => {
    const isExpense = item.type === 'EXPENSE';
    const amountStr = isExpense ? `-¥${Math.abs(item.amount)}` : `+¥${item.amount}`;

    return (
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.category}>{item.category}</Text>
          <Text style={[styles.amount, { color: isExpense ? '#ef4444' : '#10b981' }]}>
            {amountStr}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.merchant}>{item.merchant || '未记录商户'}</Text>
          <Text style={styles.date}>{new Date(item.date).toLocaleDateString()}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>最新流水</Text>
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  center: {
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#1f2937',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  category: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
  amount: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  merchant: {
    fontSize: 14,
    color: '#6b7280',
  },
  date: {
    fontSize: 12,
    color: '#9ca3af',
  },
  error: {
    color: '#ef4444',
    textAlign: 'center',
    padding: 20,
  },
  empty: {
    color: '#6b7280',
    textAlign: 'center',
    padding: 20,
  },
});

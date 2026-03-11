import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, ScrollView } from 'react-native';
import { useTransactions, useBooks, Transaction } from '../api/queries';

export const TransactionList = () => {
  const [selectedBookId, setSelectedBookId] = useState<string | undefined>(undefined);
  
  const { data: books, isLoading: isLoadingBooks } = useBooks();
  const { data: transactions, isLoading: isLoadingTxs, isError } = useTransactions(selectedBookId);

  React.useEffect(() => {
    if (books && books.length > 0 && !selectedBookId) {
      const defaultBook = books.find(b => b.isDefault) || books[0];
      setSelectedBookId(defaultBook.id);
    }
  }, [books, selectedBookId]);

  const activeBook = books?.find(b => b.id === selectedBookId);

  const renderItem = ({ item }: { item: Transaction }) => {
    const isExpense = item.type === 'EXPENSE';
    const amountStr = isExpense ? `-${Math.abs(item.amount)}` : `+${item.amount}`;
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
      <View style={styles.header}>
        <Text style={styles.title}>账本流水</Text>
        {activeBook && (
          <Text style={[styles.balanceText, { color: (activeBook.balance || 0) < 0 ? '#ef4444' : '#10b981' }]}>
            结余: ￥{(activeBook.balance || 0).toFixed(2)}
          </Text>
        )}
      </View>

      {isLoadingBooks ? (
        <ActivityIndicator style={styles.center} color="#3b82f6" />
      ) : books && books.length > 0 ? (
        <View style={styles.bookSelector}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {books.map(book => (
              <TouchableOpacity
                key={book.id}
                style={[styles.bookTab, selectedBookId === book.id && styles.bookTabActive]}
                onPress={() => setSelectedBookId(book.id)}
              >
                <Text style={[styles.bookTabText, selectedBookId === book.id && styles.bookTabTextActive]}>
                  {book.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ) : (
        <Text style={styles.empty}>请先创建一个账本</Text>
      )}

      {books && books.length > 0 && (isLoadingTxs ? (
        <ActivityIndicator style={styles.center} color="#3b82f6" />
      ) : isError ? (
        <Text style={styles.error}>加载账单失败</Text>
      ) : (!transactions || transactions.length === 0) ? (
        <Text style={styles.empty}>当前账本暂无金额变动明细</Text>
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  balanceText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  bookSelector: {
    marginBottom: 12,
  },
  bookTab: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#e5e7eb',
    marginRight: 8,
  },
  bookTabActive: {
    backgroundColor: '#8b5cf6',
  },
  bookTabText: {
    fontSize: 14,
    color: '#374151',
  },
  bookTabTextActive: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  center: {
    padding: 20,
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

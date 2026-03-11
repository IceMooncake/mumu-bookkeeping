import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, ScrollView, Modal, TextInput, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTransactions, useBooks, Transaction } from '../api/queries';
import { TransactionsService } from '../api/generated';
import { CalendarHeatmap } from './CalendarHeatmap';
import { useSettings } from '../contexts/SettingsContext';

const formatDateTime = (date: Date) => {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const TransactionList = () => {
  const [selectedBookId, setSelectedBookId] = useState<string | undefined>(undefined);
  const [modalVisible, setModalVisible] = useState(false);
  
  // Form State
  const [type, setType] = useState<'EXPENSE' | 'INCOME'>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [remark, setRemark] = useState('');
  const [dateStr, setDateStr] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());

  const queryClient = useQueryClient();
  const { data: books, isLoading: isLoadingBooks } = useBooks();
  const { data: transactions, isLoading: isLoadingTxs, isError } = useTransactions(selectedBookId);
  const { heatmapBasis } = useSettings();

  const filteredTransactions = useMemo(() => {
    if (!transactions) return [];
    const dateStr = formatDateTime(selectedDate).split(' ')[0];
    return transactions.filter(t => t.date.startsWith(dateStr));
  }, [transactions, selectedDate]);

  React.useEffect(() => {
    if (books && books.length > 0 && !selectedBookId) {
      const defaultBook = books.find(b => b.isDefault) || books[0];
      setSelectedBookId(defaultBook.id);
    }
  }, [books, selectedBookId]);

  const activeBook = books?.find(b => b.id === selectedBookId);

  const handleSubmit = async () => {
    if (!amount || isNaN(Number(amount))) {
      Alert.alert('提示', '请输入有效的金额');
      return;
    }
    if (!category.trim()) {
      Alert.alert('提示', '请输入分类');
      return;
    }
    if (!selectedBookId) {
      Alert.alert('提示', '请先选择账本');
      return;
    }

    const parsedDate = new Date(dateStr.replace(' ', 'T') + ':00');
    if (isNaN(parsedDate.getTime())) {
      Alert.alert('提示', '请输入有效的日期格式 (YYYY-MM-DD HH:mm)');
      return;
    }

    try {
      setIsSubmitting(true);
      await TransactionsService.postTransactions({
        amount: Number(amount),
        type,
        category,
        merchant: null,
        remark: remark.trim() || null,
        payMethod: null,
        bookId: selectedBookId,
        date: parsedDate.toISOString(),
      });

      // Reset form
      setType('EXPENSE');
      setAmount('');
      setCategory('');
      setRemark('');
      setDateStr('');
      setModalVisible(false);

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['books'] });
    } catch (error: any) {
      Alert.alert('错误', error.message || '记账失败');
    } finally {
      setIsSubmitting(false);
    }
  };

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
          <Text style={styles.date}>{formatDateTime(new Date(item.date))}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>账本流水</Text>
        <View style={styles.headerRight}>
          {activeBook && (
            <Text style={[styles.balanceText, { color: (activeBook.balance || 0) < 0 ? '#ef4444' : '#10b981' }]}>
              结余: ￥{(activeBook.balance || 0).toFixed(2)}
            </Text>
          )}
          {activeBook && (
            <TouchableOpacity style={styles.recordBtn} onPress={() => {
              // Create a date utilizing selectedDate's YYYY-MM-DD but current time HH:mm
              const now = new Date();
              const newD = new Date(selectedDate);
              newD.setHours(now.getHours());
              newD.setMinutes(now.getMinutes());
              setDateStr(formatDateTime(newD));
              setModalVisible(true);
            }}>
              <Text style={styles.recordBtnText}>+ 记一笔</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView 
          style={styles.modalOverlay} 
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>记一笔</Text>
            
            <View style={styles.typeSelector}>
              <TouchableOpacity 
                style={[styles.typeBtn, type === 'EXPENSE' && styles.typeBtnActiveExpense]}
                onPress={() => setType('EXPENSE')}
              >
                <Text style={[styles.typeBtnText, type === 'EXPENSE' && styles.typeBtnTextActive]}>支出</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.typeBtn, type === 'INCOME' && styles.typeBtnActiveIncome]}
                onPress={() => setType('INCOME')}
              >
                <Text style={[styles.typeBtnText, type === 'INCOME' && styles.typeBtnTextActive]}>收入</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.input}
              placeholder="金额 (例如: 100)"
              keyboardType="numeric"
              value={amount}
              onChangeText={setAmount}
            />

            <TextInput
              style={styles.input}
              placeholder="日期时间 (YYYY-MM-DD HH:mm)"
              value={dateStr}
              onChangeText={setDateStr}
            />
            
            <TextInput
              style={styles.input}
              placeholder="分类 (例如: 餐饮)"
              value={category}
              onChangeText={setCategory}
            />

            <TextInput
              style={styles.input}
              placeholder="备注 (可选)"
              value={remark}
              onChangeText={setRemark}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity 
                style={[styles.btn, styles.cancelBtn]} 
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.cancelBtnText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.btn, styles.submitBtn, isSubmitting && styles.btnDisabled]} 
                onPress={handleSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitBtnText}>保存</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {isLoadingBooks ? (
        <ActivityIndicator style={styles.center} color="#3b82f6" />
      ) : books && books.length > 0 ? (
        <View>
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

          {transactions && (
            <CalendarHeatmap 
              transactions={transactions || []} 
              basis={heatmapBasis} 
              selectedDate={selectedDate} 
              onSelectDate={setSelectedDate} 
            />
          )}
        </View>
      ) : (
        <Text style={styles.empty}>请先创建一个账本</Text>
      )}

      {books && books.length > 0 && (isLoadingTxs ? (
        <ActivityIndicator style={styles.center} color="#3b82f6" />
      ) : isError ? (
        <Text style={styles.error}>加载账单失败</Text>
      ) : (!filteredTransactions || filteredTransactions.length === 0) ? (
        <Text style={styles.empty}>选定日期暂无流水明细</Text>
      ) : (
        <FlatList
          data={filteredTransactions}
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  balanceText: {
    fontSize: 16,
    fontWeight: 'bold',
    marginRight: 10,
  },
  recordBtn: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  recordBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
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
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  typeSelector: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  typeBtn: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
    marginHorizontal: 4,
    borderRadius: 8,
  },
  typeBtnActiveExpense: {
    backgroundColor: '#ef4444',
  },
  typeBtnActiveIncome: {
    backgroundColor: '#10b981',
  },
  typeBtnText: {
    color: '#374151',
    fontWeight: '600',
  },
  typeBtnTextActive: {
    color: '#ffffff',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  cancelBtn: {
    backgroundColor: '#e5e7eb',
  },
  cancelBtnText: {
    color: '#4b5563',
    fontWeight: 'bold',
    fontSize: 16,
  },
  submitBtn: {
    backgroundColor: '#3b82f6',
  },
  submitBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  btnDisabled: {
    opacity: 0.7,
  },
});

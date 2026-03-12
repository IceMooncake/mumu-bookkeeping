import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, ScrollView, Modal, TextInput, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { useTransactions, useBooks, useCreateTransaction, useUpdateTransaction, useDeleteTransaction, Transaction } from '../api/queries';
import { CalendarHeatmap } from './CalendarHeatmap';
import { useSettings } from '../contexts/SettingsContext';
import { useCategoryTags } from '../api/categoryTags';
import { queueBookOperation } from '../api/offlineSync';
import { CACHE_KEYS } from '../api/queries';

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
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [bookPromptVisible, setBookPromptVisible] = useState(false);
  const [bookPromptTitle, setBookPromptTitle] = useState('');
  const [bookPromptValue, setBookPromptValue] = useState('');
  const [bookPromptOnConfirm, setBookPromptOnConfirm] = useState<((val: string) => void) | null>(null);

  const queryClient = useQueryClient();
  const { data: books, isLoading: isLoadingBooks } = useBooks();
  const { data: transactions, isLoading: isLoadingTxs, isError } = useTransactions(selectedBookId);
  const { heatmapBasis } = useSettings();
  const { data: allTags } = useCategoryTags();
  const createTransactionMutation = useCreateTransaction();
  const updateTransactionMutation = useUpdateTransaction();
  const deleteTransactionMutation = useDeleteTransaction();

  const selectableTags = useMemo(
    () => (allTags || []).filter(tag => tag.type === type),
    [allTags, type]
  );

  const categoryTagMap = useMemo(() => {
    const map = new Map<string, { bgColor: string; textColor: string }>();
    (allTags || []).forEach(tag => {
      map.set(`${tag.type}:${tag.name}`, { bgColor: tag.bgColor, textColor: tag.textColor });
    });
    return map;
  }, [allTags]);

  const filteredTransactions = useMemo(() => {
    if (!transactions) return [];
    const selectedDateKey = formatDateTime(selectedDate).split(' ')[0];
    return transactions.filter(t => t.date.startsWith(selectedDateKey));
  }, [transactions, selectedDate]);

  React.useEffect(() => {
    if (books && books.length > 0 && (!selectedBookId || !books.some(b => b.id === selectedBookId))) {
      const defaultBook = books.find(b => b.isDefault) || books[0];
      setSelectedBookId(defaultBook.id);
    }
  }, [books, selectedBookId]);

  const activeBook = books?.find(b => b.id === selectedBookId);

  const setBooksAndPersist = async (updater: (old: any[]) => any[]) => {
    let nextBooks: any[] = [];
    queryClient.setQueryData(['books'], (old: any) => {
      nextBooks = updater(old || []);
      return nextBooks;
    });
    await AsyncStorage.setItem(CACHE_KEYS.BOOKS, JSON.stringify(nextBooks));
    return nextBooks;
  };

  const showBookPrompt = (title: string, defaultValue: string, onConfirm: (val: string) => void) => {
    setBookPromptTitle(title);
    setBookPromptValue(defaultValue);
    setBookPromptOnConfirm(() => onConfirm);
    setBookPromptVisible(true);
  };

  const handleCreateBook = () => {
    showBookPrompt('新建账本', '默认账本', async (name) => {
      const cleanName = name.trim();
      if (!cleanName) return;
      try {
        const tempId = `temp_book_${Date.now()}`;
        await queueBookOperation({ action: 'create', targetId: tempId, data: { name: cleanName } });
        await setBooksAndPersist(old => [
          {
            id: tempId,
            name: cleanName,
            balance: 0,
            isDefault: old.length === 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isPending: true,
          },
          ...old,
        ]);
        setSelectedBookId(tempId);
      } catch (error: any) {
        Alert.alert('创建失败', error?.message || '请稍后重试');
      }
    });
  };

  const handleRenameBook = (id: string, currentName: string) => {
    showBookPrompt('重命名账本', currentName, async (name) => {
      const cleanName = name.trim();
      if (!cleanName || cleanName === currentName) return;
      try {
        await queueBookOperation({ action: 'update', targetId: id, data: { name: cleanName } });
        await setBooksAndPersist(old =>
          old.map((book: any) =>
            book.id === id ? { ...book, name: cleanName, updatedAt: new Date().toISOString(), isPending: true } : book
          )
        );
      } catch (error: any) {
        Alert.alert('重命名失败', error?.message || '请稍后重试');
      }
    });
  };

  const handleDeleteBook = (id: string, name: string) => {
    if ((books?.length || 0) <= 1) {
      Alert.alert('提示', '至少保留一个账本，无法删除');
      return;
    }

    Alert.alert('确认删除', `确定删除账本 [${name}] 吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await queueBookOperation({ action: 'delete', targetId: id });
            const nextBooks = await setBooksAndPersist(old => old.filter((book: any) => book.id !== id));
            if (selectedBookId === id) {
              const fallback = nextBooks.find((book: any) => book.isDefault) || nextBooks[0];
              setSelectedBookId(fallback?.id);
            }
          } catch (error: any) {
            Alert.alert('删除失败', error?.message || '请稍后重试');
          }
        },
      },
    ]);
  };

  const handleBookLongPress = (book: any) => {
    const actions: Array<{ text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }> = [
      { text: '重命名', onPress: () => handleRenameBook(book.id, book.name) },
    ];

    if ((books?.length || 0) > 1) {
      actions.push({ text: '删除', style: 'destructive', onPress: () => handleDeleteBook(book.id, book.name) });
    }

    actions.push({ text: '取消', style: 'cancel' });
    Alert.alert(`账本操作: ${book.name}`, '请选择要执行的操作', actions);
  };

  const handleSubmit = async () => {
    if (!amount || isNaN(Number(amount))) {
      Alert.alert('提示', '请输入有效的金额');
      return;
    }
    if (!selectedBookId) {
      Alert.alert('提示', '请先选择账本');
      return;
    }

    const finalCategory = category.trim() || '未分类';

    const parsedDate = new Date(dateStr.replace(' ', 'T') + ':00');
    if (isNaN(parsedDate.getTime())) {
      Alert.alert('提示', '请输入有效的日期格式 (YYYY-MM-DD HH:mm)');
      return;
    }

    try {
      setIsSubmitting(true);
      if (editingTxId) {
        await updateTransactionMutation.mutateAsync({
          id: editingTxId,
          data: {
            amount: Number(amount),
            type,
            category: finalCategory,
            merchant: null,
            remark: remark.trim() || null,
            payMethod: null,
            bookId: selectedBookId,
            date: parsedDate.toISOString(),
          } as any,
        });
      } else {
        await createTransactionMutation.mutateAsync({
          amount: Number(amount),
          type,
          category: finalCategory,
          merchant: null,
          remark: remark.trim() || null,
          payMethod: null,
          bookId: selectedBookId,
          date: parsedDate.toISOString(),
        });
      }

      // Reset form
      setType('EXPENSE');
      setAmount('');
      setCategory('');
      setRemark('');
      setDateStr('');
      setEditingTxId(null);
      setModalVisible(false);
    } catch (error: any) {
      Alert.alert('错误', error.message || '记账失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderItem = ({ item }: { item: Transaction }) => {
    const isExpense = item.type === 'EXPENSE';
    const amountStr = isExpense ? `-${Math.abs(item.amount)}` : `+${item.amount}`;
    const tagStyle = categoryTagMap.get(`${item.type}:${item.category}`);
    return (
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.tagsInlineRow}>
            <View
              style={[
                styles.categoryTag,
                tagStyle
                  ? { backgroundColor: tagStyle.bgColor }
                  : styles.categoryTagDefault,
              ]}
            >
              <Text style={[styles.category, tagStyle ? { color: tagStyle.textColor } : undefined]}>{item.category}</Text>
            </View>
            {item.merchant ? (
              <View style={styles.merchantTag}>
                <Text style={styles.merchantTagText}>{item.merchant}</Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.amount, isExpense ? styles.amountExpense : styles.amountIncome]}>
            {amountStr}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.remark}>{item.remark?.trim() || ''}</Text>
          <Text style={styles.date}>{formatDateTime(new Date(item.date))}</Text>
        </View>
        <View style={styles.itemActionsRow}>
          <TouchableOpacity
            onPress={() => {
              setEditingTxId((item as any).id || (item as any)._offlineId || null);
              setType(item.type as 'EXPENSE' | 'INCOME');
              setAmount(String(item.amount));
              setCategory(item.category || '');
              setRemark(item.remark || '');
              setDateStr(formatDateTime(new Date(item.date)));
              setModalVisible(true);
            }}
          >
            <Text style={styles.actionTextEdit}>编辑</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              const txId = (item as any).id || (item as any)._offlineId;
              if (!txId) return;
              Alert.alert('确认删除', '确定删除这笔流水吗？', [
                { text: '取消', style: 'cancel' },
                {
                  text: '删除',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await deleteTransactionMutation.mutateAsync({ id: txId });
                    } catch (err: any) {
                      Alert.alert('删除失败', err?.message || '请稍后重试');
                    }
                  },
                },
              ]);
            }}
          >
            <Text style={styles.actionTextDelete}>删除</Text>
          </TouchableOpacity>
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
            <Text
              style={[
                styles.balanceText,
                (activeBook.balance || 0) < 0 ? styles.balanceNegative : styles.balancePositive,
              ]}
            >
              结余: ￥{(activeBook.balance || 0).toFixed(2)}
            </Text>
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
            <Text style={styles.modalTitle}>{editingTxId ? '编辑流水' : '记一笔'}</Text>
            
            <View style={styles.typeSelector}>
              <TouchableOpacity 
                style={[styles.typeBtn, type === 'EXPENSE' && styles.typeBtnActiveExpense]}
                onPress={() => {
                  setType('EXPENSE');
                  if (category && !((allTags || []).some(tag => tag.type === 'EXPENSE' && tag.name === category))) {
                    setCategory('');
                  }
                }}
              >
                <Text style={[styles.typeBtnText, type === 'EXPENSE' && styles.typeBtnTextActive]}>支出</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.typeBtn, type === 'INCOME' && styles.typeBtnActiveIncome]}
                onPress={() => {
                  setType('INCOME');
                  if (category && !((allTags || []).some(tag => tag.type === 'INCOME' && tag.name === category))) {
                    setCategory('');
                  }
                }}
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
            
            <View style={styles.tagSelectorWrap}>
              <Text style={styles.tagSelectorTitle}>选择标签</Text>
              <View style={styles.tagsGrid}>
                {selectableTags.length === 0 ? (
                  <Text style={styles.tagEmptyText}>暂无可用标签，请到设置中添加</Text>
                ) : (
                  selectableTags.map(tag => {
                    const isActive = category === tag.name;
                    return (
                      <TouchableOpacity
                        key={tag.localId}
                        onPress={() => setCategory(tag.name)}
                        style={[
                          styles.selectTag,
                          isActive ? styles.selectTagActiveBorder : styles.selectTagInactiveBorder,
                          {
                            backgroundColor: tag.bgColor,
                            transform: [{ scale: isActive ? 1.04 : 1 }],
                          },
                        ]}
                      >
                        <Text style={[styles.selectTagText, { color: tag.textColor }]}>{tag.name}</Text>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            </View>

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
          <View style={styles.bookSelectorRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bookSelectorScroll}>
              {books.map(book => (
                <TouchableOpacity
                  key={book.id}
                  style={[styles.bookTab, selectedBookId === book.id && styles.bookTabActive]}
                  onPress={() => setSelectedBookId(book.id)}
                  onLongPress={() => handleBookLongPress(book)}
                >
                  <Text style={[styles.bookTabText, selectedBookId === book.id && styles.bookTabTextActive]}>
                    {book.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.addBookMiniBtn} onPress={handleCreateBook}>
              <Text style={styles.addBookMiniBtnText}>+</Text>
            </TouchableOpacity>
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
          keyExtractor={(item, index) => item.id ? item.id.toString() : ((item as any)._offlineId || `temp_${index}`)}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
        />
      ))}

      {/* Floating Action Button */}
      {activeBook && (
        <TouchableOpacity 
          style={styles.floatingBtn} 
          onPress={() => {
            setEditingTxId(null);
            const now = new Date();
            const newD = new Date(selectedDate);
            newD.setHours(now.getHours());
            newD.setMinutes(now.getMinutes());
            setDateStr(formatDateTime(newD));
            setModalVisible(true);
          }}
        >
          <Text style={styles.floatingBtnText}>+</Text>
        </TouchableOpacity>
      )}

      <Modal visible={bookPromptVisible} transparent animationType="fade" onRequestClose={() => setBookPromptVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{bookPromptTitle}</Text>
            <TextInput
              style={styles.input}
              value={bookPromptValue}
              onChangeText={setBookPromptValue}
              placeholder="请输入账本名称"
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.btn, styles.cancelBtn]} onPress={() => setBookPromptVisible(false)}>
                <Text style={styles.cancelBtnText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.submitBtn]}
                onPress={() => {
                  setBookPromptVisible(false);
                  if (bookPromptOnConfirm) {
                    bookPromptOnConfirm(bookPromptValue);
                  }
                }}
              >
                <Text style={styles.submitBtnText}>确定</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  addBookMiniBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#8b5cf6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBookMiniBtnText: {
    color: '#fff',
    fontSize: 18,
    lineHeight: 20,
    fontWeight: '700',
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
  floatingBtn: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#3b82f6',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
  },
  floatingBtnText: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '300',
    lineHeight: 36,
  },
  bookSelectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  bookSelectorScroll: {
    flex: 1,
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
  tagsInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    paddingRight: 10,
  },
  itemActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
    marginTop: 6,
  },
  actionTextEdit: {
    color: '#2563eb',
    fontSize: 13,
    fontWeight: '700',
  },
  actionTextDelete: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '700',
  },
  category: {
    fontSize: 14,
    fontWeight: '700',
  },
  categoryTag: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  categoryTagDefault: {
    backgroundColor: '#f3f4f6',
  },
  amount: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  amountExpense: {
    color: '#ef4444',
  },
  amountIncome: {
    color: '#10b981',
  },
  merchantTag: {
    borderRadius: 999,
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  merchantTagText: {
    fontSize: 12,
    color: '#4338ca',
    fontWeight: '600',
  },
  remark: {
    fontSize: 13,
    color: '#64748b',
    flex: 1,
    paddingRight: 8,
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
  tagSelectorWrap: {
    marginBottom: 16,
  },
  tagSelectorTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
  },
  tagsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  selectTag: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1.5,
  },
  selectTagActiveBorder: {
    borderColor: '#111827',
  },
  selectTagInactiveBorder: {
    borderColor: 'transparent',
  },
  selectTagText: {
    fontSize: 13,
    fontWeight: '700',
  },
  tagEmptyText: {
    color: '#94a3b8',
    fontSize: 13,
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
  balanceNegative: {
    color: '#ef4444',
  },
  balancePositive: {
    color: '#10b981',
  },
  btnDisabled: {
    opacity: 0.7,
  },
});

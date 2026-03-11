import React, { useEffect, useState } from 'react';
import { SafeAreaView, StatusBar, StyleSheet, View, Text, TouchableOpacity, Alert, Switch, ScrollView, TextInput, Modal } from 'react-native';
import { QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import Toast from 'react-native-toast-message';
import { TransactionList } from './src/components/TransactionList';
import { TaskList } from './src/components/TaskList';
import { MumuAccessibilityService } from './src/api/accessibility';
import { TransactionsService, BooksService } from './src/api/generated';
import { addTransactionToOfflineQueue, syncOfflineTransactions } from './src/api/offlineSync';

const queryClient = new QueryClient();

function AccessibilityController({ visible }: { visible?: boolean }) {
  const [isEnabled, setIsEnabled] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [, setSyncing] = useState(false);

  // 网络状态监听与离线同步机制
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      if (state.isInternetReachable === null) return;
      
      const offline = !(state.isConnected && state.isInternetReachable);
      setIsOffline(prevOffline => {
        if (offline && !prevOffline) {
          Toast.show({
            type: 'error',
            text1: '网络连接已断开',
            text2: '当前处于离线模式，记账转为本地队列',
            position: 'top',
          });
        }
        return offline;
      });
      
      // 如果从离线恢复到在线，触发后台数据同步
      if (!offline) {
        handleSync();
      }
    });
    return () => unsubscribe();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    Toast.show({
      type: 'info',
      text1: '网络恢复',
      text2: '正在同步本地积压账单...',
      position: 'top',
    });
    const syncedCount = await syncOfflineTransactions();
    if (syncedCount > 0) {
      // 同步完成后刷新账单和账本列表
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['books'] });
      Toast.show({
        type: 'success',
        text1: '同步完成',
        text2: `已将 ${syncedCount} 笔离线账单同步至云端。`,
        position: 'top',
      });
    }
    setSyncing(false);
  };

  // 记录账单的 mutation（改造成支持离线排队）
  const recordMutation = useMutation({
    mutationFn: async (data: any) => {
      if (isOffline) {
        // 如果断网，写入本地队列
        await addTransactionToOfflineQueue({ ...data, date: new Date().toISOString(), remark: (data.remark || '') + ' [离线]' });
        return { offline: true };
      } else {
        // 在线则直接提交到后端
        return await TransactionsService.postTransactions(data);
      }
    },
    onSuccess: (res: any) => {
      if (!res?.offline) {
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
        queryClient.invalidateQueries({ queryKey: ['books'] });
      } else {
        Alert.alert("已离线记账", "暂无网络，由于您处于离线模式，该账单已暂存在本机。\n网络恢复后将自动同步。");
      }
    }
  });

  const checkStatus = async () => {
    const status = await MumuAccessibilityService.isEnabled();
    setIsEnabled(status);
  };

  useEffect(() => {
    checkStatus();
    
    // 定时检查状态（作为兜底）
    const interval = setInterval(checkStatus, 3000);

    // 监听无障碍扫屏事件
    const removeListener = MumuAccessibilityService.addListener((eventName, data) => {
      console.log('Received event from native:', eventName, data);
      
      if (eventName === 'SERVICE_CONNECTED') {
        setIsEnabled(true);
      } else if (eventName === 'SERVICE_DISCONNECTED') {
        setIsEnabled(false);
      } else if (eventName === 'SCREEN_DATA') {
        try {
          if (data.includes('支付成功') || data.includes('交易成功')) {
            const amountMatch = data.match(/(?:￥|¥)\s*(\d+\.\d{2})/);
            
            if (amountMatch && amountMatch[1]) {
              const amount = parseFloat(amountMatch[1]);
              let merchant = "未知商户";
              
              if (data.includes('美团')) merchant = '美团';
              else if (data.includes('滴滴')) merchant = '滴滴出行';
              
              // 自动发起新建账单请求（内部已封装离网处理）
              recordMutation.mutate({
                amount: amount,
                type: 'EXPENSE',
                category: '自动抓取',
                merchant: merchant,
                remark: '无障碍自动记账',
              });
            }
          }
        } catch (err) {
          console.error('Failed to parse screen data', err);
        }
      }
    });

    return () => {
      clearInterval(interval);
      removeListener();
    };
  }, [isOffline, recordMutation]);

  if (!visible) return null;

  const toggleSwitch = (val: boolean) => {
    if (val && !isEnabled) {
      MumuAccessibilityService.openSettings();
    }
  };

  return (
    <View style={styles.settingsSection}>
      <Text style={styles.settingsGroupTitle}>核心功能</Text>
      <View style={styles.a11yContainer}>
        <View style={styles.a11yTextWrapper}>
          <Text style={styles.a11yText}>自动记账服务</Text>
          <Text style={styles.a11ySubText}>开启无障碍后，可监控屏幕支付成功页面自动记账</Text>
        </View>
        <Switch
          trackColor={{ false: '#d1d5db', true: '#c4b5fd' }}
          thumbColor={isEnabled ? '#8b5cf6' : '#f3f4f6'}
          onValueChange={toggleSwitch}
          value={isEnabled}
        />
      </View>
    </View>
  );
}

function BooksTab() {
  const { data: books } = useQuery({
    queryKey: ['books'],
    queryFn: () => BooksService.getBooks()
  });

  const [promptVisible, setPromptVisible] = useState(false);
  const [promptTitle, setPromptTitle] = useState('');
  const [promptDefaultValue, setPromptDefaultValue] = useState('');
  const [promptValue, setPromptValue] = useState('');
  const [promptOnConfirm, setPromptOnConfirm] = useState<((val: string) => void) | null>(null);

  const showPrompt = (title: string, defaultValue: string, onConfirm: (val: string) => void) => {
    setPromptTitle(title);
    setPromptDefaultValue(defaultValue);
    setPromptValue(defaultValue);
    setPromptOnConfirm(() => onConfirm);
    setPromptVisible(true);
  };

  const handleCreateBook = () => {
    showPrompt('新建账本', '默认账本', async (name: string) => {
      try {
        await BooksService.postBooks({ name });
        queryClient.invalidateQueries({ queryKey: ['books'] });
        Toast.show({ type: 'success', text1: '创建成功', text2: `账本 [${name}] 已添加` });
      } catch(e: any) {
        Toast.show({ type: 'error', text1: '创建失败', text2: e.message });
      }
    });
  };

  const handleRenameBook = (id: string, currentName: string) => {
    showPrompt('重命名账本', currentName, async (newName: string) => {
      if (newName !== currentName) {
        try {
          await BooksService.putBooks(id, { name: newName });
          queryClient.invalidateQueries({ queryKey: ['books'] });
          Toast.show({ type: 'success', text1: '重命名成功', text2: `账本已重命名为 [${newName}]` });
        } catch(e: any) {
          Toast.show({ type: 'error', text1: '重命名失败', text2: e.message });
        }
      }
    });
  };

  const handleDeleteBook = (id: string, name: string) => {
    Alert.alert(
      '确认删除',
      `确定要删除账本 [${name}] 吗？此操作不可逆！`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
             // @ts-ignore
            try {
              // @ts-ignore
              await BooksService.deleteBooks(id);
              queryClient.invalidateQueries({ queryKey: ['books'] });
              Toast.show({ type: 'success', text1: '删除成功', text2: `账本 [${name}] 已删除` });
            } catch (e: any) {
              Toast.show({ type: 'error', text1: '删除失败', text2: e.message });
            }
          }
        }
      ]
    );
  };

  const handleSetDefault = async (id: string) => {
    try {
      await BooksService.putBooks(id, { isDefault: true });
      queryClient.invalidateQueries({ queryKey: ['books'] });
      Toast.show({ type: 'success', text1: '设置成功', text2: `已切换账本` });
    } catch(e: any) {
      Toast.show({ type: 'error', text1: '设置失败', text2: e.message });
    }
  };

  return (
    <View style={styles.booksWrapper}>
      <View style={styles.booksHeader}>
        <Text style={styles.booksTitle}>账本管理</Text>
        <TouchableOpacity style={styles.addBookBtn} onPress={handleCreateBook}>
          <Text style={styles.addBookBtnText}>新增</Text>
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.booksList}>
        {books?.map((book: any) => (
          <TouchableOpacity 
            key={book.id} 
            style={[styles.bookItem, book.isDefault && styles.bookItemActive]}
            onPress={() => !book.isDefault && handleSetDefault(book.id)}
            onLongPress={() => handleRenameBook(book.id, book.name)}
          >
            <View>
              <Text style={[styles.bookName, book.isDefault && styles.bookNameActive]}>
                {book.name} {book.isDefault ? '(当前使用)' : ''}
              </Text>
              <Text style={styles.bookBalance}>余额: ¥{book.balance}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity onPress={() => handleRenameBook(book.id, book.name)} style={{ marginRight: 12 }}>
                <Text style={styles.renameText}>重命名</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleDeleteBook(book.id, book.name)}>
                <Text style={[styles.renameText, { color: '#ef4444' }]}>删除</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        ))}
        { /* Bottom padding to prevent last item being cut off */ }
        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal visible={promptVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{promptTitle}</Text>
            <TextInput
              style={styles.modalInput}
              value={promptValue}
              onChangeText={setPromptValue}
              placeholder="请输入"
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalBtn} onPress={() => setPromptVisible(false)}>
                <Text style={styles.modalBtnText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalBtn, { borderLeftWidth: 1, borderColor: '#e5e7eb' }]} 
                onPress={() => {
                  setPromptVisible(false);
                  if (promptValue && promptOnConfirm) {
                    promptOnConfirm(promptValue);
                  }
                }}
              >
                <Text style={[styles.modalBtnText, { color: '#3b82f6', fontWeight: 'bold' }]}>确定</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function App(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<'transactions' | 'sandbox' | 'books' | 'settings'>('transactions');

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="#f3f4f6" />
        
        {/* 全局监听（不含UI） */}
        <AccessibilityController visible={false} />

        <View style={styles.content}>
          {activeTab === 'transactions' && (
            <View style={styles.section}>
              <TransactionList />
            </View>
          )}

          {activeTab === 'sandbox' && (
            <View style={[styles.section, styles.borderTop]}>
              <TaskList />
            </View>
          )}

          {activeTab === 'books' && (
            <View style={[styles.section, styles.borderTop]}>
              <BooksTab />
            </View>
          )}

          {activeTab === 'settings' && (
            <View style={styles.settingsWrapper}>
              {/* 设置项 UI 控制 */}
              <AccessibilityController visible={true} />
              
              <View style={styles.settingsContent}>
                <Text style={styles.settingsHint}>更多设置功能开发中...</Text>
              </View>
            </View>
          )}
        </View>

        {/* 底部导航栏 */}
        <View style={styles.tabBar}>
          <TouchableOpacity 
            style={styles.tabItem} 
            onPress={() => setActiveTab('transactions')}
          >
            <Text style={[styles.tabText, activeTab === 'transactions' && styles.tabTextActive]}>流水</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.tabItem} 
            onPress={() => setActiveTab('sandbox')}
          >
            <Text style={[styles.tabText, activeTab === 'sandbox' && styles.tabTextActive]}>沙箱</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.tabItem} 
            onPress={() => setActiveTab('books')}
          >
            <Text style={[styles.tabText, activeTab === 'books' && styles.tabTextActive]}>账本</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.tabItem} 
            onPress={() => setActiveTab('settings')}
          >
            <Text style={[styles.tabText, activeTab === 'settings' && styles.tabTextActive]}>设置</Text>
          </TouchableOpacity>
        </View>

        <Toast />
      </SafeAreaView>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  content: {
    flex: 1,
  },
  section: {
    flex: 1,
  },
  borderTop: {
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
  },
  settingsWrapper: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  settingsSection: {
    marginVertical: 12,
  },
  settingsGroupTitle: {
    fontSize: 13,
    color: '#6b7280',
    marginLeft: 16,
    marginBottom: 8,
    marginTop: 8,
  },
  settingsContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsHint: {
    color: '#9ca3af',
    fontSize: 14,
  },
  tabBar: {
    flexDirection: 'row',
    height: 56,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#8b5cf6',
    fontWeight: 'bold',
  },
  a11yContainer: {
    padding: 16,
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  a11yTextWrapper: {
    flex: 1,
    paddingRight: 16,
  },
  a11yText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
  },
  a11ySubText: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4,
  },
  addBookBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#8b5cf6',
    borderRadius: 8,
  },
  addBookBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  booksWrapper: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  booksHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  booksTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
  },
  booksList: {
    flex: 1,
    padding: 16,
  },
  bookItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  bookItemActive: {
    borderColor: '#8b5cf6',
    backgroundColor: '#f5f3ff',
  },
  bookName: {
    fontSize: 16,
    color: '#111827',
    fontWeight: '500',
    marginBottom: 4,
  },
  bookNameActive: {
    color: '#8b5cf6',
  },
  bookBalance: {
    fontSize: 14,
    color: '#6b7280',
  },
  renameText: {
    color: '#8b5cf6',
    fontSize: 14,
    padding: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '80%',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingTop: 20,
    overflow: 'hidden',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 16,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    marginHorizontal: 20,
    marginBottom: 20,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#111827',
  },
  modalActions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderColor: '#e5e7eb',
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnText: {
    fontSize: 16,
    color: '#4b5563',
  },
});

export default App;

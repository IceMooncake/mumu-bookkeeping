import React, { useEffect, useState } from 'react';
import { SafeAreaView, StatusBar, StyleSheet, View, Text, TouchableOpacity, Switch, ScrollView, Platform } from 'react-native';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { TransactionList } from './src/components/TransactionList';
import { TaskList } from './src/components/TaskList';
import { CategorySettings } from './src/components/CategorySettings';
import { MumuAccessibilityService } from './src/api/accessibility';
import { addTransactionToOfflineQueue, startHeartbeat, stopHeartbeat } from './src/api/offlineSync';
import { SettingsProvider, useSettings } from './src/contexts/SettingsContext';

const queryClient = new QueryClient();

function AccessibilityController({ visible }: { visible?: boolean }) {
  const [isEnabled, setIsEnabled] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  // 心跳机制与离线同步机制
  useEffect(() => {
    startHeartbeat((onlineStatus) => {
      const offline = !onlineStatus;
      setIsOffline((prevOffline) => {
        if (offline && !prevOffline) {
          Toast.show({
            type: 'error',
            text1: '服务不可达',
            text2: '切换至离线本地模式，记账转为本地队列',
            position: 'top',
          });
        } else if (!offline && prevOffline) {
          // 仅做状态切换提示，具体同步交由心跳的 onSyncComplete 处理
          Toast.show({
            type: 'info',
            text1: '网络恢复',
            text2: '后台将自动同步本地积压账单...',
            position: 'top',
          });
        }
        return offline;
      });
    }, (syncedCount) => {
      // 每次后台同步完成后的回调
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['books'] });
      if (syncedCount > 0) {
        Toast.show({
          type: 'success',
          text1: '后台同步完成',
          text2: `已静默将 ${syncedCount} 笔本地账单同步至云端。`,
          position: 'top',
        });
      }
    }, () => {
      queryClient.invalidateQueries({ queryKey: ['category-tags'] });
    }, () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['books'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['category-tags'] });
    });

    return () => stopHeartbeat();
  }, []);

  // 记录账单的 mutation（改造成完全本地优先）
  const recordMutation = useMutation({
    mutationFn: async (data: any) => {
      // 所有的流水请求直接进入本地队列缓存，而不是先尝试网络请求
      const offlineRes = await addTransactionToOfflineQueue({ ...data, date: new Date().toISOString(), remark: (data.remark || '') + ' [无障碍自动记账]' });
      return { offline: true, ...offlineRes };
    },
    onMutate: async (newTx: any) => {
      await queryClient.cancelQueries({ queryKey: ['transactions'] });
      const previousTxs = queryClient.getQueryData(['transactions']) || [];
      queryClient.setQueryData(['transactions'], (old: any) => [
        { ...newTx, id: 'temp_' + Date.now(), isPending: true },
        ...(old || [])
      ]);
      return { previousTxs };
    },
    onError: (_err, _newTx, context: any) => {
      queryClient.setQueryData(['transactions'], context?.previousTxs);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['books'] });
    },
    onSuccess: (_res: any) => {
      Toast.show({
        type: 'success',
        text1: '自动记账成功',
        text2: '已加入本地队列等待同步',
        position: 'top',
      });
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

function SettingsTab() {
  const { heatmapBasis, setHeatmapBasis } = useSettings();

  return (
    <ScrollView style={styles.settingsWrapper} contentContainerStyle={{ paddingBottom: 36 }}>
      {/* 设置项 UI 控制 */}
      <AccessibilityController visible={true} />
      
      <View style={styles.settingsSection}>
        <Text style={styles.settingsGroupTitle}>日历热力图依据</Text>
        <View style={styles.a11yContainer}>
          <TouchableOpacity 
            style={{flex: 1, paddingVertical: 12, flexDirection: 'row', alignItems: 'center'}}
            onPress={() => setHeatmapBasis('count')}
          >
            <Text style={[styles.a11yText, { flex: 1 }]}>按照流水笔数</Text>
            {heatmapBasis === 'count' && <Text style={{color: '#8b5cf6', fontSize: 16}}>✓</Text>}
          </TouchableOpacity>
        </View>
        <View style={[styles.a11yContainer, { borderTopWidth: 0 }]}>
          <TouchableOpacity 
            style={{flex: 1, paddingVertical: 12, flexDirection: 'row', alignItems: 'center'}}
            onPress={() => setHeatmapBasis('amount')}
          >
            <Text style={[styles.a11yText, { flex: 1 }]}>按照金额</Text>
            {heatmapBasis === 'amount' && <Text style={{color: '#8b5cf6', fontSize: 16}}>✓</Text>}
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.settingsSection}>
        <Text style={styles.settingsGroupTitle}>标签偏好</Text>
        <CategorySettings />
      </View>
    </ScrollView>
  );
}

function App(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<'transactions' | 'sandbox' | 'settings'>('transactions');

  return (
    <SettingsProvider>
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

          {activeTab === 'settings' && (
            <SettingsTab />
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
            onPress={() => setActiveTab('settings')}
          >
            <Text style={[styles.tabText, activeTab === 'settings' && styles.tabTextActive]}>设置</Text>
          </TouchableOpacity>
        </View>

        <Toast />
      </SafeAreaView>
      </QueryClientProvider>
    </SettingsProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
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

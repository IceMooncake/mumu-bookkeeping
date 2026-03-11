import React, { useEffect, useState } from 'react';
import { SafeAreaView, StatusBar, StyleSheet, View, Text, TouchableOpacity, Alert, Switch } from 'react-native';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import Toast from 'react-native-toast-message';
import { TransactionList } from './src/components/TransactionList';
import { TaskList } from './src/components/TaskList';
import { MumuAccessibilityService } from './src/api/accessibility';
import { TransactionsService } from './src/api/generated';
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
      // 同步完成后刷新账单列表
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
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

function App(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<'transactions' | 'sandbox' | 'settings'>('transactions');

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
});

export default App;

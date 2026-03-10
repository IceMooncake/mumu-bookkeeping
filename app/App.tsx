import React, { useEffect, useState } from 'react';
import { SafeAreaView, StatusBar, StyleSheet, View, Text, TouchableOpacity, Alert } from 'react-native';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { TransactionList } from './src/components/TransactionList';
import { TaskList } from './src/components/TaskList';
import { MumuAccessibilityService } from './src/api/accessibility';
import { apiClient } from './src/api/client';
import { addTransactionToOfflineQueue, syncOfflineTransactions } from './src/api/offlineSync';

const queryClient = new QueryClient();

function AccessibilityController() {
  const [isEnabled, setIsEnabled] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // 网络状态监听与离线同步机制
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      const offline = !(state.isConnected && state.isInternetReachable !== false);
      setIsOffline(offline);
      
      // 如果从离线恢复到在线，触发后台数据同步
      if (!offline) {
        handleSync();
      }
    });
    return () => unsubscribe();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    const syncedCount = await syncOfflineTransactions();
    if (syncedCount > 0) {
      // 同步完成后刷新账单列表
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      // Alert.alert('同步完成', `已将 ${syncedCount} 笔离线账单同步至云端。`);
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
        return await apiClient.post('/transactions', data);
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

  return (
    <View>
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>当前处于离线模式，任务引擎部分禁用，记账已转为本地队列！</Text>
        </View>
      )}
      {syncing && (
        <View style={[styles.offlineBanner, { backgroundColor: '#3b82f6' }]}>
          <Text style={styles.offlineText}>网络恢复，正在同步本地积压账单...</Text>
        </View>
      )}
      <View style={styles.a11yContainer}>
        <Text style={styles.a11yText}>
          自动记账扫描: <Text style={{ color: isEnabled ? '#10b981' : '#ef4444' }}>{isEnabled ? '运行中' : '未开启'}</Text>
        </Text>
        {!isEnabled && (
          <TouchableOpacity style={styles.btn} onPress={MumuAccessibilityService.openSettings}>
            <Text style={styles.btnText}>去开启权限</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function App(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="#f3f4f6" />
        
        {/* 控制面板 */}
        <AccessibilityController />

        {/* 上半部分：流水展示 */}
        <View style={styles.section}>
          <TransactionList />
        </View>

        {/* 下半部分：沙箱任务展示 */}
        <View style={[styles.section, styles.borderTop]}>
          <TaskList />
        </View>

      </SafeAreaView>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  section: {
    flex: 1,
  },
  borderTop: {
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
  },
  offlineBanner: {
    backgroundColor: '#ef4444',
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  a11yContainer: {
    padding: 16,
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  a11yText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#374151',
  },
  btn: {
    backgroundColor: '#8b5cf6',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  btnText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  }
});

export default App;

import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from './client';

const OFFLINE_TX_QUEUE = '@offline_tx_queue';

/**
 * 将一笔账单数据存入本地离线队列
 */
export async function addTransactionToOfflineQueue(txData: any) {
  try {
    const queueStr = await AsyncStorage.getItem(OFFLINE_TX_QUEUE);
    const queue = queueStr ? JSON.parse(queueStr) : [];
    // 增加一个离线时生成的临时ID标识
    queue.push({ ...txData, _offlineId: Date.now().toString() });
    await AsyncStorage.setItem(OFFLINE_TX_QUEUE, JSON.stringify(queue));
  } catch (e) {
    console.error('Failed to save offline tx', e);
  }
}

/**
 * 获取离线队列中的账单
 */
export async function getOfflineQueue() {
  try {
    const queueStr = await AsyncStorage.getItem(OFFLINE_TX_QUEUE);
    return queueStr ? JSON.parse(queueStr) : [];
  } catch (e) {
    return [];
  }
}

/**
 * 执行网络同步，将积压的离线账单推送到服务器
 */
export async function syncOfflineTransactions() {
  const queue = await getOfflineQueue();
  if (queue.length === 0) return 0;

  console.log(`[Sync] Found ${queue.length} offline transactions, syncing...`);
  
  let successCount = 0;
  let remainingQueue = [];

  for (const tx of queue) {
    try {
      // 剔除离线标识
      const { _offlineId, ...payload } = tx;
      await apiClient.post('/transactions', payload);
      successCount++;
    } catch (e) {
      console.error(`[Sync] Failed to sync transaction: ${tx._offlineId}`, e);
      // 同步失败的保留在队列中接续重试
      remainingQueue.push(tx);
    }
  }

  await AsyncStorage.setItem(OFFLINE_TX_QUEUE, JSON.stringify(remainingQueue));
  return successCount;
}

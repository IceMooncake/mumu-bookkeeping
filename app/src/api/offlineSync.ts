import AsyncStorage from '@react-native-async-storage/async-storage';
import { TransactionsService, OpenAPI } from './generated';
import Toast from 'react-native-toast-message';
import { pullRemoteCategoriesToLocal, syncPendingCategoryOps } from './categoryTags';

const OFFLINE_TX_QUEUE = '@offline_tx_queue';
const IS_OFFLINE_KEY = '@app_is_offline';

let isOnlineInternal = true;
let heartbeatInterval: any = null;

export const setOnlineStatus = (status: boolean) => {
  isOnlineInternal = status;
};

export const getOnlineStatus = () => isOnlineInternal;

/**
 * Starts a heartbeat check to ping the server.
 */
export function startHeartbeat(
  onStatusChange: (isOnline: boolean) => void,
  onSyncComplete?: (count: number) => void,
  onCategorySyncComplete?: (count: number) => void,
) {
  const checkHeartbeat = async () => {
    try {
      // Very basic endpoint to test server reachable.
      // Use health check endpoint so we don't rely on openapi.json
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 2000); // 2 seconds timeout for heartbeat
      const response = await fetch(`${OpenAPI.BASE || 'http://localhost:3000/api'}/health`, {
        signal: controller.signal,
      }).catch(() => null);
      clearTimeout(id);
      
      const newStatus = !!response && response.ok;
      if (newStatus !== isOnlineInternal) {
        isOnlineInternal = newStatus;
        onStatusChange(newStatus);
      }
      
      // 每次心跳（只要是在线状态），都尝试清空缓存队列并与后端进行同步
      if (newStatus) {
        const syncedTxCount = await syncOfflineTransactions();
        const syncedCategoryCount = await syncPendingCategoryOps();
        await pullRemoteCategoriesToLocal();

        if (syncedTxCount > 0 && onSyncComplete) {
          onSyncComplete(syncedTxCount);
        }
        if (onCategorySyncComplete) {
         onCategorySyncComplete(syncedCategoryCount);
        }
      }
    } catch (e) {
      if (isOnlineInternal) {
        isOnlineInternal = false;
        onStatusChange(false);
      }
    }
  };

  // Run immediately then poll
  checkHeartbeat();
  heartbeatInterval = setInterval(checkHeartbeat, 5000); // 5 sec heartbeat
}

export function stopHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
}

/**
 * Save mutation directly to a local queue. Returns a temporary mock object to use for optimistic UI updates.
 */
export async function addTransactionToOfflineQueue(txData: any) {
  try {
    const queueStr = await AsyncStorage.getItem(OFFLINE_TX_QUEUE);
    const queue = queueStr ? JSON.parse(queueStr) : [];
    
    const offlineItem = {
      ...txData,
      _offlineId: 'temp_' + Date.now().toString(),
      _syncStatus: 'pending' // pending, syncing, error
    };
    
    queue.push(offlineItem);
    await AsyncStorage.setItem(OFFLINE_TX_QUEUE, JSON.stringify(queue));
    return offlineItem;
  } catch (e) {
    console.error('Failed to save offline tx', e);
    return null;
  }
}

export async function getOfflineQueue() {
  try {
    const queueStr = await AsyncStorage.getItem(OFFLINE_TX_QUEUE);
    return queueStr ? JSON.parse(queueStr) : [];
  } catch {
    return [];
  }
}

let isSyncing = false;

export async function syncOfflineTransactions() {
  if (!getOnlineStatus() || isSyncing) return 0;
  
  isSyncing = true;
  try {
    const queue = await getOfflineQueue();
    if (queue.length === 0) return 0;

    console.log(`[Sync] Found ${queue.length} offline transactions, syncing...`);

    let successCount = 0;
    let remainingQueue = [];

    for (const tx of queue) {
      try {
        const payload = { ...tx };
        delete payload._offlineId;
        delete payload._syncStatus;
        await TransactionsService.postTransactions(payload);
        successCount++;
      } catch (e) {
        console.error(`[Sync] Failed to sync transaction: ${tx._offlineId}`, e);
        remainingQueue.push(tx);
      }
    }

    await AsyncStorage.setItem(OFFLINE_TX_QUEUE, JSON.stringify(remainingQueue));
    return successCount;
  } finally {
    isSyncing = false;
  }
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OpenAPI } from './generated';

export type CategoryTagType = 'EXPENSE' | 'INCOME';

export interface CategoryTag {
  localId: string;
  remoteId?: string;
  name: string;
  type: CategoryTagType;
  bgColor: string;
  textColor: string;
  updatedAt: string;
}

interface PendingTagOp {
  id: string;
  action: 'create' | 'delete';
  payload: {
    localId: string;
    remoteId?: string;
    name: string;
    type: CategoryTagType;
    bgColor: string;
    textColor: string;
  };
  createdAt: string;
}

interface RemoteCategory {
  id: string;
  name: string;
  type: CategoryTagType;
  color?: string;
  bgColor?: string;
  textColor?: string;
  updatedAt?: string;
}

const STORAGE_KEYS = {
  TAGS: '@category_tags_v1',
  OPS: '@category_tag_ops_v1',
};

const HEX_COLOR_RE = /^#([0-9A-F]{6})$/i;

const DEFAULT_TAGS: CategoryTag[] = [
  { localId: 'default_expense_food', name: '餐饮', type: 'EXPENSE', bgColor: '#FFD8A8', textColor: '#7C2D12', updatedAt: new Date().toISOString() },
  { localId: 'default_expense_transport', name: '交通', type: 'EXPENSE', bgColor: '#C7E9FF', textColor: '#0C4A6E', updatedAt: new Date().toISOString() },
  { localId: 'default_expense_shopping', name: '购物', type: 'EXPENSE', bgColor: '#FDE2E4', textColor: '#9F1239', updatedAt: new Date().toISOString() },
  { localId: 'default_income_salary', name: '工资', type: 'INCOME', bgColor: '#C7F9CC', textColor: '#14532D', updatedAt: new Date().toISOString() },
  { localId: 'default_income_bonus', name: '奖金', type: 'INCOME', bgColor: '#E9D5FF', textColor: '#581C87', updatedAt: new Date().toISOString() },
];

const getApiBase = () => {
  if (OpenAPI.BASE && OpenAPI.BASE.startsWith('http')) {
    return OpenAPI.BASE;
  }
  return 'http://localhost:3000/api';
};

const normalizeHexColor = (input: string, fallback: string) => {
  const value = (input || '').trim().toUpperCase();
  if (HEX_COLOR_RE.test(value)) return value;
  return fallback;
};

const safeJsonParse = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const toLocalTagFromRemote = (remote: RemoteCategory): CategoryTag => {
  const bgColor = normalizeHexColor(remote.bgColor || remote.color || '#E5E7EB', '#E5E7EB');
  const textColor = normalizeHexColor(remote.textColor || '#111827', '#111827');
  return {
    localId: `remote_${remote.id}`,
    remoteId: remote.id,
    name: remote.name,
    type: remote.type,
    bgColor,
    textColor,
    updatedAt: remote.updatedAt || new Date().toISOString(),
  };
};

const getLocalTags = async (): Promise<CategoryTag[]> => {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.TAGS);
  if (raw !== null) {
    const parsed = safeJsonParse<CategoryTag[]>(raw, []);
    return parsed;
  }

  await AsyncStorage.setItem(STORAGE_KEYS.TAGS, JSON.stringify(DEFAULT_TAGS));
  return DEFAULT_TAGS;
};

const saveLocalTags = async (tags: CategoryTag[]) => {
  await AsyncStorage.setItem(STORAGE_KEYS.TAGS, JSON.stringify(tags));
};

const getPendingOps = async (): Promise<PendingTagOp[]> => {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.OPS);
  return safeJsonParse<PendingTagOp[]>(raw, []);
};

const savePendingOps = async (ops: PendingTagOp[]) => {
  await AsyncStorage.setItem(STORAGE_KEYS.OPS, JSON.stringify(ops));
};

const addPendingOp = async (op: PendingTagOp) => {
  const ops = await getPendingOps();
  ops.push(op);
  await savePendingOps(ops);
};

export const listCategoryTags = async (type?: CategoryTagType) => {
  const tags = await getLocalTags();
  return tags
    .filter(t => (type ? t.type === type : true))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
};

export const createCategoryTagLocal = async (input: {
  name: string;
  type: CategoryTagType;
  bgColor: string;
  textColor: string;
}) => {
  const name = input.name.trim();
  if (!name) {
    throw new Error('标签名不能为空');
  }

  const tags = await getLocalTags();
  const duplicated = tags.some(
    t => t.type === input.type && t.name.trim().toLowerCase() === name.toLowerCase()
  );
  if (duplicated) {
    throw new Error('同类型下标签名已存在');
  }

  const tag: CategoryTag = {
    localId: `local_${Date.now()}`,
    name,
    type: input.type,
    bgColor: normalizeHexColor(input.bgColor, '#E5E7EB'),
    textColor: normalizeHexColor(input.textColor, '#111827'),
    updatedAt: new Date().toISOString(),
  };

  const nextTags = [...tags, tag];
  await saveLocalTags(nextTags);

  await addPendingOp({
    id: `op_create_${Date.now()}`,
    action: 'create',
    payload: {
      localId: tag.localId,
      name: tag.name,
      type: tag.type,
      bgColor: tag.bgColor,
      textColor: tag.textColor,
    },
    createdAt: new Date().toISOString(),
  });

  return tag;
};

export const deleteCategoryTagLocal = async (localId: string) => {
  const tags = await getLocalTags();
  const target = tags.find(t => t.localId === localId);
  if (!target) return;

  const nextTags = tags.filter(t => t.localId !== localId);
  await saveLocalTags(nextTags);

  const ops = await getPendingOps();
  const pendingCreateIndex = ops.findIndex(
    op => op.action === 'create' && op.payload.localId === localId
  );

  if (pendingCreateIndex >= 0) {
    ops.splice(pendingCreateIndex, 1);
    await savePendingOps(ops);
    return;
  }

  if (!target.remoteId) {
    return;
  }

  await addPendingOp({
    id: `op_delete_${Date.now()}`,
    action: 'delete',
    payload: {
      localId: target.localId,
      remoteId: target.remoteId,
      name: target.name,
      type: target.type,
      bgColor: target.bgColor,
      textColor: target.textColor,
    },
    createdAt: new Date().toISOString(),
  });
};

const fetchRemoteCategories = async (): Promise<RemoteCategory[]> => {
  const response = await fetch(`${getApiBase()}/categories`);
  if (!response.ok) {
    throw new Error('获取远程标签失败');
  }
  return (await response.json()) as RemoteCategory[];
};

export const syncPendingCategoryOps = async () => {
  const ops = await getPendingOps();
  if (ops.length === 0) return 0;

  let tags = await getLocalTags();
  const remainingOps: PendingTagOp[] = [];
  let successCount = 0;

  for (const op of ops) {
    try {
      if (op.action === 'create') {
        const response = await fetch(`${getApiBase()}/categories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: op.payload.name,
            type: op.payload.type,
            bgColor: op.payload.bgColor,
            textColor: op.payload.textColor,
            color: op.payload.bgColor,
          }),
        });

        if (!response.ok) {
          throw new Error('创建远程标签失败');
        }

        const remote = (await response.json()) as RemoteCategory;
        tags = tags.map(tag => {
          if (tag.localId !== op.payload.localId) return tag;
          return {
            ...tag,
            remoteId: remote.id,
            localId: `remote_${remote.id}`,
            bgColor: normalizeHexColor(remote.bgColor || remote.color || tag.bgColor, tag.bgColor),
            textColor: normalizeHexColor(remote.textColor || tag.textColor, tag.textColor),
            updatedAt: remote.updatedAt || new Date().toISOString(),
          };
        });
        successCount += 1;
      } else {
        const remoteId = op.payload.remoteId;
        if (remoteId) {
          const response = await fetch(`${getApiBase()}/categories/${remoteId}`, {
            method: 'DELETE',
          });
          if (!response.ok && response.status !== 404) {
            throw new Error('删除远程标签失败');
          }
          successCount += 1;
        }
      }
    } catch {
      remainingOps.push(op);
    }
  }

  await saveLocalTags(tags);
  await savePendingOps(remainingOps);
  return successCount;
};

export const pullRemoteCategoriesToLocal = async () => {
  const remote = await fetchRemoteCategories();
  const remoteLocal = remote.map(toLocalTagFromRemote);

  const local = await getLocalTags();
  const ops = await getPendingOps();
  const pendingCreateIds = new Set(
    ops.filter(op => op.action === 'create').map(op => op.payload.localId)
  );

  const unsyncedLocalCreates = local.filter(tag => pendingCreateIds.has(tag.localId));
  const merged = [...remoteLocal, ...unsyncedLocalCreates];

  await saveLocalTags(merged);
  return merged;
};

export const useCategoryTags = (type?: CategoryTagType) => {
  return useQuery({
    queryKey: ['category-tags', type],
    queryFn: () => listCategoryTags(type),
    staleTime: 1000,
  });
};

export const useCreateCategoryTag = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createCategoryTagLocal,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['category-tags'] });
    },
  });
};

export const useDeleteCategoryTag = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteCategoryTagLocal,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['category-tags'] });
    },
  });
};

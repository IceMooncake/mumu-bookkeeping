import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { useTasks, useRunTask, Task } from '../api/queries';
import { TaskEditor } from './TaskEditor';

export const TaskList = () => {
  const { data, isLoading, isError } = useTasks();
  const runTaskMutation = useRunTask();
  const [editorVisible, setEditorVisible] = useState(false);

  const handleRun = (id: string) => {
    runTaskMutation.mutate(id, {
      onSuccess: (res: any) => {
        Alert.alert('执行成功', res?.output || '任务已成功运行');
      },
      onError: (err) => {
        Alert.alert('执行失败', String(err));
      }
    });
  };

  const renderItem = ({ item }: { item: Task }) => {
    return (
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.name}>{item.name}</Text>
          <View style={[styles.badge, { backgroundColor: item.isActive ? '#10b981' : '#d1d5db' }]}>
            <Text style={styles.badgeText}>{item.isActive ? '运行中' : '已停用'}</Text>
          </View>
        </View>
        {item.description ? <Text style={styles.desc}>{item.description}</Text> : null}
        <View style={styles.footer}>
          <Text style={styles.cron}>
            Cron: {item.cronExpression ? item.cronExpression : '手动触发'}
          </Text>
          <TouchableOpacity 
            style={styles.runBtn} 
            onPress={() => handleRun(item.id)}
            disabled={runTaskMutation.isPending}
          >
            <Text style={styles.runBtnText}>立即执行</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (isLoading) return <ActivityIndicator style={styles.center} color="#8b5cf6" />;
  if (isError) return <Text style={styles.error}>加载任务失败</Text>;

  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>任务沙箱</Text>
        <TouchableOpacity onPress={() => setEditorVisible(true)} style={styles.addBtn}>
          <Text style={styles.addBtnText}>+ 写脚本</Text>
        </TouchableOpacity>
      </View>

      {(!data || data.length === 0) ? (
        <Text style={styles.empty}>暂无定制任务</Text>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item: any) => item.id}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
        />
      )}

      <TaskEditor 
        visible={editorVisible} 
        onClose={() => setEditorVisible(false)} 
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  center: {
    padding: 20,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  addBtn: {
    backgroundColor: '#8b5cf6',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addBtnText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#8b5cf6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
    color: '#374151',
  },
  desc: {
    fontSize: 14,
    color: '#4b5563',
    marginBottom: 8,
  },
  cron: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#8b5cf6',
    backgroundColor: '#f3f4f6',
    padding: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  runBtn: {
    backgroundColor: '#eff6ff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  runBtnText: {
    fontSize: 12,
    color: '#3b82f6',
    fontWeight: 'bold',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 10,
    color: '#ffffff',
    fontWeight: '600',
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

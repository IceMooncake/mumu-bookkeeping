import React from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { useTasks, Task } from '../api/queries';

export const TaskList = () => {
  const { data, isLoading, isError } = useTasks();

  if (isLoading) return <ActivityIndicator style={styles.center} color="#8b5cf6" />;
  if (isError) return <Text style={styles.error}>加载任务失败</Text>;
  if (!data || data.length === 0) return <Text style={styles.empty}>暂无定制任务</Text>;

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
        <Text style={styles.cron}>
          Cron: {item.cronExpression ? item.cronExpression : '手动触发'}
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>任务沙箱</Text>
      <FlatList
        data={data}
        keyExtractor={(item: any) => item.id}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
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
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#1f2937',
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
    alignSelf: 'flex-start',
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

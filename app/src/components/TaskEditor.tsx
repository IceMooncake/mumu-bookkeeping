import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Modal, Switch } from 'react-native';
import { useCreateTask } from '../api/queries';

interface TaskEditorProps {
  visible: boolean;
  onClose: () => void;
}

export const TaskEditor = ({ visible, onClose }: TaskEditorProps) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [cronExpression, setCronExpression] = useState('');
  const [script, setScript] = useState('// Your JS code here\n// Use db.addTransaction({ ... })');
  const [isActive, setIsActive] = useState(true);

  const createTaskMutation = useCreateTask();

  const handleSave = () => {
    if (!name || !script) return;
    createTaskMutation.mutate(
      {
        name,
        description: description || null,
        cronExpression: cronExpression || null,
        script,
        isActive,
      },
      {
        onSuccess: () => {
          // Reset form
          setName('');
          setDescription('');
          setCronExpression('');
          setScript('// Your JS code here\n// Use db.addTransaction({ ... })');
          setIsActive(true);
          onClose();
        },
      }
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet">
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.cancelText}>取消</Text>
          </TouchableOpacity>
          <Text style={styles.title}>新建任务任务</Text>
          <TouchableOpacity onPress={handleSave} disabled={createTaskMutation.isPending}>
            <Text style={[styles.saveText, createTaskMutation.isPending && styles.disabledText]}>
              {createTaskMutation.isPending ? '保存中...' : '保存'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.formContainer}>
          <Text style={styles.label}>任务名称*</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="例如: 每日自动记账"
          />

          <Text style={styles.label}>简短描述</Text>
          <TextInput
            style={styles.input}
            value={description}
            onChangeText={setDescription}
            placeholder="说明任务的作用"
          />

          <Text style={styles.label}>Cron 表达式 (可选)</Text>
          <TextInput
            style={styles.input}
            value={cronExpression}
            onChangeText={setCronExpression}
            placeholder="例如: 0 9 * * *"
          />

          <View style={styles.switchRow}>
            <Text style={styles.label}>是否启用</Text>
            <Switch value={isActive} onValueChange={setIsActive} />
          </View>

          <Text style={styles.label}>执行脚本 (JS 沙箱环境)*</Text>
          <TextInput
            style={styles.scriptInput}
            value={script}
            onChangeText={setScript}
            multiline
            textAlignVertical="top"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  cancelText: {
    fontSize: 16,
    color: '#6b7280',
  },
  saveText: {
    fontSize: 16,
    color: '#8b5cf6',
    fontWeight: 'bold',
  },
  disabledText: {
    opacity: 0.5,
  },
  formContainer: {
    padding: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4b5563',
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 8,
  },
  scriptInput: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: 'monospace',
    minHeight: 200,
  }
});
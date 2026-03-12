import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  ScrollView,
} from 'react-native';
import {
  CategoryTagType,
  useCategoryTags,
  useCreateCategoryTag,
  useDeleteCategoryTag,
} from '../api/categoryTags';

const BG_SWATCHES = [
  '#FFD8A8', '#FFE3E3', '#FDE2E4', '#E9D5FF', '#D8B4FE', '#C7E9FF',
  '#CFFAFE', '#C7F9CC', '#DCFCE7', '#FDE68A', '#FBCFE8', '#E5E7EB',
  '#FECACA', '#FED7AA', '#FDE68A', '#BBF7D0', '#A5F3FC', '#BFDBFE',
];

const TEXT_SWATCHES = [
  '#111827', '#1E293B', '#0F172A', '#334155', '#7C2D12', '#7F1D1D',
  '#9D174D', '#6D28D9', '#4338CA', '#0C4A6E', '#134E4A', '#14532D',
  '#065F46', '#92400E', '#F8FAFC', '#FFFFFF', '#DB2777', '#166534',
];

const HEX_COLOR_RE = /^#([0-9A-F]{6})$/i;

const toValidHex = (input: string, fallback: string) => {
  const value = (input || '').trim().toUpperCase();
  return HEX_COLOR_RE.test(value) ? value : fallback;
};

export const CategorySettings = () => {
  const { data: tags } = useCategoryTags();
  const createMutation = useCreateCategoryTag();
  const deleteMutation = useDeleteCategoryTag();

  const [activeType, setActiveType] = useState<CategoryTagType>('EXPENSE');
  const [modalVisible, setModalVisible] = useState(false);

  const [name, setName] = useState('');
  const [type, setType] = useState<CategoryTagType>('EXPENSE');
  const [bgColor, setBgColor] = useState('#FFD8A8');
  const [textColor, setTextColor] = useState('#7C2D12');

  const typeTags = useMemo(
    () => (tags || []).filter(tag => tag.type === activeType),
    [tags, activeType]
  );

  const openCreateModal = () => {
    setName('');
    setType(activeType);
    setBgColor('#FFD8A8');
    setTextColor('#7C2D12');
    setModalVisible(true);
  };

  const submitCreate = async () => {
    const finalName = name.trim();
    if (!finalName) {
      Alert.alert('提示', '请输入标签名');
      return;
    }

    try {
      await createMutation.mutateAsync({
        name: finalName,
        type,
        bgColor: toValidHex(bgColor, '#FFD8A8'),
        textColor: toValidHex(textColor, '#7C2D12'),
      });
      setModalVisible(false);
    } catch (error: any) {
      Alert.alert('新增失败', error?.message || '请稍后重试');
    }
  };

  const confirmDelete = (localId: string, displayName: string) => {
    Alert.alert('删除标签', `确定删除标签「${displayName}」吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMutation.mutateAsync(localId);
          } catch (error: any) {
            Alert.alert('删除失败', error?.message || '请稍后重试');
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.sectionWrap}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>标签管理</Text>
        <TouchableOpacity style={styles.addBtn} onPress={openCreateModal}>
          <Text style={styles.addBtnText}>+ 新标签</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.typeTabs}>
        <TouchableOpacity
          style={[styles.typeTab, activeType === 'EXPENSE' && styles.typeTabActiveExpense]}
          onPress={() => setActiveType('EXPENSE')}
        >
          <Text style={[styles.typeTabText, activeType === 'EXPENSE' && styles.typeTabTextActive]}>支出</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeTab, activeType === 'INCOME' && styles.typeTabActiveIncome]}
          onPress={() => setActiveType('INCOME')}
        >
          <Text style={[styles.typeTabText, activeType === 'INCOME' && styles.typeTabTextActive]}>收入</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tagsWrap}>
        {typeTags.length === 0 ? (
          <Text style={styles.emptyText}>暂无标签，点击右上角创建一个吧</Text>
        ) : (
          typeTags.map(tag => (
            <TouchableOpacity
              key={tag.localId}
              style={[styles.tagChip, { backgroundColor: tag.bgColor }]}
              onLongPress={() => confirmDelete(tag.localId, tag.name)}
              delayLongPress={220}
            >
              <Text style={[styles.tagText, { color: tag.textColor }]}>{tag.name}</Text>
            </TouchableOpacity>
          ))
        )}
      </View>

      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>创建标签</Text>

            <TextInput
              style={styles.input}
              placeholder="标签名（例如：奶茶）"
              value={name}
              onChangeText={setName}
            />

            <View style={styles.typeTabs}>
              <TouchableOpacity
                style={[styles.typeTab, type === 'EXPENSE' && styles.typeTabActiveExpense]}
                onPress={() => setType('EXPENSE')}
              >
                <Text style={[styles.typeTabText, type === 'EXPENSE' && styles.typeTabTextActive]}>支出标签</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.typeTab, type === 'INCOME' && styles.typeTabActiveIncome]}
                onPress={() => setType('INCOME')}
              >
                <Text style={[styles.typeTabText, type === 'INCOME' && styles.typeTabTextActive]}>收入标签</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.paletteArea}>
              <Text style={styles.pickerTitle}>背景色</Text>
              <View style={styles.swatchesWrap}>
                {BG_SWATCHES.map((color, index) => (
                  <TouchableOpacity
                    key={`bg_${index}_${color}`}
                    style={[styles.swatch, { backgroundColor: color }, bgColor.toUpperCase() === color && styles.swatchActive]}
                    onPress={() => setBgColor(color)}
                  />
                ))}
              </View>
              <TextInput
                style={styles.input}
                placeholder="#RRGGBB"
                value={bgColor}
                onChangeText={setBgColor}
                autoCapitalize="characters"
              />

              <Text style={styles.pickerTitle}>文字色</Text>
              <View style={styles.swatchesWrap}>
                {TEXT_SWATCHES.map((color, index) => (
                  <TouchableOpacity
                    key={`text_${index}_${color}`}
                    style={[styles.swatch, { backgroundColor: color }, textColor.toUpperCase() === color && styles.swatchActive]}
                    onPress={() => setTextColor(color)}
                  />
                ))}
              </View>
              <TextInput
                style={styles.input}
                placeholder="#RRGGBB"
                value={textColor}
                onChangeText={setTextColor}
                autoCapitalize="characters"
              />
            </ScrollView>

            <View style={styles.previewWrap}>
              <Text style={styles.previewTitle}>预览</Text>
              <View style={[styles.previewTag, { backgroundColor: toValidHex(bgColor, '#FFD8A8') }]}>
                <Text style={[styles.previewTagText, { color: toValidHex(textColor, '#7C2D12') }]}>
                  {name.trim() || '标签预览'}
                </Text>
              </View>
            </View>

            <View style={styles.actionsRow}>
              <TouchableOpacity style={[styles.actionBtn, styles.cancelBtn]} onPress={() => setModalVisible(false)}>
                <Text style={styles.cancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.confirmBtn]} onPress={submitCreate}>
                <Text style={styles.confirmText}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  sectionWrap: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 12,
    borderRadius: 16,
    padding: 12,
    paddingBottom: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 2,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    color: '#1F2937',
    fontWeight: '800',
  },
  addBtn: {
    backgroundColor: '#FDE68A',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  addBtnText: {
    color: '#92400E',
    fontSize: 12,
    fontWeight: '800',
  },
  typeTabs: {
    flexDirection: 'row',
    marginBottom: 10,
    gap: 8,
  },
  typeTab: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
  },
  typeTabActiveExpense: {
    backgroundColor: '#FECACA',
  },
  typeTabActiveIncome: {
    backgroundColor: '#BBF7D0',
  },
  typeTabText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  typeTabTextActive: {
    color: '#111827',
  },
  tagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    minHeight: 44,
  },
  tagChip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tagText: {
    fontSize: 13,
    fontWeight: '800',
  },
  tagDeleteHint: {
    fontSize: 14,
    fontWeight: '900',
    opacity: 0.72,
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 13,
    paddingVertical: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFFBEB',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: 32,
    maxHeight: '90%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#7C2D12',
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1F2937',
    marginBottom: 10,
  },
  paletteArea: {
    maxHeight: 290,
  },
  pickerTitle: {
    fontSize: 13,
    color: '#92400E',
    fontWeight: '800',
    marginBottom: 8,
  },
  swatchesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 10,
    paddingLeft: 4,
  },
  swatch: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  swatchActive: {
    borderColor: '#111827',
    borderWidth: 2,
    transform: [{ scale: 1.1 }],
  },
  previewWrap: {
    marginTop: 4,
    marginBottom: 12,
  },
  previewTitle: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 8,
  },
  previewTag: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  previewTagText: {
    fontSize: 13,
    fontWeight: '800',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 12,
  },
  cancelBtn: {
    backgroundColor: '#E2E8F0',
  },
  confirmBtn: {
    backgroundColor: '#F59E0B',
  },
  cancelText: {
    color: '#334155',
    fontWeight: '700',
    fontSize: 14,
  },
  confirmText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
});

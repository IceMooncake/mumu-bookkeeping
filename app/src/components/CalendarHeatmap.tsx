import React, { useMemo, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, Animated, PanResponder } from 'react-native';
import { Transaction } from '../api/queries';

interface CalendarHeatmapProps {
  transactions: Transaction[];
  basis: 'count' | 'amount';
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
}

function generatePalette(startColor: string, endColor: string, count: number) {
  const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16)
      } : null;
  };
  const rgbToHex = (r: number, g: number, b: number) => {
      return "#" + [r, g, b].map(x => {
          const hex = Math.round(x).toString(16);
          return hex.length === 1 ? "0" + hex : hex;
      }).join("");
  };

  const start = hexToRgb(startColor)!;
  const end = hexToRgb(endColor)!;
  const palette = [];
  for (let i = 0; i < count; i++) {
      const ratio = i / (count - 1 || 1);
      const r = start.r + (end.r - start.r) * ratio;
      const g = start.g + (end.g - start.g) * ratio;
      const b = start.b + (end.b - start.b) * ratio;
      
      palette.push(rgbToHex(r, g, b));
  }
  return palette;
}

const GREEN_PALETTE = generatePalette('#dcfce7', '#14532d', 256);
const RED_PALETTE = generatePalette('#fee2e2', '#7f1d1d', 256);
const GREEN_PALETTE_SHORT = generatePalette('#dcfce7', '#14532d', 20);
const RED_PALETTE_SHORT = generatePalette('#fee2e2', '#7f1d1d', 20);

const toDateString = (d: Date) => {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const CalendarHeatmap: React.FC<CalendarHeatmapProps> = ({ transactions, basis, selectedDate, onSelectDate }) => {
  const [expanded, setExpanded] = useState(false);

  const stats = useMemo(() => {
    const map = new Map<string, { count: number; netIncome: number }>();
    transactions.forEach(t => {
      // Local date parsing safe fallback
      const dateStr = t.date.split('T')[0];
      const entry = map.get(dateStr) || { count: 0, netIncome: 0 };
      entry.count += 1;
      entry.netIncome += (t.type === 'INCOME' ? t.amount : -t.amount);
      map.set(dateStr, entry);
    });
    return map;
  }, [transactions]);

  const getHeatmapColor = (dateStr: string) => {
    const stat = stats.get(dateStr);
    if (!stat) return '#f3f4f6'; // Empty gray
    
    let depth = 0;
    let maxLevels = 255;

    if (basis === 'count') {
      depth = stat.count; // 1 pen = +1
      maxLevels = 19;     // len=20 (index 0 to 19)
    } else {
      depth = Math.abs(stat.netIncome) / 5; // 5 yuan = +1
      maxLevels = 255;    // len=256 (index 0 to 255)
    }
    
    let colorIndex = Math.floor(depth);
    if (colorIndex < 1) colorIndex = 1;
    if (colorIndex > maxLevels) colorIndex = maxLevels;

    let palette;
    if (basis === 'count') {
      palette = stat.netIncome >= 0 ? GREEN_PALETTE_SHORT : RED_PALETTE_SHORT;
    } else {
      palette = stat.netIncome >= 0 ? GREEN_PALETTE : RED_PALETTE;
    }

    return palette[colorIndex];
  };

  // Generate days based on selection month (if expanded) or week (if collapsed)
  const days = useMemo(() => {
    const currentViewDate = selectedDate;
    const year = currentViewDate.getFullYear();
    const month = currentViewDate.getMonth();
    
    let result = [];
    
    if (expanded) {
      // Standard month view
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      
      const startOffset = (firstDay.getDay() + 6) % 7; // Making Monday = 0
      
      // Add prev month trailing days
      for (let i = startOffset - 1; i >= 0; i--) {
        result.push(new Date(year, month, -i));
      }
      // Add current month days
      for (let i = 1; i <= lastDay.getDate(); i++) {
        result.push(new Date(year, month, i));
      }
      // Add next month leading days to complete grid (42 cells max if necessary, or just rows of 7)
      const remaining = 7 - (result.length % 7);
      if (remaining < 7) {
        for (let i = 1; i <= remaining; i++) {
          result.push(new Date(year, month + 1, i));
        }
      }
    } else {
      // 1-Week view
      const currentDay = (currentViewDate.getDay() + 6) % 7; // Mon=0
      for (let i = 0; i < 7; i++) {
        const d = new Date(year, month, currentViewDate.getDate() - currentDay + i);
        result.push(d);
      }
    }
    return result;
  }, [selectedDate, expanded]);

  // Handle swipe left/right
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (e, gs) => Math.abs(gs.dx) > 20, // Only capture horizontal swipe
      onPanResponderRelease: (e, gs) => {
        if (gs.dx > 50) {
          // Swipe Right -> Prev Day
          const prev = new Date(selectedDate);
          prev.setDate(prev.getDate() - 1);
          onSelectDate(prev);
        } else if (gs.dx < -50) {
          // Swipe Left -> Next Day
          const next = new Date(selectedDate);
          next.setDate(next.getDate() + 1);
          onSelectDate(next);
        }
      }
    })
  ).current;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.monthText}>
          {selectedDate.getFullYear()}年{selectedDate.getMonth() + 1}月
        </Text>
        <TouchableOpacity onPress={() => setExpanded(!expanded)}>
          <Text style={styles.toggleText}>{expanded ? '收起' : '展开'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.weekDays}>
        {['一', '二', '三', '四', '五', '六', '日'].map(d => (
          <Text key={d} style={styles.weekDayText}>{d}</Text>
        ))}
      </View>

      <View {...panResponder.panHandlers} style={styles.grid}>
        {days.map((d, i) => {
          const ds = toDateString(d);
          const isSelected = toDateString(selectedDate) === ds;
          const isCurrentMonth = d.getMonth() === selectedDate.getMonth() || !expanded;
          
          return (
            <TouchableOpacity 
              key={ds + i} 
              style={styles.cellContainer}
              onPress={() => onSelectDate(d)}
            >
              <View style={[
                  styles.cell, 
                  { backgroundColor: getHeatmapColor(ds) },
                  isSelected && styles.cellSelected
                ]}>
                <Text style={[
                  styles.cellText,
                  !isCurrentMonth && styles.cellTextDimmed,
                  isSelected && styles.cellTextSelected
                ]}>
                  {d.getDate()}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  monthText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  toggleText: {
    fontSize: 14,
    color: '#8b5cf6',
  },
  weekDays: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  weekDayText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    color: '#6b7280',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cellContainer: {
    width: '14.28%',
    aspectRatio: 1,
    padding: 2,
  },
  cell: {
    flex: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellSelected: {
    borderWidth: 2,
    borderColor: '#3b82f6',
  },
  cellText: {
    fontSize: 14,
    color: '#374151',
  },
  cellTextDimmed: {
    opacity: 0.3,
  },
  cellTextSelected: {
    fontWeight: 'bold',
    color: '#1e3a8a',
  },
});

import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

type HeatmapBasis = 'count' | 'amount';

interface SettingsContextType {
  heatmapBasis: HeatmapBasis;
  setHeatmapBasis: (basis: HeatmapBasis) => void;
}

const SettingsContext = createContext<SettingsContextType>({
  heatmapBasis: 'count',
  setHeatmapBasis: () => {},
});

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [heatmapBasis, setHeatmapBasisState] = useState<HeatmapBasis>('count');

  useEffect(() => {
    AsyncStorage.getItem('settings_heatmap_basis').then(val => {
      if (val === 'count' || val === 'amount') {
        setHeatmapBasisState(val);
      }
    });
  }, []);

  const setHeatmapBasis = async (basis: HeatmapBasis) => {
    setHeatmapBasisState(basis);
    await AsyncStorage.setItem('settings_heatmap_basis', basis);
  };

  return (
    <SettingsContext.Provider value={{ heatmapBasis, setHeatmapBasis }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => useContext(SettingsContext);

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

const { MumuAccessibility } = NativeModules;
const accessibilityEmitter = new NativeEventEmitter(MumuAccessibility);

export const MumuAccessibilityService = {
  /**
   * 跳转到系统无障碍设置页面
   */
  openSettings: () => {
    if (Platform.OS === 'android') {
      MumuAccessibility.openAccessibilitySettings();
    }
  },

  /**
   * 检查是否已开启无障碍服务
   */
  isEnabled: async (): Promise<boolean> => {
    if (Platform.OS === 'android') {
      return await MumuAccessibility.isAccessibilityServiceEnabled();
    }
    return false;
  },

  /**
   * 监听无障碍事件
   * @param callback 接收识别到的屏幕文字
   * @returns 移除监听器的函数
   */
  addListener: (callback: (eventName: string, data: string) => void) => {
    if (Platform.OS !== 'android') return () => {};

    const subscription = accessibilityEmitter.addListener('MumuAccessibilityEvent', (eventStr: string) => {
      // 拆分自定义协议 "$eventName:::$data"
      const [eventName, ...rest] = eventStr.split(':::');
      const data = rest.join(':::');
      callback(eventName, data);
    });

    return () => subscription.remove();
  }
};

import axios from 'axios';
import { Platform } from 'react-native';

// Android 模拟器访问宿主机的 localhost 使用 10.0.2.2，iOS 模拟器直接使用 localhost 即可。
// 若使用真机调试，此处需换成您电脑的局域网 IP，如 'http://192.168.1.100:3000/api'
const defaultBaseURL = Platform.OS === 'android' ? 'http://10.0.2.2:3000/api' : 'http://localhost:3000/api';

export const apiClient = axios.create({
  baseURL: defaultBaseURL,
  timeout: 5000,
});

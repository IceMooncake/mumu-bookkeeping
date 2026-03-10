/**
 * @format
 */

import { AppRegistry, Platform } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { OpenAPI } from './src/api/generated';

// Global API configuration
const defaultBaseURL = Platform.OS === 'android' ? 'http://10.0.2.2:3000/api' : 'http://localhost:3000/api';
OpenAPI.BASE = defaultBaseURL;

AppRegistry.registerComponent(appName, () => App);

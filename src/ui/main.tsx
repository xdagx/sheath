import { render } from 'preact';
import { App } from './App';
import { applyCachedTheme } from './state';
import './styles.css';

applyCachedTheme();
document.documentElement.lang = navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
render(<App />, document.getElementById('app')!);

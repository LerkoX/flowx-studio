/** 读取当前生效主题（由 SystemPreferencesEffect 写入 <html data-theme>） */
export function getCurrentTheme(): 'dark' | 'light' {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

'use strict';

// ===== テーマ (ライト / ダーク) の切り替え =====
// OSの設定には追従せず、トグルボタンでのみ切り替える。

// ボタンに表示するラベル (切り替え先ではなく現在のテーマを表示)
const THEME_LABELS = { light: '☀', dark: '🌙' };
// 選択したテーマを保存する localStorage のキー
const THEME_STORAGE_KEY = 'musicPlayer.theme';

// 保存済みのテーマを読み出す (保存なし・読み出し不可ならライト)
function loadTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

// テーマを画面に反映する
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);

  // ボタンがあれば表示と押下状態を更新 (head 内で実行された時点ではまだ存在しない)
  const btn = document.getElementById('themeBtn');
  if (btn) {
    btn.textContent = THEME_LABELS[theme];
    btn.setAttribute('aria-pressed', String(theme === 'dark'));
  }
}

// 現在のテーマ
let currentTheme = loadTheme();

// ライト ⇔ ダークを切り替えて保存する
function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(currentTheme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, currentTheme);
  } catch {
    // 保存できない環境 (プライベートモード等) では今回の表示だけ切り替える
  }
}

// ページ描画前にテーマを適用 (ちらつき防止)
applyTheme(currentTheme);

// 画面の読み込み完了後にボタン表示とクリック処理を設定
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(currentTheme);
  document.getElementById('themeBtn').addEventListener('click', toggleTheme);
});

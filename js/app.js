'use strict';

// ===== 定数 =====

// 対応する拡張子の一覧
const SUPPORTED_EXTENSIONS = ['wav', 'mp3', 'ogg', 'flac', 'm4a'];

// ===== DOM要素の取得 =====
const audio = document.getElementById('audio');
const nowPlaying = document.getElementById('nowPlaying');
const seekBar = document.getElementById('seekBar');
const currentTimeLabel = document.getElementById('currentTime');
const durationLabel = document.getElementById('duration');
const playBtn = document.getElementById('playBtn');
const stopBtn = document.getElementById('stopBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const volumeBar = document.getElementById('volumeBar');
const volumeValue = document.getElementById('volumeValue');
const addBtn = document.getElementById('addBtn');
const clearBtn = document.getElementById('clearBtn');
const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const playlistEl = document.getElementById('playlist');
const emptyMessage = document.getElementById('emptyMessage');
const trackCount = document.getElementById('trackCount');

// ===== 状態 =====

// 再生リスト (1つのみ)。各要素は { id, name, url, duration }
let playlist = [];
// 現在選択中の曲のid (未選択なら null)
let currentId = null;
// 曲ごとに一意なidを振るためのカウンタ
let nextTrackId = 1;
// シークバーをドラッグ中かどうか (ドラッグ中は再生位置による更新を止める)
let isSeeking = false;
// 再生リスト内で並べ替えのためにドラッグ中の曲のid
let draggingId = null;

// ===== 音量制御 (Web Audio API) =====
// audio要素の volume は 0～1 までしか設定できないため、
// 100%を超える増幅には GainNode を使う。
// AudioContext はユーザー操作後でないと開始できないため、初回再生時に生成する。
let audioContext = null;
let gainNode = null;

// AudioContext と GainNode を (まだなければ) 準備する
function ensureAudioGraph() {
  if (audioContext) {
    // 一時停止状態なら再開する
    if (audioContext.state === 'suspended') audioContext.resume();
    return;
  }
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return; // 非対応ブラウザでは audio.volume のみで制御 (最大100%)
  audioContext = new AudioCtx();
  const source = audioContext.createMediaElementSource(audio);
  gainNode = audioContext.createGain();
  source.connect(gainNode).connect(audioContext.destination);
  applyVolume();
}

// 音量スライダーの値 (0～200) を実際の出力に反映する
function applyVolume() {
  const ratio = Number(volumeBar.value) / 100;
  volumeValue.textContent = `${volumeBar.value}%`;
  if (gainNode) {
    // GainNode があれば増幅率で制御し、audio要素側は等倍に固定
    audio.volume = 1;
    gainNode.gain.value = ratio;
  } else {
    // GainNode が無い場合は audio要素の音量 (上限1) で代用
    audio.volume = Math.min(ratio, 1);
  }
}

// ===== ユーティリティ =====

// 秒数を「分:秒」または「時:分:秒」形式の文字列に変換する
function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// ファイル名の拡張子から対応ファイルかどうかを判定する
function isSupportedFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(ext);
}

// idから再生リスト上の位置を求める
function indexOfTrack(id) {
  return playlist.findIndex((t) => t.id === id);
}

// ===== 再生リストの編集 =====

// ファイル群を再生リストの末尾に追加する
function addFiles(fileList) {
  const files = Array.from(fileList);
  const supported = files.filter(isSupportedFile);
  const rejected = files.length - supported.length;

  supported.forEach((file) => {
    const track = {
      id: nextTrackId++,
      name: file.name,
      url: URL.createObjectURL(file), // ローカルファイルを再生用URLに変換
      duration: null,
    };
    playlist.push(track);
    loadDuration(track);
  });

  // 対応外のファイルが含まれていた場合は通知する
  if (rejected > 0) {
    alert(`${rejected} 件のファイルは対応形式 (${SUPPORTED_EXTENSIONS.join(' / ')}) ではないため追加しませんでした。`);
  }

  renderPlaylist();
  updateControls();

  // 何も選択されていなければ最初に追加した曲を選択状態にする (自動再生はしない)
  if (currentId === null && supported.length > 0) {
    selectTrack(playlist[playlist.length - supported.length].id, false);
  }
}

// 曲の長さを事前に読み込み、再生リストに表示する
function loadDuration(track) {
  const probe = new Audio();
  probe.preload = 'metadata';
  probe.addEventListener('loadedmetadata', () => {
    track.duration = probe.duration;
    renderPlaylist();
    probe.removeAttribute('src'); // 読み込みを解放
  }, { once: true });
  probe.src = track.url;
}

// 指定した曲を再生リストから削除する
function removeTrack(id) {
  const index = indexOfTrack(id);
  if (index < 0) return;
  const [removed] = playlist.splice(index, 1);

  // 削除した曲が選択中だった場合は再生を止め、次の曲 (なければ前の曲) を選択する
  if (removed.id === currentId) {
    const wasPlaying = !audio.paused;
    resetPlayer();
    const fallback = playlist[index] || playlist[index - 1];
    if (fallback) selectTrack(fallback.id, wasPlaying);
  }

  URL.revokeObjectURL(removed.url); // 不要になったURLを解放
  renderPlaylist();
  updateControls();
}

// 再生リストをすべて削除する
function clearPlaylist() {
  if (playlist.length === 0) return;
  if (!confirm('再生リストをすべて削除しますか？')) return;
  resetPlayer();
  playlist.forEach((t) => URL.revokeObjectURL(t.url));
  playlist = [];
  renderPlaylist();
  updateControls();
}

// 曲の並び順を変更する (movingId の曲を targetId の曲の前へ。targetId が null なら末尾へ)
function moveTrack(movingId, targetId) {
  if (movingId === targetId) return;
  const from = indexOfTrack(movingId);
  if (from < 0) return;
  const [track] = playlist.splice(from, 1);
  const to = targetId === null ? playlist.length : indexOfTrack(targetId);
  playlist.splice(to < 0 ? playlist.length : to, 0, track);
  renderPlaylist();
  updateControls();
}

// ===== 再生リストの描画 =====

// 再生リストの内容を画面に描画し直す
function renderPlaylist() {
  playlistEl.innerHTML = '';

  playlist.forEach((track, i) => {
    const li = document.createElement('li');
    li.dataset.id = track.id;
    li.draggable = true; // 並べ替え用にドラッグ可能にする
    if (track.id === currentId) li.classList.add('active');

    // 曲番号
    const indexEl = document.createElement('span');
    indexEl.className = 'index';
    indexEl.textContent = track.id === currentId && !audio.paused ? '▶' : i + 1;

    // 曲名
    const nameEl = document.createElement('span');
    nameEl.className = 'name';
    nameEl.textContent = track.name;
    nameEl.title = track.name;

    // 曲の長さ
    const timeEl = document.createElement('span');
    timeEl.className = 'track-time';
    timeEl.textContent = track.duration === null ? '--:--' : formatTime(track.duration);

    // 削除ボタン
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove';
    removeBtn.title = '再生リストから削除';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // 行クリック (再生) を発火させない
      removeTrack(track.id);
    });

    li.append(indexEl, nameEl, timeEl, removeBtn);

    // 行のクリックでその曲を再生
    li.addEventListener('click', () => selectTrack(track.id, true));

    // --- 並べ替え用のドラッグ処理 ---
    li.addEventListener('dragstart', (e) => {
      draggingId = track.id;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(track.id));
    });
    li.addEventListener('dragend', () => {
      draggingId = null;
      li.classList.remove('dragging');
      clearDropTargets();
    });
    li.addEventListener('dragover', (e) => {
      if (draggingId === null) return; // 外部ファイルのドラッグはドロップ領域側で処理
      e.preventDefault();
      clearDropTargets();
      li.classList.add('drop-target');
    });
    li.addEventListener('drop', (e) => {
      if (draggingId === null) return;
      e.preventDefault();
      e.stopPropagation();
      moveTrack(draggingId, track.id);
    });

    playlistEl.appendChild(li);
  });

  // 件数表示と空メッセージの切り替え
  trackCount.textContent = `(${playlist.length})`;
  emptyMessage.hidden = playlist.length > 0;
}

// 並べ替え先の強調表示をすべて消す
function clearDropTargets() {
  playlistEl.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
}

// ===== 再生制御 =====

// 指定した曲を選択し、autoPlay が true なら再生を開始する
function selectTrack(id, autoPlay) {
  const track = playlist[indexOfTrack(id)];
  if (!track) return;

  if (currentId !== id) {
    currentId = id;
    audio.src = track.url;
    nowPlaying.textContent = track.name;
    seekBar.value = 0;
    currentTimeLabel.textContent = '0:00';
    durationLabel.textContent = formatTime(track.duration);
  } else {
    // 同じ曲が選ばれた場合は先頭から再生し直す
    audio.currentTime = 0;
  }

  if (autoPlay) play();
  renderPlaylist();
  updateControls();
}

// 再生を開始する
function play() {
  if (currentId === null) {
    // 未選択なら先頭の曲を選択して再生
    if (playlist.length > 0) selectTrack(playlist[0].id, true);
    return;
  }
  ensureAudioGraph();
  audio.play().catch((err) => {
    alert(`再生できませんでした: ${err.message}`);
  });
}

// 再生/一時停止を切り替える
function togglePlay() {
  if (audio.paused) play();
  else audio.pause();
}

// 停止して先頭に戻す
function stop() {
  audio.pause();
  if (currentId !== null) audio.currentTime = 0;
}

// 前の曲へ移動する (再生位置が3秒を超えていれば曲の先頭へ戻る)
function prevTrack() {
  const index = indexOfTrack(currentId);
  if (index < 0) return;
  if (audio.currentTime > 3 || index === 0) {
    audio.currentTime = 0;
    return;
  }
  selectTrack(playlist[index - 1].id, !audio.paused);
}

// 次の曲へ移動する。末尾なら何もしない
function nextTrack(autoPlay = !audio.paused) {
  const index = indexOfTrack(currentId);
  if (index < 0 || index >= playlist.length - 1) return false;
  selectTrack(playlist[index + 1].id, autoPlay);
  return true;
}

// プレーヤーを未選択状態に戻す
function resetPlayer() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  currentId = null;
  nowPlaying.textContent = '曲が選択されていません';
  seekBar.value = 0;
  seekBar.max = 0;
  currentTimeLabel.textContent = '0:00';
  durationLabel.textContent = '0:00';
}

// ボタンやシークバーの有効/無効と表示を更新する
function updateControls() {
  const index = indexOfTrack(currentId);
  const hasTrack = index >= 0;
  playBtn.disabled = playlist.length === 0;
  stopBtn.disabled = !hasTrack;
  prevBtn.disabled = !hasTrack;
  nextBtn.disabled = !hasTrack || index >= playlist.length - 1;
  seekBar.disabled = !hasTrack;
  clearBtn.disabled = playlist.length === 0;
  playBtn.textContent = audio.paused ? '▶' : '⏸';
}

// ===== audio要素のイベント =====

// 曲の長さが判明したらシークバーの範囲と表示を設定する
audio.addEventListener('loadedmetadata', () => {
  seekBar.max = audio.duration;
  durationLabel.textContent = formatTime(audio.duration);
});

// 再生位置が進むたびにシークバーと時間表示を更新する
audio.addEventListener('timeupdate', () => {
  if (isSeeking) return;
  seekBar.value = audio.currentTime;
  currentTimeLabel.textContent = formatTime(audio.currentTime);
});

// 再生/一時停止の状態が変わったらボタン表示と再生リストを更新する
audio.addEventListener('play', () => { updateControls(); renderPlaylist(); });
audio.addEventListener('pause', () => { updateControls(); renderPlaylist(); });

// 曲が終わったら次の曲を自動再生する
audio.addEventListener('ended', () => {
  nextTrack(true);
});

// 読み込みエラー (ブラウザが形式に非対応など) を通知する
audio.addEventListener('error', () => {
  if (!audio.getAttribute('src')) return; // リセット時のエラーは無視
  const track = playlist[indexOfTrack(currentId)];
  alert(`「${track ? track.name : ''}」を読み込めませんでした。このブラウザでは再生できない形式の可能性があります。`);
});

// ===== GUI操作のイベント =====

playBtn.addEventListener('click', togglePlay);
stopBtn.addEventListener('click', stop);
prevBtn.addEventListener('click', prevTrack);
nextBtn.addEventListener('click', () => nextTrack());

// シークバー操作中は表示だけ更新し、離したときに再生位置を確定する
seekBar.addEventListener('input', () => {
  isSeeking = true;
  currentTimeLabel.textContent = formatTime(Number(seekBar.value));
});
seekBar.addEventListener('change', () => {
  audio.currentTime = Number(seekBar.value);
  isSeeking = false;
});

// 音量スライダーの変更を反映する
volumeBar.addEventListener('input', applyVolume);

// 「ファイルを追加」ボタンでファイル選択ダイアログを開く
addBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = ''; // 同じファイルを再度選べるようにリセット
});

clearBtn.addEventListener('click', clearPlaylist);

// ===== 外部ファイルのドラッグ＆ドロップ =====

// ドラッグ中のデータがファイルかどうかを判定する
function isFileDrag(e) {
  return Array.from(e.dataTransfer.types).includes('Files');
}

dropZone.addEventListener('dragover', (e) => {
  if (draggingId !== null) {
    // 再生リスト内の並べ替え中に余白へ来た場合は末尾への移動として扱う
    e.preventDefault();
    return;
  }
  if (!isFileDrag(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', (e) => {
  // 子要素への移動では強調を解除しない
  if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (draggingId !== null) {
    // 並べ替え: 行以外の場所に落とされたら末尾へ移動
    moveTrack(draggingId, null);
    return;
  }
  addFiles(e.dataTransfer.files);
});

// ドロップ領域外にファイルを落としたときにブラウザがファイルを開いてしまうのを防ぐ
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// ===== キーボードショートカット =====

// シーク量 (秒) と音量の変化量 (%)
const SEEK_STEP = 5;
const SEEK_STEP_LARGE = 30;
const VOLUME_STEP = 5;
// ミュート解除時に戻す音量
let volumeBeforeMute = 100;

// 再生位置を指定秒数だけ前後に移動する
function seekBy(seconds) {
  if (currentId === null || !Number.isFinite(audio.duration)) return;
  audio.currentTime = Math.min(Math.max(audio.currentTime + seconds, 0), audio.duration);
}

// 音量を指定値 (0～200%) に設定する
function setVolume(value) {
  volumeBar.value = Math.min(Math.max(value, 0), 200);
  applyVolume();
}

// ミュートの切り替え (ミュート前の音量を覚えておき、解除時に戻す)
function toggleMute() {
  const current = Number(volumeBar.value);
  if (current > 0) {
    volumeBeforeMute = current;
    setVolume(0);
  } else {
    setVolume(volumeBeforeMute || 100);
  }
}

// 選択中の曲を再生リストから削除する
function removeCurrentTrack() {
  if (currentId !== null) removeTrack(currentId);
}

// キーとショートカット処理の対応表 (e.key で判定。英字は小文字化して比較)
const SHORTCUTS = {
  ' ': togglePlay,
  'k': togglePlay,
  's': stop,
  'n': () => nextTrack(),
  'p': prevTrack,
  'arrowright': (e) => seekBy(e.shiftKey ? SEEK_STEP_LARGE : SEEK_STEP),
  'arrowleft': (e) => seekBy(-(e.shiftKey ? SEEK_STEP_LARGE : SEEK_STEP)),
  'arrowup': () => setVolume(Number(volumeBar.value) + VOLUME_STEP),
  'arrowdown': () => setVolume(Number(volumeBar.value) - VOLUME_STEP),
  'm': toggleMute,
  'o': () => fileInput.click(),
  'delete': removeCurrentTrack,
  'home': () => seekBy(-Infinity),
  't': toggleTheme, // テーマ切替 (theme.js で定義)
};

// キー入力をショートカットとして処理すべきかどうかを判定する
function shouldHandleShortcut(e) {
  // Ctrl/Alt/Cmd との組み合わせはブラウザの操作を優先する
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  // IME 変換中は処理しない
  if (e.isComposing) return false;

  const el = document.activeElement;
  // スライダーにフォーカスがあるときの矢印キー等はスライダー本来の操作を優先する
  if (el && el.matches('input[type="range"]') &&
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
    return false;
  }
  // ボタンにフォーカスがあるときの Space/Enter はボタンの押下を優先する
  if (el && el.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return false;
  return true;
}

// ショートカットキーの受付
document.addEventListener('keydown', (e) => {
  if (!shouldHandleShortcut(e)) return;
  const action = SHORTCUTS[e.key.toLowerCase()];
  if (!action) return;
  e.preventDefault(); // スクロール等のブラウザ既定動作を止める
  action(e);
});

// ===== 初期化 =====
applyVolume();
renderPlaylist();
updateControls();

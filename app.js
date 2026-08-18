/**
 * app.js
 * Main Controller orchestrating UI interactions, video playback,
 * Gemini API calls, Timeline Editor, Subtitle sync, and Dubbing engine.
 */

document.addEventListener('DOMContentLoaded', () => {
  // ===================================================
  // 1. KHỞI TẠO CÁC ELEMENT VÀ TRẠNG THÁI TOÀN CỤC
  // ===================================================
  const video = document.getElementById('studio-video');
  const videoWrapper = document.getElementById('video-wrapper');
  const subtitleOverlay = document.getElementById('subtitle-overlay-container');
  const videoFileInput = document.getElementById('video-file-input');
  const emptyStatePlaceholder = document.getElementById('empty-video-placeholder');
  const dragOverlay = document.getElementById('video-drag-overlay');
  const browseBtnInner = document.getElementById('btn-browse-file-inner');
  const hardsubMaskBar = document.getElementById('hardsub-mask-bar');
  const duckingBadge = document.getElementById('ducking-indicator-badge');

  // Khởi tạo Engines
  const subtitleEngine = new SubtitleEngine(subtitleOverlay, hardsubMaskBar);
  const dubbingEngine = new DubbingEngine(video, (isDucking) => {
    if (duckingBadge) {
      if (isDucking) {
        duckingBadge.classList.remove('hidden');
        duckingBadge.classList.add('flex', 'ducking-active');
      } else {
        duckingBadge.classList.remove('ducking-active');
        duckingBadge.classList.add('hidden');
      }
    }
  });

  // State
  let currentFile = null;
  let currentSegments = [];
  let currentStep = 1; // 1: Upload, 2: AI Process, 3: Edit & Dub, 4: Export

  // Mapping mã ngôn ngữ sang chuẩn BCP 47 cho TTS
  const langCodeMap = {
    'Tiếng Việt': 'vi-VN',
    'English': 'en-US',
    'Tiếng Nhật (Japanese)': 'ja-JP',
    'Tiếng Hàn (Korean)': 'ko-KR',
    'Tiếng Trung (Chinese)': 'zh-CN',
    'Tiếng Pháp (French)': 'fr-FR',
    'Tiếng Đức (German)': 'de-DE',
    'Tiếng Tây Ban Nha (Spanish)': 'es-ES',
    'Tiếng Nga (Russian)': 'ru-RU',
    'Tiếng Thái (Thai)': 'th-TH'
  };

  // ===================================================
  // 2. HỆ THỐNG TOAST NOTIFICATION
  // ===================================================
  const toastContainer = document.getElementById('toast-container');
  function showToast(message, type = 'info', duration = 3500) {
    if (!toastContainer) return;

    const toast = document.createElement('div');
    toast.className = 'toast';

    let icon = 'ℹ️';
    let borderColor = 'rgba(99, 102, 241, 0.5)';
    if (type === 'success') {
      icon = '✅';
      borderColor = '#10B981';
    } else if (type === 'error') {
      icon = '⚠️';
      borderColor = '#EF4444';
    } else if (type === 'warning') {
      icon = '⚡';
      borderColor = '#F59E0B';
    }

    toast.style.borderLeft = `4px solid ${borderColor}`;
    toast.innerHTML = `
      <span class="text-lg">${icon}</span>
      <span class="flex-1 text-sm font-medium leading-snug">${escapeHtml(message)}</span>
    `;

    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ===================================================
  // 3. QUẢN LÝ TIẾN TRÌNH 4 BƯỚC (STEPS)
  // ===================================================
  function setStep(step) {
    currentStep = step;
    document.querySelectorAll('.step-item').forEach((el) => {
      const s = parseInt(el.dataset.step, 10);
      el.classList.remove('active', 'completed');
      if (s === step) {
        el.classList.add('active');
      } else if (s < step) {
        el.classList.add('completed');
      }
    });
  }

  // ===================================================
  // 4. QUẢN LÝ TABS BÊN PHẢI
  // ===================================================
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  function switchTab(targetTabId) {
    tabButtons.forEach((btn) => {
      if (btn.dataset.tab === targetTabId) {
        btn.classList.add('border-indigo-500', 'text-indigo-400', 'bg-slate-800/60');
        btn.classList.remove('border-transparent', 'text-slate-400');
      } else {
        btn.classList.remove('border-indigo-500', 'text-indigo-400', 'bg-slate-800/60');
        btn.classList.add('border-transparent', 'text-slate-400');
      }
    });

    tabPanes.forEach((pane) => {
      if (pane.id === targetTabId) {
        pane.classList.remove('hidden');
      } else {
        pane.classList.add('hidden');
      }
    });
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // ===================================================
  // 5. QUẢN LÝ API KEY & MODEL SETTINGS
  // ===================================================
  const apiKeyInput = document.getElementById('gemini-api-key-input');
  const modelSelect = document.getElementById('gemini-model-select');
  const saveKeyBtn = document.getElementById('btn-save-key');
  const toggleKeyVisibilityBtn = document.getElementById('btn-toggle-key-visibility');

  // Load saved key & model
  if (apiKeyInput) {
    apiKeyInput.value = window.geminiService.apiKey || '';
  }
  if (modelSelect) {
    modelSelect.value = window.geminiService.model || 'gemini-3.6-flash';
  }

  if (saveKeyBtn && apiKeyInput) {
    saveKeyBtn.addEventListener('click', () => {
      const key = apiKeyInput.value.trim();
      window.geminiService.saveApiKey(key);
      if (key) {
        showToast('Đã lưu Google Gemini API Key thành công!', 'success');
      } else {
        showToast('Đã xóa API Key.', 'info');
      }
    });
  }

  if (modelSelect) {
    modelSelect.addEventListener('change', () => {
      window.geminiService.saveModel(modelSelect.value);
      showToast(`Đã chuyển sang mô hình: ${modelSelect.value}`, 'info');
    });
  }

  if (toggleKeyVisibilityBtn && apiKeyInput) {
    toggleKeyVisibilityBtn.addEventListener('click', () => {
      const isPassword = apiKeyInput.type === 'password';
      apiKeyInput.type = isPassword ? 'text' : 'password';
      toggleKeyVisibilityBtn.textContent = isPassword ? '👁️‍🗨️' : '👁️';
    });
  }

  // ===================================================
  // 6. XỬ LÝ NẠP VIDEO (UPLOAD / DRAG & DROP / DEMO)
  // ===================================================
  function loadVideoFile(file) {
    if (!file) return;

    // Kiểm tra định dạng video phong phú
    const validExtensions = /\.(mp4|webm|mov|mkv|avi|m4v|ts|flv|wmv)$/i;
    if (!file.type.startsWith('video/') && !file.name.match(validExtensions)) {
      showToast('Vui lòng chọn định dạng tệp video hợp lệ (.mp4, .webm, .mov, .mkv).', 'error');
      return;
    }

    currentFile = file;
    const videoUrl = URL.createObjectURL(file);
    video.src = videoUrl;

    if (emptyStatePlaceholder) emptyStatePlaceholder.classList.add('hidden');
    video.classList.remove('hidden');

    setStep(2);
    showToast(`Đã nạp video: ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`, 'success');
    renderTimelineTrack();
  }

  // Chọn tệp qua File Input (cả nút trên header và trong dropzone)
  if (videoFileInput) {
    videoFileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        loadVideoFile(file);
        videoFileInput.value = ''; // Reset để có thể chọn lại cùng 1 file
      }
    });
  }

  // Click vào vùng placeholder để mở file picker
  if (emptyStatePlaceholder) {
    emptyStatePlaceholder.addEventListener('click', () => {
      if (videoFileInput) videoFileInput.click();
    });
  }

  if (browseBtnInner) {
    browseBtnInner.addEventListener('click', (e) => {
      e.stopPropagation();
      if (videoFileInput) videoFileInput.click();
    });
  }

  // Ngăn chặn hành vi mặc định của trình duyệt khi kéo thả tệp ra ngoài vùng
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
    window.addEventListener(eventName, (e) => {
      e.preventDefault();
    });
  });

  // Kéo & Thả trực tiếp vào khung Video (kể cả khi chưa có hoặc đã có video)
  let dragCounter = 0;

  if (videoWrapper) {
    videoWrapper.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter++;
      if (dragOverlay) dragOverlay.classList.remove('hidden');
      videoWrapper.classList.add('ring-4', 'ring-indigo-500/60');
    });

    videoWrapper.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (dragOverlay && dragOverlay.classList.contains('hidden')) {
        dragOverlay.classList.remove('hidden');
      }
    });

    videoWrapper.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        if (dragOverlay) dragOverlay.classList.add('hidden');
        videoWrapper.classList.remove('ring-4', 'ring-indigo-500/60');
      }
    });

    videoWrapper.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      if (dragOverlay) dragOverlay.classList.add('hidden');
      videoWrapper.classList.remove('ring-4', 'ring-indigo-500/60');

      const dt = e.dataTransfer;
      const files = dt?.files;
      if (files && files.length > 0) {
        loadVideoFile(files[0]);
      }
    });
  }

  // Nạp Video Mẫu Demo
  const loadDemoBtn = document.getElementById('btn-load-demo');
  if (loadDemoBtn) {
    loadDemoBtn.addEventListener('click', () => {
      // Sử dụng video mẫu công khai định dạng mp4 ngắn chất lượng cao
      const demoVideoUrl = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';
      video.src = demoVideoUrl;
      video.crossOrigin = 'anonymous';
      currentFile = new File(['demo'], 'sample_demo_video.mp4', { type: 'video/mp4' });

      if (emptyStatePlaceholder) emptyStatePlaceholder.classList.add('hidden');
      video.classList.remove('hidden');

      const targetLang = document.getElementById('target-language-select')?.value || 'Tiếng Việt';
      const sampleSegments = window.geminiService.getDemoSegments(targetLang);
      applySegments(sampleSegments);

      setStep(3);
      showToast('Đã nạp video mẫu và bộ phụ đề demo thành công!', 'success');
      switchTab('tab-editor');
    });
  }

  // ===================================================
  // 7. MODULE 1: GỌI GEMINI API BÓC BĂNG & DỊCH THUẬT
  // ===================================================
  const startAiBtn = document.getElementById('btn-start-ai');
  const aiStatusBox = document.getElementById('ai-status-container');
  const aiStatusText = document.getElementById('ai-status-text');
  const aiProgressBar = document.getElementById('ai-progress-bar');
  const targetLanguageSelect = document.getElementById('target-language-select');
  const customPromptInput = document.getElementById('custom-prompt-input');

  if (startAiBtn) {
    startAiBtn.addEventListener('click', async () => {
      if (!currentFile) {
        showToast('Vui lòng chọn hoặc tải lên một video trước khi bóc băng.', 'warning');
        return;
      }

      if (!window.geminiService.apiKey) {
        showToast('Vui lòng nhập Google Gemini API Key ở ô trên và nhấn Lưu.', 'error');
        apiKeyInput?.focus();
        return;
      }

      // Giới hạn kích thước file inline base64 khuyến nghị
      if (currentFile.size > 25 * 1024 * 1024) {
        const proceed = confirm(
          'Tệp video này khá lớn (>25MB). Quá trình gửi Base64 có thể mất chút thời gian hoặc bị giới hạn bởi API. Bạn có muốn tiếp tục không?'
        );
        if (!proceed) return;
      }

      const targetLang = targetLanguageSelect ? targetLanguageSelect.value : 'Tiếng Việt';
      const customPrompt = customPromptInput ? customPromptInput.value.trim() : '';

      try {
        startAiBtn.disabled = true;
        startAiBtn.classList.add('opacity-60', 'cursor-not-allowed');
        if (aiStatusBox) aiStatusBox.classList.remove('hidden');

        setStep(2);

        const segments = await window.geminiService.transcribeAndTranslate({
          file: currentFile,
          targetLang: targetLang,
          customPrompt: customPrompt,
          onStatusUpdate: (msg, percent) => {
            if (aiStatusText) aiStatusText.textContent = msg;
            if (aiProgressBar) aiProgressBar.style.width = `${percent}%`;
          }
        });

        applySegments(segments);
        setStep(3);
        showToast(`AI đã bóc băng thành công ${segments.length} đoạn thoại!`, 'success');
        switchTab('tab-editor');
      } catch (error) {
        console.error('Gemini Transcription Error:', error);
        showToast(error.message, 'error', 6000);
        if (aiStatusText) {
          aiStatusText.textContent = `Lỗi: ${error.message}`;
        }
      } finally {
        startAiBtn.disabled = false;
        startAiBtn.classList.remove('opacity-60', 'cursor-not-allowed');
      }
    });
  }

  // Nút nạp dữ liệu Demo không cần API Key
  const useDemoDataBtn = document.getElementById('btn-use-demo-data');
  if (useDemoDataBtn) {
    useDemoDataBtn.addEventListener('click', () => {
      const targetLang = targetLanguageSelect ? targetLanguageSelect.value : 'Tiếng Việt';
      const demoSegments = window.geminiService.getDemoSegments(targetLang);
      applySegments(demoSegments);
      setStep(3);
      showToast('Đã nạp bộ phụ đề Demo!', 'info');
      switchTab('tab-editor');
    });
  }

  // ===================================================
  // 8. CẬP NHẬT SEGMENTS VÀO ENGINES & TIMELINE
  // ===================================================
  function applySegments(segments) {
    currentSegments = segments;
    subtitleEngine.setSegments(segments);
    renderTimelineTrack();
    renderSegmentEditorList();

    // Cập nhật ngôn ngữ cho TTS nếu có
    const targetLang = targetLanguageSelect ? targetLanguageSelect.value : 'Tiếng Việt';
    const langCode = langCodeMap[targetLang] || 'vi-VN';
    dubbingEngine.updateConfig({ lang: langCode });
    populateVoiceList(langCode);
  }

  // ===================================================
  // 9. MODULE 2: SUBTITLE SYNC & KIỂU DÁNG PHỤ ĐỀ
  // ===================================================
  // Listeners video events
  video.addEventListener('timeupdate', () => {
    const currentTime = video.currentTime;
    const activeSeg = subtitleEngine.updateTime(currentTime);

    // AI Dubbing Sync
    dubbingEngine.onTimeUpdate(currentTime, activeSeg);

    // Cập nhật highlight active trên timeline và editor
    updateActiveSegmentUI(activeSeg);

    // Cập nhật thanh thời gian hiện tại
    updateTimeDisplay();
  });

  video.addEventListener('pause', () => {
    dubbingEngine.stopSpeaking(true);
  });

  video.addEventListener('seeked', () => {
    dubbingEngine.stopSpeaking(true);
  });

  video.addEventListener('ended', () => {
    dubbingEngine.stopSpeaking(true);
    subtitleEngine.clearSubtitle();
  });

  // Tùy biến Style Phụ đề
  const subFontSizeSlider = document.getElementById('sub-font-size');
  const subFontSizeVal = document.getElementById('sub-font-size-val');
  const subColorPicker = document.getElementById('sub-text-color');
  const subBgOpacitySlider = document.getElementById('sub-bg-opacity');
  const subBlurSlider = document.getElementById('sub-backdrop-blur');
  const subDisplayModeSelect = document.getElementById('sub-display-mode');
  const subShadowToggle = document.getElementById('sub-shadow-toggle');

  if (subFontSizeSlider) {
    subFontSizeSlider.addEventListener('input', (e) => {
      const size = parseInt(e.target.value, 10);
      if (subFontSizeVal) subFontSizeVal.textContent = `${size}px`;
      subtitleEngine.updateStyles({ fontSize: size });
    });
  }

  if (subColorPicker) {
    subColorPicker.addEventListener('input', (e) => {
      subtitleEngine.updateStyles({ textColor: e.target.value });
    });
  }

  // Color preset buttons
  document.querySelectorAll('.color-preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      if (subColorPicker) subColorPicker.value = color;
      subtitleEngine.updateStyles({ textColor: color });
    });
  });

  if (subBgOpacitySlider) {
    subBgOpacitySlider.addEventListener('input', (e) => {
      const opacity = parseFloat(e.target.value);
      subtitleEngine.updateStyles({ bgColor: `rgba(0, 0, 0, ${opacity})` });
    });
  }

  if (subBlurSlider) {
    subBlurSlider.addEventListener('input', (e) => {
      subtitleEngine.updateStyles({ backdropBlur: parseInt(e.target.value, 10) });
    });
  }

  if (subDisplayModeSelect) {
    subDisplayModeSelect.addEventListener('change', (e) => {
      subtitleEngine.updateStyles({ displayMode: e.target.value });
    });
  }

  if (subShadowToggle) {
    subShadowToggle.addEventListener('change', (e) => {
      subtitleEngine.updateStyles({ textShadow: e.target.checked });
    });
  }

  // Vị trí phụ đề
  document.querySelectorAll('.sub-pos-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sub-pos-btn').forEach((b) => b.classList.remove('ring-2', 'ring-indigo-500', 'bg-indigo-600/30'));
      btn.classList.add('ring-2', 'ring-indigo-500', 'bg-indigo-600/30');
      subtitleEngine.updateStyles({ position: btn.dataset.pos });
    });
  });

  // Tùy biến Dải Che / Đè Phụ Đề Gốc (Hardsub Mask)
  const maskEnableToggle = document.getElementById('mask-enable-toggle');
  const maskControlsWrapper = document.getElementById('mask-controls-wrapper');
  const maskModeSelect = document.getElementById('mask-mode-select');
  const maskHeightSlider = document.getElementById('mask-height-slider');
  const maskHeightVal = document.getElementById('mask-height-val');
  const maskBottomSlider = document.getElementById('mask-bottom-slider');
  const maskBottomVal = document.getElementById('mask-bottom-val');
  const maskWidthSlider = document.getElementById('mask-width-slider');
  const maskWidthVal = document.getElementById('mask-width-val');
  const maskOpacitySlider = document.getElementById('mask-opacity-slider');
  const maskOpacityVal = document.getElementById('mask-opacity-val');
  const maskColorPicker = document.getElementById('mask-color-picker');

  if (maskEnableToggle) {
    maskEnableToggle.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      subtitleEngine.updateMaskSettings({ enabled });
      if (maskControlsWrapper) {
        if (enabled) maskControlsWrapper.classList.remove('hidden');
        else maskControlsWrapper.classList.add('hidden');
      }
      showToast(enabled ? 'Đã bật dải che đè phụ đề gốc!' : 'Đã tắt dải che.', 'info');
    });
  }

  if (maskModeSelect) {
    maskModeSelect.addEventListener('change', (e) => {
      subtitleEngine.updateMaskSettings({ mode: e.target.value });
    });
  }

  if (maskHeightSlider) {
    maskHeightSlider.addEventListener('input', (e) => {
      const height = parseInt(e.target.value, 10);
      if (maskHeightVal) maskHeightVal.textContent = `${height}px`;
      subtitleEngine.updateMaskSettings({ height });
    });
  }

  if (maskBottomSlider) {
    maskBottomSlider.addEventListener('input', (e) => {
      const bottom = parseInt(e.target.value, 10);
      if (maskBottomVal) maskBottomVal.textContent = `${bottom}%`;
      subtitleEngine.updateMaskSettings({ bottom });
    });
  }

  if (maskWidthSlider) {
    maskWidthSlider.addEventListener('input', (e) => {
      const width = parseInt(e.target.value, 10);
      if (maskWidthVal) maskWidthVal.textContent = `${width}%`;
      subtitleEngine.updateMaskSettings({ width });
    });
  }

  if (maskOpacitySlider) {
    maskOpacitySlider.addEventListener('input', (e) => {
      const opacity = parseFloat(e.target.value);
      if (maskOpacityVal) maskOpacityVal.textContent = `${Math.round(opacity * 100)}%`;
      subtitleEngine.updateMaskSettings({ opacity });
    });
  }

  if (maskColorPicker) {
    maskColorPicker.addEventListener('input', (e) => {
      subtitleEngine.updateMaskSettings({ color: e.target.value });
    });
  }

  // ===================================================
  // 10. MODULE 3: LỒNG TIẾNG (AI DUBBING & AUDIO DUCKING)
  // ===================================================
  const dubbingEnableToggle = document.getElementById('dubbing-enable-toggle');
  const duckingEnableToggle = document.getElementById('ducking-enable-toggle');
  const duckingRatioSlider = document.getElementById('ducking-ratio-slider');
  const duckingRatioVal = document.getElementById('ducking-ratio-val');
  const voiceSelect = document.getElementById('voice-select');
  const voiceVolumeSlider = document.getElementById('voice-volume-slider');
  const originalVolumeSlider = document.getElementById('original-volume-slider');
  const voiceRateSlider = document.getElementById('voice-rate-slider');
  const voiceRateVal = document.getElementById('voice-rate-val');
  const voiceOffsetSlider = document.getElementById('voice-offset-slider');
  const voiceOffsetVal = document.getElementById('voice-offset-val');
  const testVoiceBtn = document.getElementById('btn-test-voice');
  const resetTtsBtn = document.getElementById('btn-reset-tts');

  function populateVoiceList(langCode) {
    if (!voiceSelect) return;
    voiceSelect.innerHTML = '';

    const voices = dubbingEngine.getVoicesForLanguage(langCode);

    if (voices.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Đang tải danh sách giọng đọc...';
      voiceSelect.appendChild(opt);
      return;
    }

    voices.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.voiceURI;
      opt.textContent = `${v.name} (${v.lang})${v.default ? ' — Mặc định' : ''}`;
      voiceSelect.appendChild(opt);
    });

    dubbingEngine.updateConfig({ voiceURI: voiceSelect.value });
  }

  // Tải voice khi speechSynthesis sẵn sàng
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => {
      const targetLang = targetLanguageSelect ? targetLanguageSelect.value : 'Tiếng Việt';
      const langCode = langCodeMap[targetLang] || 'vi-VN';
      populateVoiceList(langCode);
    };
  }

  if (targetLanguageSelect) {
    targetLanguageSelect.addEventListener('change', () => {
      const targetLang = targetLanguageSelect.value;
      const langCode = langCodeMap[targetLang] || 'vi-VN';
      dubbingEngine.updateConfig({ lang: langCode });
      populateVoiceList(langCode);
    });
  }

  if (voiceSelect) {
    voiceSelect.addEventListener('change', (e) => {
      dubbingEngine.updateConfig({ voiceURI: e.target.value });
    });
  }

  if (dubbingEnableToggle) {
    dubbingEnableToggle.addEventListener('change', (e) => {
      dubbingEngine.updateConfig({ enabled: e.target.checked });
      if (!e.target.checked) dubbingEngine.stopSpeaking(true);
      showToast(e.target.checked ? 'Đã bật chế độ lồng tiếng tự động!' : 'Đã tắt lồng tiếng.', 'info');
    });
  }

  if (duckingEnableToggle) {
    duckingEnableToggle.addEventListener('change', (e) => {
      dubbingEngine.updateConfig({ duckingEnabled: e.target.checked });
    });
  }

  if (duckingRatioSlider) {
    duckingRatioSlider.addEventListener('input', (e) => {
      const ratio = parseFloat(e.target.value);
      if (duckingRatioVal) duckingRatioVal.textContent = `${Math.round(ratio * 100)}%`;
      dubbingEngine.updateConfig({ duckingRatio: ratio });
    });
  }

  if (voiceVolumeSlider) {
    voiceVolumeSlider.addEventListener('input', (e) => {
      dubbingEngine.updateConfig({ volume: parseFloat(e.target.value) });
    });
  }

  if (originalVolumeSlider) {
    originalVolumeSlider.addEventListener('input', (e) => {
      const vol = parseFloat(e.target.value);
      video.volume = vol;
      dubbingEngine.updateConfig({ originalVideoVolume: vol });
    });
  }

  if (voiceRateSlider) {
    voiceRateSlider.addEventListener('input', (e) => {
      const rate = parseFloat(e.target.value);
      if (voiceRateVal) voiceRateVal.textContent = `${rate.toFixed(1)}x`;
      dubbingEngine.updateConfig({ rate: rate });
    });
  }

  if (voiceOffsetSlider) {
    voiceOffsetSlider.addEventListener('input', (e) => {
      const offset = parseFloat(e.target.value);
      if (voiceOffsetVal) voiceOffsetVal.textContent = `${offset > 0 ? '+' : ''}${offset.toFixed(1)}s`;
      dubbingEngine.updateConfig({ timingOffset: offset });
    });
  }

  if (testVoiceBtn) {
    testVoiceBtn.addEventListener('click', () => {
      try {
        const sampleText = 'Xin chào, đây là giọng đọc AI thuyết minh thử nghiệm.';
        dubbingEngine.testVoice(sampleText);
        showToast('Đang phát thử giọng đọc...', 'info');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  if (resetTtsBtn) {
    resetTtsBtn.addEventListener('click', () => {
      dubbingEngine.resetEngine();
      const targetLang = targetLanguageSelect ? targetLanguageSelect.value : 'Tiếng Việt';
      const langCode = langCodeMap[targetLang] || 'vi-VN';
      populateVoiceList(langCode);
      showToast('Đã khởi động lại bộ đọc TTS thành công!', 'success');
    });
  }

  // ===================================================
  // 11. TIMELINE SCRUBBER & SEGMENTS TRACK
  // ===================================================
  const timelineTrackContainer = document.getElementById('timeline-segments-track');
  const currentTimeDisplay = document.getElementById('current-time-display');
  const totalDurationDisplay = document.getElementById('total-duration-display');

  function updateTimeDisplay() {
    if (currentTimeDisplay) {
      currentTimeDisplay.textContent = window.TimeUtils.formatShortTime(video.currentTime);
    }
    if (totalDurationDisplay && !isNaN(video.duration)) {
      totalDurationDisplay.textContent = window.TimeUtils.formatShortTime(video.duration);
    }
  }

  video.addEventListener('loadedmetadata', () => {
    updateTimeDisplay();
    renderTimelineTrack();
  });

  function renderTimelineTrack() {
    if (!timelineTrackContainer) return;
    timelineTrackContainer.innerHTML = '';

    const duration = video.duration || 30;

    currentSegments.forEach((seg) => {
      const startSec = window.TimeUtils.timeToSeconds(seg.start);
      const endSec = window.TimeUtils.timeToSeconds(seg.end);

      const leftPercent = Math.max(0, Math.min(100, (startSec / duration) * 100));
      const widthPercent = Math.max(1, Math.min(100 - leftPercent, ((endSec - startSec) / duration) * 100));

      const segBlock = document.createElement('div');
      segBlock.className = 'timeline-track-segment';
      segBlock.id = `timeline-bar-${seg.id}`;
      segBlock.style.left = `${leftPercent}%`;
      segBlock.style.width = `${widthPercent}%`;
      segBlock.title = `${seg.start} -> ${seg.end}\n${seg.translated || seg.original}`;

      segBlock.addEventListener('click', (e) => {
        e.stopPropagation();
        video.currentTime = startSec;
        video.play();
      });

      timelineTrackContainer.appendChild(segBlock);
    });
  }

  function updateActiveSegmentUI(activeSeg) {
    // Highlight trên timeline track
    document.querySelectorAll('.timeline-track-segment').forEach((el) => el.classList.remove('active-segment'));
    if (activeSeg) {
      const bar = document.getElementById(`timeline-bar-${activeSeg.id}`);
      if (bar) bar.classList.add('active-segment');
    }

    // Highlight trong editor list
    document.querySelectorAll('.segment-card').forEach((el) => el.classList.remove('active-playback'));
    if (activeSeg) {
      const card = document.getElementById(`segment-card-${activeSeg.id}`);
      if (card) {
        card.classList.add('active-playback');
      }
    }
  }

  // ===================================================
  // 12. DANH SÁCH & CHỈNH SỬA ĐOẠN THOẠI (TIMELINE EDITOR)
  // ===================================================
  const segmentListContainer = document.getElementById('segment-editor-list');
  const segmentCountBadge = document.getElementById('segment-count-badge');
  const addSegmentBtn = document.getElementById('btn-add-segment');
  const segmentSearchInput = document.getElementById('segment-search-input');

  function renderSegmentEditorList() {
    if (!segmentListContainer) return;
    segmentListContainer.innerHTML = '';

    if (segmentCountBadge) {
      segmentCountBadge.textContent = `${currentSegments.length} câu thoại`;
    }

    if (currentSegments.length === 0) {
      segmentListContainer.innerHTML = `
        <div class="text-center py-10 text-slate-500 text-sm">
          <p>Chưa có đoạn thoại nào.</p>
          <p class="text-xs mt-1 text-slate-600">Hãy bấm <strong>"Bắt Đầu Bóc Băng"</strong> hoặc <strong>"Thêm Đoạn Thoại"</strong>.</p>
        </div>
      `;
      return;
    }

    const searchTerm = segmentSearchInput ? segmentSearchInput.value.toLowerCase().trim() : '';

    currentSegments.forEach((seg, idx) => {
      if (
        searchTerm &&
        !seg.original.toLowerCase().includes(searchTerm) &&
        !seg.translated.toLowerCase().includes(searchTerm)
      ) {
        return;
      }

      const card = document.createElement('div');
      card.className = 'segment-card glass-panel rounded-xl p-3.5 space-y-2.5 transition-all';
      card.id = `segment-card-${seg.id}`;

      card.innerHTML = `
        <div class="flex items-center justify-between gap-2 border-b border-slate-700/50 pb-2">
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-indigo-400 bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-800/40">#${idx + 1}</span>
            <div class="flex items-center gap-1.5 text-xs font-mono text-slate-300">
              <input type="text" class="seg-start-input w-24 bg-slate-900/90 border border-slate-700/70 rounded px-1.5 py-0.5 text-center focus:border-indigo-500 focus:outline-none" value="${escapeHtml(seg.start)}" data-id="${seg.id}">
              <span class="text-slate-500">➜</span>
              <input type="text" class="seg-end-input w-24 bg-slate-900/90 border border-slate-700/70 rounded px-1.5 py-0.5 text-center focus:border-indigo-500 focus:outline-none" value="${escapeHtml(seg.end)}" data-id="${seg.id}">
            </div>
          </div>
          <div class="flex items-center gap-1">
            <button class="btn-play-seg text-xs bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white px-2 py-1 rounded transition flex items-center gap-1" data-id="${seg.id}" title="Phát video từ đoạn này">
              <span>▶</span> Phát
            </button>
            <button class="btn-speak-seg text-xs bg-slate-800 hover:bg-cyan-600 text-slate-300 hover:text-white px-2 py-1 rounded transition flex items-center gap-1" data-id="${seg.id}" title="Nghe thử giọng đọc câu này">
              <span>🎙️</span>
            </button>
            <button class="btn-delete-seg text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-950/50 p-1 rounded transition" data-id="${seg.id}" title="Xóa đoạn này">
              ✕
            </button>
          </div>
        </div>

        <div class="space-y-1.5 text-xs">
          <div>
            <label class="text-slate-400 font-medium">Bản gốc:</label>
            <textarea class="seg-orig-input w-full bg-slate-900/80 border border-slate-700/60 rounded-lg p-2 text-slate-300 focus:border-indigo-500 focus:outline-none resize-y" rows="2" data-id="${seg.id}">${escapeHtml(seg.original)}</textarea>
          </div>
          <div>
            <label class="text-indigo-400 font-semibold flex items-center justify-between">
              <span>Bản dịch (Lồng tiếng & Phụ đề):</span>
            </label>
            <textarea class="seg-trans-input w-full bg-slate-900/80 border border-indigo-900/60 rounded-lg p-2 text-white font-medium focus:border-indigo-500 focus:outline-none resize-y" rows="2" data-id="${seg.id}">${escapeHtml(seg.translated)}</textarea>
          </div>
        </div>
      `;

      // Gắn sự kiện các nút
      const startInput = card.querySelector('.seg-start-input');
      const endInput = card.querySelector('.seg-end-input');
      const origInput = card.querySelector('.seg-orig-input');
      const transInput = card.querySelector('.seg-trans-input');
      const playBtn = card.querySelector('.btn-play-seg');
      const speakBtn = card.querySelector('.btn-speak-seg');
      const deleteBtn = card.querySelector('.btn-delete-seg');

      startInput.addEventListener('change', (e) => {
        seg.start = e.target.value.trim();
        subtitleEngine.setSegments(currentSegments);
        renderTimelineTrack();
      });

      endInput.addEventListener('change', (e) => {
        seg.end = e.target.value.trim();
        subtitleEngine.setSegments(currentSegments);
        renderTimelineTrack();
      });

      origInput.addEventListener('input', (e) => {
        seg.original = e.target.value;
        subtitleEngine.setSegments(currentSegments);
      });

      transInput.addEventListener('input', (e) => {
        seg.translated = e.target.value;
        subtitleEngine.setSegments(currentSegments);
      });

      playBtn.addEventListener('click', () => {
        const sec = window.TimeUtils.timeToSeconds(seg.start);
        video.currentTime = sec;
        video.play();
      });

      speakBtn.addEventListener('click', () => {
        dubbingEngine.speakSegment(seg);
      });

      deleteBtn.addEventListener('click', () => {
        currentSegments = currentSegments.filter((s) => s.id !== seg.id);
        applySegments(currentSegments);
        showToast('Đã xóa đoạn thoại.', 'info');
      });

      segmentListContainer.appendChild(card);
    });
  }

  if (segmentSearchInput) {
    segmentSearchInput.addEventListener('input', () => {
      renderSegmentEditorList();
    });
  }

  // Nút thêm Segment thủ công
  if (addSegmentBtn) {
    addSegmentBtn.addEventListener('click', () => {
      const currentTime = video.currentTime || 0;
      const startStr = window.geminiService.secondsToTimeString(currentTime);
      const endStr = window.geminiService.secondsToTimeString(currentTime + 3);

      const newSeg = {
        id: `seg_${Date.now()}`,
        start: startStr,
        end: endStr,
        original: 'Đoạn thoại mới',
        translated: 'Bản dịch mới'
      };

      currentSegments.push(newSeg);
      applySegments(currentSegments);
      showToast('Đã thêm một đoạn thoại mới.', 'success');

      // Scroll to bottom of segment list
      setTimeout(() => {
        if (segmentListContainer) {
          segmentListContainer.scrollTop = segmentListContainer.scrollHeight;
        }
      }, 100);
    });
  }

  // ===================================================
  // 13. XUẤT FILE PHỤ ĐỀ (SRT, VTT, JSON)
  // ===================================================
  const exportSrtBtn = document.getElementById('btn-export-srt');
  const exportVttBtn = document.getElementById('btn-export-vtt');
  const exportJsonBtn = document.getElementById('btn-export-json');

  if (exportSrtBtn) {
    exportSrtBtn.addEventListener('click', () => {
      try {
        subtitleEngine.exportSRT('subtitles_studio.srt');
        setStep(4);
        showToast('Đã xuất và tải về file phụ đề SRT thành công!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  if (exportVttBtn) {
    exportVttBtn.addEventListener('click', () => {
      try {
        subtitleEngine.exportVTT('subtitles_studio.vtt');
        setStep(4);
        showToast('Đã xuất và tải về file WebVTT thành công!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  if (exportJsonBtn) {
    exportJsonBtn.addEventListener('click', () => {
      try {
        subtitleEngine.exportJSON('subtitles_data.json');
        showToast('Đã xuất file JSON dữ liệu!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Khởi tạo ban đầu
  setStep(1);
  populateVoiceList('vi-VN');
});

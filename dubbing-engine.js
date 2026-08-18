/**
 * dubbing-engine.js
 * Module quản lý:
 * 1. Subtitle Sync Engine: Đồng bộ phụ đề theo thời gian video, tùy biến giao diện, xuất SRT/VTT.
 * 2. AI Dubbing Engine: Phát giọng đọc Text-to-Speech (Web Speech API) và hiệu ứng Audio Ducking.
 */

// ==========================================
// CÁC HÀM TIỆN ÍCH CHUYỂN ĐỔI THỜI GIAN
// ==========================================
class TimeUtils {
  /**
   * Chuyển chuỗi thời gian "00:01:23.456" hoặc "01:23.456" hoặc số sang giây (float)
   */
  static timeToSeconds(timeInput) {
    if (typeof timeInput === 'number') return timeInput;
    if (!timeInput || typeof timeInput !== 'string') return 0;

    const cleanStr = timeInput.trim().replace(',', '.');
    const parts = cleanStr.split(':');

    if (parts.length === 3) {
      const hours = parseFloat(parts[0]) || 0;
      const minutes = parseFloat(parts[1]) || 0;
      const seconds = parseFloat(parts[2]) || 0;
      return hours * 3600 + minutes * 60 + seconds;
    } else if (parts.length === 2) {
      const minutes = parseFloat(parts[0]) || 0;
      const seconds = parseFloat(parts[1]) || 0;
      return minutes * 60 + seconds;
    } else {
      return parseFloat(cleanStr) || 0;
    }
  }

  /**
   * Chuyển số giây sang định dạng SRT: 00:00:01,200
   */
  static secondsToSRT(sec) {
    const totalMs = Math.max(0, Math.round(sec * 1000));
    const hours = Math.floor(totalMs / 3600000);
    const minutes = Math.floor((totalMs % 3600000) / 60000);
    const seconds = Math.floor((totalMs % 60000) / 1000);
    const ms = totalMs % 1000;

    const pad = (n, w = 2) => String(n).padStart(w, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(ms, 3)}`;
  }

  /**
   * Chuyển số giây sang định dạng WebVTT: 00:00:01.200
   */
  static secondsToVTT(sec) {
    const totalMs = Math.max(0, Math.round(sec * 1000));
    const hours = Math.floor(totalMs / 3600000);
    const minutes = Math.floor((totalMs % 3600000) / 60000);
    const seconds = Math.floor((totalMs % 60000) / 1000);
    const ms = totalMs % 1000;

    const pad = (n, w = 2) => String(n).padStart(w, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(ms, 3)}`;
  }

  /**
   * Định dạng hiển thị ngắn gọn MM:SS
   */
  static formatShortTime(sec) {
    const totalSec = Math.floor(sec || 0);
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
}

// ==========================================
// SUBTITLE SYNC ENGINE
// ==========================================
class SubtitleEngine {
  constructor(overlayContainerElement) {
    this.container = overlayContainerElement;
    this.segments = [];
    this.activeSegment = null;

    // Cài đặt phong cách hiển thị mặc định
    this.styles = {
      position: 'bottom', // 'bottom', 'bottom-higher', 'middle', 'top'
      fontSize: 22, // px
      textColor: '#FFFFFF',
      bgColor: 'rgba(0, 0, 0, 0.75)',
      backdropBlur: 4, // px
      textShadow: true,
      displayMode: 'both', // 'both', 'translated-only', 'original-only'
      dualLayout: 'stacked' // 'stacked' (translated to hơn, original nhỏ hơn ở trên)
    };

    this.applyStyles();
  }

  /**
   * Cập nhật danh sách segments và tính toán số giây sẵn sàng cho sync tốc độ cao
   */
  setSegments(rawSegments) {
    this.segments = (rawSegments || []).map((seg, idx) => {
      const startSec = TimeUtils.timeToSeconds(seg.start);
      const endSec = Math.max(startSec + 0.5, TimeUtils.timeToSeconds(seg.end));
      return {
        id: seg.id || `seg_${idx}_${Date.now()}`,
        start: seg.start,
        end: seg.end,
        startSec: startSec,
        endSec: endSec,
        original: seg.original || '',
        translated: seg.translated || ''
      };
    }).sort((a, b) => a.startSec - b.startSec);

    this.clearSubtitle();
  }

  /**
   * Cập nhật tùy biến kiểu dáng phụ đề
   */
  updateStyles(newStyles) {
    this.styles = { ...this.styles, ...newStyles };
    this.applyStyles();
    // Render lại phụ đề hiện tại nếu đang hiển thị
    if (this.activeSegment) {
      this.displaySubtitle(this.activeSegment);
    }
  }

  /**
   * Áp dụng vị trí và container style
   */
  applyStyles() {
    if (!this.container) return;

    // Xóa các class vị trí cũ
    this.container.classList.remove('sub-pos-bottom', 'sub-pos-bottom-higher', 'sub-pos-middle', 'sub-pos-top');

    // Gán class vị trí mới
    switch (this.styles.position) {
      case 'top':
        this.container.classList.add('sub-pos-top');
        break;
      case 'middle':
        this.container.classList.add('sub-pos-middle');
        break;
      case 'bottom-higher':
        this.container.classList.add('sub-pos-bottom-higher');
        break;
      case 'bottom':
      default:
        this.container.classList.add('sub-pos-bottom');
        break;
    }
  }

  /**
   * Bắt sự kiện thời gian video để render phụ đề tức thì
   */
  updateTime(currentTime) {
    if (!this.segments || this.segments.length === 0) {
      this.clearSubtitle();
      return null;
    }

    // Tìm segment đang rơi vào khoảng thời gian hiện tại
    const current = this.segments.find(
      (s) => currentTime >= s.startSec && currentTime <= s.endSec
    );

    if (current) {
      if (this.activeSegment?.id !== current.id) {
        this.activeSegment = current;
        this.displaySubtitle(current);
      }
      return current;
    } else {
      if (this.activeSegment) {
        this.clearSubtitle();
      }
      return null;
    }
  }

  /**
   * Hiển thị HTML phụ đề
   */
  displaySubtitle(segment) {
    if (!this.container) return;

    const { fontSize, textColor, bgColor, backdropBlur, textShadow, displayMode } = this.styles;

    let contentHtml = '';
    const shadowStyle = textShadow
      ? 'text-shadow: 0 2px 4px rgba(0,0,0,0.9), 0 0 2px #000;'
      : '';

    const showOriginal = (displayMode === 'both' || displayMode === 'original-only') && segment.original;
    const showTranslated = (displayMode === 'both' || displayMode === 'translated-only') && segment.translated;

    if (showOriginal && showTranslated) {
      contentHtml = `
        <div class="subtitle-box" style="background-color: ${bgColor}; backdrop-filter: blur(${backdropBlur}px); -webkit-backdrop-filter: blur(${backdropBlur}px); color: ${textColor}; ${shadowStyle}">
          <span class="subtitle-original-text font-normal opacity-75" style="font-size: ${Math.round(fontSize * 0.75)}px;">${this.escapeHtml(segment.original)}</span>
          <span class="subtitle-translated-text font-bold" style="font-size: ${fontSize}px;">${this.escapeHtml(segment.translated)}</span>
        </div>
      `;
    } else if (showTranslated) {
      contentHtml = `
        <div class="subtitle-box" style="background-color: ${bgColor}; backdrop-filter: blur(${backdropBlur}px); -webkit-backdrop-filter: blur(${backdropBlur}px); color: ${textColor}; ${shadowStyle}">
          <span class="subtitle-translated-text font-bold" style="font-size: ${fontSize}px;">${this.escapeHtml(segment.translated)}</span>
        </div>
      `;
    } else if (showOriginal) {
      contentHtml = `
        <div class="subtitle-box" style="background-color: ${bgColor}; backdrop-filter: blur(${backdropBlur}px); -webkit-backdrop-filter: blur(${backdropBlur}px); color: ${textColor}; ${shadowStyle}">
          <span class="subtitle-translated-text font-bold" style="font-size: ${fontSize}px;">${this.escapeHtml(segment.original)}</span>
        </div>
      `;
    }

    this.container.innerHTML = contentHtml;
  }

  /**
   * Xóa khung phụ đề khi không có thoại
   */
  clearSubtitle() {
    this.activeSegment = null;
    if (this.container) {
      this.container.innerHTML = '';
    }
  }

  /**
   * Xuất file .SRT chuẩn phụ đề
   */
  exportSRT(filename = 'subtitles.srt') {
    if (!this.segments || this.segments.length === 0) {
      throw new Error('Chưa có phụ đề để xuất file.');
    }

    let srtContent = '';
    this.segments.forEach((seg, index) => {
      const srtStart = TimeUtils.secondsToSRT(seg.startSec);
      const srtEnd = TimeUtils.secondsToSRT(seg.endSec);
      const text = seg.translated || seg.original || '';

      srtContent += `${index + 1}\n`;
      srtContent += `${srtStart} --> ${srtEnd}\n`;
      srtContent += `${text}\n\n`;
    });

    this.downloadFile(srtContent, filename, 'text/plain;charset=utf-8');
  }

  /**
   * Xuất file .VTT (WebVTT)
   */
  exportVTT(filename = 'subtitles.vtt') {
    if (!this.segments || this.segments.length === 0) {
      throw new Error('Chưa có phụ đề để xuất file.');
    }

    let vttContent = 'WEBVTT\n\n';
    this.segments.forEach((seg, index) => {
      const vttStart = TimeUtils.secondsToVTT(seg.startSec);
      const vttEnd = TimeUtils.secondsToVTT(seg.endSec);
      const text = seg.translated || seg.original || '';

      vttContent += `${index + 1}\n`;
      vttContent += `${vttStart} --> ${vttEnd}\n`;
      vttContent += `${text}\n\n`;
    });

    this.downloadFile(vttContent, filename, 'text/vtt;charset=utf-8');
  }

  /**
   * Xuất file JSON lưu trữ
   */
  exportJSON(filename = 'subtitles_data.json') {
    if (!this.segments || this.segments.length === 0) {
      throw new Error('Chưa có phụ đề để xuất file.');
    }

    const data = JSON.stringify(this.segments, null, 2);
    this.downloadFile(data, filename, 'application/json;charset=utf-8');
  }

  /**
   * Helper kích hoạt tải file trên trình duyệt
   */
  downloadFile(content, fileName, contentType) {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// ==========================================
// AI DUBBING ENGINE & AUDIO DUCKING
// ==========================================
class DubbingEngine {
  constructor(videoElement, onDuckingChange = () => {}) {
    this.video = videoElement;
    this.onDuckingChange = onDuckingChange;

    this.synth = window.speechSynthesis;
    this.availableVoices = [];

    // Cài đặt mặc định
    this.config = {
      enabled: true,
      voiceURI: null,
      lang: 'vi-VN',
      volume: 1.0, // 0.0 - 1.0
      rate: 1.0,   // 0.5 - 2.0 (tốc độ đọc)
      pitch: 1.0,  // 0.5 - 1.5
      duckingEnabled: true,
      duckingRatio: 0.25, // Hạ âm lượng video gốc còn 25% khi có thuyết minh
      originalVideoVolume: 1.0 // Âm lượng cơ sở của video
    };

    this.lastSpokenSegmentId = null;
    this.isDucking = false;
    this.activeUtterance = null;

    this.initVoices();
  }

  /**
   * Nạp danh sách giọng đọc từ trình duyệt
   */
  initVoices() {
    const load = () => {
      if (!this.synth) return;
      this.availableVoices = this.synth.getVoices() || [];
    };

    load();
    if (this.synth && this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = load;
    }
  }

  /**
   * Lấy danh sách giọng đọc theo mã ngôn ngữ
   */
  getVoicesForLanguage(langCode) {
    if (!this.availableVoices || this.availableVoices.length === 0) {
      this.availableVoices = this.synth?.getVoices() || [];
    }

    if (!langCode) return this.availableVoices;

    const shortCode = langCode.split('-')[0].toLowerCase();
    const matching = this.availableVoices.filter(
      (v) => v.lang.toLowerCase().startsWith(shortCode) || v.lang.toLowerCase().includes(shortCode)
    );

    return matching.length > 0 ? matching : this.availableVoices;
  }

  /**
   * Cập nhật cấu hình dubbing
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Gọi khi video phát và đồng bộ từng mốc thoại
   */
  onTimeUpdate(currentTime, activeSegment) {
    if (!this.config.enabled || !activeSegment || !activeSegment.translated) {
      return;
    }

    // Nếu vừa bước vào một segment mới chưa được đọc
    if (this.lastSpokenSegmentId !== activeSegment.id) {
      this.lastSpokenSegmentId = activeSegment.id;
      this.speakSegment(activeSegment);
    }
  }

  /**
   * Phát giọng đọc cho đoạn thoại
   */
  speakSegment(segment) {
    if (!this.synth || !this.config.enabled) return;

    // Hủy phát âm thanh trước đó nếu còn đang nói
    this.stopSpeaking(false);

    const textToSpeak = segment.translated || segment.original;
    if (!textToSpeak) return;

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.volume = Math.max(0, Math.min(1, this.config.volume));
    utterance.rate = Math.max(0.5, Math.min(2.0, this.config.rate));
    utterance.pitch = Math.max(0.5, Math.min(1.5, this.config.pitch));

    // Tìm voice phù hợp
    if (this.config.voiceURI) {
      const selected = this.availableVoices.find((v) => v.voiceURI === this.config.voiceURI);
      if (selected) utterance.voice = selected;
    } else if (this.config.lang) {
      const matchingVoices = this.getVoicesForLanguage(this.config.lang);
      if (matchingVoices.length > 0) utterance.voice = matchingVoices[0];
    }

    // Bắt sự kiện bắt đầu phát -> Kích hoạt Audio Ducking
    utterance.onstart = () => {
      this.applyAudioDucking(true);
    };

    // Khi kết thúc phát hoặc gặp lỗi -> Tắt Audio Ducking
    utterance.onend = () => {
      this.applyAudioDucking(false);
      this.activeUtterance = null;
    };

    utterance.onerror = (e) => {
      console.warn('SpeechSynthesis error:', e);
      this.applyAudioDucking(false);
      this.activeUtterance = null;
    };

    this.activeUtterance = utterance;
    this.synth.speak(utterance);
  }

  /**
   * Hiệu ứng Audio Ducking: Tự động hạ âm lượng video gốc khi có tiếng thuyết minh
   */
  applyAudioDucking(enable) {
    if (!this.video) return;

    this.isDucking = enable;
    this.onDuckingChange(enable);

    if (!this.config.duckingEnabled) {
      this.video.volume = this.config.originalVideoVolume;
      return;
    }

    if (enable) {
      // Giảm âm lượng video gốc
      const targetVolume = this.config.originalVideoVolume * this.config.duckingRatio;
      this.video.volume = Math.max(0, Math.min(1, targetVolume));
    } else {
      // Khôi phục âm lượng video gốc
      this.video.volume = Math.max(0, Math.min(1, this.config.originalVideoVolume));
    }
  }

  /**
   * Dừng phát giọng đọc (khi pause, seek hoặc đổi segment)
   */
  stopSpeaking(resetSegmentId = true) {
    if (this.synth) {
      this.synth.cancel();
    }
    this.activeUtterance = null;
    this.applyAudioDucking(false);
    if (resetSegmentId) {
      this.lastSpokenSegmentId = null;
    }
  }

  /**
   * Phát thử giọng đọc đã cấu hình
   */
  testVoice(sampleText = 'Xin chào, đây là giọng thuyết minh AI thử nghiệm.') {
    if (!this.synth) {
      throw new Error('Trình duyệt của bạn không hỗ trợ Web Speech API.');
    }

    this.stopSpeaking(true);

    const utterance = new SpeechSynthesisUtterance(sampleText);
    utterance.volume = this.config.volume;
    utterance.rate = this.config.rate;
    utterance.pitch = this.config.pitch;

    if (this.config.voiceURI) {
      const selected = this.availableVoices.find((v) => v.voiceURI === this.config.voiceURI);
      if (selected) utterance.voice = selected;
    } else if (this.config.lang) {
      const matchingVoices = this.getVoicesForLanguage(this.config.lang);
      if (matchingVoices.length > 0) utterance.voice = matchingVoices[0];
    }

    this.synth.speak(utterance);
  }
}

// Gán vào Window
window.TimeUtils = TimeUtils;
window.SubtitleEngine = SubtitleEngine;
window.DubbingEngine = DubbingEngine;
